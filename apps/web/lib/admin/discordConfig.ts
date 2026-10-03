import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeOk } from './result';

/**
 * A group's `discord_config` row (`/admin/discord`).
 *
 * **One row per group** since M13.4 (`0020`: `group_id` is the primary key). Two groups may share
 * a Discord server with different channels, so the guild id is just a field. The table holds a
 * secret — the webhook URL is a bearer credential
 * for posting into the results channel — so it has no read policy at all and only the service
 * role ever touches it. The page shows the webhook masked; an admin overwrites it by typing a
 * new one, and clears it with the explicit "clear" box. An empty field means "leave it alone",
 * because a masked value cannot be round-tripped through a form.
 */

export interface AdminDiscordConfig {
  guildId: string;
  webhookUrl: string | null;
  resultsChannelId: string | null;
  lobbyVoiceChannelId: string | null;
  blueVoiceChannelId: string | null;
  redVoiceChannelId: string | null;
  updatedAt: string;
}

/**
 * The group's config as a list of at most one (the page's shape predates `0020`, when a second
 * guild's row could exist and the page warned about it; the key makes that impossible now).
 */
export async function listDiscordConfigs(
  client: ServiceClient,
  groupId: string,
): Promise<AdminDiscordConfig[]> {
  const { data, error } = await client
    .from('discord_config')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`listDiscordConfigs failed: ${error.message}`);
  return (data ?? []).map(toAdminDiscordConfig);
}

/** One group's row, by its primary key. */
export async function getDiscordConfig(
  client: ServiceClient,
  groupId: string,
): Promise<AdminDiscordConfig | null> {
  const { data, error } = await client
    .from('discord_config')
    .select('*')
    .eq('group_id', groupId)
    .maybeSingle();

  if (error) throw new Error(`getDiscordConfig failed: ${error.message}`);
  if (!data) return null;
  return toAdminDiscordConfig(data);
}

function toAdminDiscordConfig(data: {
  guild_id: string;
  webhook_url: string | null;
  results_channel_id: string | null;
  lobby_voice_channel_id: string | null;
  blue_voice_channel_id: string | null;
  red_voice_channel_id: string | null;
  updated_at: string;
}): AdminDiscordConfig {
  return {
    guildId: data.guild_id,
    webhookUrl: data.webhook_url,
    resultsChannelId: data.results_channel_id,
    lobbyVoiceChannelId: data.lobby_voice_channel_id,
    blueVoiceChannelId: data.blue_voice_channel_id,
    redVoiceChannelId: data.red_voice_channel_id,
    updatedAt: data.updated_at,
  };
}

export interface SaveDiscordConfigInput {
  /** The request's group (M13.4): the row written is this group's and no other. */
  groupId: string;
  guildId: string;
  /** `undefined` keeps whatever is stored; a string overwrites it; `null` clears it. */
  webhookUrl?: string | null;
  resultsChannelId: string | null;
  lobbyVoiceChannelId: string | null;
  blueVoiceChannelId: string | null;
  redVoiceChannelId: string | null;
}

/**
 * Writes the request's group's row and nothing else.
 *
 * Keyed by the primary key (`group_id`, M13.4), never by "the first row" and never by the guild:
 * two groups in one Discord server each keep their own channels, and saving one group's config
 * cannot touch another's.
 */
export async function saveDiscordConfig(
  client: ServiceClient,
  input: SaveDiscordConfigInput,
): Promise<AdminWriteResult<AdminDiscordConfig>> {
  const row = {
    group_id: input.groupId,
    guild_id: input.guildId,
    results_channel_id: input.resultsChannelId,
    lobby_voice_channel_id: input.lobbyVoiceChannelId,
    blue_voice_channel_id: input.blueVoiceChannelId,
    red_voice_channel_id: input.redVoiceChannelId,
    ...(input.webhookUrl === undefined ? {} : { webhook_url: input.webhookUrl }),
  };

  const { error } = await client.from('discord_config').upsert(row, { onConflict: 'group_id' });
  if (error) throw new Error(`saveDiscordConfig failed: ${error.message}`);

  const saved = await getDiscordConfig(client, input.groupId);
  if (saved === null) throw new Error('saveDiscordConfig: row vanished after write');
  return writeOk(saved);
}

/**
 * `https://discord.com/api/webhooks/12345/…kQ9f`. Enough for an admin to tell whether the
 * right webhook is stored, not enough for anyone reading over a shoulder to post with it.
 */
export function maskSecret(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 12) return '…'.padStart(trimmed.length, '•');

  const slash = trimmed.lastIndexOf('/');
  const head = slash > 0 ? trimmed.slice(0, Math.min(slash + 1, 44)) : trimmed.slice(0, 12);
  return `${head}…${trimmed.slice(-4)}`;
}
