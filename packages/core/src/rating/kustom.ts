/**
 * The Kustom rating (M18.1). Pure, and **not wired**: nothing outside `packages/core` imports it
 * until the M18 switch deploy (M18.2, M18.5). OpenSkill (`rating/index.ts`) is untouched.
 *
 * One line of arithmetic a friend can check on a phone:
 *
 *   change = K × (result − expected) × share
 *
 * - `result` is 1 for a win, 0 for a loss.
 * - `expected` is `winProbability(Σblue, Σred)` for blue and one minus it for red, over the five
 *   players' unrounded Ratings `r` on the track being folded.
 * - `K = kFor(n)`, `n` the player's own rated games on that track before this one.
 * - `share` comes from the player's performance rank inside their own team (`shareRanks`,
 *   `shareFor`): winners 1.2 … 0.8, losers 0.8 … 1.2, all 1.0 when the game has no score.
 *
 * The same function folds both tracks (all-time and weekly); the caller passes that track's
 * `r` and `n`. Constants live in `config.kustom`.
 */

import { config } from '../config';
import type { Side } from '../types';

const TEAM_SIZE = 5;
const C = config.kustom;

/** Thrown on input the fold's gates already exclude, so a throw here is a bug, never data. */
export class KustomInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KustomInputError';
  }
}

/** The balanced-teams guard's pair (research §6.5). Every caller passes `{ a: 0, b: 1 }` until M18.11. */
export interface KustomCalib {
  a: number;
  b: number;
}

const PLAIN: KustomCalib = { a: 0, b: 1 };

/**
 * Blue's chance to win: `1 / (1 + exp(−(a + b × (blueTotal − redTotal) / 400)))`. The one odds
 * function; with the default calibration it is exactly the formula the fold's expected uses.
 */
export function winProbability(blueTotal: number, redTotal: number, calib: KustomCalib = PLAIN): number {
  if (![blueTotal, redTotal, calib.a, calib.b].every(Number.isFinite)) {
    throw new KustomInputError(
      `winProbability: needs finite totals and calibration, got ${blueTotal}, ${redTotal}, (${calib.a}, ${calib.b})`,
    );
  }
  return 1 / (1 + Math.exp(-(calib.a + (calib.b * (blueTotal - redTotal)) / C.oddsScale)));
}

/** `16 + 16 × max(0, 10 − n) / 10`: 32 at a player's first game on a track, 16 from the eleventh. */
export function kFor(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new KustomInputError(`kFor: n must be an integer >= 0, got ${n}`);
  }
  return C.kSettled + ((C.kNew - C.kSettled) * Math.max(0, C.kSettleGames - n)) / C.kSettleGames;
}

/**
 * One side's five PUUIDs ordered by performance score, best first; equal scores by PUUID
 * ascending (as `mvpAce` breaks them). `null` when any of the five has no score: then every
 * share in the game is 1.0 and nobody is named.
 */
export function shareRanks(
  team: readonly string[],
  scores: ReadonlyMap<string, number | null>,
): string[] | null {
  if (team.length !== TEAM_SIZE || new Set(team).size !== TEAM_SIZE) {
    throw new KustomInputError(`shareRanks: needs five distinct players, got ${team.join(', ')}`);
  }
  const scored: { puuid: string; score: number }[] = [];
  for (const puuid of team) {
    const score = scores.get(puuid);
    if (score === undefined || score === null) return null;
    if (!Number.isFinite(score)) throw new KustomInputError(`shareRanks: ${puuid} has score ${score}`);
    scored.push({ puuid, score });
  }
  scored.sort((x, y) => y.score - x.score || (x.puuid < y.puuid ? -1 : 1));
  return scored.map((s) => s.puuid);
}

/** The share for performance rank 1..5 on the winning (`won`) or losing side. */
export function shareFor(rank: number, won: boolean): number {
  if (!Number.isInteger(rank) || rank < 1 || rank > TEAM_SIZE) {
    throw new KustomInputError(`shareFor: rank must be 1..5, got ${rank}`);
  }
  return C.winnerShares[won ? rank - 1 : TEAM_SIZE - rank] as number;
}

/** One seat of a game to fold, on one track. `score` is the performance score, `null` if unknown. */
export interface KustomPlayer {
  puuid: string;
  side: Side;
  /** Unrounded Rating on this track before the game. */
  r: number;
  /** Rated games on this track before this one. */
  n: number;
  score: number | null;
}

export interface KustomGame {
  players: readonly KustomPlayer[];
  winningSide: Side;
}

export type KustomAward = 'mvp' | 'ace' | 'none';

