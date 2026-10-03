import type { ReactNode } from 'react';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { currentViewerState } from '@/lib/viewer';
import { PageGroupProvider } from '../../../_shell/PageGroup';
import { Shell } from '../../../_shell/Shell';
import '../../../shell.css';

/**
 * One group's pages (M13.9): `/g/<slug>` and everything under it, inside the Floodlit shell with
 * the group's name under the wordmark (05-design.md, "The group in the shell").
 *
 * The slug is resolved here first (`requirePageGroup`): an unknown one is a 404, and a uuid that
 * names a game -- M11.4's `/g/<gameId>` links in Discord -- is a 308 to that game's group's page,
 * before any markup is sent. The resolved group is then the shell's (its name, every link, the
 * `Admin` tab for its admins) and every client component's below (`PageGroupProvider`: the
 * controls' `groupId`, the tape's and rail's links).
 *
 * Public by link exactly as before: nothing here needs a session, and a session only adds the
 * footer's `Your games` and an admin's tab. There is no list of groups anywhere.
 */
export default async function GroupLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = await requirePageGroup(slug);
  const viewer = await currentViewerState(group.id);

  return (
    <PageGroupProvider group={group}>
      <Shell
        group={group}
        viewerPuuid={viewer.kind === 'linked' ? viewer.puuid : null}
        isAdmin={viewer.kind === 'linked' && viewer.isAdmin}
      >
        {children}
      </Shell>
    </PageGroupProvider>
  );
}
