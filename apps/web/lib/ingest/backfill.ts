import { rawNeedsDraftBanEnrichment } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';

/**
 * The one read behind `POST /api/companion/backfill/scan` (M5.1).
 *
 * The contract the companion and this route share is the doc comment on
 * `companionBackfillScanRequestSchema` in `packages/db/src/schemas/companionResponses.ts` and
 * is not restated here. What is here is the half that touches the database: which of these
 * `lcu_game_id`s do we not already have.
 *
 * There is no approval read any more: backfill is on for every member of every group
 * (`04-decisions.md`, 2026-10-03, reversing M5.1's approval gate). The
 * `group_memberships.backfill_requested_at` / `backfill_approved_at` columns are left in the
 * schema, unread and unwritten, for a later cleanup migration to drop.
 */

/**
 * The ids in `gameIds` that still need a match-history detail, in the order they
 * were asked about.
 *
 * A live end-of-game row is the better scoreboard, but it has no `teams[].bans`.
 * Those Rift games stay "unknown" until a later detail post copies the list on.
 * A row that already has a `bans` array — even empty, a blind custom — is done,
 * and so is ARAM (no draft). The caller has already capped the batch at 100.
 */
export async function selectUnknownGameIds(
  client: ServiceClient,
  gameIds: readonly number[],
): Promise<number[]> {
  const { data, error } = await client
    .from('games')
    .select('lcu_game_id, raw')
    .in('lcu_game_id', [...gameIds]);
  if (error) throw new Error(`backfill: games select failed: ${error.message}`);

  const done = new Set<number>();
  for (const row of data ?? []) {
    if (row.lcu_game_id !== null && !rawNeedsDraftBanEnrichment(row.raw)) {
      done.add(row.lcu_game_id);
    }
  }
  const unknown: number[] = [];
  const seen = new Set<number>();
  for (const gameId of gameIds) {
    if (done.has(gameId) || seen.has(gameId)) continue;
    seen.add(gameId);
    unknown.push(gameId);
  }
  return unknown;
}
