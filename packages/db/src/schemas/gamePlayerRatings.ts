import { z } from 'zod';
import { foldAwardSchema } from './foldBreakdown';
import { shareRankSchema } from './kustomRating';

/**
 * One row of `apply_game_player_ratings(p_group, p_rows, p_only_unrated)` (0043): every rating
 * column a fold owns on one `game_players` row -- OpenSkill's four, 0034's breakdown and 0036's
 * nine Kustom columns -- with `null` where the column is to be null. The function refuses a row
 * missing any of these keys (0036's "a track is written whole" must not depend on a caller
 * remembering a key), so the schema has no optional rating column either.
 *
 * `counts_for_role_inference` (M5.17) is the one optional key: the live fold's claim carries it,
 * the rebuild leaves it alone. The ranges are the column checks; the cross-column rules (a track
 * together or not at all) are the table's checks and refuse the whole call.
 *
 * Server-only today (the live fold, `rebuild-ratings` and the daily cron), exported here so the
 * one writer and its tests share one definition.
 */

const rating = z.number().finite().nullable();
const positive = z.number().finite().positive().nullable();
const odds = z.number().min(0).max(1).nullable();
const count = z.number().int().min(0).nullable();

export const gamePlayerRatingsRowSchema = z
  .object({
    game_id: z.string().min(1),
    player_id: z.string().min(1),
    mu_before: rating,
    sigma_before: rating,
    mu_after: rating,
    sigma_after: rating,
    fold_p: odds,
    base_mu_after: rating,
    award: foldAwardSchema.nullable(),
    rated_games_before: count,
    r_before: rating,
    r_after: rating,
    k: positive,
    share_rank: shareRankSchema.nullable(),
    week_r_before: rating,
    week_r_after: rating,
    week_k: positive,
    week_fold_p: odds,
    week_games_before: count,
    counts_for_role_inference: z.boolean().optional(),
  })
  .strict();

export type GamePlayerRatingsRow = z.infer<typeof gamePlayerRatingsRowSchema>;

export const gamePlayerRatingsRowsSchema = z.array(gamePlayerRatingsRowSchema);
