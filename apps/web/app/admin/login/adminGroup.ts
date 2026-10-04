import type { Route } from 'next';
import { currentPageSession, type PageSession } from '@/lib/groups/pageSession';
import { groupBase } from '@/lib/nav';
import { getServiceClient, type ServiceClient } from '@/lib/supabase';

/**
 * Where `/admin/login` sends a signed-in viewer (M14.23 follow-up; M14.51): the admin page of the
 * oldest group they run (`owner` or `admin`), never the bare `/admin`, which 308s to the original
 * group's admin and would show an admin of any other group a not-admin page.
 *
 * - `{ kind: 'runs-group', href }`: they run a group.
 * - `{ kind: 'creator-unlinked', href }` (M14.51): no League account linked yet, but this session
 *   created a group (`groups.created_by`, M13.5). The page sends them straight to its admin home,
 *   the same landing `/new` gives them: before they link they have no You card and no top-bar
 *   `Admin`, so this page is their way back. Their oldest group when they made several.
 * - `{ kind: 'denied' }`: signed in, but they run no group here and created none.
 * - `{ kind: 'anonymous' }`: no session, or one with no Discord identity (it can do nothing here).
 *
 * Service-role reads, decided here on the server. Nothing here grants anything: the admin home and
 * every route behind it decide again (`decideAdminAccess`, the setup gate). A failed read is
 * `denied`, which is never wrong: `/` sends a member to their own group.
 */
export type LoginViewer =
  | { kind: 'anonymous' }
  | { kind: 'denied' }
  | { kind: 'runs-group'; href: Route }
  | { kind: 'creator-unlinked'; href: Route };

const adminOf = (slug: string): Route => `${groupBase({ slug })}/admin` as Route;

export async function decideLoginViewer(client: ServiceClient, session: PageSession): Promise<LoginViewer> {
  if (session.kind !== 'signed-in') return { kind: 'anonymous' };
  try {
    if (session.player !== null) {
      const { data, error } = await client
        .from('group_memberships')
        .select('created_at, role, groups!inner(slug)')
        .eq('player_id', session.player.playerId)
        .in('role', ['owner', 'admin'])
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      const slug = data?.[0]?.groups.slug;
      return slug === undefined ? { kind: 'denied' } : { kind: 'runs-group', href: adminOf(slug) };
    }
    const { data, error } = await client
      .from('groups')
      .select('slug')
      .eq('created_by', session.userId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    const slug = data?.[0]?.slug;
    return slug === undefined ? { kind: 'denied' } : { kind: 'creator-unlinked', href: adminOf(slug) };
  } catch (error) {
    console.error('admin login: reading the viewer groups failed', error);
    return { kind: 'denied' };
  }
}

/** {@link decideLoginViewer} for this request. A session that cannot be read is signed out, as before. */
export async function loginViewer(): Promise<LoginViewer> {
  let session: PageSession;
  try {
    session = await currentPageSession();
  } catch (error) {
    console.error('admin login: reading the session failed', error);
    return { kind: 'anonymous' };
  }
  return decideLoginViewer(getServiceClient(), session);
}
