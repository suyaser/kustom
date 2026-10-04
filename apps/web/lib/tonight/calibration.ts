import { type Calibration, type CalibrationGame, calibration } from '@customs/core';
import { readAssignments } from '../discord/assemble';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import type { PublicClient } from '../publicClient';

/**
 * The group's calibration line (STRATEGY §4.8, M14.9): how often the side the bot favored won,
 * beside how often it expected to. Core counts (`calibration`); this file only decides **which
 * games count**, which is product's rule and not core's:
 *
 * - a Summoner's Rift game of this group (not ARAM), with a winner;
 * - rated: `games.rated` is not false (M15.3) and every scoreboard row carries `r_before` and
 *   `r_after` (the all-time fold's own mark);
 * - **rolled with Kustom** (`splits.odds_model = 'kustom'`, M18.6): the line checks the odds of
 *   `winProbability`, so it counts only the calls that function made, and restarts at `0 of 20` at
 *   the switch (05-design 11.7);
 * - played from a chosen split, and the ten on each side are exactly that split's ten (teams were
 *   not changed in the lobby after the roll);
 * - **every** such game, across rating resets: a reset does not wipe the bot's past calls.
 *
 * `calibration` itself drops the 50/50 splits. Pre-game odds (§4.10) are never counted: they are
 * odds worked out afterwards, not predictions.
 */

export interface CalibrationGameRow {
  id: string;
  lobby_id: string | null;
  winning_side: number | null;
  gameMode: unknown;
  /** `games.rated` (M15.3): a game played not rated is never a call the bot made. Absent: rated. */
  rated?: boolean;
  game_players: readonly {
    player_id: string;
    side: number | null;
    r_before: number | null;
    r_after: number | null;
  }[];
}

export interface CalibrationSplitRow {
  lobby_id: string;
  blue: unknown;
  red: unknown;
  blue_win_prob: number;
  /** `splits.odds_model` (0036): only `kustom` counts. */
  odds_model: string;
}

/** The games that count, as core's input. Pure, so the rule is a unit test. */
export function calibrationGames(
  games: readonly CalibrationGameRow[],
  splits: readonly CalibrationSplitRow[],
  puuidOf: ReadonlyMap<string, string>,
): CalibrationGame[] {
  const splitByLobby = new Map(splits.map((split) => [split.lobby_id, split]));
  const out: CalibrationGame[] = [];
  for (const game of games) {
    if (game.lobby_id === null || (game.winning_side !== 100 && game.winning_side !== 200)) continue;
    if (game.rated === false) continue;
    if (!matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'sr')) continue;
    const rows = game.game_players;
    if (rows.length !== 10 || rows.some((row) => row.r_before === null || row.r_after === null)) continue;
    const split = splitByLobby.get(game.lobby_id);
    if (split === undefined || split.odds_model !== 'kustom') continue;
    const p = split.blue_win_prob;
    if (!Number.isFinite(p) || p < 0 || p > 1) continue;

    const played = (side: 100 | 200): Set<string> | null => {
      const set = new Set<string>();
      for (const row of rows) {
        if (row.side !== side) continue;
        const puuid = puuidOf.get(row.player_id);
        if (puuid === undefined) return null;
        set.add(puuid);
      }
      return set;
    };
    const blue = played(100);
    const red = played(200);
    if (blue === null || red === null) continue;
    if (!sameTen(blue, readAssignments(split.blue)) || !sameTen(red, readAssignments(split.red))) continue;

    out.push({ blueWinProb: p, blueWon: game.winning_side === 100 });
  }
  return out;
}

function sameTen(played: ReadonlySet<string>, rolled: readonly { puuid: string }[]): boolean {
  return played.size === 5 && rolled.length === 5 && rolled.every((seat) => played.has(seat.puuid));
}

/** PostgREST answers at most this many rows per request; the reads below page through. */
const PAGE = 1000;

/**
 * Remembered per group for a few minutes, in this server instance. The tonight page re-renders on
 * every Realtime event, and this is the one read on it that scans a group's whole history; the
 * number moves by at most one game every half hour, so a minutes-old answer is the same answer.
 */
const CACHE_MS = 5 * 60_000;
/** A failed scan is remembered too, briefly, so a broken read is not retried on every re-render. */
export const FAILURE_CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: Calibration | null }>();

/** The group's calibration, or `null` on any failed read (the line is then left out, §4.8). */
export async function loadCalibrationOrNone(
  client: PublicClient,
  groupId: string,
  now: number = Date.now(),
): Promise<Calibration | null> {
  const held = cache.get(groupId);
  if (held !== undefined && now - held.at < (held.value === null ? FAILURE_CACHE_MS : CACHE_MS)) {
    return held.value;
  }
  try {
    const value = await loadCalibration(client, groupId);
    cache.set(groupId, { at: now, value });
    return value;
  } catch (error) {
    console.error('tonight: reading the calibration failed', error);
    cache.set(groupId, { at: now, value: null });
    return null;
  }
}

async function loadCalibration(client: PublicClient, groupId: string): Promise<Calibration> {
  const games: CalibrationGameRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('games')
      .select(
        'id, lobby_id, winning_side, rated, gameMode:game_mode, game_players(player_id, side, r_before, r_after)',
      )
      .eq('group_id', groupId)
      .not('lobby_id', 'is', null)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`calibration: game lookup failed: ${error.message}`);
    const page = (data ?? []) as unknown as CalibrationGameRow[];
    games.push(...page);
    if (page.length < PAGE) break;
  }

  const splits: CalibrationSplitRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('splits')
      .select('lobby_id, blue, red, blue_win_prob, odds_model, lobbies!inner(group_id)')
      .eq('is_chosen', true)
      .eq('odds_model', 'kustom')
      .eq('lobbies.group_id', groupId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`calibration: split lookup failed: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      splits.push({
        lobby_id: row.lobby_id,
        blue: row.blue,
        red: row.red,
        blue_win_prob: row.blue_win_prob,
        odds_model: row.odds_model,
      });
    }
    if (page.length < PAGE) break;
  }

  const playerIds = [...new Set(games.flatMap((game) => game.game_players.map((row) => row.player_id)))];
  const puuidOf = new Map<string, string>();
  for (let i = 0; i < playerIds.length; i += 200) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid')
      .in('id', playerIds.slice(i, i + 200));
    if (error) throw new Error(`calibration: player lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id !== null && row.puuid !== null) puuidOf.set(row.id, row.puuid);
    }
  }

  return calibration(calibrationGames(games, splits, puuidOf));
}
