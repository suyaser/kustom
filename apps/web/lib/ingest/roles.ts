import { inferRoles, type Role, type RoleGame, resolveRoles } from '@customs/core';
import { readAssignments } from '../discord/assemble';
import type { ServiceClient } from '../supabase';

/**
 * Inferred roles (M5.17): the database half of `inferRoles` (M5.16, `@customs/core`).
 *
 * Two jobs, and they happen at two different moments:
 *
 * 1. **The guard, at fold time.** `roleInferenceFlags` asks, for one game, whether the balancer
 *    put each player on a role they claim. The answer is written to
 *    `game_players.counts_for_role_inference` by the same update that claims the rating columns
 *    (`rating.ts`), because it is only knowable now: the roles it is measured against are about
 *    to be overwritten by the recompute below, and a month from now nothing could reconstruct
 *    it. Without the guard the inference eats itself — a support filled into jungle twice
 *    becomes a jungle main, is balanced as one, and never plays support again
 *    (`04-decisions.md`, 2026-09-10).
 *
 * 2. **The recompute, after the fold.** `recomputeInferredRoles` folds a player's *rated* games
 *    through `inferRoles` and writes the answer back to `players.main_role` /
 *    `secondary_role` — the columns the balancer already reads — plus `roles_counted` and
 *    `roles_inferred_at`. It runs after every rated game for the ten who played it, and at the
 *    end of `rebuild-ratings` for everybody. Nowhere else: a pair changing is not an event
 *    anything announces.
 *
 * No arithmetic lives here. Which role is a main is `inferRoles`; whether an assignment is
 * on-role is `resolveRoles`, the balancer's own rule (CLAUDE.md).
 */

/** PostgREST's `max_rows`. Every select here pages; a group's history outgrows one page. */
const PAGE_SIZE = 1000;

/** Single-row updates in flight at once. Ten per game, the whole roster per rebuild. */
const WRITE_CONCURRENCY = 10;

/**
 * Player ids per `in` list.
 *
 * The rebuild hands this function **every** `players.id`, so the id list is a URL that grows
 * with the roster rather than with the game. A uuid is 38 characters inside the list, so 200 is
 * about 7.5kB of query string — comfortably inside PostgREST's limit with the rest of the
 * select, and the calls are made once per rebuild.
 */
const ID_CHUNK = 200;

/** One participant, as much of them as the guard needs. */
export interface RoleProfileRow {
  playerId: string;
  puuid: string;
  mainRole: Role | null;
  secondaryRole: Role | null;
  /** The end-of-game side (M21.8): the team they actually played on. */
  side: number;
  /** The end-of-game role (M21.8), `null` when the client did not say. */
  role: Role | null;
}

/** One seat of the chosen split: who, which side, which role. */
export interface SplitSeat {
  puuid: string;
  side: 100 | 200;
  role: Role;
}

/**
 * The guard's rule (M5.17, amended by M21.8), pure: which players the balancer filled.
 *
 * Returns `false` entries only; everybody absent counts. `false` only when all of these hold:
 *
 * 1. there is a chosen split (`null`: nobody rolled, so nobody chose any seat);
 * 2. **the teams that played are the split's teams** (the same five and five, on either side).
 *    When the room made its own teams the bot did not choose those seats, so every game counts,
 *    the rule this function already stated for a game with no split (M21.8 (b));
 * 3. the split names the player and the role it gave them is neither tonight's main nor tonight's
 *    backup (a role-for-tonight tap is tonight's main; a flexible player is never off-role);
 * 4. they played that role: a player who swapped seats inside the team chose the role they played,
 *    so it counts. An end-of-game role the client did not report (`null`) keeps rule 3's answer.
 */
export function fillGuardFlags(
  split: readonly SplitSeat[] | null,
  players: readonly (RoleProfileRow & { roleOverride: Role | null })[],
): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  if (split === null || split.length === 0) return flags;
  if (!sameTeams(split, players)) return flags;

  const assigned = new Map(split.map((seat) => [seat.puuid, seat.role]));
  for (const player of players) {
    const role = assigned.get(player.puuid);
    if (role === undefined) continue;
    if (player.role !== null && player.role !== role) continue;
    const tonight = resolveRoles(player);
    const counts = tonight.main === null || role === tonight.main || role === tonight.secondary;
    if (!counts) flags.set(player.playerId, false);
  }
  return flags;
}

