import type { Route } from 'next';
import { type LandingMembership, type LandingViewer, landingPath } from '../groups/landing';
import type { PageGroup } from '../groups/pageGroup';
import type { SessionPlayer } from '../viewer';

/**
 * What `/` and `/about` do for one request (M14.24 acceptance 1; STRATEGY §2.2), with the reads
 * injected so all four `/` cases are unit tests:
 *
 * | Visitor | `/` | `/about` |
 * |---|---|---|
 * | signed in, member of a group | 307 to their group (`landingPath`) | the landing page, `Back to <Group>` from the cookie |
 * | signed in, in no group | the landing page (`Create your group` leads, `Free.` line for the signed in) | the same |
 * | signed out, with the cookie | the landing page + `Back to <Group>` | the same |
 * | signed out, no cookie | the landing page | the same |
 *
 * The cookie is a hint, never trusted: the bar is drawn only for a group `groups_public` knows.
 * A failed membership read keeps a signed-in visitor on the landing page (it still works), and a
 * failed group read just leaves the bar out.
 *
 * `/about` is static since about-static and no longer calls this: its client islands draw the same
 * table's `/about` column from `GET /api/groups/remembered` ({@link rememberedGroup}) and the
 * session probe. The `about` kind stays as the rule those islands follow.
 */
export type LandingPageKind = 'root' | 'about';

export type LandingAudience = 'signed-out' | 'signed-in';

export type LandingDecision =
  | { kind: 'redirect'; to: Route }
  | { kind: 'landing'; audience: LandingAudience; back: PageGroup | null };

export interface LandingDeps {
  session: SessionPlayer;
  cookieSlug: string | null | undefined;
  memberships(playerId: string): Promise<LandingMembership[]>;
  groupBySlug(slug: string): Promise<PageGroup | null>;
}

export async function decideLanding(page: LandingPageKind, deps: LandingDeps): Promise<LandingDecision> {
  const { session, cookieSlug } = deps;
  const audience: LandingAudience = session.kind === 'anonymous' ? 'signed-out' : 'signed-in';

  if (page === 'root' && session.kind !== 'anonymous') {
    const viewer = await signedInViewer(session, deps);
    const to = landingPath(viewer, cookieSlug);
    if (to !== null) return { kind: 'redirect', to };
  }

  // `/`: the bar is for signed-out visitors (a signed-in member was redirected above). `/about`:
  // for anybody whose browser remembers a group, since a member reached it from that group.
  const wantsBar = audience === 'signed-out' || page === 'about';
  const back = wantsBar ? await rememberedGroup(cookieSlug, deps.groupBySlug) : null;
  return { kind: 'landing', audience, back };
}

async function signedInViewer(
  session: Exclude<SessionPlayer, { kind: 'anonymous' }>,
  deps: LandingDeps,
): Promise<LandingViewer> {
  // A Discord session with no player row can be a member of nothing (memberships point at
  // `players.id`), so it is the no-group case without a query.
  if (session.kind === 'unlinked') return { kind: 'signed-in', memberships: [] };
  try {
    return { kind: 'signed-in', memberships: await deps.memberships(session.playerId) };
  } catch (error) {
    console.error('landing: reading the memberships failed', error);
    return { kind: 'signed-in', memberships: [] };
  }
}

/**
 * The group a `kustom_group` cookie names, when `groups_public` knows it: no cookie is no read,
 * and a failed read is no bar. Also `GET /api/groups/remembered`'s whole answer, so the static
 * `/about`'s client island and the dynamic `/` draw the bar on exactly the same rule.
 */
export async function rememberedGroup(
  cookieSlug: string | null | undefined,
  groupBySlug: LandingDeps['groupBySlug'],
): Promise<PageGroup | null> {
  if (!cookieSlug) return null;
  try {
    return await groupBySlug(cookieSlug);
  } catch (error) {
    console.error('landing: the remembered group could not be read', error);
    return null;
  }
}
