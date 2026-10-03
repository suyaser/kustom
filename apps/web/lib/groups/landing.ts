import type { Route } from 'next';
import { groupHome } from '../nav';
import type { ServiceClient } from '../supabase';
import { ORIGINAL_GROUP_SLUG } from './pageGroup';

/**
 * Where `/` sends somebody (M13.9). `/` was the tonight page for months and is in every pinned
 * WhatsApp message, so it is kept permanently, as a redirect:
 *
 * 1. **Signed out** (or signed in with no Discord identity): `/g/customs`, the original group --
 *    the only group anybody could have had a `/` link for.
 * 2. **Signed in, member of the group the `kustom_group` cookie names**: that group, the last one
 *    this browser opened.
 * 3. **Signed in, the cookie missing or naming a group they are not in** (the cookie is ignored,
 *    never trusted): their oldest membership. Not the original group: somebody who only plays
 *    in group B would otherwise be dropped on a stranger's night.
 * 4. **Signed in and a member of no group at all** -- including a Discord session with no player
 *    row yet, which can have no membership: `/new`, where a group is started (the product owner,
 *    M13.9; the page itself is M13.13's).
 *
 * Pure, so every branch is a unit test; {@link loadLandingMemberships} is the one read.
 */

/** A membership as `/` needs it: which group, by slug. Oldest membership first. */
export interface LandingMembership {
  slug: string;
}

export type LandingViewer =
  | { kind: 'anonymous' }
  | { kind: 'signed-in'; memberships: readonly LandingMembership[] };

/** M13.13's page. Not in any group's nav; `/` is the only thing that sends people there. */
export const NEW_GROUP_PATH = '/new';

export function landingPath(viewer: LandingViewer, cookieSlug: string | null | undefined): Route {
  if (viewer.kind === 'anonymous') return groupHome({ slug: ORIGINAL_GROUP_SLUG });

  const remembered =
    cookieSlug === null || cookieSlug === undefined
      ? undefined
      : viewer.memberships.find((membership) => membership.slug === cookieSlug);
  if (remembered !== undefined) return groupHome(remembered);

  const oldest = viewer.memberships[0];
  if (oldest !== undefined) return groupHome(oldest);

  return NEW_GROUP_PATH as Route;
}

/**
 * The player's memberships, oldest first, by slug. Service role: `group_memberships` is not
 * public (`0018_groups.sql`), and only slugs -- which are in public URLs anyway -- leave here.
 */
export async function loadLandingMemberships(
  client: ServiceClient,
  playerId: string,
): Promise<LandingMembership[]> {
  const { data, error } = await client
    .from('group_memberships')
    .select('created_at, groups!inner(slug)')
    .eq('player_id', playerId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`landing: membership lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({ slug: row.groups.slug }));
}
