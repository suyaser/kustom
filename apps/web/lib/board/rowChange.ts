import { displayDelta } from '../ratingDisplay';
import type { BoardRow } from './types';

/**
 * The signed change a board row prints (M14.57): net points on a week (the sum of the printed
 * per-game weekly changes, the number the week is sorted on), the 1200-to-now climb on `All time`, or
 * `null` for a row with neither. One function so the board, the Tonight rail and any later surface
 * print the same number for the same row.
 */
export function rowChange(row: Pick<BoardRow, 'points' | 'climb'>): number | null {
  if (row.points !== null) return row.points;
  return row.climb === null ? null : displayDelta(row.climb.rBefore, row.climb.rAfter);
}
