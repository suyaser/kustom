import { rawNeedsDraftBanEnrichment } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';

/**
 * The two reads and the one write behind `POST /api/companion/backfill/scan` (M5.1).
 *
 * The contract the companion and this route share is the doc comment on
 * `companionBackfillScanRequestSchema` in `packages/db/src/schemas/companionResponses.ts` and
 * is not restated here. What is here is the half that touches the database: is this player
 * approved, and which of these `lcu_game_id`s do we not already have.
 *
 * Approval is per **player per group**, not per token: re-minting a token must not re-approve
 * anybody (`04-decisions.md`, 2026-09-09), and approving somebody's history is a group admin's
 * call about **their** group (M13.2, M13.3). It is read from the token's membership row,
 * `group_memberships.backfill_approved_at`, and never from `players`.
 */

export interface BackfillApproval {
  approved: boolean;
  approvedAt: string | null;
  requestedAt: string | null;
}

export async function selectBackfillApproval(
  client: ServiceClient,
  playerId: string,
  groupId: string,
): Promise<BackfillApproval> {
  const { data, error } = await client
    .from('group_memberships')
    .select('backfill_approved_at, backfill_requested_at')
    .eq('group_id', groupId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw new Error(`backfill: approval select failed: ${error.message}`);
  // The auth step already refused a token with no membership (403), so this is a membership
  // deleted between the two reads: not approved, and nothing to mark.
  if (data === null) return { approved: false, approvedAt: null, requestedAt: null };

  return {
    approved: data.backfill_approved_at !== null,
    approvedAt: data.backfill_approved_at,
    requestedAt: data.backfill_requested_at,
  };
}

/**
 * Record that this player's companion asked, **once**.
 *
 * The `is null` predicate is the whole of "a second scan does not move it": the update matches
 * nothing on every later pass, and the admin page keeps saying when the friend's PC first came
 * looking rather than "a minute ago" forever. Returns true when this call was the one that set
 * it, which is only used for a log line.
 */
export async function markBackfillRequested(
  client: ServiceClient,
  playerId: string,
  groupId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await client
    .from('group_memberships')
    .update({ backfill_requested_at: now.toISOString() })
    .eq('group_id', groupId)
    .eq('player_id', playerId)
    .is('backfill_requested_at', null)
    .select('player_id');
  if (error) throw new Error(`backfill: request update failed: ${error.message}`);
  return (data ?? []).length > 0;
}

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
