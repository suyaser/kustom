import type { ServiceClient } from '../supabase';

/**
 * Which groups a PUUID is in, for the champ-select overlay (M13.3). No token: the overlay is a
 * public read, and so is this -- who is in a group is the leaderboard (`group_members_public`),
 * and a PUUID is already in every `/p/<puuid>` link, so learning its groups' names reveals
 * nothing a link does not. Read with the service role only because the order the brief asks
 * for, oldest membership first, is `group_memberships.created_at`, which the public view does
 * not carry; nothing but `{ id, slug, name }` ever leaves this file.
 */

export interface OverlayGroup {
  id: string;
  slug: string;
  name: string;
}

/** Every group this PUUID is a member of, oldest membership first. Empty for an unknown PUUID. */
export async function listPuuidGroups(client: ServiceClient, puuid: string): Promise<OverlayGroup[]> {
  const { data, error } = await client
    .from('group_memberships')
    .select('created_at, group_id, groups!inner(id, slug, name), players!inner(puuid)')
    .eq('players.puuid', puuid)
    .order('created_at', { ascending: true })
    .order('group_id', { ascending: true });
  if (error) throw new Error(`overlay: membership lookup failed: ${error.message}`);

  return (data ?? []).map((row) => ({ id: row.groups.id, slug: row.groups.slug, name: row.groups.name }));
}

/**
 * The group an overlay request is answered for, or `null` for the empty answer (M13.3):
 *
 * - `group` given: that group, **only** when the PUUID is a member of it;
 * - `group` missing: the PUUID's only group, or nothing when they have several -- the 0.2.x
 *   panel, which sends no group, then shows nothing rather than the wrong group.
 */
export function overlayGroupFor(groups: readonly OverlayGroup[], requested: string | null): string | null {
  if (requested !== null) return groups.some((group) => group.id === requested) ? requested : null;
  return groups.length === 1 ? (groups[0]?.id ?? null) : null;
}
