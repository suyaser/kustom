import { z } from 'zod';
import { foldAwardSchema } from './foldBreakdown';

/**
 * The Kustom rating as a `game_players` row stores it (M18.4, `0036_kustom_rating.sql`), and the
 * odds model a split was rolled with. Written by the Kustom fold (M18.5); read by the board, the
 * player page and the breakdown (M18.6).
 *
 * Readers parse a row's columns through {@link storedKustomAllTime} / {@link storedKustomWeek}: a
 * track that is null (not folded under Kustom), partial or out of range reads as `null`, so a bad
 * row is dropped rather than crashing a page. The ranges are the column checks of 0036.
 */

/** `splits.odds_model`: which function made `blue_win_prob`. */
export const ODDS_MODELS = ['openskill', 'kustom'] as const;

export const oddsModelSchema = z.enum(ODDS_MODELS);

export type OddsModel = z.infer<typeof oddsModelSchema>;

/** `game_players.share_rank`: the place inside the team by performance score, 1 best. */
export const shareRankSchema = z.number().int().min(1).max(5);

const rating = z.number().finite();
const k = z.number().finite().positive();
const odds = z.number().min(0).max(1);
const count = z.number().int().min(0);

/** A whole all-time track: the 0036 columns plus the 0034 ones it reuses. */
export const kustomAllTimeSchema = z.object({
  r_before: rating,
  r_after: rating,
  k,
  fold_p: odds,
  rated_games_before: count,
  award: foldAwardSchema,
  share_rank: shareRankSchema.nullable(),
});

export type KustomAllTime = z.infer<typeof kustomAllTimeSchema>;

/** A whole weekly track (the share rank and award are the all-time row's, stored once). */
export const kustomWeekSchema = z.object({
  week_r_before: rating,
  week_r_after: rating,
  week_k: k,
  week_fold_p: odds,
  week_games_before: count,
});

export type KustomWeek = z.infer<typeof kustomWeekSchema>;

/** The all-time columns as a row carries them, any of them null. */
export interface KustomAllTimeColumns {
  r_before: number | null;
  r_after: number | null;
  k: number | null;
  fold_p: number | null;
  rated_games_before: number | null;
  award: string | null;
  share_rank: number | null;
}

/** The weekly columns as a row carries them, any of them null. */
export interface KustomWeekColumns {
  week_r_before: number | null;
  week_r_after: number | null;
  week_k: number | null;
  week_fold_p: number | null;
  week_games_before: number | null;
}

/** The row's all-time Kustom track, or `null` when it was not folded under Kustom (or is malformed). */
export function storedKustomAllTime(row: KustomAllTimeColumns): KustomAllTime | null {
  if (row.r_after === null) return null;
  const parsed = kustomAllTimeSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** The row's weekly Kustom track, or `null` when it was not folded on the week (or is malformed). */
export function storedKustomWeek(row: KustomWeekColumns): KustomWeek | null {
  if (row.week_r_after === null) return null;
  const parsed = kustomWeekSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}
