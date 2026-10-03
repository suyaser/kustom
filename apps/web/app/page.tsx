import { cookies } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { type LandingViewer, landingPath, loadLandingMemberships } from '@/lib/groups/landing';
import { GROUP_COOKIE_NAME } from '@/lib/groups/pageGroup';
import { getServiceClient } from '@/lib/supabase';
import { currentSessionPlayer } from '@/lib/viewer';

/**
 * `/` (M13.9): the tonight page's old address, kept permanently as a redirect, because it is in
 * months of pinned WhatsApp messages. Where it goes is `lib/groups/landing.ts`'s rule: signed out
 * to `/g/customs`; a signed-in member to the group the `kustom_group` cookie names (the shell's
 * proxy writes it on every group page), or their oldest group when it names none of theirs; a
 * signed-in person in no group to `/new`.
 *
 * A 308, as the brief asks. It depends on the session and the cookie, so it must never be cached
 * as one answer for everybody: the page is dynamic, and Next sends a dynamic response with
 * `Cache-Control: private, no-cache, no-store`, which keeps a browser from remembering it.
 *
 * Nothing is rendered and nothing is written. A failed membership read sends a signed-in
 * visitor to the original group rather than to an error page: the link still opens a night.
 */
export const dynamic = 'force-dynamic';

export default async function Landing(): Promise<never> {
  const [session, store] = await Promise.all([currentSessionPlayer(), cookies()]);
  permanentRedirect(landingPath(await landingViewer(session), store.get(GROUP_COOKIE_NAME)?.value));
}

async function landingViewer(
  session: Awaited<ReturnType<typeof currentSessionPlayer>>,
): Promise<LandingViewer> {
  if (session.kind === 'anonymous') return { kind: 'anonymous' };
  // A Discord session with no player row can be a member of nothing (memberships point at
  // `players.id`), so it is the no-group case without a query.
  if (session.kind === 'unlinked') return { kind: 'signed-in', memberships: [] };
  try {
    return {
      kind: 'signed-in',
      memberships: await loadLandingMemberships(getServiceClient(), session.playerId),
    };
  } catch (error) {
    console.error('landing: reading the memberships failed', error);
    return { kind: 'anonymous' };
  }
}
