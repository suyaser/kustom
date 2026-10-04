import {
  displayKustom,
  explainKustomDelta,
  type KustomAward,
  type KustomDeltaParts,
  shareFor,
} from '@customs/core';
import type { SideValue } from '@customs/db';

/**
 * Why each game moved a Rating by as much as it did (M14.58, Kustom since M18.6), and which odds a
 * result line shows (M14.59), from what the fold stored (`0034`, `0036`). Pure: rows in, structure
 * out. The words are the web's (`copy.ts`); the reasoning is core's (`explainKustomDelta`), and
 * nothing here computes a rating.
 *
 * Both tracks are read off the same row: the all-time columns (`r_before`, `r_after`, `k`,
 * `fold_p`, `rated_games_before`) and the weekly ones (`week_r_before`, `week_r_after`, `week_k`,
 * `week_fold_p`, `week_games_before`). The share rank and the award are one per game, the same on
 * both (M18.1). No OpenSkill column is read here (M18.6 acceptance).
 *
 * One rule decides which number goes where (M14.59, decision row 2026-10-04, option (a)):
 * anything that is the bot's claim about its split uses the bot's odds (`splits.blue_win_prob`:
 * the receipt, the pick, `Upset!`, calibration); anything about rating points uses the rating's
 * odds (the fold's stored `fold_p`: the explanation, and the history and poster result line).
 */

/** Which track a reason explains: the all-time Rating or the week's. */
export type BreakdownTrack = 'all-time' | 'week';

/** The bot's odds model on the chosen split (`splits.odds_model`, 0036). */
export type OddsModel = 'openskill' | 'kustom';

/** One `game_players` row as the readers select it: both tracks' befores, afters and parts. */
export interface BreakdownRow {
  playerId: string;
  side: SideValue;
  /** All-time track (0036): all four together or none (`game_players_kustom_together`). */
  rBefore: number | null;
  rAfter: number | null;
  k: number | null;
  /** On a row with `r_after`: Kustom's all-time expected score for this row's side. */
  foldP: number | null;
  ratedGamesBefore: number | null;
  /** 1..5 inside the team, `null` when the game had no performance score. */
  shareRank: number | null;
  award: string | null;
  /** Weekly track (0036): all five together or none (`game_players_week_together`). */
  weekRBefore: number | null;
  weekRAfter: number | null;
  weekK: number | null;
  weekFoldP: number | null;
  weekGamesBefore: number | null;
}

/** One game, as the explanation and the result line need it. */
export interface BreakdownGame {
  winningSide: SideValue;
  /** The bot's chosen split's `blue_win_prob`, or `null` for a game the bot did not pick. */
  botBlueWinProb: number | null;
  /**
   * Which function made {@link BreakdownGame.botBlueWinProb} (`splits.odds_model`). `kustom` rolls
   * read the same Ratings and the same function as the fold, so they never get a second number.
   * Absent or `null` reads as `openskill` (a roll stored before 0036).
   */
  botOddsModel?: OddsModel | null;
  rows: readonly BreakdownRow[];
}

/** The columns a reader adds to its `game_players` select for {@link toBreakdownRow}. */
export const BREAKDOWN_COLUMNS =
  'player_id, side, r_before, r_after, k, fold_p, rated_games_before, share_rank, award, week_r_before, week_r_after, week_k, week_fold_p, week_games_before' as const;

/** The raw select row, before {@link toBreakdownRow}. */
export interface RawBreakdownRow {
  player_id: string;
  side: number;
  r_before: number | null;
  r_after: number | null;
  k: number | null;
  fold_p: number | null;
  rated_games_before: number | null;
  share_rank: number | null;
  award: string | null;
  week_r_before: number | null;
  week_r_after: number | null;
  week_k: number | null;
  week_fold_p: number | null;
  week_games_before: number | null;
}

export function toBreakdownRow(row: RawBreakdownRow): BreakdownRow {
  return {
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    rBefore: row.r_before ?? null,
    rAfter: row.r_after ?? null,
    k: row.k ?? null,
    foldP: row.fold_p ?? null,
    ratedGamesBefore: row.rated_games_before ?? null,
    shareRank: row.share_rank ?? null,
    award: row.award ?? null,
    weekRBefore: row.week_r_before ?? null,
    weekRAfter: row.week_r_after ?? null,
    weekK: row.week_k ?? null,
    weekFoldP: row.week_fold_p ?? null,
    weekGamesBefore: row.week_games_before ?? null,
  };
}

/**
 * The structured reason for one player's change on one track (M18.6): core's
 * `explainKustomDelta` parts from the stored row, and on a week row the same game's all-time
 * change (05-design 11.6.3's `All time: +8, to 1300.` clause).
 */
export interface KustomReason {
  track: BreakdownTrack;
  parts: KustomDeltaParts;
  /** The player's rated games on this track before this one (`n`): 0 is a first game. */
  gamesBefore: number;
  /** On a week row, the all-time change and Rating after of the same game; `null` otherwise. */
  allTime: { points: number; rating: number } | null;
}

