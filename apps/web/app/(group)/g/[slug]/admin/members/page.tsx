import type { Metadata } from 'next';
import { adminNav } from '@/lib/admin/adminNav';
import { loadGroupMembers } from '@/lib/admin/groupMembers';
import { MEMBERS_TITLE } from '@/lib/admin/homeCopy';
import type { MemberViewer } from '@/lib/admin/memberActions';
import { readAiGate } from '@/lib/premium';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';
import { AdminFrame } from '../_components/AdminFrame';
import { MembersTable } from '../_components/MembersTable';
import { sectionAccess } from '../_components/sectionAccess';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${MEMBERS_TITLE} · Kustom`,
  robots: { index: false, follow: false },
};

/**
 * `/g/<slug>/admin/members` (M14.22; STRATEGY 3.5): everyone in the group with their role in words,
 * when they last played and how many games, and the actions the viewer may take on each, behind
 * confirms. The operator reads it with no actions. In a Premium group an admin also gets
 * `Don't write about <Name>` (M16.3b); the flag is read here, on the server, and a group without
 * Premium gets no AI control or word.
 */
export default async function GroupMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const gate = await sectionAccess((await params).slug, 'members');
  if ('refusal' in gate) return gate.refusal;
  const { group, reader } = gate;

  const viewer: MemberViewer =
    reader.kind === 'runs-group' ? { role: reader.role, playerId: reader.playerId } : { role: 'read-only' };
  const client = getServiceClient();
  const [rows, aiGate] = await Promise.all([
    loadGroupMembers(client, group.id),
    reader.kind === 'runs-group' ? readAiGate(client, group.id) : null,
  ]);

  return (
    <AdminFrame
      group={group}
      title={MEMBERS_TITLE}
      nav={adminNav(group, 'members')}
      readOnly={reader.kind === 'operator'}
      wide
    >
      <MembersTable
        groupId={group.id}
        rows={rows}
        viewer={viewer}
        aiLines={aiGate?.premium === true}
        timeZone={nightTimeZone()}
      />
    </AdminFrame>
  );
}