/** The split's two teams are the two teams that played, on the same sides or swapped. */
function sameTeams(split: readonly SplitSeat[], players: readonly { puuid: string; side: number }[]): boolean {
  const key = (puuids: string[]) => [...puuids].sort().join(' ');
  const splitBlue = key(split.filter((seat) => seat.side === 100).map((seat) => seat.puuid));
  const splitRed = key(split.filter((seat) => seat.side === 200).map((seat) => seat.puuid));
  const blue = key(players.filter((p) => p.side === 100).map((p) => p.puuid));
  const red = key(players.filter((p) => p.side === 200).map((p) => p.puuid));
  return (splitBlue === blue && splitRed === red) || (splitBlue === red && splitRed === blue);
}

/**
 * Did the balancer put each of these players on a role of their own? The I/O around
 * {@link fillGuardFlags}: the lobby's chosen split and tonight's taps.
 *
 * `true` (absent), the honest default and the column's default, whenever we did not choose the
 * seats: a backfilled game, a game played from no lobby, a lobby whose split we cannot read, a
 * game whose teams are not the split's (M21.8), a player who was not in the split at all, or a
 * player who played another role than the split's.
 */
export async function roleInferenceFlags(
  client: ServiceClient,
  lobbyId: string | null,
  players: readonly RoleProfileRow[],
): Promise<Map<string, boolean>> {
  if (lobbyId === null) return new Map();

  const split = await selectChosenSeats(client, lobbyId);
  if (split === null) return new Map();

  const overrides = await selectRoleOverrides(client, lobbyId);
  return fillGuardFlags(
    split,
    players.map((player) => ({ ...player, roleOverride: overrides.get(player.playerId) ?? null })),
  );
}

/** The chosen split's seats, or null when this lobby has no readable split. */
async function selectChosenSeats(client: ServiceClient, lobbyId: string): Promise<SplitSeat[] | null> {
  const { data, error } = await client
    .from('splits')
    .select('blue, red')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`roles: split lookup failed: ${error.message}`);
  if (!data) return null;
  return seatsOf(data.blue, data.red);
}

function seatsOf(blue: unknown, red: unknown): SplitSeat[] | null {
  const seats: SplitSeat[] = [
    ...readAssignments(blue).map((a) => ({ puuid: a.puuid, role: a.role, side: 100 as const })),
    ...readAssignments(red).map((a) => ({ puuid: a.puuid, role: a.role, side: 200 as const })),
  ];
  return seats.length === 0 ? null : seats;
}

/** One stored `false` flag the M21.8 rule releases (sets back to `true`). */
export interface ReleasedFlag {
  gameId: string;
  playerId: string;
}

/**
 * M21.8's one-time refold of history, idempotent: the stored `counts_for_role_inference = false`
 * rows of this group's games that the amended guard would leave `true` -- the game's teams are
 * not its lobby's chosen split, or the player played another role than the split gave them.
 *
 * Only `false` rows are looked at, and only ever released: the amended rule is the old one plus
 * two more ways to count, so it never turns a `true` into a `false`. That is also why history
 * can be refolded at all: the old rule measured against the role pair at fold time, which is gone,
 * but neither new condition needs it. A second run finds nothing.
 */
