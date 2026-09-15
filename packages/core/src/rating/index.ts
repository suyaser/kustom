/**
 * Rating model: OpenSkill, default Plackett-Luce, two teams of five.
 * Spec: docs/01-architecture.md "Rating model" and the M1.3 / M7.2 briefs in docs/02-milestones.md.
 *
 * Two channels over one model: `rateGame` is the all-time rating that forms teams and is
 * stored, and `rateGameWeekly` (M7.2) is the weekly track, tuned by `config.rating.weekly`
 * and folded from scratch each week by the board. Neither ever sees the other's numbers.
 *
 * Pure. No clock, no I/O. Both folds are functions of their arguments only.
 */

import type { Options } from 'openskill';
import { predictWin as openskillPredictWin, rate as openskillRate } from 'openskill';
import { config, type RankDivision, type RankTier } from '../config';
import type { Rating, Side } from '../types';

const { rating: cfg } = config;

const TIER_MU: Readonly<Record<string, number>> = cfg.tierMu;
const DIVISION_STEPS: Readonly<Record<string, number>> = cfg.divisionSteps;
const TIERS_WITHOUT_DIVISIONS: readonly string[] = cfg.tiersWithoutDivisions;

/** Players per side. A League custom is 5v5; anything else is not a game we rate. */
const TEAM_SIZE = 5;

/**
 * Seed a rating from the ranked tier and division the client reports.
 *
 * - Division IV is the tier base; each division above adds `config.rating.divisionStep`.
 * - Master, Grandmaster and Challenger are all 35 and ignore any division.
 * - Unranked, or any tier string we do not recognise, is 20 with sigma 10.
 * - Matching is case-insensitive. A missing or unrecognised division on a ranked tier
 *   counts as IV, the tier base.
 *
 * Accepts loose strings because the client and the database are the callers and both can
 * hand us `null`, `'NONE'`, `'NA'` or something new after a patch. Typed callers can pass
 * `RankTier` / `RankDivision` directly.
 */
export function seedFromRank(
  tier: RankTier | string | null | undefined,
  division: RankDivision | string | null | undefined,
): Rating {
  const tierKey = (tier ?? '').trim().toUpperCase();
  const base = TIER_MU[tierKey];
  if (base === undefined) {
    return { mu: cfg.unrankedMu, sigma: cfg.unrankedSigma };
  }
  if (TIERS_WITHOUT_DIVISIONS.includes(tierKey)) {
    return { mu: base, sigma: cfg.rankedSigma };
  }
  const steps = DIVISION_STEPS[(division ?? '').trim().toUpperCase()] ?? 0;
  return { mu: base + steps * cfg.divisionStep, sigma: cfg.rankedSigma };
}

/** Leaderboard sort key: `mu - 2 * sigma`. Conservative, so uncertain players rank lower. */
export function ordinal({ mu, sigma }: Rating): number {
  return mu - cfg.ordinalSigmaWeight * sigma;
}

/** What a player sees: `round(mu * 60)`, so a seed reads like a familiar MMR number. */
export function displayRating(mu: number): number {
  return Math.round(mu * cfg.displayMultiplier);
}

function assertTeam(team: readonly Rating[], side: 'blue' | 'red', caller: string): void {
  if (team.length !== TEAM_SIZE) {
    throw new Error(`${caller}: ${side} must have exactly five ratings, got ${team.length}`);
  }
}

function clean({ mu, sigma }: Rating): Rating {
  return { mu, sigma };
}

/** OpenSkill tuning a channel may set. `rank` is ours, never a caller's. */
type Tuning = Pick<Options, 'beta' | 'tau'>;

/**
 * The all-time channel passes nothing, so OpenSkill's own defaults apply and every
 * `mu_after` already stored stays reproducible. Do not put a number in here.
 */
const ALL_TIME_TUNING: Tuning = {};

/** The weekly channel's tuning (M7.2), from the one place it lives. */
const WEEKLY_TUNING: Tuning = { beta: cfg.weekly.beta, tau: cfg.weekly.tau };

/**
 * One fold of one finished game, shared by both channels. The only difference between them
 * is `tuning`; the shape, the order and the five-a-side rule are identical.
 *
 * OpenSkill's `rank` is a placing, so the winner gets 1 and the loser 2.
 */
function fold(
  blue: readonly Rating[],
  red: readonly Rating[],
  winningSide: Side,
  tuning: Tuning,
  caller: string,
): { blue: Rating[]; red: Rating[] } {
  assertTeam(blue, 'blue', caller);
  assertTeam(red, 'red', caller);
  const rank = winningSide === 100 ? [1, 2] : [2, 1];
  const [newBlue, newRed] = openskillRate([blue.map(clean), red.map(clean)], { ...tuning, rank });
  return { blue: newBlue.map(clean), red: newRed.map(clean) };
}

/**
 * Rate one finished game for the all-time channel: the rating that forms teams and sits on
 * the leaderboard. Returns new ratings for both sides, in the same order as given.
 * `winningSide` is `100` (blue) or `200` (red). There is no draw path: a League custom
 * cannot draw, and a remake is not a game (the API drops it before this call).
 *
 * **These numbers are pinned** by M1.3's tests and by every stored `mu_after`. Nothing about
 * this function's maths may change without a rebuild; the weekly track (below) exists exactly
 * so that it does not have to.
 */
export function rateGame(
  blue: readonly Rating[],
  red: readonly Rating[],
  winningSide: Side,
): { blue: Rating[]; red: Rating[] } {
  return fold(blue, red, winningSide, ALL_TIME_TUNING, 'rateGame');
}

/**
 * Rate one finished game for the weekly track (M7.2): the same model and the same signature
 * as `rateGame`, tuned by `config.rating.weekly` to move sooner over the handful of games a
 * week holds.
 *
 * It is a second, independent number. It never forms teams, it is never stored on
 * `game_players`, and it is folded from scratch over one week's games by its caller (M7.3),
 * which also decides who is in the week at all — a player with no games in the window is
 * never handed to this function. Five and five, or it throws, exactly like `rateGame`.
 */
export function rateGameWeekly(
  blue: readonly Rating[],
  red: readonly Rating[],
  winningSide: Side,
): { blue: Rating[]; red: Rating[] } {
  return fold(blue, red, winningSide, WEEKLY_TUNING, 'rateGameWeekly');
}

/**
 * Blue's probability of beating red, in `[0, 1]`. Red's is `1 - it`.
 * Takes real `{ mu, sigma }` values, never role-adjusted effective skill.
 */
export function predictWin(blue: readonly Rating[], red: readonly Rating[]): number {
  const [blueProb] = openskillPredictWin([blue.map(clean), red.map(clean)]);
  if (blueProb === undefined) {
    throw new Error('predictWin: openskill returned no probability for blue');
  }
  return blueProb;
}
