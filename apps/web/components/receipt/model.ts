import {
  describeSwap,
  type FavoredSide,
  favoredSide,
  type SwapDescription,
  type WhyLowerScored,
  whyLower,
} from '@customs/core';
import { storedScoreParts } from '@customs/db/schemas';
import { NAMELESS_PLAYER } from '@/lib/discord/embeds';
import { barPercents } from '@/lib/receipt/copy';
import type { ReceiptNames, SplitRowLike, StoredSplit } from './types';

/**
 * The receipt's facts, read off the stored columns through M14.4's core helpers and
 * `lib/receipt/copy`'s `barPercents` (core's `favoredSide` rounding), nothing else (STRATEGY
 * §4.2 rule 5). `explanation` is carried, never read.
 */

/** A `splits` row (blue / red parsed) in the receipt's shape. */
export function receiptSplitFromRow(row: SplitRowLike): StoredSplit {
  return {
    rank: row.rank,
    isChosen: row.is_chosen,
    blueWinProb: row.blue_win_prob,
    gap: row.gap,
    offRoleCount: row.off_role_count,
    blue: row.blue,
    red: row.red,
    explanation: row.explanation,
    // M18.13 (0045): zod-checked; a row from before the column, or a bad value, is `null`.
    scoreParts: storedScoreParts(row.score_parts),
  };
}

/** The page's name for a puuid: the map's, or the shared fallback word. */
export function nameLookup(names: ReceiptNames): (puuid: string) => string {
  return (puuid) => {
    const name = names[puuid]?.trim();
    return name === undefined || name.length === 0 ? NAMELESS_PLAYER : name;
  };
}

/** A split's odds as the bar draws them: both rounded ends and the favored side, all from `favoredSide`. */
export interface Odds {
  blueWinProb: number;
  favored: FavoredSide;
  bluePct: number;
  redPct: number;
}

/** `null` for a probability core refuses (outside `[0, 1]`, NaN): the receipt hides, the page lives. */
export function oddsOf(blueWinProb: number): Odds | null {
  if (!Number.isFinite(blueWinProb) || blueWinProb < 0 || blueWinProb > 1) return null;
  const { blue, red } = barPercents(blueWinProb);
  return { blueWinProb, favored: favoredSide(blueWinProb), bluePct: blue, redPct: red };
}

function safeSwap(chosen: StoredSplit, other: StoredSplit): SwapDescription | null {
  try {
    return describeSwap(chosen, other);
  } catch {
    // Not the same ten: there is no honest "who swapped". The row names nobody.
    return null;
  }
}

export interface SplitRow {
  split: StoredSplit;
  odds: Odds;
  inPlay: boolean;
  /** `null` on the one in play. */
  swap: SwapDescription | null;
  /** Ranked below the one in play: why it lost. */
  why: WhyLowerScored | null;
  /** Ranked above the one in play (a reroll moved past it). */
  rerolledPast: boolean;
  /** Its odds sit nearer 50/50 than the one in play's. */
  closer: boolean;
}

export interface ReceiptModel {
  chosen: StoredSplit;
  odds: Odds;
  /** How many splits the run stored, 1 to 3. */
  total: number;
  /** The split ranked directly below the one in play, or `null`. */
  next: StoredSplit | null;
  rows: SplitRow[];
}

/**
 * The model for a run of stored splits, or `null` when there is nothing honest to draw (no split,
 * or a chosen probability outside `[0, 1]`). Any order in; rows come out by rank. With no row
 * flagged `isChosen` (the window between a reroll's two writes) the best rank is in play, the
 * same rule the tonight loader uses.
 */
export function buildReceipt(splits: readonly StoredSplit[]): ReceiptModel | null {
  const sorted = [...splits].sort((a, b) => a.rank - b.rank);
  const chosen = sorted.find((s) => s.isChosen) ?? sorted[0];
  if (chosen === undefined) return null;
  const odds = oddsOf(chosen.blueWinProb);
  if (odds === null) return null;

  const rows: SplitRow[] = [];
  for (const split of sorted) {
    const rowOdds = split === chosen ? odds : oddsOf(split.blueWinProb);
    if (rowOdds === null) continue;
    const inPlay = split === chosen;
    const below = split.rank > chosen.rank;
    rows.push({
      split,
      odds: rowOdds,
      inPlay,
      swap: inPlay ? null : safeSwap(chosen, split),
      why: below ? whyLower(chosen, split) : null,
      rerolledPast: !inPlay && !below,
      closer: !inPlay && rowOdds.favored.pct < odds.favored.pct,
    });
  }

  const next = rows.find((r) => r.split.rank > chosen.rank)?.split ?? null;
  return { chosen, odds, total: sorted.length, next, rows };
}

/** Segment widths for the bar: proportional, but never under 30% so a label always fits (5.5). */
export function barFlex(odds: Odds, floor = 30): { blue: number; red: number } {
  const blue = Math.min(100 - floor, Math.max(floor, odds.bluePct));
  return { blue, red: 100 - blue };
}

/**
 * Below 768 a 30% segment is too narrow for `BLUE 7%` at 375 (design round 1, M14.16): the full
 * bar clamps to 37/63 there and keeps 30/70 from 768 (`WinBar` switches with a CSS variable).
 */
export const PHONE_BAR_FLOOR = 37;
