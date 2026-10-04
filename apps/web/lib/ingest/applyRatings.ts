import { type GamePlayerRatingsRow, gamePlayerRatingsRowsSchema } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * The one writer of a fold's `game_players` rating columns (0043, `apply_game_player_ratings`):
 * the live fold's claim (`rating.ts`, `onlyUnrated: true`), `rebuild-ratings` and the daily cron
 * rebuild (`rebuild.ts`, `onlyUnrated: false`).
 *
 * One call, one statement, one transaction: a whole rebuild lands or none of it does, a check
 * refusing one row refuses the call, and rows whose stored values already match are skipped in
 * the database, so they fire no Realtime event. Every row carries every rating column
 * ({@link GamePlayerRatingsRow}); the rows are parsed before the call, so a NaN or an
 * out-of-range number is a thrown bug here and never reaches the table.
 *
 * Returns the rows the database actually wrote. For the claim that is the number of rows this
 * request won (0: somebody else already rated the game).
 */
export async function applyGamePlayerRatings(
  client: ServiceClient,
  groupId: string,
  rows: readonly GamePlayerRatingsRow[],
  options: { onlyUnrated: boolean },
): Promise<number> {
  if (rows.length === 0) return 0;
  const parsed = gamePlayerRatingsRowsSchema.safeParse(rows);
  if (!parsed.success) {
    throw new Error(`apply_game_player_ratings: a malformed row: ${parsed.error.message}`);
  }
  const { data, error } = await client.rpc('apply_game_player_ratings', {
    p_group: groupId,
    p_rows: parsed.data,
    p_only_unrated: options.onlyUnrated,
  });
  if (error) throw new Error(`apply_game_player_ratings failed: ${error.message}`);
  if (typeof data !== 'number') throw new Error('apply_game_player_ratings: no row count returned');
  return data;
}
