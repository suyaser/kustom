import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';
import { loadLandingMemberships } from '../groups/landing';
import { GROUP_COOKIE_NAME, ORIGINAL_GROUP_SLUG, type PageGroup } from '../groups/pageGroup';
import { resolveGroupParam } from '../groups/resolve';
import { createPublicClient } from '../publicClient';
import { getServiceClient } from '../supabase';
import { currentSessionPlayer } from '../viewer';
import { decideLanding, type LandingDecision, type LandingPageKind } from './decide';
import { type LandingData, loadLanding, supabaseLandingSource } from './load';

/**
 * The real wiring for Kustom's own pages (M14.24): the session, the `kustom_group` cookie and the
 * reads, handed to the pure {@link decideLanding} and {@link loadLanding}.
 */

export async function landingDecision(page: LandingPageKind): Promise<LandingDecision> {
  const [session, store] = await Promise.all([currentSessionPlayer(), cookies()]);
  return decideLanding(page, {
    session,
    cookieSlug: store.get(GROUP_COOKIE_NAME)?.value,
    // Service role: `group_memberships` is not public, and only slugs leave `loadLandingMemberships`.
    memberships: (playerId) => loadLandingMemberships(getServiceClient(), playerId),
    groupBySlug: landingGroupBySlug,
  });
}

/**
 * A remembered slug to its group, read with the anon key from `groups_public` (a slug that is no
 * group, or a malformed one, is `null`). Shared by `/`'s decision and `GET /api/groups/remembered`.
 */
export async function landingGroupBySlug(slug: string): Promise<PageGroup | null> {
  const found = await resolveGroupParam(createPublicClient(), slug);
  return found.kind === 'group' ? found.group : null;
}

const NOTHING: LandingData = {
  demo: null,
  demoGames: null,
  hero: { kind: 'example' },
  calibration: null,
  counters: null,
};

/**
 * The landing data, the same for every visitor (anon reads only), so it is cached for five
 * minutes across requests: the page reads a few hundred rows to find the demo group's latest
 * rolled game and its calibration, and nobody needs that fresher than a game takes to play.
 */
const cachedLanding = unstable_cache(
  () => loadLanding(supabaseLandingSource(createPublicClient()), ORIGINAL_GROUP_SLUG),
  ['landing-data-v1'],
  { revalidate: 300 },
);

export async function landingData(): Promise<LandingData> {
  try {
    return await cachedLanding();
  } catch (error) {
    // Only a missing environment gets here (every read inside fails soft on its own).
    console.error('landing: no data', error);
    return NOTHING;
  }
}
