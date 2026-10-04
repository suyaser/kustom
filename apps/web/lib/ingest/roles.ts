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
}

/**
 * Did the balancer put each of these players on a role of their own?
 *
 * `true` — the honest default and the column's default — whenever we did not choose the seats:
 * a backfilled game, a game played from no lobby, a lobby whose split we cannot read, a player
 * who was not in the split at all (somebody swapped in). Nobody forced anything, so the game
 * counts.
 *
 * `false` only when there *is* a chosen split, it names this player, and the role it gave them
 * is neither tonight's main nor tonight's backup. Tonight's, not the stored pair: a
 * role-for-tonight tap (M3.6) makes the tapped role the main for the night, which is exactly
 * how a player deliberately moves — tap it, play it on-role, and the game counts.
 *
 * A flexible player (null main) is never off-role, by the balancer's own rule (M1.4), so every
 * role counts for them. That is what makes a newcomer's first three games the ones that decide
 * their main.
 */
export async function roleInferenceFlags(
  client: ServiceClient,
  lobbyId: string | null,
  players: readonly RoleProfileRow[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  if (lobbyId === null) return flags;

  const assignments = await selectChosenAssignments(client, lobbyId);
  if (assignments === null) return flags;

  const overrides = await selectRoleOverrides(client, lobbyId);

  for (const player of players) {
    const assigned = assignments.get(player.puuid);
    if (assigned === undefined) continue;
    const tonight = resolveRoles({
      mainRole: player.mainRole,
      secondaryRole: player.secondaryRole,
      roleOverride: overrides.get(player.playerId) ?? null,
    });
    const counts = tonight.main === null || assigned === tonight.main || assigned === tonight.secondary;
    if (!counts) flags.set(player.playerId, false);
  }

  return flags;
}

/** The role the chosen split gave each puuid, or null when this lobby has no readable split. */
async function selectChosenAssignments(
  client: ServiceClient,
  lobbyId: string,
): Promise<Map<string, Role> | null> {
  const { data, error } = await client
    .from('splits')
    .select('blue, red')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`roles: split lookup failed: ${error.message}`);
  if (!data) return null;

  const assignments = new Map<string, Role>();
  for (const entry of [...readAssignments(data.blue), ...readAssignments(data.red)]) {
    assignments.set(entry.puuid, entry.role);
  }
  return assignments.size === 0 ? null : assignments;
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