export async function selectReleasedFillFlags(client: ServiceClient, groupId: string): Promise<ReleasedFlag[]> {
  const filled: { gameId: string; playerId: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('game_players')
      .select('game_id, player_id')
      .eq('group_id', groupId)
      .eq('counts_for_role_inference', false)
      .order('game_id', { ascending: true })
      .order('player_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`roles: filled rows select failed: ${error.message}`);
    const rows = data ?? [];
    filled.push(...rows.map((row) => ({ gameId: row.game_id, playerId: row.player_id })));
    if (rows.length < PAGE_SIZE) break;
  }
  if (filled.length === 0) return [];

  const gameIds = [...new Set(filled.map((row) => row.gameId))];
  const seatsByGame = new Map<string, { playerId: string; puuid: string; side: number; role: Role | null }[]>();
  const lobbyByGame = new Map<string, string | null>();
  for (const chunk of chunked(gameIds)) {
    const { data, error } = await client
      .from('games')
      .select('id, lobby_id, game_players(player_id, side, role, players!inner(puuid))')
      .in('id', chunk);
    if (error) throw new Error(`roles: filled games select failed: ${error.message}`);
    for (const game of data ?? []) {
      lobbyByGame.set(game.id, game.lobby_id);
      seatsByGame.set(
        game.id,
        game.game_players.map((row) => ({
          playerId: row.player_id,
          puuid: row.players.puuid,
          side: row.side,
          role: row.role,
        })),
      );
    }
  }

  const lobbyIds = [...new Set([...lobbyByGame.values()].filter((id): id is string => id !== null))];
  const splitByLobby = new Map<string, SplitSeat[] | null>();
  for (const chunk of chunked(lobbyIds)) {
    const { data, error } = await client
      .from('splits')
      .select('lobby_id, blue, red')
      .in('lobby_id', chunk)
      .eq('is_chosen', true);
    if (error) throw new Error(`roles: filled splits select failed: ${error.message}`);
    for (const row of data ?? []) splitByLobby.set(row.lobby_id, seatsOf(row.blue, row.red));
  }

  const released: ReleasedFlag[] = [];
  for (const row of filled) {
    const lobbyId = lobbyByGame.get(row.gameId) ?? null;
    const split = lobbyId === null ? null : (splitByLobby.get(lobbyId) ?? null);
    const seats = seatsByGame.get(row.gameId) ?? [];
    if (!stillFilled(split, seats, row.playerId)) released.push(row);
  }
  return released;
}

/**
 * The amended rule's two new conditions only, for one stored `false` (pure): still filled when
 * there is a split, its teams are the teams that played, and the player played the split's role
 * (or no role was reported). The pair half of the rule is the stored `false` itself.
 */
export function stillFilled(
  split: readonly SplitSeat[] | null,
  seats: readonly { playerId: string; puuid: string; side: number; role: Role | null }[],
  playerId: string,
): boolean {
  if (split === null || split.length === 0) return false;
  if (!sameTeams(split, seats)) return false;
  const seat = seats.find((s) => s.playerId === playerId);
  if (seat === undefined) return false;
  const assigned = split.find((s) => s.puuid === seat.puuid)?.role;
  if (assigned === undefined) return false;
  return seat.role === null || seat.role === assigned;
}

/** Write {@link selectReleasedFillFlags}' answer: those rows back to `true`. Returns rows written. */
export async function releaseFillFlags(client: ServiceClient, rows: readonly ReleasedFlag[]): Promise<number> {
  let written = 0;
  for (let index = 0; index < rows.length; index += WRITE_CONCURRENCY) {
    const chunk = rows.slice(index, index + WRITE_CONCURRENCY);
    const counts = await Promise.all(
      chunk.map(async (row) => {
        const { error, count } = await client
          .from('game_players')
          .update({ counts_for_role_inference: true }, { count: 'exact' })
          .eq('game_id', row.gameId)
          .eq('player_id', row.playerId)
          .eq('counts_for_role_inference', false);
        if (error) throw new Error(`roles: releasing a fill flag failed: ${error.message}`);
        return count ?? 0;
      }),
    );
    written += counts.reduce((a, b) => a + b, 0);
  }
  return written;
}

/** Tonight's taps (M3.6), by player id. Absent is null, which `resolveRoles` reads as no tap. */
async function selectRoleOverrides(
  client: ServiceClient,
  lobbyId: string,
): Promise<Map<string, Role | null>> {
  const { data, error } = await client
    .from('lobby_members')
    .select('player_id, role_override')
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`roles: role_override lookup failed: ${error.message}`);

  return new Map((data ?? []).map((row) => [row.player_id, row.role_override]));
}

export interface RecomputeOptions {
  /** Injected so a test can pin `roles_inferred_at`. */
  now?: Date;
}

export interface RecomputeResult {
  /** Players whose stored pair, count or stamp moved. Zero on a second run: the idempotency. */
  changed: number;
  /** Players looked at. */
  considered: number;
}

/**
 * Recompute and store the inferred pair for these players.
 *
 * The universe is every **rated** game the player has — `mu_after is not null`, which is the
 * fold's own universe (a remake or a four-minute surrender never moved a rating and never moves
 * a role either). All of them, not a pre-sliced twenty: `inferRoles` orders by `started_at` and
 * takes its own window, so a game that lands out of order (backfill, then a rebuild) cannot
 * change the answer by arriving late.
 *
 * **Only rows that move are written.** `roles_inferred_at` is part of the row, so rewriting an
 * unchanged pair would make a second `rebuild-ratings` produce a different table and the
 * idempotency claim would be a lie. A player whose stamp is still null is written even when the
 * pair matches — that is the M1-era hand-set pair being adopted, and the stamp is what says so.
 */
