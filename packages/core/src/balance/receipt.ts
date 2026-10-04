/**
 * Helpers for the fairness receipt and the board (M14.4, redesign/STRATEGY.md §4 and §5).
 *
 * Each one exists so a page or Discord never does maths on a split and never parses
 * `splits.explanation` (STRATEGY §4.2 rule 5). They read the numeric columns a stored split
 * already has (`blue`, `red`, `gap`, `off_role_count`, `blue_win_prob`) and return facts, not
 * copy: the words live in `apps/web`. Nothing here changes the model.
 */

import { predictWin } from '../rating/index';
import type { Rating } from '../types';
import type { Assignment, Split } from './types';

/** The two sides of a stored split: five `{ puuid, role }` each. */
export interface SplitTeams {
  blue: readonly Assignment[];
  red: readonly Assignment[];
}

/**
 * Who differs between two splits of the same ten.
 *
 * - `one-for-one`: one player from the chosen split's blue (`a`) and one from its red (`b`)
 *   trade sides. Each carries the lane they play **in the chosen split**, the one on the cards;
 *   `sameLane` is `a.role === b.role`.
 * - `reshuffle`: more than one pair trades; `moved` is how many **players** change side (always
 *   even: two swaps is 4).
 * - `identical`: the same two teams of five, whatever the colours or the lanes inside them.
 */
export type SwapDescription =
  | { kind: 'one-for-one'; a: Assignment; b: Assignment; sameLane: boolean }
  | { kind: 'reshuffle'; moved: number }
  | { kind: 'identical' };

const NOT_THE_SAME_TEN = 'describeSwap: the two splits are not the same ten players';

/** The ten puuids of a split, or `null` if it is not five distinct a side. */
function tenOf(split: SplitTeams): Set<string> | null {
  if (split.blue.length !== 5 || split.red.length !== 5) return null;
  const all = new Set([...split.blue, ...split.red].map((a) => a.puuid));
  return all.size === 10 ? all : null;
}

/**
 * Compare `next` against `chosen`. `next`'s colours do not matter: it is aligned by whichever
 * of its sides shares more players with `chosen.blue`, so a runner-up stored with blue and red
 * the other way round reads the same. This is the logic behind the sentence's `Next best:`
 * clause, which calls it, so the sentence and the receipt can never disagree.
 *
 * Throws unless both are five distinct players a side and the same ten: two splits of
 * different lobbies have no honest "who swapped".
 */
export function describeSwap(chosen: SplitTeams, next: SplitTeams): SwapDescription {
  const chosenTen = tenOf(chosen);
  const nextTen = tenOf(next);
  if (chosenTen === null || nextTen === null || [...chosenTen].some((p) => !nextTen.has(p))) {
    throw new Error(NOT_THE_SAME_TEN);
  }
  const blue = new Set(chosen.blue.map((a) => a.puuid));
  const overlap = (side: readonly Assignment[]): number => side.filter((a) => blue.has(a.puuid)).length;
  // Five a side of the same ten: the two overlaps sum to five, so they never tie.
  const aligned = overlap(next.blue) > overlap(next.red) ? next.blue : next.red;
  const alignedSet = new Set(aligned.map((a) => a.puuid));
  const leaving = chosen.blue.filter((a) => !alignedSet.has(a.puuid));
  const [a] = leaving;
  if (a === undefined) return { kind: 'identical' };
  if (leaving.length > 1) return { kind: 'reshuffle', moved: leaving.length * 2 };
  // Exactly one of chosen's red is on the aligned side; it is `b`, at its lane in `chosen`.
  const b = chosen.red.find((r) => alignedSet.has(r.puuid)) as Assignment;
  return {
    kind: 'one-for-one',
    a: { puuid: a.puuid, role: a.role },
    b: { puuid: b.puuid, role: b.role },
    sameLane: a.role === b.role,
  };
}

/** The two numeric columns `whyLower` reads off each stored split. */
export type RankedColumns = Pick<Split, 'gap' | 'offRoleCount'>;

/**
 * Why the runner-up ranked below the chosen split, from the columns only (STRATEGY §4.4),
 * checked in this order:
 *
 * 1. `off-role`: the runner-up puts more people off their main role; `k` is how many more.
 * 2. `gap`: else its rating gap is bigger; both gaps, in display points.
 * 3. `role-costs`: else the stored score says it lost on fill protection or a repeat, and the
 *    columns do not say which, so this does not guess.
 */
export type WhyLower =
  | { kind: 'off-role'; k: number }
  | { kind: 'gap'; chosenGap: number; nextGap: number }
  | { kind: 'role-costs' };

