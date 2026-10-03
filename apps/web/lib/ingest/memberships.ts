import type { ServiceClient } from '../supabase';

/**
 * Group membership, as ingest writes and reads it (M13.3).
 *
 * **Playing is joining** (`04-decisions.md`, 2026-10-03): every PUUID in a lobby roster or an
 * end-of-game block that lands in group G gets a `member` row in G if it has none. That is what
 * keeps zero input true across groups -- the friend who never opened an invite link becomes part
 * of the group by playing in it, exactly the way a `players` row is created today.
 *
 * `on conflict do nothing`, always: a membership that exists is never touched, so an `admin`
 * stays `admin` and the M5.1 backfill columns on the row are never reset by a game.
 */

/** Add a `member` row in `groupId` for every player id that has none. Idempotent. */
export async function ensureMemberships(
  client: ServiceClient,
  groupId: string,
  playerIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) return;

  const { error } = await client.from('group_memberships').upsert(
    unique.map((playerId) => ({ group_id: groupId, player_id: playerId, role: 'member' as const })),
    { onConflict: 'group_id,player_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`memberships: insert failed: ${error.message}`);
}

/**
 * How many of these PUUIDs are already members of `groupId`. Used by the backfill rule: a match
 * walked out of a host's history is stored in the token's group only when at least
 * {@link BACKFILL_MIN_MEMBERS} of its ten already belong there.
 *
 * A PUUID with no `players` row is, by construction, nobody's member.
 */
export async function countMembersByPuuid(
  client: ServiceClient,
  groupId: string,
  puuids: readonly string[],
): Promise<number> {
  const unique = [...new Set(puuids)];
  if (unique.length === 0) return 0;

  const { data, error } = await client
    .from('players')
    .select('id, group_memberships!inner(group_id)')
    .in('puuid', unique)
    .eq('group_memberships.group_id', groupId);
  if (error) throw new Error(`memberships: member count failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * "Most of the lobby was this group" (decision row 2026-10-03): six of ten. Fewer and a
 * backfilled game is skipped, counted, and offered again by the next daily scan, so a new
 * group's history arrives as its people join.
 */
export const BACKFILL_MIN_MEMBERS = 6;
