import type { Route } from 'next';
import { groupHome } from '../nav';
import type { ServiceClient } from '../supabase';

/**
 * Who `/` sends away, and where (M13.9, revised by M14.24; STRATEGY §2.2):
 *
 * 1. **Signed in, member of the group the `kustom_group` cookie names**: that group, the last one
 *    this browser opened.
 * 2. **Signed in, the cookie missing or naming a group they are not in** (the cookie is ignored,
 *    never trusted): their oldest membership. Not the original group: somebody who only plays
 *    in group B would otherwise be dropped on a stranger's night.
 * 3. **Everybody else stays on `/`, the landing page** (`null` here): signed out, cookie or not
 *    (the page draws a `Back to <Group>` bar from the cookie), and signed in with no group at all
 *    -- including a Discord session with no player row yet (the page leads with `Create your
 *    group`). This replaces M13.9's "signed out -> `/g/customs`" and "no group -> `/new`": a
 *    newcomer should see what they are creating first.
 *
 * `/about` is the same landing page and never redirects anybody.
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

/** M13.13's page, where a group is started: the landing page's `Create your group`. */
export const NEW_GROUP_PATH = '/new';

/** Where `/` redirects this viewer (307), or `null` to render the landing page. */
export function landingPath(viewer: LandingViewer, cookieSlug: string | null | undefined): Route | null {
  if (viewer.kind === 'anonymous') return null;

  const remembered =
    cookieSlug === null || cookieSlug === undefined
      ? undefined
      : viewer.memberships.find((membership) => membership.slug === cookieSlug);
  if (remembered !== undefined) return groupHome(remembered);

  const oldest = viewer.memberships[0];
  if (oldest !== undefined) return groupHome(oldest);

  return null;
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
