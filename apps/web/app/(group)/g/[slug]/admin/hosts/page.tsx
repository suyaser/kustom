import type { Metadata, Route } from 'next';
import { adminHref, adminNav } from '@/lib/admin/adminNav';
import { HOSTS_TITLE } from '@/lib/admin/homeCopy';
import { hostAccount } from '@/lib/admin/hostName';
import { playerLabel } from '@/lib/admin/playerName';
import { listAdminTokens } from '@/lib/admin/tokens';
import { getServiceClient } from '@/lib/supabase';
import { AdminFrame } from '../_components/AdminFrame';
import { sectionAccess } from '../_components/sectionAccess';
import { HostsView } from './HostsView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${HOSTS_TITLE} · Kustom`,
  robots: { index: false, follow: false },
};

/**
 * `/g/<slug>/admin/hosts` (M14.23; replaces `/admin/tokens`): this group's hosts. Reads only; the stop is
 * `POST /api/admin/tokens`, which checks the session again (its `mint` is a 410 since M17.12: hosts link
 * with a code from the admin home). The operator reads the list with no control.
 */
export default async function GroupHostsPage({ params }: { params: Promise<{ slug: string }> }) {
  const gate = await sectionAccess((await params).slug, 'hosts');
  if ('refusal' in gate) return gate.refusal;
  const { group, reader } = gate;
  const readOnly = reader.kind === 'operator';

  const client = getServiceClient();
  const tokens = await listAdminTokens(client, group.id);

  return (
    <AdminFrame group={group} title={HOSTS_TITLE} nav={adminNav(group, 'hosts')} readOnly={readOnly} wide>
      <HostsView
        groupId={group.id}
        hostCardHref={`${adminHref(group, 'home')}#host` as Route}
        hosts={tokens.map((token) => ({
          id: token.id,
          person: playerLabel(token),
          account: hostAccount(token),
          label: token.label,
          createdAt: token.createdAt,
          lastSeenAt: token.lastSeenAt,
          stopped: token.revokedAt !== null,
        }))}
        readOnly={readOnly}
        now={new Date()}
      />
    </AdminFrame>
  );
}