/** What one seat's fold produced: everything the stored row and its explanation need. */
export interface KustomRow {
  puuid: string;
  side: Side;
  won: boolean;
  rBefore: number;
  rAfter: number;
  k: number;
  /** This player's side's expected score (blue's `winProbability`, or one minus it). */
  expected: number;
  /** 1..5 inside the team, or `null` when the game has no score. */
  shareRank: number | null;
  share: number;
  /** `k × (result − expected)`, before the share. */
  base: number;
  award: KustomAward;
}

/**
 * Fold one game. Rows come back in input order. Throws `KustomInputError` on anything but five
 * distinct players a side, a non-finite `r`, a bad `n`, or a `winningSide` not 100 or 200.
 */
export function rateGameKustom(game: KustomGame, calib: KustomCalib = PLAIN): KustomRow[] {
  const { players, winningSide } = game;
  if (winningSide !== 100 && winningSide !== 200) {
    throw new KustomInputError(`rateGameKustom: winningSide must be 100 or 200, got ${winningSide}`);
  }
  const blue = players.filter((p) => p.side === 100);
  const red = players.filter((p) => p.side === 200);
  if (blue.length !== TEAM_SIZE || red.length !== TEAM_SIZE || players.length !== 2 * TEAM_SIZE) {
    throw new KustomInputError(
      `rateGameKustom: needs five players a side, got ${blue.length} blue and ${red.length} red of ${players.length}`,
    );
  }
  if (new Set(players.map((p) => p.puuid)).size !== players.length) {
    throw new KustomInputError('rateGameKustom: a PUUID appears twice in one game');
  }
  for (const p of players) {
    if (!Number.isFinite(p.r)) throw new KustomInputError(`rateGameKustom: ${p.puuid} has r ${p.r}`);
  }

  const sum = (team: readonly KustomPlayer[]) => team.reduce((a, p) => a + p.r, 0);
  const pBlue = winProbability(sum(blue), sum(red), calib);

  const scores = new Map(players.map((p) => [p.puuid, p.score]));
  const blueRanks = shareRanks(
    blue.map((p) => p.puuid),
    scores,
  );
  const redRanks = shareRanks(
    red.map((p) => p.puuid),
    scores,
  );
  const ranked = blueRanks !== null && redRanks !== null;
  const rankOf = new Map<string, number>();
  if (ranked) {
    for (const order of [blueRanks, redRanks]) {
      for (const [i, puuid] of order.entries()) rankOf.set(puuid, i + 1);
    }
  }

  return players.map((p) => {
    const won = p.side === winningSide;
    const k = kFor(p.n);
    const expected = p.side === 100 ? pBlue : 1 - pBlue;
    const base = k * ((won ? 1 : 0) - expected);
    const shareRank = ranked ? (rankOf.get(p.puuid) as number) : null;
    const share = shareRank === null ? 1 : shareFor(shareRank, won);
    const award: KustomAward = shareRank === 1 ? (won ? 'mvp' : 'ace') : 'none';
    return {
      puuid: p.puuid,
      side: p.side,
      won,
      rBefore: p.r,
      rAfter: p.r + base * share,
      k,
      expected,
      shareRank,
      share,
      base,
      award,
    };
  });
}

/** The printed Rating. */
export function displayKustom(r: number): number {
  return Math.round(r);
}

/** The printed change: a difference of printed Ratings, so a column of them adds up. */
export function printedChange(rBefore: number, rAfter: number): number {
  return displayKustom(rAfter) - displayKustom(rBefore);
}

/** The parts of "why this many points" for one row; web owns the words (M18.7). */
export interface KustomDeltaParts {
  side: Side;
  result: 'win' | 'loss';
  /** The side's expected as a whole percent; red is 100 minus blue's rounding, as on the receipt. */
  expectedPct: number;
  k: number;
  /** K above the settled K: one of the player's first ten games on this track ("count extra"). */
  firstTenGames: boolean;
  shareRank: number | null;
  share: number;
  award: KustomAward;
  points: number;
}

/** Structure from a stored row. Never mentions sigma, certainty, or anyone else's numbers. */
export function explainKustomDelta(row: KustomRow): KustomDeltaParts {
  const bluePct = Math.round((row.side === 100 ? row.expected : 1 - row.expected) * 100);
  return {
    side: row.side,
    result: row.won ? 'win' : 'loss',
    expectedPct: row.side === 100 ? bluePct : 100 - bluePct,
    k: row.k,
    firstTenGames: row.k > C.kSettled,
    shareRank: row.shareRank,
    share: row.share,
    award: row.award,
    points: printedChange(row.rBefore, row.rAfter),
  };
}
