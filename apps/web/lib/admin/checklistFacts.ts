import { supabaseDiscordConnectStore } from '../discord/connect';
import type { ServiceClient } from '../supabase';
import type { ChecklistFacts } from './checklist';
import { hostAccount } from './hostName';

/**
 * The facts behind `Get your group ready` (`checklist.ts`), read with the service role: every table
 * here is service-role only (`discord_config` holds a secret, `companion_tokens` hashes,
 * `group_memberships` who runs what). Four small reads, all keyed on the group; nothing is written.
 * Only the facts leave this file: never the webhook URL, never a token hash.
 */
export async function loadChecklistFacts(client: ServiceClient, groupId: string): Promise<ChecklistFacts> {
  const [discord, members, hosts, games] = await Promise.all([
    supabaseDiscordConnectStore(client).readStatus(groupId),
    client
      .from('group_memberships')
      .select('player_id', { count: 'exact', head: true })
      .eq('group_id', groupId),
    client
      .from('companion_tokens')
      .select('label, last_seen_at, players!inner(display_name, game_name)')
      .eq('group_id', groupId)
      .is('revoked_at', null),
    client.from('games').select('id').eq('group_id', groupId).limit(1),
  ]);
  if (members.error) throw new Error(`checklist: counting members failed: ${members.error.message}`);
  if (hosts.error) throw new Error(`checklist: reading hosts failed: ${hosts.error.message}`);
  if (games.error) throw new Error(`checklist: reading games failed: ${games.error.message}`);

  return {
    discord: {
      webhookSet: discord?.webhookSet ?? false,
      // M14.20 (`0025`): when the last test post landed, and Discord's reason when it did not.
      testPostAt: discord?.testPostAt ?? null,
      testPostError: discord?.testPostError ?? null,
    },
    members: members.count ?? 0,
    hosts: (hosts.data ?? []).map((row) => ({
      label: row.label,
      account: hostAccount({ displayName: row.players.display_name, gameName: row.players.game_name }),
      lastSeenAt: row.last_seen_at,
    })),
    hasGame: (games.data ?? []).length > 0,
  };
}
