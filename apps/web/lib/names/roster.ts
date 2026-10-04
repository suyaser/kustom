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

/**
 * What the labels are computed from, before a page's extra people are added: the roster's players
 * and the first games of the ones who clash among themselves. Plain JSON on purpose (arrays and a
 * record, no `Map`), so a page may keep it in the server cache across requests (performance plan,
 * phase 2; Tonight tags it `roster:<groupId>`, `games:<groupId>` and `names`). The labels themselves
 * are always computed per render from it ({@link loadRosterLabels}); a labelled list is never cached.
 */
export interface RosterInputs {
  roster: RosterPlayer[];
  /** `players.id` -> earliest `games.started_at` in the group, for the checked players who have one. */
  firsts: Record<string, string>;
  /** Every `players.id` whose first game was looked up, with or without an answer. */
  checked: string[];
}

/**
 * The roster's players and its own clashes' first games, in three rounds at most: the two id lists
 * side by side, the players (every chunk at once), then, only with a clash, one batched first-game
 * read. Throws on a failed read; {@link loadRosterLabels} turns that into plain names.
 */
export async function readRosterInputs(client: PublicClient, groupId: string): Promise<RosterInputs> {
  const ids = await readRosterIds(client, groupId);
  const roster = await readPlayers(client, 'id', [...ids]);
  const colliding = collidingNames(roster);
  const checked = roster.flatMap((player) => (colliding.has(player.puuid) ? [player.playerId] : []));
  const firsts =
    checked.length === 0 ? new Map<string, string>() : await readFirstGames(client, groupId, checked);
  return { roster, firsts: Object.fromEntries(firsts), checked };
}

export async function loadRosterLabels(
  client: PublicClient,
  groupId: string,
  extra: readonly { puuid: string; name: PlayerName }[] = [],
  options: {
    /**
     * The roster's inputs when the caller already has them (Tonight's server-cached copy), or a
     * promise of them, so the read can start before the extra people are known. Absent: read here.
     * A rejected promise is a failed read: plain names.
     */
    inputs?: RosterInputs | Promise<RosterInputs>;
  } = {},
): Promise<NameLabels> {
  try {
    const inputs = await (options.inputs ?? readRosterInputs(client, groupId));
    const roster = inputs.roster;
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

    // First games the inputs already answered; only a clash an extra person brought in (a
    // first-timer named like somebody on the roster) is read now.
    const firsts = new Map(Object.entries(inputs.firsts));
    const checked = new Set(inputs.checked);
    const unknown = everyone.flatMap((player) =>
      colliding.has(player.puuid) && player.playerId !== null && !checked.has(player.playerId)
        ? [player.playerId]
        : [],
    );
    if (unknown.length > 0) {
      for (const [playerId, startedAt] of await readFirstGames(client, groupId, unknown)) {
        firsts.set(playerId, startedAt);
      }
    }
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

/** The group's rated players and its members: both lists side by side, each paging on its own. */
async function readRosterIds(client: PublicClient, groupId: string): Promise<Set<string>> {
  const [rated, members] = await Promise.all([
    readAllIds(client, 'ratings', groupId, 'rating roster'),
    readAllIds(client, 'group_members_public', groupId, 'member roster'),
  ]);
  return new Set([...rated, ...members]);
}

async function readAllIds(
  client: PublicClient,
  table: 'ratings' | 'group_members_public',
  groupId: string,
  what: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1_000) {
    const base = table === 'ratings' ? client.from('ratings') : client.from('group_members_public');
    const { data, error } = await base
      .select('player_id')
      .eq('group_id', groupId)
      .order('player_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`names: ${what} failed: ${error.message}`);
    for (const row of data ?? []) if (row.player_id !== null) ids.push(row.player_id);
    if ((data ?? []).length < 1_000) break;
  }
  return ids;
}

async function readPlayers(
  client: PublicClient,
  column: 'id' | 'puuid',
  values: readonly string[],
): Promise<RosterPlayer[]> {
  // Every chunk at once: a big roster is several `in` lists, never several round trips in a row.
  const pages = await Promise.all(
    inChunks(values).map(async (chunk) => {
      const { data, error } = await client
        .from('players_public')
        .select('id, puuid, display_name, game_name, tag_line')
        .in(column, chunk);
      if (error) throw new Error(`names: player lookup failed: ${error.message}`);
      return data ?? [];
    }),
  );
  const out: RosterPlayer[] = [];
  for (const row of pages.flat()) {
    if (row.id === null || row.puuid === null) continue;
    out.push({
      playerId: row.id,
      puuid: row.puuid,
      name: row.display_name ?? row.game_name ?? null,
      tag: row.tag_line,
    });
  }
  return out;
}

/** PostgREST's `max_rows`: one page of the first-game read. */
const FIRST_GAME_PAGE = 1_000;

/**
 * Each player's earliest `started_at` in this group, for every clashing player **in one read**: the
 * group's games any of them played, oldest first (`started_at`, then `id`, the order the old
 * per-player read used), each with only their rows embedded; the first game a player appears in is
 * theirs. Never a scan of their scoreboard rows, which PostgREST would cut at its `max_rows` (1000)
 * and so order a busy pair's `(2)` / `(3)` wrongly (code review).
 *
 * A full page may have stopped before somebody's first game (a busy player's thousand earlier
 * games): the next page asks again, from the start, for the players still unanswered only. So
 * every page answers at least one more player, and a player with no game here ends the read with
 * a short page. There are only ever a few, so it is one round trip in practice.
 */
async function readFirstGames(
  client: PublicClient,
  groupId: string,
  playerIds: readonly string[],
): Promise<Map<string, string>> {
  const firsts = new Map<string, string>();
  await Promise.all(
    inChunks(playerIds).map(async (chunk) => {
      let unresolved = chunk;
      while (unresolved.length > 0) {
        const { data, error } = await client
          .from('games')
          .select('id, started_at, game_players!inner(player_id)')
          .eq('group_id', groupId)
          .in('game_players.player_id', unresolved)
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(FIRST_GAME_PAGE);
        if (error) throw new Error(`names: first game lookup failed: ${error.message}`);
        const rows = data ?? [];
        for (const game of rows) {
          for (const seat of game.game_players) {
            if (!firsts.has(seat.player_id)) firsts.set(seat.player_id, game.started_at);
          }
        }
        if (rows.length < FIRST_GAME_PAGE) break;
        unresolved = unresolved.filter((playerId) => !firsts.has(playerId));
      }
    }),
  );
  return firsts;
}
