/**
 * The balanced-teams guard's fit (M18.11 core). Pure: the caller passes the games and the clock.
 *
 * `winProbability(Σblue, Σred, { a, b })` is `logistic(a + b × gap / 400)`. Every group starts at
 * the plain pair `(0, 1)`. Once a group has enough bot-rolled Kustom games, `fitOddsPair` asks
 * which `(a, b)` best explains how those games actually went, and `shouldAdoptOddsPair` decides
 * whether the group switches to it:
 *
 * - `b` below 1 means favourites won less often than the odds said (the odds were overconfident);
 *   `a` above 0 means blue won more often than its gap said.
 * - The fit is ridge-shrunk toward `(0, 1)`: it maximises the log likelihood of the results minus
 *   `ridge / 2 × (a² + (b − 1)²)`, so with few games, or games whose gaps are all small (which is
 *   what a balancer produces), it stays near the plain odds.
 * - Newton's method from `(0, 1)` with step halving, at most `maxIterations` steps; no randomness.
 *   Games are sorted by `(gap, blueWon)` first, so the fit does not depend on input order.
 *
 * Adopting a pair changes no stored Rating, only the odds of future games. Constants live in
 * `config.oddsFit`.
 */

import { config } from '../config';
import { type KustomCalib, KustomInputError } from './kustom';

const F = config.oddsFit;
const SCALE = config.kustom.oddsScale;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One rated, bot-rolled game: blue's summed Rating minus red's at the time, and who won. */
export interface OddsFitGame {
  gap: number;
  blueWon: boolean;
}

export interface OddsFit extends KustomCalib {
  /** How many games the fit read. */
  games: number;
  /** Newton steps taken (0 with no games). */
  iterations: number;
  /** False only if `maxIterations` ran out before a step fell under `tolerance`. */
  converged: boolean;
}

export interface OddsFitOptions {
  /** Overrides `config.oddsFit.ridge`; 0 is the plain maximum-likelihood fit. */
  ridge?: number;
}

/** `log(1 + exp(z))` without overflow. */
function softplus(z: number): number {
  return z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

function objective(
  xs: readonly number[],
  ys: readonly number[],
  a: number,
  b: number,
  ridge: number,
): number {
  let ll = 0;
  for (let i = 0; i < xs.length; i++) {
    const z = a + b * (xs[i] as number);
    // log p(y) = y·z − log(1 + e^z)
    ll += (ys[i] as number) * z - softplus(z);
  }
  return ll - (ridge / 2) * (a * a + (b - 1) * (b - 1));
}

/** Fits the group's `(a, b)` to its games. With no games it is exactly `(0, 1)`. */
export function fitOddsPair(games: readonly OddsFitGame[], options: OddsFitOptions = {}): OddsFit {
  const ridge = options.ridge ?? F.ridge;
  if (!Number.isFinite(ridge) || ridge < 0) {
    throw new KustomInputError(`fitOddsPair: ridge must be a finite number >= 0, got ${ridge}`);
  }
  for (const g of games) {
    if (!Number.isFinite(g.gap)) throw new KustomInputError(`fitOddsPair: gap must be finite, got ${g.gap}`);
  }
  if (games.length === 0) return { a: 0, b: 1, games: 0, iterations: 0, converged: true };

  const sorted = [...games].sort((p, q) => p.gap - q.gap || Number(p.blueWon) - Number(q.blueWon));
  const xs = sorted.map((g) => g.gap / SCALE);
  const ys = sorted.map((g) => (g.blueWon ? 1 : 0));

  let a = 0;
  let b = 1;
  let current = objective(xs, ys, a, b, ridge);
  for (let iter = 1; iter <= F.maxIterations; iter++) {
    // Gradient and (negated) Hessian of the penalised log likelihood.
    let ga = -ridge * a;
    let gb = -ridge * (b - 1);
    let haa = ridge;
    let hab = 0;
    let hbb = ridge;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const r = (ys[i] as number) - p;
      const w = p * (1 - p);
      ga += r;
      gb += r * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (!(det > 0)) {
      // Only reachable with ridge 0 and games that cannot identify both numbers (one gap value).
      throw new KustomInputError('fitOddsPair: games cannot identify (a, b) without a ridge');
    }
    let da = (hbb * ga - hab * gb) / det;
    let db = (haa * gb - hab * ga) / det;
    // Step halving keeps every step uphill (the objective is concave, so this always ends).
    let next = objective(xs, ys, a + da, b + db, ridge);
    for (let h = 0; h < 30 && !(next >= current); h++) {
      da /= 2;
      db /= 2;
      next = objective(xs, ys, a + da, b + db, ridge);
    }
    a += da;
    b += db;
    current = next;
    if (Math.abs(da) < F.tolerance && Math.abs(db) < F.tolerance) {
      return { a, b, games: games.length, iterations: iter, converged: true };
    }
  }
  return { a, b, games: games.length, iterations: F.maxIterations, converged: false };
}

export type OddsAdoptSkip = 'too_few_games' | 'too_soon' | 'b_not_low' | 'b_not_positive';

export type OddsAdoptDecision = { adopt: true; pair: KustomCalib } | { adopt: false; reason: OddsAdoptSkip };

export interface OddsAdoptInput {
  /** The fit (`fitOddsPair`'s `a` and `b`). */
  fit: KustomCalib;
  /** Rated, bot-rolled Kustom games since the group's last ratings reset. */
  games: number;
  /** When the group last adopted a pair, or null if it never has. */
  lastAdoptedAt: Date | null;
  /** The caller's clock. */
  now: Date;
}

/**
 * Whether a group switches to `fit`. Checks in this order and names the first that fails:
 * at least `minGames` games, `minDaysBetween` days since the last adoption, `b > 0`, `b < adoptBelowB`.
 */
export function shouldAdoptOddsPair(input: OddsAdoptInput): OddsAdoptDecision {
  const { fit, games, lastAdoptedAt, now } = input;
  if (!Number.isFinite(fit.a) || !Number.isFinite(fit.b)) {
    throw new KustomInputError(`shouldAdoptOddsPair: needs a finite pair, got (${fit.a}, ${fit.b})`);
  }
  if (!Number.isInteger(games) || games < 0) {
    throw new KustomInputError(`shouldAdoptOddsPair: games must be an integer >= 0, got ${games}`);
  }
  if (
    !Number.isFinite(now.getTime()) ||
    (lastAdoptedAt !== null && !Number.isFinite(lastAdoptedAt.getTime()))
  ) {
    throw new KustomInputError('shouldAdoptOddsPair: invalid date');
  }
  if (games < F.minGames) return { adopt: false, reason: 'too_few_games' };
  if (lastAdoptedAt !== null && now.getTime() - lastAdoptedAt.getTime() < F.minDaysBetween * DAY_MS) {
    return { adopt: false, reason: 'too_soon' };
  }
  if (!(fit.b > 0)) return { adopt: false, reason: 'b_not_positive' };
  if (!(fit.b < F.adoptBelowB)) return { adopt: false, reason: 'b_not_low' };
  return { adopt: true, pair: { a: fit.a, b: fit.b } };
}
