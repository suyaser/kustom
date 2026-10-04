import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DiscordConnectResult } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * Connect Discord in one click (M14.20): the OAuth `state`, the store behind it, and the copy.
 *
 * **The state.** `<nonce>.<mac>`: 32 random bytes, and an HMAC-SHA256 over (nonce, group, auth
 * user) keyed from the server's Discord client secret. The server stores only sha256(nonce) in
 * `discord_connect_states` (`0025`), with the group, the auth user who pressed `Connect Discord`, a
 * ten-minute expiry and a `used_at`. So a state is:
 *
 * - **signed**: the MAC is checked against the stored group and user before anything else happens;
 * - **short-lived**: `expires_at` is checked in the same statement that consumes it;
 * - **single-use**: that statement is `update ... set used_at = now() where used_at is null and
 *   expires_at > now()`, so two racing callbacks get one row between them;
 * - **bound to the session and the group**: the callback requires the same verified auth user,
 *   still an admin of the stored group, and the webhook is written to that group and no other.
 *
 * Nothing here logs a state, a code, a token or a webhook URL.
 */

/** How long a `Connect Discord` press stays good. Discord's consent screen takes seconds. */
export const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

/** Product's sentence for cancelled, denied, expired or failed (M14.20 brief). */
export const CONNECT_FAILED = "Discord wasn't connected. Try again, or paste a webhook link instead.";

/** The callback's 403 when a state comes back to a different session than the one that made it. */
export const CONNECT_OTHER_SESSION = 'this Discord connect was started by someone else';

/** The callback's 400 for a state we never issued or whose signature does not hold. */
export const CONNECT_BAD_STATE = 'invalid state';

const STATE_PATTERN = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

function stateKey(clientSecret: string): Buffer {
  return createHmac('sha256', clientSecret).update('kustom discord connect state v1').digest();
}

