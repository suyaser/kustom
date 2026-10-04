import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { groupByInviteCode } from '@/lib/groups/invites';
import { loadJoinState } from '@/lib/groups/joinPage';
import { joinMetadata } from '@/lib/og/meta';
import { getServiceClient } from '@/lib/supabase';
import { JoinView } from '../_components/JoinView';

export const dynamic = 'force-dynamic';

interface JoinPageProps {
  params: Promise<{ code: string }>;
}

/**
 * The invite link's preview (M14.42, scene-walk gap 9): `Join <Group> on Kustom` for a live code,
 * the plain Kustom card for a dead one. Reads the code only (no session), so the unfurl bot gets the
 * same answer a signed-out friend would.
 */
export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const found = await groupByInviteCode(getServiceClient(), (await params).code);
  return joinMetadata(found);
}

/**
 * `/join/<code>`, the group's invite link (M13.13, M14.21; STRATEGY 3.4). Kustom-level, so the bare
 * shell. The state is the server's (`loadJoinState`); joining and pairing are posts to the M13.5
 * routes from the client, so this page writes nothing. Already a member: straight to the group.
 */
export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params;
  const state = await loadJoinState(code);
  if (state.kind === 'member') redirect(`/g/${encodeURIComponent(state.group.slug)}` as Route);

  if (state.kind === 'dead') return <JoinView kind="dead" />;
  return <JoinView kind={state.kind} code={code} group={state.group} />;
}
