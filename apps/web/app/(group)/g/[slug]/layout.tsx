import type { Metadata } from 'next';
import { type ReactNode, Suspense } from 'react';
import { JoinedNotice } from '@/app/join/_components/JoinedNotice';
import { Shell } from '@/components/shell/Shell';
import { isUnlinkedCreator } from '@/lib/admin/groupAdminPage';
import { joinPitch } from '@/lib/groups/pageCopy';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { currentViewerState } from '@/lib/viewer';
import { PageGroupProvider } from '../../../_shell/PageGroup';

/**
 * One group's pages: `/g/<slug>` and everything under it, in the Kustom 2.0 shell (M14.7; the group
 * resolution is M13.9's).
 *
 * The slug is resolved first (`requirePageGroup`): an unknown one is a 404 (`../not-found.tsx`, the
 * unknown-group page), and a uuid that names a game is a 308 to that game's page, before any markup is
 * sent. The group is then the shell's (its name, every link, `Admin` for its admins) and every client
 * component's below (`PageGroupProvider`).
 *
 * Public by link: nothing here needs a session. A session only adds `Admin` for an admin and turns
 * the desktop `Sign in` into the account link.
 */
/**
 * Every group page's description names the group (M14.42, scene-walk gap 9): the join page's own
 * pitch, `<Group> uses Kustom to pick fair teams for your customs.`, instead of the root's generic
 * line. Pages set their own titles (`groupPageTitle`).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  return { description: joinPitch(group.name) };
}

export default async function GroupLayout({
  children,
  panel,
  params,
}: {
  children: ReactNode;
  /** M14.30: the `@panel` slot, where `(.)mode` overlays the mode panel on a soft navigation. */
  panel: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = await requirePageGroup(slug);
  const viewer = await currentViewerState(group.id);
  // M14.51: the group's creator before they link gets `Admin` too (only they pay for the read).
  const isAdmin =
    (viewer.kind === 'linked' && viewer.isAdmin) ||
    (viewer.kind === 'unlinked' && (await isUnlinkedCreator(group)));

  return (
    <PageGroupProvider group={group}>
      <Shell
        group={group}
        isAdmin={isAdmin}
        account={viewer.kind === 'anonymous' ? 'anonymous' : 'signed-in'}
      >
        {/* `You're in.` after a join (M14.21); renders nothing without `?joined=1`. */}
        <Suspense fallback={null}>
          <JoinedNotice />
        </Suspense>
        {children}
        {panel}
      </Shell>
    </PageGroupProvider>
  );
}
