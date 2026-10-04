/**
 * Why a game moved a Rating by as much as it did (M14.58), as structure, never as copy: the web
 * owns every word. Pure; a function of its argument only.
 *
 * Three things set the size of one player's change, and the reason names each:
 *
 * - **the odds** the fold used for their side (a favourite's win pays less, its loss costs more);
 * - **how sure** the model was of them going in (`new` swings hard, `settled` barely);
 * - **the award** (MVP keeps 1.25x of a win, ACE 0.8x of a loss, `applyMvpAceBonus`).
 *
 * Every number is a difference of two displayed Ratings (`displayRating(after) -
 * displayRating(before)`), so `points === basePoints + award.effect` always holds and nothing
 * prints a figure that fails to add up.
 *
 * The fold stores what it used (`0034`): `foldWinProbability` for the side, the base `mu_after`
 * before the bonus, and the award. Rows from before that are explained by `explainLegacyDelta`,
 * which recomputes the odds from the ten stored befores and cannot know the award.
 */

import { favoredSide, type RatingBefore } from '../balance/receipt';
import { config, SETTLING_GAMES } from '../config';
import type { Rating, Side } from '../types';
import { displayRating, predictWin } from './index';

const cfg = config.rating.explain;

export type OddsStance = 'favourite' | 'underdog' | 'even';
export type Certainty = 'new' | 'settling' | 'settled';
export type GameResult = 'won' | 'lost';

/** What the fold stores per `game_players` row (M14.58, `0034`), plus what was already there. */
export interface DeltaBreakdown {
  result: GameResult;
  side: Side;
  /** `foldWinProbability(blueBefore, redBefore, side)`, as the fold stored it. */
  sideWinProb: number;
  sigmaBefore: number;
  /** Rated games this player had before this one (since the last reset). Decides certainty when given. */
  ratedGamesBefore?: number | null;
  muBefore: number;
  /** `rateGame`'s `mu` before any MVP/ACE bonus. */
  baseMuAfter: number;
  /** The stored `mu_after`, bonus included. */
  muAfter: number;
  award: 'mvp' | 'ace' | 'none';
}

export interface DeltaOdds {
  /** This side's percent, the receipt's rounding (`favoredSide`). */
  pct: number;
  stance: OddsStance;
}

export interface DeltaAward {
  kind: 'mvp' | 'ace';
  /** Display points the award moved the change by: `points - basePoints`. Positive for both. */
  effect: number;
  /** The configured share: MVP's bonus (0.25) or ACE's relief (0.2), for "a quarter" / "a fifth". */
  fraction: number;
}

/** A row the fold stored a breakdown for. */
export interface StoredDeltaReason {
  basis: 'stored';
  result: GameResult;
  /** The printed change: `displayRating(muAfter) - displayRating(muBefore)`. */
  points: number;
  /** The change before the award: `displayRating(baseMuAfter) - displayRating(muBefore)`. */
  basePoints: number;
  odds: DeltaOdds;
  certainty: Certainty;
  award: DeltaAward | 'none';
}

/** A row stored before `0034`: odds and certainty from the befores, the award unknown. */
export interface LegacyDeltaReason {
  basis: 'legacy';
  result: GameResult;
  points: number;
  odds: DeltaOdds;
  certainty: Certainty;
  award: 'unknown';
}

/** A pre-`0034` row missing any of the ten befores: only `You won 31.` can be said. */
export interface LeadOnlyDeltaReason {
  basis: 'lead-only';
  result: GameResult;
  points: number;
}

export type DeltaReason = StoredDeltaReason | LegacyDeltaReason | LeadOnlyDeltaReason;

/** The stored befores of an old row and of the ten players in its game. */
export interface LegacyDeltaInput {
  result: GameResult;
  side: Side;
  muBefore: number;
  muAfter: number;
  sigmaBefore: number | null | undefined;
  ratedGamesBefore?: number | null;
  blue: readonly RatingBefore[];
  red: readonly RatingBefore[];
}