export function whyLower(chosen: RankedColumns, next: RankedColumns): WhyLower {
  if (next.offRoleCount > chosen.offRoleCount) {
    return { kind: 'off-role', k: next.offRoleCount - chosen.offRoleCount };
  }
  if (next.gap > chosen.gap) return { kind: 'gap', chosenGap: chosen.gap, nextGap: next.gap };
  return { kind: 'role-costs' };
}

/** STRATEGY §4.3's five bands, on the favored side's rounded percentage. */
export type OddsBand = 'even' | 'coin-flip' | 'slight' | 'favored' | 'clear';

function assertProbability(p: number, caller: string): void {
  if (!(p >= 0 && p <= 1)) {
    throw new Error(`${caller}: blueWinProb must be in [0, 1], got ${p}`);
  }
}

/** The favored side of a split and its rounded percentage; `side` is `null` at a rounded 50. */
export interface FavoredSide {
  side: 'blue' | 'red' | null;
  pct: number;
}

/**
 * Which side the odds favor and by how much, as the page prints it (`Blue 54%`). The
 * percentage is `Math.round(blueWinProb * 100)` for blue, or 100 minus that for red: the same
 * rounding as the sentence (`Blue favored 54%.`) and `oddsBand`, so no surface can disagree.
 * A rounded 50 is `{ side: null, pct: 50 }` (`Even 50%.`). Throws outside `[0, 1]` and on `NaN`.
 */
export function favoredSide(blueWinProb: number): FavoredSide {
  assertProbability(blueWinProb, 'favoredSide');
  const bluePct = Math.round(blueWinProb * 100);
  if (bluePct > 50) return { side: 'blue', pct: bluePct };
  if (bluePct < 50) return { side: 'red', pct: 100 - bluePct };
  return { side: null, pct: 50 };
}

/**
 * The band for a split's `blueWinProb`: 50 `even`, 51-53 `coin-flip`, 54-57 `slight`,
 * 58-62 `favored`, 63+ `clear`, read on whichever side is favored: `favoredSide`'s `pct`, so
 * `Blue favored 54%.` is never banded as anything but `slight`. Throws outside `[0, 1]` and on `NaN`.
 */
export function oddsBand(blueWinProb: number): OddsBand {
  assertProbability(blueWinProb, 'oddsBand');
  const { pct } = favoredSide(blueWinProb);
  if (pct <= 50) return 'even';
  if (pct <= 53) return 'coin-flip';
  if (pct <= 57) return 'slight';
  if (pct <= 62) return 'favored';
  return 'clear';
}

/** One player's rating going into a game, as stored (`mu_before`, `sigma_before`); either may be absent. */
export interface RatingBefore {
  mu?: number | null;
  sigma?: number | null;
}

function known(r: RatingBefore): r is Rating {
  return Number.isFinite(r.mu) && Number.isFinite(r.sigma);
}

/**
 * Blue's win chance for a game with no stored split (STRATEGY §4.10), from everyone's rating
 * going in, through the existing `predictWin` and nothing else. `null` unless both sides are
 * exactly five and all ten have a finite `mu` and `sigma`: an unrated backfill has no odds.
 */
export function preGameOdds(blue: readonly RatingBefore[], red: readonly RatingBefore[]): number | null {
  if (blue.length !== 5 || red.length !== 5) return null;
  const b = blue.filter(known);
  const r = red.filter(known);
  if (b.length !== 5 || r.length !== 5) return null;
  return predictWin(b, r);
}

/** One game the caller has decided counts (STRATEGY §4.8 picks which; core only counts). */
export interface CalibrationGame {
  blueWinProb: number;
  blueWon: boolean;
}

/**
 * How honest the bot's odds were. Over the games with `blueWinProb` other than exactly 0.5:
 * `n` games, `favoredWon` of them won by the side the bot favored, `actualPct` that as a whole
 * percentage, and `expectedPct` the average favored-side probability as a whole percentage
 * (both `Math.round`). With `n` 0 both percentages are `null`: there is nothing to divide by.
 * Throws on a probability outside `[0, 1]`.
 */
export interface Calibration {
  n: number;
  favoredWon: number;
  expectedPct: number | null;
  actualPct: number | null;
}

export function calibration(games: readonly CalibrationGame[]): Calibration {
  let n = 0;
  let favoredWon = 0;
  let favoredProbSum = 0;
  for (const { blueWinProb, blueWon } of games) {
    assertProbability(blueWinProb, 'calibration');
    if (blueWinProb === 0.5) continue;
    const blueFavored = blueWinProb > 0.5;
    n += 1;
    favoredProbSum += blueFavored ? blueWinProb : 1 - blueWinProb;
    if (blueFavored === blueWon) favoredWon += 1;
  }
  if (n === 0) return { n, favoredWon, expectedPct: null, actualPct: null };
  return {
    n,
    favoredWon,
    expectedPct: Math.round((favoredProbSum / n) * 100),
    actualPct: Math.round((favoredWon / n) * 100),
  };
}
