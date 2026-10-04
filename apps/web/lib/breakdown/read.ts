import {
  type DeltaReason,
  explainDelta,
  explainLegacyDelta,
  foldWinProbability,
  provisionalSeed,
  type RatingBefore,
} from '@customs/core';
import { type FoldBreakdown, type SideValue, storedFoldBreakdown } from '@customs/db';

/**
 * Why each game moved a Rating by as much as it did (M14.58), and which odds a result line shows
 * (M14.59), from what the fold stored (`0034`). Pure: rows in, structure out. The words are the
 * web's; the reasoning is core's (`explainDelta`, `explainLegacyDelta`, `foldWinProbability`), and
 * nothing here computes a rating.
 *
 * One rule decides which number goes where (M14.59, decision row 2026-10-04, option (a)):
 * anything that is the bot's claim about its split uses the bot's odds (`splits.blue_win_prob`:
 * the receipt, the pick, `Upset!`, calibration); anything about rating points uses the rating's
 * odds (the fold's stored `fold_p`: the explanation, and the history and poster result line).
 */

/** One `game_players` row as the readers select it: the befores, the after and the breakdown. */
export interface BreakdownRow {
  playerId: string;
  side: SideValue;
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  /** The four `0034` columns, as stored (any of them null on a row stored before it). */
  foldP: number | null;
  baseMuAfter: number | null;
  award: string | null;
  ratedGamesBefore: number | null;
}

/** One game, as the explanation and the result line need it. */
export interface BreakdownGame {
  winningSide: SideValue;
  /** The bot's chosen split's `blue_win_prob`, or `null` for a game the bot did not pick. */
  botBlueWinProb: number | null;
  rows: readonly BreakdownRow[];
}

/** The columns a reader adds to its `game_players` select for {@link toBreakdownRow}. */
export const BREAKDOWN_COLUMNS =
  'player_id, side, mu_before, sigma_before, mu_after, fold_p, base_mu_after, award, rated_games_before' as const;

/** The raw select row, before {@link toBreakdownRow}. */
export interface RawBreakdownRow {
  player_id: string;
  side: number;
  mu_before: number | null;
  sigma_before: number | null;
  mu_after: number | null;
  fold_p: number | null;
  base_mu_after: number | null;
  award: string | null;
  rated_games_before: number | null;
}

export function toBreakdownRow(row: RawBreakdownRow): BreakdownRow {
  return {
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    muBefore: row.mu_before,
    sigmaBefore: row.sigma_before,
    muAfter: row.mu_after,
    foldP: row.fold_p,
    baseMuAfter: row.base_mu_after,
    award: row.award,
    ratedGamesBefore: row.rated_games_before,
  };
}

function storedOf(row: BreakdownRow): FoldBreakdown | null {
  return storedFoldBreakdown({
    fold_p: row.foldP,
    base_mu_after: row.baseMuAfter,
    award: row.award,
    rated_games_before: row.ratedGamesBefore,
  });
}

function befores(rows: readonly BreakdownRow[], side: SideValue): RatingBefore[] {
  return rows.filter((row) => row.side === side).map((row) => ({ mu: row.muBefore, sigma: row.sigmaBefore }));
}

/**
 * The structured reason for one player's change in one game (M14.58), or `null` for a row with no
 * change to explain (ARAM, unrated, a backfill waiting for `rebuild-ratings`).
 *
 * - **Stored** (`0034` filled it): `explainDelta` over the fold's own breakdown, so the award
 *   sentence names what actually moved the number, even when the read-time badge disagrees.
 * - **Legacy** (stored before `0034`): `explainLegacyDelta`, odds from the ten stored befores, the
 *   award `unknown`; a row missing any before says only the lead (`basis: 'lead-only'`).
 *
 * A stored breakdown core refuses (a hand edit that breaks its invariants) is logged and explained
 * as legacy rather than crashing the page.
 */
export function rowReason(game: BreakdownGame, playerId: string): DeltaReason | null {
  const row = game.rows.find((candidate) => candidate.playerId === playerId);
  if (row === undefined || row.muBefore === null || row.muAfter === null) return null;
  const result = row.side === game.winningSide ? 'won' : 'lost';
  const stored = storedOf(row);

  if (stored !== null && row.sigmaBefore !== null) {
    try {
      return explainDelta({
        result,
        side: row.side,
        sideWinProb: stored.fold_p,
        sigmaBefore: row.sigmaBefore,
        ratedGamesBefore: stored.rated_games_before,
        muBefore: row.muBefore,
        baseMuAfter: stored.base_mu_after,
        muAfter: row.muAfter,
        award: stored.award,
      });
    } catch (error) {
      console.error(`breakdown: the stored breakdown for player ${playerId} did not explain`, error);
    }
  }

  return explainLegacyDelta({
    result,
    side: row.side,
    muBefore: row.muBefore,
    muAfter: row.muAfter,
    sigmaBefore: row.sigmaBefore,
    ratedGamesBefore: row.ratedGamesBefore,
    blue: befores(game.rows, 100),
    red: befores(game.rows, 200),
  });
}

