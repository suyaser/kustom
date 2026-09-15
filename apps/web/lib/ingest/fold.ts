import { type Rating, rateGame } from '@customs/core';
import type { SideValue } from '@customs/db';
import { isRatedGameMode } from '../games/queue';
import { MIN_RATED_DURATION_S, PLAYERS_PER_GAME } from '../lobbyState';

/**
 * The middle of the rating fold, written once (M5.2).
 *
 * Ten rows plus the ratings that went in plus the winning side, in; the ratings that came out,
 * out. No database, no clock: everything either side of this — reading `ratings`, claiming the
 * null `mu_after` columns, batching a whole season's writes — belongs to its caller.
 *
 * There are exactly two callers, and that is the point: `rating.ts` folds one game as it lands
 * and `rebuild.ts` folds every game of a season from seeds. "The rebuild reproduces the
 * incremental fold exactly" is a fact about this file being the only implementation, not a
 * hope about two copies staying in step. The gate below has to be shared for the same reason:
 * a game the live fold skipped and the rebuild rated would move numbers nobody played for.
 *
 * The maths itself is `rateGame` in `@customs/core` and is not repeated here (CLAUDE.md).
 */

/** Five a side. Anything else is not a game we rate. */
export const TEAM_SIZE = PLAYERS_PER_GAME / 2;

/** One `game_players` row, reduced to what the fold reads. */
export interface FoldPlayer {
  playerId: string;
  /** The tie-break for the order the two teams are handed to core. */
  puuid: string;
  side: SideValue;
}

/**
 * Why a stored game is not rated. `duplicate-player` cannot happen through the API — the
 * `(game_id, player_id)` primary key forbids it and the game route refuses the payload — but
 * the rebuild reads whatever is in the table, and a fold that averaged somebody against
 * themselves would be worse than a loud skip.
 */
export type FoldSkipReason =
  | 'participant-count'
  | 'side-split'
  | 'duration'
  | 'duplicate-player'
  | 'game-mode';

export type FoldGate =
  | { ok: true; blue: FoldPlayer[]; red: FoldPlayer[] }
  | { ok: false; reason: FoldSkipReason };

/**
 * M2.5's gate: ten rows, five a side, over 300 seconds. 300 exactly is not rated.
 *
 * On the way through it sorts each side by puuid ascending, which is the order both callers
 * hand to `rateGame`. OpenSkill's answer does not depend on that order today, but the columns
 * we write do — the fold has to be reproducible from the table, not from the order a
 * PostgREST select happened to return.
 */
export function gateGame(players: readonly FoldPlayer[], durationS: number): FoldGate {
  if (players.length !== PLAYERS_PER_GAME) {
    return { ok: false, reason: 'participant-count' };
  }
  if (new Set(players.map((player) => player.puuid)).size !== players.length) {
    return { ok: false, reason: 'duplicate-player' };
  }
  const blue = players.filter((player) => player.side === 100).sort(byPuuid);
  const red = players.filter((player) => player.side === 200).sort(byPuuid);
  if (blue.length !== TEAM_SIZE || red.length !== TEAM_SIZE) {
    return { ok: false, reason: 'side-split' };
  }
  if (durationS <= MIN_RATED_DURATION_S) {
    return { ok: false, reason: 'duration' };
  }
  return { ok: true, blue, red };
}

/**
 * The live fold and the rebuild: {@link gateGame}'s remake checks, then Summoner's Rift.
 *
 * ARAM, Kiwi and anything else stay stored. They are not a rated game — Howling Abyss is not
 * the nightly 5v5 the leaderboard is for, and a custom that is not Rift must not move Proven.
 * Shape is checked first so a four-minute ARAM remake is still `duration`, not `game-mode`.
 */
export function gateRatedGame(
  players: readonly FoldPlayer[],
  durationS: number,
  gameMode: string | null | undefined,
  mapId?: number | null,
): FoldGate {
  const gate = gateGame(players, durationS);
  if (!gate.ok) return gate;
  if (!isRatedGameMode(gameMode, mapId)) return { ok: false, reason: 'game-mode' };
  return gate;
}

/**
 * One game's new ratings, by player id. `before` must hold a rating for all ten — a seed, or
 * what the season has given them so far; whose job that is differs between the two callers.
 */
export function foldGame(
  blue: readonly FoldPlayer[],
  red: readonly FoldPlayer[],
  before: ReadonlyMap<string, Rating>,
  winningSide: SideValue,
): Map<string, Rating> {
  const rated = rateGame(
    blue.map((player) => mustGet(before, player.playerId)),
    red.map((player) => mustGet(before, player.playerId)),
    winningSide,
  );

  const after = new Map<string, Rating>();
  blue.forEach((player, index) => {
    after.set(player.playerId, mustIndex(rated.blue, index));
  });
  red.forEach((player, index) => {
    after.set(player.playerId, mustIndex(rated.red, index));
  });
  return after;
}

function byPuuid(a: FoldPlayer, b: FoldPlayer): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

export function mustGet(map: ReadonlyMap<string, Rating>, key: string): Rating {
  const value = map.get(key);
  if (value === undefined) throw new Error(`fold: no rating for player ${key}`);
  return value;
}

function mustIndex(list: readonly Rating[], index: number): Rating {
  const value = list[index];
  if (value === undefined) throw new Error(`fold: core returned no rating at index ${index}`);
  return value;
}
