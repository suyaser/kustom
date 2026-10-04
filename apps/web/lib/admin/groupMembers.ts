import { type GroupRole, groupRoleSchema, memberGameCountRowSchema } from '@customs/db/schemas';
import { loadRosterLabels } from '../names/roster';
import type { ServiceClient } from '../supabase';
import { sortMembers } from './memberList';
import { playerLabel } from './playerName';

/**
 * The Members page's rows (M14.22; STRATEGY 3.5): everyone with a membership in **this** group, with
 * their role, how many of the group's games they played and when they last did. Service-role reads
 * (`group_memberships` is not public), all keyed on the group, so an admin of A never sees B's people.
 * Nothing is written.
 */
export interface GroupMemberRow {
  playerId: string;
  puuid: string;
  /** The name people know them by; `Someone` when there is none yet (admin round 2: never a PUUID fragment). */
  name: string;
  /** False when there is no display name and no Riot ID yet (`name` is then `Someone`). */
  named: boolean;
  /** The Riot tag (the roster-wide label below decides whether it prints). */
  tagLine?: string | null;
  /**
   * The same-name suffix (`#EUW`, `(2)`), muted after the name, from the group's roster-wide labels
   * (M14.69, `lib/names/roster.ts`): the same label the board and Tonight print. Null when the name
   * is unique. `Find someone` still matches the plain name.
   */
  nameSuffix?: string | null;
  role: GroupRole;
  games: number;
  /** `games.started_at` of their latest game in this group, or `null` for none yet. */
  lastPlayedAt: string | null;
  /** `group_memberships.ai_opt_out` (M16.3b): left out of AI lines in this group. */
  aiOptOut: boolean;
  /**
   * M14.60: a Discord account is linked to this player (`players.discord_id` set), so the Manage
   * panel can offer `Unlink Discord`. The id itself never leaves the server.
   */
  discordLinked: boolean;
}

/**
 * How many of the group's games each player played, and when they last did: one row per player from
 * `group_member_game_counts` (0042), counted by Postgres over `game_players_group_player_idx`. It
 * replaced paging every `game_players` row of the group to the server (2.1 MB in 29 requests on a
 * year-old group, `redesign/research/db-performance.md` finding 8). Every stored game counts, rated
 * or not, as before. A group has far fewer than PostgREST's 1,000-row cap of players.
 */
async function readPlayed(
  client: ServiceClient,
  groupId: string,
): Promise<Map<string, { games: number; last: string | null }>> {
  const { data, error } = await client
    .from('group_member_game_counts')
    .select('player_id, games, last_played_at')
    .eq('group_id', groupId);
  if (error) throw new Error(`members: reading games failed: ${error.message}`);
  const played = new Map<string, { games: number; last: string | null }>();
  for (const row of data ?? []) {
    const parsed = memberGameCountRowSchema.safeParse(row);
    if (!parsed.success) continue;
    played.set(parsed.data.player_id, { games: parsed.data.games, last: parsed.data.last_played_at });
  }
  return played;
}

export async function loadGroupMembers(client: ServiceClient, groupId: string): Promise<GroupMemberRow[]> {
  const [{ data: memberships, error }, labels, played] = await Promise.all([
    client
      .from('group_memberships')
      .select('role, ai_opt_out, players!inner(id, puuid, display_name, game_name, tag_line, discord_id)')
      .eq('group_id', groupId),
    loadRosterLabels(client, groupId),
    readPlayed(client, groupId),
  ]);
  if (error) throw new Error(`members: reading memberships failed: ${error.message}`);

  const rows: GroupMemberRow[] = [];
  for (const membership of memberships ?? []) {
    // A role the union does not know (a hand-edited row) grants nothing and is not listed as one.
    const role = groupRoleSchema.safeParse(membership.role);
    if (!role.success) continue;
    const player = membership.players;
    const stats = played.get(player.id);
    const named = Boolean(player.display_name?.trim() || player.game_name?.trim());
    rows.push({
      playerId: player.id,
      puuid: player.puuid,
      // `Someone` when there is no name yet (playerLabel's last resort, admin round 2).
      name: playerLabel({
        puuid: player.puuid,
        displayName: player.display_name,
        gameName: player.game_name,
        tagLine: player.tag_line,
      }),
      named,
      tagLine: player.tag_line?.trim() || null,
      nameSuffix: labels.get(player.puuid)?.suffix ?? null,
      role: role.data,
      games: stats?.games ?? 0,
      lastPlayedAt: stats?.last ?? null,
      aiOptOut: membership.ai_opt_out,
      discordLinked: player.discord_id !== null,
    });
  }
  return sortMembers(rows);
}