/** Why the bot's odds and the rating's odds differ, when they do (M14.59). */
export type OddsGapReason = 'new-players' | 'ratings-moved';

/**
 * The two odds a result line can show (M14.59). Percentages are blue's, rounded the receipt's way
 * (`Math.round(p * 100)`, `favoredSide`'s rule); red is `100 - blue`.
 */
export interface ResultOdds {
  /** Blue's percent in the bot's chosen split, or `null` for a game the bot did not pick. */
  botBluePct: number | null;
  /**
   * Blue's percent the rating fold used: the stored `fold_p` of the blue rows, or, for a game
   * stored before `0034`, `foldWinProbability` over the ten stored befores. `null` when neither
   * exists (an unrated game, a backfill missing a before).
   */
  ratingBluePct: number | null;
  /**
   * Both exist and round to different percents: the result line names both, once, with
   * {@link ResultOdds.reason}. When `false` every surface shows one number, unlabelled.
   */
  differ: boolean;
  /**
   * Why, when they differ: `new-players` when one of the ten was new to the group's ratings (the
   * bot rated them from their rank at the roll; the fold started them at 1200), else
   * `ratings-moved` (ratings changed between the roll and the game). `null` when they agree.
   */
  reason: OddsGapReason | null;
  /** The number anything about rating points shows: the rating's when it exists, else the bot's. */
  pointsBluePct: number | null;
  /**
   * Blue's unrounded probability the rating fold used (the source of {@link ResultOdds.ratingBluePct}),
   * for a receipt that draws the bar from it (M14.59: a game the bot did not pick shows the fold's
   * number). `null` when there is none.
   */
  ratingBlueWinProb: number | null;
}

/** `Math.round(p * 100)`, the receipt's rounding. */
function pct(p: number): number {
  return Math.round(p * 100);
}

/**
 * The fold's blue probability for a game: the stored value when every blue row has one (they are
 * one number written ten times; the first is read), else the legacy recompute from the befores.
 */
export function ratingBlueWinProb(rows: readonly BreakdownRow[]): number | null {
  const blue = rows.filter((row) => row.side === 100);
  const red = rows.filter((row) => row.side === 200);
  const stored = blue.map((row) => storedOf(row)?.fold_p ?? null);
  if (blue.length === 5 && stored.every((p) => p !== null)) return stored[0] as number;
  const known = (list: readonly BreakdownRow[]) =>
    list.flatMap((row) =>
      row.muBefore === null || row.sigmaBefore === null ? [] : [{ mu: row.muBefore, sigma: row.sigmaBefore }],
    );
  const b = known(blue);
  const r = known(red);
  if (b.length !== 5 || r.length !== 5 || blue.length !== 5 || red.length !== 5) return null;
  return foldWinProbability(b, r, 100);
}

/** One of the ten was new to the group's ratings when the game was folded. */
function hadNewPlayer(rows: readonly BreakdownRow[]): boolean {
  const seed = provisionalSeed();
  return rows.some((row) =>
    row.ratedGamesBefore !== null
      ? row.ratedGamesBefore === 0
      : row.muBefore === seed.mu && row.sigmaBefore === seed.sigma,
  );
}

/** The result line's odds (M14.59), or `null` for a game with neither number. */
export function resultOdds(game: BreakdownGame): ResultOdds | null {
  const rated =
    game.rows.length > 0 && game.rows.every((row) => row.muBefore !== null && row.muAfter !== null);
  const rating = rated ? ratingBlueWinProb(game.rows) : null;
  const botBluePct = game.botBlueWinProb === null ? null : pct(game.botBlueWinProb);
  const ratingBluePct = rating === null ? null : pct(rating);
  if (botBluePct === null && ratingBluePct === null) return null;
  const differ = botBluePct !== null && ratingBluePct !== null && botBluePct !== ratingBluePct;
  return {
    botBluePct,
    ratingBluePct,
    differ,
    reason: differ ? (hadNewPlayer(game.rows) ? 'new-players' : 'ratings-moved') : null,
    pointsBluePct: ratingBluePct ?? botBluePct,
    ratingBlueWinProb: rating,
  };
}
