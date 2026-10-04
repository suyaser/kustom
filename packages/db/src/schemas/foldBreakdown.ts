import { z } from 'zod';

/**
 * The fold's stored breakdown on a `game_players` row (M14.58, M14.59, `0034_fold_breakdown.sql`):
 * the odds the fold used for the row's side, the base `mu_after` before the MVP/ACE bonus, the
 * award that moved this rating, and the player's rated games before this one.
 *
 * The three award words are the `check` on `game_players.award`. `none` is a real value (a game
 * nobody could be scored in included); a null column is "stored before 0034", never `none`.
 *
 * Readers parse the four columns of a row through {@link storedFoldBreakdownSchema}: a row whose
 * breakdown is null, partial or out of range reads as `null` (the legacy explanation), so a bad
 * row is dropped rather than crashing a page.
 */
export const FOLD_AWARDS = ['mvp', 'ace', 'none'] as const;

export const foldAwardSchema = z.enum(FOLD_AWARDS);

export type FoldAward = z.infer<typeof foldAwardSchema>;

/** A whole stored breakdown: what the fold wrote beside `mu_after`. */
export const foldBreakdownSchema = z.object({
  fold_p: z.number().min(0).max(1),
  base_mu_after: z.number().finite(),
  award: foldAwardSchema,
  rated_games_before: z.number().int().min(0).nullable(),
});

export type FoldBreakdown = z.infer<typeof foldBreakdownSchema>;

/** The four columns as a row carries them, any of them null. */
export interface FoldBreakdownColumns {
  fold_p: number | null;
  base_mu_after: number | null;
  award: string | null;
  rated_games_before: number | null;
}

/**
 * The stored breakdown, or `null` for a row stored before `0034` (or one that does not parse:
 * logged by the caller, explained as legacy).
 */
export function storedFoldBreakdown(row: FoldBreakdownColumns): FoldBreakdown | null {
  if (row.fold_p === null && row.base_mu_after === null && row.award === null) return null;
  const parsed = foldBreakdownSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}
