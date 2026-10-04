import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import { supabaseDiscordConnectStore } from '@/lib/discord/connect';
import type { DiscordOAuthEnv } from '@/lib/env';
import type { ServiceClient } from '@/lib/supabase';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { discordCallbackRoute } from './callback/handler';
import { discordConnectRoute } from './connect/handler';

/**
 * Connect Discord (M14.20) against the local stack: the Supabase store and `0025` (the state table,
 * the atomic consume, the test-post columns and the trigger that clears them). Discord is faked;
 * the session is injected; every row is read for real.
 *
 * Skipped, not failed, without the local stack -- **and until `0025` is applied** (the lane does not
 * apply migrations to the shared stack; the lead does after review).
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

const db =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

async function hasMigration(): Promise<boolean> {
  if (db === null) return false;
  const { error } = await db.from('discord_connect_states').select('state_hash').limit(1);
  if (error) return false;
  const columns = await db.from('discord_config').select('test_post_at, test_post_error').limit(1);
  return columns.error === null;
}

if (stack === null || authUsers === null || db === null || !(await hasMigration())) {
  describe.skip('Connect Discord against the local Supabase stack', () => {
    it('needs the local stack (`pnpm db:start`) with 0025 applied', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

  const ENV: DiscordOAuthEnv = {
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_CLIENT_SECRET: 'it-secret',
    DISCORD_REDIRECT_URI: 'http://localhost:3000/api/admin/discord/callback',
  };
  const runId = randomUUID().slice(0, 8);
  const groups = { a: '', b: '' };
  let hana = '';
  let zoe = '';
  const webhook = (n: number) => ({
    id: `22345678901234567${n}`,
    token: `It_${runId}_token_abcdefghijklmnopqrstuvwxyz_${n}`,
    channel_id: '423456789012345678',
    guild_id: '323456789012345678',
  });
  let posts = 0;

  function fakeFetch(n: number): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return Response.json({
          access_token: 'it-access',
          refresh_token: 'it-refresh',
          token_type: 'Bearer',
          scope: 'webhook.incoming',
          webhook: webhook(n),
        });
      }
      posts += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
  }

  const adminOf: Record<string, string[]> = {};
  function opts(userId: string, n = 1) {
    return {
      getClient: () => db as ServiceClient,
      env: () => ENV,
      fetchImpl: fakeFetch(n),
      authorize: async (_r: Request, _c: ServiceClient, groupId: string | null): Promise<AdminAuthResult> =>
        groupId !== null && (adminOf[userId] ?? []).includes(groupId)
          ? {
              ok: true,
              admin: {
                userId,
                discordId: '1',
                playerId: 'p',
                groupId,
                puuid: 'x',
                displayName: null,
                email: null,
                discordName: null,
              },
            }
          : { ok: false, status: 403, error: 'not an admin of this group' },
    };
  }

  async function stateFor(userId: string, groupId: string): Promise<string> {
    const response = await discordConnectRoute(opts(userId))(
      new Request(`http://localhost:3000/api/admin/discord/connect?groupId=${groupId}`),
    );
    expect(response.status).toBe(303);
    return new URL(response.headers.get('location') ?? '').searchParams.get('state') ?? '';
  }

  async function back(userId: string, state: string, n = 1) {
    const url = new URL('http://localhost:3000/api/admin/discord/callback');
    url.searchParams.set('state', state);
    url.searchParams.set('code', 'c');
    return discordCallbackRoute(opts(userId, n))(new Request(url));
  }

  const config = async (groupId: string) =>
    (await db.from('discord_config').select('*').eq('group_id', groupId).maybeSingle()).data;

  beforeAll(async () => {
    [hana, zoe] = authUsers.create([`hana-${runId}@example.invalid`, `zoe-${runId}@example.invalid`]) as [
      string,
      string,
    ];
    const made = await createTestGroups(db, runId, ['dca', 'dcb'] as const);
    groups.a = made.dca;
    groups.b = made.dcb;
    adminOf[hana] = [groups.a];
    adminOf[zoe] = [groups.b];
  });

  afterAll(async () => {
    await db.from('discord_connect_states').delete().in('group_id', Object.values(groups));
    await deleteTestGroups(db, Object.values(groups));
    authUsers.remove([hana, zoe].filter(Boolean));
  });

  it('connects: stores the webhook for the group only, posts once, records the test post', async () => {
    const state = await stateFor(hana, groups.a);
    const before = posts;
    const response = await back(hana, state);
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('discord')).toBe('connected');
    expect(posts - before).toBe(1);

    const row = await config(groups.a);
    expect(row?.webhook_url).toBe(`https://discord.com/api/webhooks/${webhook(1).id}/${webhook(1).token}`);
    expect(row?.guild_id).toBe(webhook(1).guild_id);
    expect(row?.results_channel_id).toBe(webhook(1).channel_id);
    expect(row?.test_post_at).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain('it-access');
    expect(JSON.stringify(row)).not.toContain('it-refresh');
    expect(await config(groups.b)).toBeNull();
  });

  it('refuses the same state twice and stores nothing more', async () => {
    const state = await stateFor(hana, groups.a);
    expect((await back(hana, state, 2)).status).toBe(303);
    const after = await config(groups.a);
    const again = await back(hana, state, 3);
    expect(new URL(again.headers.get('location') ?? '').searchParams.get('discord')).toBe('failed');
    expect((await config(groups.a))?.webhook_url).toBe(after?.webhook_url);
  });

  it("refuses another group's state and writes nothing in either group", async () => {
    const stateB = await stateFor(zoe, groups.b);
    const beforeA = JSON.stringify(await config(groups.a));
    expect((await back(hana, stateB)).status).toBe(403);
    expect(JSON.stringify(await config(groups.a))).toBe(beforeA);
    expect(await config(groups.b)).toBeNull();
  });

  it('a state past its expiry cannot be consumed (the database checks the time)', async () => {
    const store = supabaseDiscordConnectStore(db);
    await stateFor(hana, groups.a);
    const { data } = await db
      .from('discord_connect_states')
      .select('state_hash, expires_at')
      .eq('group_id', groups.a)
      .is('used_at', null)
      .limit(1)
      .single();
    if (!data) throw new Error('no state');
    const late = new Date(Date.parse(data.expires_at) + 1).toISOString();
    expect(await store.consumeState(data.state_hash, late)).toBe(false);
    expect(await store.consumeState(data.state_hash, new Date().toISOString())).toBe(true);
    expect(await store.consumeState(data.state_hash, new Date().toISOString())).toBe(false);
  });

  it('a new webhook from any path clears the old test post (0025 trigger)', async () => {
    expect((await config(groups.a))?.test_post_at).not.toBeNull();
    // The paste route's write, as it is: only the webhook changes.
    await db
      .from('discord_config')
      .update({ webhook_url: 'https://discord.com/api/webhooks/1/pasted' })
      .eq('group_id', groups.a);
    const row = await config(groups.a);
    expect([row?.test_post_at, row?.test_post_error]).toEqual([null, null]);
    // A write that leaves the webhook alone keeps the test post.
    await db
      .from('discord_config')
      .update({ test_post_at: '2026-10-03T20:00:00.000Z' })
      .eq('group_id', groups.a);
    await db.from('discord_config').update({ lobby_voice_channel_id: '1' }).eq('group_id', groups.a);
    expect(Date.parse((await config(groups.a))?.test_post_at ?? '')).toBe(
      Date.parse('2026-10-03T20:00:00.000Z'),
    );
  });

  it('the paste fallback with sendTestPost saves, posts once and records test_post_at; a failed post keeps the reason', async () => {
    const { withAdminAuth } = await import('@/lib/adminRoute');
    const { discordConfigHandler } = await import('../discord-config/handler');
    const { discordConfigRequestSchema } = await import('../discord-config/schema');
    const pasted = 'https://discord.com/api/webhooks/523456789012345678/pasted-token_abcdefghijklmn';
    const paste = (status: number) => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return status === 204
          ? new Response(null, { status })
          : Response.json({ message: 'Unknown Webhook', code: 10015 }, { status });
      }) as typeof fetch;
      const route = withAdminAuth(discordConfigRequestSchema, discordConfigHandler({ fetchImpl }), {
        getClient: () => db as ServiceClient,
        authorize: opts(zoe).authorize,
      });
      return { calls, route };
    };
    const body = (sendTestPost: boolean) =>
      new Request('http://localhost/api/admin/discord-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          groupId: groups.b,
          guildId: 'it-guild',
          webhookUrl: pasted,
          resultsChannelId: '',
          lobbyVoiceChannelId: '',
          blueVoiceChannelId: '',
          redVoiceChannelId: '',
          sendTestPost,
        }),
      });

    const ok = paste(204);
    const saved = (await (await ok.route(body(true))).json()) as { testPost: { posted: boolean } };
    expect(saved.testPost.posted).toBe(true);
    expect(ok.calls).toEqual([pasted]);
    const row = await config(groups.b);
    expect(row?.webhook_url).toBe(pasted);
    expect(row?.test_post_at).not.toBeNull();

    // Without the flag the route is what it always was: no post, the record untouched.
    const quiet = paste(204);
    const plain = (await (await quiet.route(body(false))).json()) as Record<string, unknown>;
    expect(plain.testPost).toBeUndefined();
    expect(quiet.calls).toEqual([]);
    expect((await config(groups.b))?.test_post_at).toBe(row?.test_post_at);

    const bad = paste(404);
    const failed = (await (await bad.route(body(true))).json()) as {
      testPost: { posted: boolean; testPostError: string };
    };
    expect(failed.testPost).toMatchObject({ posted: false, testPostError: 'Discord said: Unknown Webhook' });
    expect(await config(groups.b)).toMatchObject({
      webhook_url: pasted,
      test_post_at: null,
      test_post_error: 'Discord said: Unknown Webhook',
    });
  });

  it('the state table is closed to anon', async () => {
    const anon = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });
    const { data, error } = await anon.from('discord_connect_states').select('state_hash');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
}