function assertFinite(value: number, name: string, caller: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${caller}: ${name} must be a finite number, got ${value}`);
  }
}

function assertCount(count: number | null | undefined, caller: string): void {
  if (count === null || count === undefined) return;
  if (!(Number.isInteger(count) && count >= 0)) {
    throw new Error(`${caller}: ratedGamesBefore must be a whole number >= 0, got ${count}`);
  }
}

/**
 * The win probability the fold uses for `side`, from the exact before-ratings it hands
 * `rateGame`: `predictWin`, the balancer's own function (M14.59 option (a): one function, not
 * two). Blue's is `predictWin(blue, red)`, red's is one minus it. Five and five, like `rateGame`.
 */
export function foldWinProbability(blue: readonly Rating[], red: readonly Rating[], side: Side): number {
  if (blue.length !== 5 || red.length !== 5) {
    throw new Error(
      `foldWinProbability: both sides must have exactly five ratings, got ${blue.length} and ${red.length}`,
    );
  }
  const p = predictWin(blue, red);
  return side === 100 ? p : 1 - p;
}

function oddsFor(side: Side, sideWinProb: number): DeltaOdds {
  const blue = favoredSide(side === 100 ? sideWinProb : 1 - sideWinProb);
  const bluePct = blue.side === 'red' ? 100 - blue.pct : blue.pct;
  const pct = side === 100 ? bluePct : 100 - bluePct;
  const stance: OddsStance =
    pct > cfg.evenPct.high ? 'favourite' : pct < cfg.evenPct.low ? 'underdog' : 'even';
  return { pct, stance };
}

function certaintyFor(sigmaBefore: number, ratedGamesBefore: number | null | undefined): Certainty {
  if (ratedGamesBefore !== null && ratedGamesBefore !== undefined) {
    if (ratedGamesBefore < cfg.newGames) return 'new';
    // The tenth game, nine before it, is the first settled one.
    return ratedGamesBefore + 1 >= SETTLING_GAMES ? 'settled' : 'settling';
  }
  if (sigmaBefore > cfg.newSigmaAbove) return 'new';
  if (sigmaBefore <= cfg.settledSigmaAtOrBelow) return 'settled';
  return 'settling';
}

function displayDelta(muBefore: number, muAfter: number): number {
  return displayRating(muAfter) - displayRating(muBefore);
}

/**
 * The structured reason for one stored row. Throws on a breakdown the fold could not have
 * written (an MVP on a loss, an award of none with a bonus in it, a probability outside
 * `[0, 1]`): that is a caller bug, not something to explain.
 */
export function explainDelta(input: DeltaBreakdown): StoredDeltaReason {
  const caller = 'explainDelta';
  const { result, side, sideWinProb, sigmaBefore, ratedGamesBefore, muBefore, baseMuAfter, muAfter, award } =
    input;
  if (!(sideWinProb >= 0 && sideWinProb <= 1)) {
    throw new Error(`${caller}: sideWinProb must be in [0, 1], got ${sideWinProb}`);
  }
  if (!(Number.isFinite(sigmaBefore) && sigmaBefore > 0)) {
    throw new Error(`${caller}: sigmaBefore must be a finite number > 0, got ${sigmaBefore}`);
  }
  assertFinite(muBefore, 'muBefore', caller);
  assertFinite(baseMuAfter, 'baseMuAfter', caller);
  assertFinite(muAfter, 'muAfter', caller);
  assertCount(ratedGamesBefore, caller);
  if (award === 'mvp' && result !== 'won') throw new Error(`${caller}: an mvp is on the winning side`);
  if (award === 'ace' && result !== 'lost') throw new Error(`${caller}: an ace is on the losing side`);
  if (award === 'none' && muAfter !== baseMuAfter) {
    throw new Error(`${caller}: award none but muAfter ${muAfter} differs from baseMuAfter ${baseMuAfter}`);
  }

  const points = displayDelta(muBefore, muAfter);
  const basePoints = displayDelta(muBefore, baseMuAfter);
  return {
    basis: 'stored',
    result,
    points,
    basePoints,
    odds: oddsFor(side, sideWinProb),
    certainty: certaintyFor(sigmaBefore, ratedGamesBefore),
    award:
      award === 'none'
        ? 'none'
        : {
            kind: award,
            effect: points - basePoints,
            fraction: award === 'mvp' ? config.rating.mvp.bonusFraction : config.rating.mvp.aceReliefFraction,
          },
  };
}

function known(r: RatingBefore): r is Rating {
  return Number.isFinite(r.mu) && Number.isFinite(r.sigma);
}

/**
 * The reason for a row stored before `0034` (no base `mu_after`). The odds are
 * `foldWinProbability` over the ten stored befores, the same number the fold would have stored;
 * certainty is the same rule as `explainDelta`; the award is `unknown` (none is a real value, and
 * this row cannot say which). Any missing before, the row's own sigma included, leaves only the
 * lead.
 */
export function explainLegacyDelta(input: LegacyDeltaInput): LegacyDeltaReason | LeadOnlyDeltaReason {
  const caller = 'explainLegacyDelta';
  const { result, side, muBefore, muAfter, sigmaBefore, ratedGamesBefore, blue, red } = input;
  assertFinite(muBefore, 'muBefore', caller);
  assertFinite(muAfter, 'muAfter', caller);
  assertCount(ratedGamesBefore, caller);
  const points = displayDelta(muBefore, muAfter);

  const blueKnown = blue.filter(known);
  const redKnown = red.filter(known);
  const sigmaKnown = typeof sigmaBefore === 'number' && Number.isFinite(sigmaBefore) && sigmaBefore > 0;
  if (
    !sigmaKnown ||
    blue.length !== 5 ||
    red.length !== 5 ||
    blueKnown.length !== 5 ||
    redKnown.length !== 5
  ) {
    return { basis: 'lead-only', result, points };
  }

  return {
    basis: 'legacy',
    result,
    points,
    odds: oddsFor(side, foldWinProbability(blueKnown, redKnown, side)),
    certainty: certaintyFor(sigmaBefore, ratedGamesBefore),
    award: 'unknown',
  };
}