function awardOf(value: string | null): KustomAward {
  return value === 'mvp' || value === 'ace' ? value : 'none';
}

interface TrackValues {
  rBefore: number;
  rAfter: number;
  k: number;
  expected: number;
  n: number;
}

function trackOf(row: BreakdownRow, track: BreakdownTrack): TrackValues | null {
  const [rBefore, rAfter, k, expected, n] =
    track === 'all-time'
      ? [row.rBefore, row.rAfter, row.k, row.foldP, row.ratedGamesBefore]
      : [row.weekRBefore, row.weekRAfter, row.weekK, row.weekFoldP, row.weekGamesBefore];
  if (rBefore === null || rAfter === null || k === null || expected === null || n === null) return null;
  return { rBefore, rAfter, k, expected, n };
}

/**
 * The structured reason for one player's change in one game on one track, or `null` for a row
 * with nothing on that track (ARAM, unrated, a backfill waiting for `rebuild-ratings`, a game
 * before the reset epoch on `all-time`).
 */
export function rowReason(
  game: BreakdownGame,
  playerId: string,
  track: BreakdownTrack = 'all-time',
): KustomReason | null {
  const row = game.rows.find((candidate) => candidate.playerId === playerId);
  if (row === undefined) return null;
  const values = trackOf(row, track);
  if (values === null) return null;
  const won = row.side === game.winningSide;
  const shareRank = row.shareRank;
  let parts: KustomDeltaParts;
  try {
    const share = shareRank === null ? 1 : shareFor(shareRank, won);
    parts = explainKustomDelta({
      puuid: playerId,
      side: row.side,
      won,
      rBefore: values.rBefore,
      rAfter: values.rAfter,
      k: values.k,
      expected: values.expected,
      shareRank,
      share,
      base: values.k * ((won ? 1 : 0) - values.expected),
      award: shareRank === null ? 'none' : awardOf(row.award),
    });
  } catch (error) {
    // A stored row core refuses (a hand edit that breaks the invariants) is logged and left
    // unexplained: the change still prints, the page still renders.
    console.error(`breakdown: the stored row for player ${playerId} did not explain`, error);
    return null;
  }
  const allTime = track === 'week' ? trackOf(row, 'all-time') : null;
  return {
    track,
    parts,
    gamesBefore: values.n,
    allTime:
      allTime === null
        ? null
        : {
            points: displayKustom(allTime.rAfter) - displayKustom(allTime.rBefore),
            rating: displayKustom(allTime.rAfter),
          },
  };
}

/**
 * The two odds a result line can show (M14.59). Percentages are blue's, rounded the receipt's way
 * (`Math.round(p * 100)`, `favoredSide`'s rule); red is `100 - blue`.
 */
export interface ResultOdds {
  /** Blue's percent in the bot's chosen split, or `null` for a game the bot did not pick. */
  botBluePct: number | null;
  /**
   * Blue's percent the all-time Kustom fold used: the stored `fold_p` of the blue rows. `null`
   * when there is none (an unrated game, a backfill the rebuild has not folded).
   */
  ratingBluePct: number | null;
  /**
   * The result line names the rating's number too (`For points, Red was 50%.`): both exist, round
   * to different percents, **and the bot rolled with OpenSkill** (a game rolled before the M18
   * switch; 05-design 11.7). A `kustom` roll reads the same Ratings and the same function, so it
   * never gets a second number. When `false` every surface shows one number, unlabelled.
   */
  differ: boolean;
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
 * The all-time fold's blue probability for a game: the stored `fold_p` when every blue row was
 * folded under Kustom (they are one number written five times; the first is read), else `null`.
 */
export function ratingBlueWinProb(rows: readonly BreakdownRow[]): number | null {
  const blue = rows.filter((row) => row.side === 100);
  const red = rows.filter((row) => row.side === 200);
  if (blue.length !== 5 || red.length !== 5) return null;
  if (!rows.every((row) => row.rAfter !== null && row.foldP !== null)) return null;
  return blue[0]?.foldP ?? null;
}

/** The result line's odds (M14.59), or `null` for a game with neither number. */
export function resultOdds(game: BreakdownGame): ResultOdds | null {
  const rating = ratingBlueWinProb(game.rows);
  const botBluePct = game.botBlueWinProb === null ? null : pct(game.botBlueWinProb);
  const ratingBluePct = rating === null ? null : pct(rating);
  if (botBluePct === null && ratingBluePct === null) return null;
  const differ =
    botBluePct !== null &&
    ratingBluePct !== null &&
    botBluePct !== ratingBluePct &&
    (game.botOddsModel ?? 'openskill') !== 'kustom';
  return {
    botBluePct,
    ratingBluePct,
    differ,
    pointsBluePct: ratingBluePct ?? botBluePct,
    ratingBlueWinProb: rating,
  };
}
