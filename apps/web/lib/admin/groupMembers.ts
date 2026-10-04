import { type GroupRole, groupRoleSchema } from '@customs/db/schemas';
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

/** PostgREST answers at most this many rows per request; the games read pages through them. */
const PAGE = 1000;

/** How many of the group's games each player played, and when they last did. */
async function readPlayed(
  client: ServiceClient,
  groupId: string,
): Promise<Map<string, { games: number; last: string | null }>> {
  const played = new Map<string, { games: number; last: string | null }>();
  const readPage = (from: number, count: boolean) =>
    client
      .from('game_players')
      .select('player_id, games!inner(started_at)', count ? { count: 'exact' } : {})
      .eq('group_id', groupId)
      .order('game_id', { ascending: true })
      .order('player_id', { ascending: true })
      .range(from, from + PAGE - 1);
  // The first page carries the total, so the rest are read side by side (app-perf, 2026-10-04): two
  // rounds for any history, where a page-after-page loop was one round per thousand rows.
  const first = await readPage(0, true);
  const total = first.count ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      readPage((i + 1) * PAGE, false),
    ),
  );
  for (const { data, error: gamesError } of [first, ...rest]) {
    if (gamesError) throw new Error(`members: reading games failed: ${gamesError.message}`);
    for (const row of data ?? []) {
      const entry = played.get(row.player_id) ?? { games: 0, last: null };
      entry.games += 1;
      const at = row.games.started_at;
      if (entry.last === null || at > entry.last) entry.last = at;
      played.set(row.player_id, entry);
    }
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
