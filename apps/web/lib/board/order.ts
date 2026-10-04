import { renderWebName } from '../tonight/copy';
import type { BoardRow } from './types';

/**
 * The board's order (M3.5; one Rating since M14.15, STRATEGY §5): **descending Rating** on All
 * time, **descending net points** on a week (M14.57), the number printed on the row, so reading the
 * column top to bottom never goes up (the audit found a 1361 below a 1287 when the board sorted on
 * a number it did not print).
 *
 * On the all-time track the board is two sections: the ranked players (core's `SETTLING_GAMES` or
 * more rated games in the group), numbered, then the settling ones, unnumbered. Each section is in
 * this order. A week is one list (`settling` is always false there).
 *
 * Pure and separate from the loader so the tie rules are a unit test rather than a night.
 */

/**
 * The board's comparator. A week row (`track: 'week'`) is ranked by {@link compareWeekRows}; an
 * all-time row by Rating, then the unrounded mu (`sortKey`), then the name a reader sees, then the
 * puuid (so two nameless `Someone`s keep one order between renders).
 */
export function compareBoardRows(a: BoardRow, b: BoardRow): number {
  if (a.track === 'week' && b.track === 'week') return compareWeekRows(a, b);
  return (
    b.rating - a.rating ||
    b.sortKey - a.sortKey ||
    renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
    byPuuid(a, b)
  );
}

/**
 * The week boards' order (M14.57, decision row 2026-10-04): **net points**; then more wins; then
 * fewer games (the same points in fewer games); then the higher all-time Rating (printed, then the
 * unrounded mu); then the display name A to Z; then the puuid. Stable, never random.
 */
export function compareWeekRows(a: BoardRow, b: BoardRow): number {
  return (
    (b.points ?? 0) - (a.points ?? 0) ||
    b.wins - a.wins ||
    a.games - b.games ||
    b.rating - a.rating ||
    b.sortKey - a.sortKey ||
    renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
    byPuuid(a, b)
  );
}

function byPuuid(a: BoardRow, b: BoardRow): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

/** A new array, ranked rows first and settling rows after, each in board order. Never sorts in place. */
export function sortBoardRows(rows: readonly BoardRow[]): BoardRow[] {
  const { ranked, settling } = boardSections(rows);
  return [...ranked, ...settling];
}

/** The board's two sections, each in board order. On a week `settling` is empty. */
export function boardSections(rows: readonly BoardRow[]): { ranked: BoardRow[]; settling: BoardRow[] } {
  const sorted = [...rows].sort(compareBoardRows);
  return {
    ranked: sorted.filter((row) => !row.settling),
    settling: sorted.filter((row) => row.settling),
  };
}

/** The board's sort select (M14.15): Rating is the default; the settling section stays below. */
export const BOARD_SORTS = ['rating', 'games', 'winrate'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export const DEFAULT_BOARD_SORT: BoardSort = 'rating';

/** `?sort=`, or the default for anything else (a typed URL never 404s the board). */
export function parseBoardSort(value: string | string[] | undefined): BoardSort {
  return typeof value === 'string' && (BOARD_SORTS as readonly string[]).includes(value)
    ? (value as BoardSort)
    : DEFAULT_BOARD_SORT;
}

/**
 * One section re-sorted for the select. `rating` is the board's own order (net points on a week). `games` is most games
 * first; `winrate` is the best win rate first, more games breaking a tie. Both fall back to the
 * board's order, so a tie never shuffles.
 */
export function sortSection(rows: readonly BoardRow[], sort: BoardSort): BoardRow[] {
  const byRating = [...rows].sort(compareBoardRows);
  if (sort === 'rating') return byRating;
  const position = new Map(byRating.map((row, index) => [row.puuid, index]));
  const tie = (a: BoardRow, b: BoardRow) => (position.get(a.puuid) ?? 0) - (position.get(b.puuid) ?? 0);
  if (sort === 'games') return byRating.sort((a, b) => b.games - a.games || tie(a, b));
  const rate = (row: BoardRow) => (row.games === 0 ? 0 : row.wins / row.games);
  return byRating.sort((a, b) => rate(b) - rate(a) || b.games - a.games || tie(a, b));
}

/** `?page=2`, or 1 for anything that is not a positive integer. The view clamps the top. */
export function parseBoardPage(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) return 1;
  return Number(value);
}