export async function recomputeInferredRoles(
  client: ServiceClient,
  playerIds: readonly string[],
  options: RecomputeOptions = {},
): Promise<RecomputeResult> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return { changed: 0, considered: 0 };

  const now = (options.now ?? new Date()).toISOString();
  const games = await selectRatedRoleGames(client, ids);
  const stored = await selectStoredRoles(client, ids);

  const updates: { playerId: string; main: Role | null; secondary: Role | null; counted: number }[] = [];
  for (const playerId of ids) {
    const inferred = inferRoles(games.get(playerId) ?? []);
    const current = stored.get(playerId);
    if (current === undefined) continue;
    const same =
      current.inferredAt !== null &&
      current.mainRole === inferred.main &&
      current.secondaryRole === inferred.secondary &&
      current.counted === inferred.counted;
    if (same) continue;
    updates.push({
      playerId,
      main: inferred.main,
      secondary: inferred.secondary,
      counted: inferred.counted,
    });
  }

  for (let index = 0; index < updates.length; index += WRITE_CONCURRENCY) {
    const chunk = updates.slice(index, index + WRITE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (update) => {
        const { error } = await client
          .from('players')
          .update({
            main_role: update.main,
            secondary_role: update.secondary,
            roles_counted: update.counted,
            roles_inferred_at: now,
          })
          .eq('id', update.playerId);
        if (error) throw new Error(`roles: recompute write failed: ${error.message}`);
      }),
    );
  }

  return { changed: updates.length, considered: ids.length };
}

/** `[a, b, c, d]` in slices of `ID_CHUNK`, so an `in` list never outgrows a URL. */
function chunked(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    chunks.push(ids.slice(index, index + ID_CHUNK));
  }
  return chunks;
}

/**
 * Every rated game of these players, in the shape `inferRoles` takes.
 *
 * Chunked by id and paged inside each chunk: the rebuild asks about the whole roster, and
 * PostgREST caps a response at `max_rows` (1000) — a silently truncated page here would be a
 * wrong pair rather than an error.
 */
async function selectRatedRoleGames(
  client: ServiceClient,
  playerIds: readonly string[],
): Promise<Map<string, RoleGame[]>> {
  const byPlayer = new Map<string, RoleGame[]>();

  for (const chunk of chunked(playerIds)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('game_players')
        .select('player_id, game_id, role, counts_for_role_inference, games!inner(started_at)')
        .in('player_id', chunk)
        .not('mu_after', 'is', null)
        // M15.3: a game played not rated never teaches a role (R4; a tanks-only game must not
        // make anybody a top main). The fold never rates one, so this only says it twice.
        .eq('games.rated', true)
        .order('player_id', { ascending: true })
        .order('game_id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`roles: rated game select failed: ${error.message}`);

      const rows = data ?? [];
      for (const row of rows) {
        const list = byPlayer.get(row.player_id) ?? [];
        list.push({
          role: row.role,
          startedAt: row.games.started_at,
          countsForInference: row.counts_for_role_inference,
        });
        byPlayer.set(row.player_id, list);
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }

  return byPlayer;
}

interface StoredRoles {
  mainRole: Role | null;
  secondaryRole: Role | null;
  counted: number;
  inferredAt: string | null;
}

async function selectStoredRoles(
  client: ServiceClient,
  playerIds: readonly string[],
): Promise<Map<string, StoredRoles>> {
  const stored = new Map<string, StoredRoles>();

  for (const chunk of chunked(playerIds)) {
    const { data, error } = await client
      .from('players')
      .select('id, main_role, secondary_role, roles_counted, roles_inferred_at')
      .in('id', chunk);
    if (error) throw new Error(`roles: stored role select failed: ${error.message}`);

    for (const row of data ?? []) {
      stored.set(row.id, {
        mainRole: row.main_role,
        secondaryRole: row.secondary_role,
        counted: row.roles_counted,
        inferredAt: row.roles_inferred_at,
      });
    }
  }

  return stored;
}

/**
 * Every `players.id`, for the rebuild (M5.17).
 *
 * The rebuild recomputes **everybody**, not only the players with a game in the group it
 * folded: an M1-era hand-set pair on somebody who has never played is exactly the row the
 * brief's "overwritten by the first recompute" is about, and nothing else will ever visit it.
 * They come out flexible with `roles_counted = 0`, which is what the balancer already does with
 * them, and the second run writes nothing.
 */
export async function selectAllPlayerIds(client: ServiceClient): Promise<string[]> {
  const ids: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('players')
      .select('id')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`roles: player id select failed: ${error.message}`);

    const rows = data ?? [];
    ids.push(...rows.map((row) => row.id));
    if (rows.length < PAGE_SIZE) return ids;
  }
}
