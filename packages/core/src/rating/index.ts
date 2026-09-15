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
 * Estimate a rating from the ranked tier and division the client reports.
 *
 * - Division IV is the tier base; each division above adds `config.rating.divisionStep`.
 * - Master, Grandmaster and Challenger are all 35 and ignore any division.
 * - Unranked, or any tier string we do not recognise, is 20 with sigma 10.
 * - Matching is case-insensitive. A missing or unrecognised division on a ranked tier
 *   counts as IV, the tier base.
 *
 * **This is a live guess and not where a rating starts** (2026-09-16). No stored rating — the
 * all-time fold or the week — is seeded from a League rank any more: every player's first number
 * is {@link provisionalSeed}, `{ mu: 20, sigma: 12 }`, because a customs board is supposed to
 * measure customs. That is **not** any value this function returns: its `sigma` is
 * `config.rating.provisionalSigma`, a third constant, larger than the `unrankedSigma` 10 an
 * unrecognised rank gets here. The maths below is unchanged and still has one caller: the
 * balancer needs *some* number for a brand-new face so tonight's split is not a coin flip, and
 * their solo-queue rank is the only thing anybody knows about them. That guess lives for one
 * evening and is never written down.
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

/**
 * **Where every rating starts**: `{ mu: 20, sigma: 12 }`, the same for everybody (2026-09-16).
 *
 * The one first-seed value, for the all-time fold, for the rebuild and for the weekly track's
 * Sunday reseed. It takes no arguments **on purpose** — there is nothing about a player that can
 * change it, which is the whole decision in one signature. A caller that wants to seed from a
 * League rank is asking the wrong question; `seedFromRank` is still there for the balancer's
 * live guess, and nothing persists that.
 *
 * Two halves, and they are different claims:
 *
 * - `config.rating.unrankedMu` (20) — **we have no idea how good you are.** Not a low number and
 *   not a high one: the number that says nothing, and the customs say the rest.
 * - `config.rating.provisionalSigma` (12) — **and we are less sure of that than of anything we
 *   say about a player we have watched.** Bigger than both `rankedSigma` and `unrankedSigma`,
 *   because OpenSkill moves `mu` in proportion to a player's own `sigma^2`: a new player's first
 *   few games move their rating hard, the movement shrinks as `sigma` does, and "provisional,
 *   then settled" needs no phase, no branch and no second code path. See `config.ts` for the
 *   measurement that picked 12 and for what happens either side of it.
 */
export function provisionalSeed(): Rating {
  return { mu: cfg.unrankedMu, sigma: cfg.provisionalSigma };
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

/**
 * How even a split is, as a whole percentage (M3.31): `100 - |blueWinProb - 0.5| * 200`,
 * rounded. 50% is 100, 54% is 92, 70% is 60, a certainty either way is 0.
 *
 * It is a **display transform of a probability and never a second opinion** about the same
 * split. The tonight page holds the chosen split's stored `blue_win_prob` and calls this, so
 * `Teams are 92% even.` and `Blue favored 54%.` are one number read twice and can never
 * disagree. It is symmetric on purpose — the score is about the gap, not about which side is
 * ahead — so it says nothing `predictWin` did not already say.
 *
 * Throws outside `[0, 1]` (and on `NaN`), like every other guard in this file.
 */
export function evenness(blueWinProb: number): number {
  if (!(blueWinProb >= 0 && blueWinProb <= 1)) {
    throw new Error(`evenness: blueWinProb must be in [0, 1], got ${blueWinProb}`);
  }
  return Math.round(100 - Math.abs(blueWinProb - 0.5) * 200);
}

/**
 * The same score for a caller holding ratings rather than a stored probability:
 * `evenness(predictWin(blue, red))`, exactly, with no arithmetic of its own.
 *
 * Not five-and-five bound — two non-empty teams of any size, matching `predictWin` — because
 * it compares two teams and does not fold a game. An empty team is a caller bug, not a 0% or
 * 100% prediction, so it throws rather than passing OpenSkill a side with nobody on it.
 * Display surfaces should prefer `evenness` on the split's stored probability: recomputing
 * from live ratings makes the two lines disagree once somebody's rating has moved.
 */
export function balanceScore(blue: readonly Rating[], red: readonly Rating[]): number {
  if (blue.length === 0) {
    throw new Error('balanceScore: blue must not be empty');
  }
  if (red.length === 0) {
    throw new Error('balanceScore: red must not be empty');
  }
  return evenness(predictWin(blue, red));
}