function mac(clientSecret: string, nonce: string, groupId: string, authUserId: string): string {
  return createHmac('sha256', stateKey(clientSecret))
    .update(`${nonce}.${groupId.toLowerCase()}.${authUserId.toLowerCase()}`)
    .digest('base64url');
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/** A fresh state for (group, user), and the hash to store. */
export function mintConnectState(
  clientSecret: string,
  groupId: string,
  authUserId: string,
): { state: string; stateHash: string } {
  const nonce = randomBytes(32).toString('base64url');
  return { state: `${nonce}.${mac(clientSecret, nonce, groupId, authUserId)}`, stateHash: hashNonce(nonce) };
}

/** The nonce's hash when the state is shaped like one of ours, else null. Does not verify the MAC. */
export function stateHashOf(state: string): string | null {
  const match = STATE_PATTERN.exec(state);
  return match ? hashNonce(match[1] as string) : null;
}

/** True when the state's MAC holds for the stored group and user. Constant-time. */
export function verifyConnectState(
  clientSecret: string,
  state: string,
  groupId: string,
  authUserId: string,
): boolean {
  const match = STATE_PATTERN.exec(state);
  if (!match) return false;
  const expected = Buffer.from(mac(clientSecret, match[1] as string, groupId, authUserId));
  const given = Buffer.from(match[2] as string);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The page the callback lands on: `/g/<slug>/admin/discord?discord=<result>[&error=...]`. */
export function connectResultPath(slug: string, result: DiscordConnectResult, error?: string | null): string {
  const params = new URLSearchParams({ discord: result });
  if (error) params.set('error', error);
  return `/g/${encodeURIComponent(slug)}/admin/discord?${params.toString()}`;
}

/** `https://discord.com/api/webhooks/<id>/<token>`, built from the parsed parts, never taken as given. */
export function webhookUrlFrom(webhook: { id: string; token: string }): string {
  return `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface ConnectStateRow {
  groupId: string;
  authUserId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface DiscordStatusRow {
  webhookSet: boolean;
  guildId: string | null;
  channelId: string | null;
  testPostAt: string | null;
  testPostError: string | null;
}

/** Every read and write the connect flow makes. Supabase below; an in-memory one in the tests. */
export interface DiscordConnectStore {
  createState(row: {
    stateHash: string;
    groupId: string;
    authUserId: string;
    expiresAt: string;
  }): Promise<void>;
  findState(stateHash: string): Promise<ConnectStateRow | null>;
  /** Atomic: true for exactly one caller, and only while unused and unexpired at `nowIso`. */
  consumeState(stateHash: string, nowIso: string): Promise<boolean>;
  groupSlug(groupId: string): Promise<string | null>;
  /** Replaces the group's webhook (and the guild and results channel it belongs to). */
  saveWebhook(
    groupId: string,
    webhook: { webhookUrl: string; guildId: string; channelId: string },
  ): Promise<void>;
  readWebhookUrl(groupId: string): Promise<string | null>;
  recordTestPost(groupId: string, outcome: { at: string | null; error: string | null }): Promise<void>;
  readStatus(groupId: string): Promise<DiscordStatusRow | null>;
}

export function supabaseDiscordConnectStore(client: ServiceClient): DiscordConnectStore {
  return {
    async createState(row) {
      // Housekeeping first: states a day past their expiry are of no use to anyone.
      const cutoff = new Date(
        Date.parse(row.expiresAt) - CONNECT_STATE_TTL_MS - 24 * 60 * 60 * 1000,
      ).toISOString();
      const purge = await client.from('discord_connect_states').delete().lt('expires_at', cutoff);
      if (purge.error) throw new Error(`discord connect: purging old states failed: ${purge.error.message}`);

      const { error } = await client.from('discord_connect_states').insert({
        state_hash: row.stateHash,
        group_id: row.groupId,
        auth_user_id: row.authUserId,
        expires_at: row.expiresAt,
      });
      if (error) throw new Error(`discord connect: storing the state failed: ${error.message}`);
    },

    async findState(stateHash) {
      const { data, error } = await client
        .from('discord_connect_states')
        .select('group_id, auth_user_id, expires_at, used_at')
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (error) throw new Error(`discord connect: reading the state failed: ${error.message}`);
      if (data === null) return null;
      return {
        groupId: data.group_id,
        authUserId: data.auth_user_id,
        expiresAt: data.expires_at,
        usedAt: data.used_at,
      };
    },

    async consumeState(stateHash, nowIso) {
      const { data, error } = await client
        .from('discord_connect_states')
        .update({ used_at: nowIso })
        .eq('state_hash', stateHash)
        .is('used_at', null)
        .gt('expires_at', nowIso)
        .select('state_hash');
      if (error) throw new Error(`discord connect: consuming the state failed: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async groupSlug(groupId) {
      const { data, error } = await client.from('groups').select('slug').eq('id', groupId).maybeSingle();
      if (error) throw new Error(`discord connect: reading the group failed: ${error.message}`);
      return data?.slug ?? null;
    },

    async saveWebhook(groupId, webhook) {
      const { error } = await client.from('discord_config').upsert(
        {
          group_id: groupId,
          guild_id: webhook.guildId,
          webhook_url: webhook.webhookUrl,
          results_channel_id: webhook.channelId,
        },
        { onConflict: 'group_id' },
      );
      if (error) throw new Error(`discord connect: saving the webhook failed: ${error.message}`);
    },

    async readWebhookUrl(groupId) {
      const { data, error } = await client
        .from('discord_config')
        .select('webhook_url')
        .eq('group_id', groupId)
        .maybeSingle();
      if (error) throw new Error(`discord connect: reading the webhook failed: ${error.message}`);
      const url = data?.webhook_url?.trim();
      return url ? url : null;
    },

    async recordTestPost(groupId, outcome) {
      const { error } = await client
        .from('discord_config')
        .update({ test_post_at: outcome.at, test_post_error: outcome.error })
        .eq('group_id', groupId);
      if (error) throw new Error(`discord connect: recording the test post failed: ${error.message}`);
    },

    async readStatus(groupId) {
      const { data, error } = await client
        .from('discord_config')
        .select('guild_id, results_channel_id, test_post_at, test_post_error, webhook_url')
        .eq('group_id', groupId)
        .maybeSingle();
      if (error) throw new Error(`discord connect: reading the status failed: ${error.message}`);
      if (data === null) return null;
      return {
        webhookSet: (data.webhook_url ?? '').trim().length > 0,
        guildId: data.guild_id,
        channelId: data.results_channel_id,
        testPostAt: data.test_post_at,
        testPostError: data.test_post_error,
      };
    },
  };
}
