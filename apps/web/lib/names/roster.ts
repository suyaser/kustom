import { inChunks } from '../chunks';
import type { PublicClient } from '../publicClient';
import type { PlayerName } from '../tonight/types';
import { collidingNames, distinctNames, type NamedPlayer, type NameLabel } from './distinct';

/**
 * The one roster-wide loader for same-name labels (M14.69, design review; lead ruling 2026-10-04):
 * every list of names in a group asks here, so the same person reads the same on the board, the
 * Games filter, the admin Members list, Tonight's Top this week, the lobby list and the team cards.
 *
 * The roster is everybody the group knows: its members (`group_members_public`) and anybody with a
 * `ratings` row in it (a rated game), plus any `extra` people a page is about to print who are not
 * on it yet (a first-timer in tonight's lobby). Clashes are decided over all of them, so a lone
 * `Ali (2)` in a quiet week still reads `Ali (2)`. Tags and first games are read **only for the
 * people who clash**.
 *
 * Anon-readable tables only, so the public pages and the service-role admin pages share it. A
 * failed read returns no labels (plain names, never a failed page), logged.
 */
export type NameLabels = ReadonlyMap<string, NameLabel>;

export const NO_LABELS: NameLabels = new Map();

interface RosterPlayer {
  playerId: string;
  puuid: string;
  name: PlayerName;
  tag: string | null;
}

export async function loadRosterLabels(
  client: PublicClient,
  groupId: string,
  extra: readonly { puuid: string; name: PlayerName }[] = [],
): Promise<NameLabels> {
  try {
    const ids = await readRosterIds(client, groupId);
    const roster = await readPlayers(client, 'id', [...ids]);
    const known = new Set(roster.map((player) => player.puuid));
    const missing = extra.filter((person) => !known.has(person.puuid));
    const extras =
      missing.length === 0
        ? []
        : await readPlayers(
            client,
            'puuid',
            missing.map((p) => p.puuid),
          );
    const found = new Set(extras.map((player) => player.puuid));
    const everyone: (RosterPlayer | (NamedPlayer & { playerId: null }))[] = [
      ...roster,
      ...extras,
      // Someone with no player row at all yet: their name still takes part in the clash.
      ...missing
        .filter((person) => !found.has(person.puuid))
        .map((person) => ({ playerId: null, puuid: person.puuid, name: person.name, tag: null })),
    ];

    const colliding = collidingNames(everyone);
    if (colliding.size === 0) return NO_LABELS;

    const clashIds = everyone.flatMap((player) =>
      colliding.has(player.puuid) && player.playerId !== null ? [player.playerId] : [],
    );
    const firsts = await readFirstGames(client, groupId, clashIds);
    return distinctNames(
      everyone.map((player) => ({
        puuid: player.puuid,
        name: player.name,
        tag: player.tag ?? null,
        firstGameAt: player.playerId === null ? null : (firsts.get(player.playerId) ?? null),
      })),
    );
  } catch (error) {
    console.error('names: reading the roster labels failed', error);
    return NO_LABELS;
  }
}

/** The label for one person, or null when their name prints as it is. */
export function labelFor(labels: NameLabels, puuid: string): NameLabel | null {
  return labels.get(puuid) ?? null;
}

/** A row's printed name and its muted suffix, for a row that keeps `name` and adds `nameSuffix`. */
export function withLabel<T extends { puuid: string; name: PlayerName }>(
  row: T,
  labels: NameLabels,
): T & { nameSuffix: string | null } {
  const label = labels.get(row.puuid);
  return label === undefined
    ? { ...row, nameSuffix: null }
    : { ...row, name: label.base, nameSuffix: label.suffix };
}

async function readRosterIds(client: PublicClient, groupId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await client
      .from('ratings')
      .select('player_id')
      .eq('group_id', groupId)
      .order('player_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`names: rating roster failed: ${error.message}`);
    for (const row of data ?? []) ids.add(row.player_id);
    if ((data ?? []).length < 1_000) break;
  }
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await client
      .from('group_members_public')
      .select('player_id')
      .eq('group_id', groupId)
      .order('player_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`names: member roster failed: ${error.message}`);
    for (const row of data ?? []) if (row.player_id !== null) ids.add(row.player_id);
    if ((data ?? []).length < 1_000) break;
  }
  return ids;
}

async function readPlayers(
  client: PublicClient,
  column: 'id' | 'puuid',
  values: readonly string[],
): Promise<RosterPlayer[]> {
  const out: RosterPlayer[] = [];
  for (const chunk of inChunks(values)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid, display_name, game_name, tag_line')
      .in(column, chunk);
    if (error) throw new Error(`names: player lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      out.push({
        playerId: row.id,
        puuid: row.puuid,
        name: row.display_name ?? row.game_name ?? null,
        tag: row.tag_line,
      });
    }
  }
  return out;
}

/**
 * Each player's earliest `started_at` in this group: one ordered, one-row read per clashing player
 * (there are only ever a few). Never a scan of their scoreboard rows, which PostgREST would cut at
 * its `max_rows` (1000) and so order a busy pair's `(2)` / `(3)` wrongly (code review).
 */
async function readFirstGames(
  client: PublicClient,
  groupId: string,
  playerIds: readonly string[],
): Promise<Map<string, string>> {
  const firsts = new Map<string, string>();
  const reads = await Promise.all(
    [...new Set(playerIds)].map(async (playerId) => {
      const { data, error } = await client
        .from('games')
        .select('id, started_at, game_players!inner(player_id)')
        .eq('group_id', groupId)
        .eq('game_players.player_id', playerId)
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
      if (error) throw new Error(`names: first game lookup failed: ${error.message}`);
      return [playerId, data?.[0]?.started_at] as const;
    }),
  );
  for (const [playerId, startedAt] of reads) if (startedAt !== undefined) firsts.set(playerId, startedAt);
  return firsts;
}
