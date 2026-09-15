import { type Rating, rateGameWeekly } from '@customs/core';
import type { SideValue } from '@customs/db';
import type { WindowKind } from '../night';

/**
 * The **weekly rating track** (M7.3): a second number per player, folded from scratch over one
 * week's games and never stored.
 *
 * Why it exists. `This week` used to print the all-time rating as it stood at a player's last
 * game inside the week, so a week somebody had could barely move the number the week was
 * supposed to be about — 40 games of history against 4 games of Tuesday. The weekly track
 * starts everybody back at their rank seed every Sunday and folds only that week's games with
 * M7.2's `rateGameWeekly`, which is tuned to move sooner over the handful of games a week
 * holds.
 *
 * Three rules, and they are the whole contract:
 *
 * - **From scratch, from the stored seed.** The caller hands in the seed the all-time fold
 *   started this player's history from (`ratings.seed_mu` / `seed_sigma`, M5.7) and
 *   `seedFromRank` only for a player who has never been rated. A seed taken from the live
 *   `players.rank_*` columns would make `Last week` read differently the day somebody's rank
 *   moved, and the Sunday post has to stay checkable on Tuesday.
 * - **The rebuild's order.** `started_at`, then `lcu_game_id` — the second key is not
 *   decoration: a backfill can land two games with the same `gameCreation`, and without a
 *   tie-break two reads of one week could disagree about the numbers.
 * - **Nothing here is stored.** This is a read-time fold, like `windowRows` around it. No
 *   table, no migration, no cron, and a backfilled game lands in the week it was played with
 *   nothing rewritten.
 *
 * **It never forms teams.** `lib/ingest/` does not import this file and must not: the balancer,
 * `ratings`, `/p/[puuid]` and every embed that prints a change read the all-time track. The
 * maths is `@customs/core`'s and is not repeated here (CLAUDE.md).
 */

/** The two windows the weekly track is read through. Nothing else gets a from-scratch fold. */
export const WEEK_WINDOWS = ['this-week', 'last-week'] as const satisfies readonly WindowKind[];

/**
 * Is this window one of the two weeks?
 *
 * **The month windows are decided, not deferred** (user, 2026-09-15): `This month` and
 * `Last month` rank on the all-time number for ever, because a month of nightly customs is
 * roughly the thirty games the all-time rating already settles over. This predicate is
 * deliberately a list of two and not a parameterised window length.
 */
export function isWeekWindow(kind: WindowKind): boolean {
  return (WEEK_WINDOWS as readonly WindowKind[]).includes(kind);
}

/** One player's seat in one game, reduced to what the fold reads. */
export interface WeeklyPlayer {
  playerId: string;
  /** The tie-break for the order the two teams are handed to core, as in `gateGame`. */
  puuid: string;
  side: SideValue;
}

/** One rated game of the week, with its ten seats. */
export interface WeeklyGame {
  gameId: string;
  /** ISO 8601, the first sort key. */
  startedAt: string;
  /** The second sort key. `null` only for a row the select could not answer for. */
  lcuGameId: number | null;
  winningSide: SideValue;
  players: readonly WeeklyPlayer[];
}

/** What one game did to one player, in the weekly track: the pair a delta is computed from. */
export interface WeeklyGameRating {
  gameId: string;
  muBefore: number;
  muAfter: number;
}

/** Where one player's week started, where it ended, and every step between. */
export interface WeeklyPlayerRating {
  /** The seed the week was folded from — the row's `climb` starts here. */
  seed: Rating;
  /** After the last game of the week, or the seed itself for a player with none. */
  rating: Rating;
  /** Oldest first, one entry per game of the week this player was rated in. */
  games: readonly WeeklyGameRating[];
}

/** Five a side, or the game is not one this fold can read. Mirrors `gateGame`'s rule. */
const TEAM_SIZE = 5;

/**
 * The week, folded.
 *
 * `seeds` is every player on the window's board, keyed by `players.id`; the answer has an entry
 * for each of them, so a player whose only game of the week was skipped still reads as their
 * seed rather than falling off the board.
 *
 * **A game is skipped when it is not five and five with a seed for all ten.** The all-time fold
 * already refused anything else (`gateRatedGame`), so a rated game in the window always has its
 * ten rated rows — but this file reads whatever the table holds, and `rateGameWeekly` throws on
 * anything that is not five and five. A skipped game is a logged line and not an exception: a
 * board that 500s because one old row is odd is worse than a board that is one game stale.
 */
export function foldWeeklyRatings(
  games: readonly WeeklyGame[],
  seeds: ReadonlyMap<string, Rating>,
): Map<string, WeeklyPlayerRating> {
  const out = new Map<string, WeeklyPlayerRating>();
  for (const [playerId, seed] of seeds) {
    out.set(playerId, { seed, rating: seed, games: [] });
  }

  for (const game of [...games].sort(compareWeeklyGames)) {
    const blue = game.players.filter((player) => player.side === 100).sort(byPuuid);
    const red = game.players.filter((player) => player.side === 200).sort(byPuuid);
    if (blue.length !== TEAM_SIZE || red.length !== TEAM_SIZE) {
      console.warn(`board: the weekly fold skipped game ${game.gameId}: not five a side`);
      continue;
    }
    const ten = [...blue, ...red];
    if (ten.some((player) => out.get(player.playerId) === undefined)) {
      console.warn(`board: the weekly fold skipped game ${game.gameId}: a seat has no seed`);
      continue;
    }

    const before = new Map(ten.map((player) => [player.playerId, mustCurrent(out, player.playerId)]));
    const rated = rateGameWeekly(
      blue.map((player) => mustGet(before, player.playerId)),
      red.map((player) => mustGet(before, player.playerId)),
      game.winningSide,
    );

    applySide(out, blue, rated.blue, before, game.gameId);
    applySide(out, red, rated.red, before, game.gameId);
  }

  return out;
}

function applySide(
  out: Map<string, WeeklyPlayerRating>,
  side: readonly WeeklyPlayer[],
  after: readonly Rating[],
  before: ReadonlyMap<string, Rating>,
  gameId: string,
): void {
  side.forEach((player, index) => {
    const next = after[index];
    if (next === undefined) throw new Error(`board: the weekly fold got no rating at index ${index}`);
    const previous = mustGet(before, player.playerId);
    const held = out.get(player.playerId) as WeeklyPlayerRating;
    out.set(player.playerId, {
      seed: held.seed,
      rating: next,
      games: [...held.games, { gameId, muBefore: previous.mu, muAfter: next.mu }],
    });
  });
}

/** `started_at`, then `lcu_game_id`: the rebuild's order, so the week and the history agree. */
function compareWeeklyGames(a: WeeklyGame, b: WeeklyGame): number {
  return Date.parse(a.startedAt) - Date.parse(b.startedAt) || (a.lcuGameId ?? 0) - (b.lcuGameId ?? 0);
}

function byPuuid(a: WeeklyPlayer, b: WeeklyPlayer): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

function mustCurrent(held: ReadonlyMap<string, WeeklyPlayerRating>, playerId: string): Rating {
  const value = held.get(playerId);
  if (value === undefined) throw new Error(`board: the weekly fold has no rating for player ${playerId}`);
  return value.rating;
}

function mustGet(map: ReadonlyMap<string, Rating>, playerId: string): Rating {
  const value = map.get(playerId);
  if (value === undefined) throw new Error(`board: the weekly fold has no rating for player ${playerId}`);
  return value;
}
