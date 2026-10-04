import type { Metadata, Route } from 'next';
import { adminNav } from '@/lib/admin/adminNav';
import { deriveChecklist } from '@/lib/admin/checklist';
import { loadChecklistFacts } from '@/lib/admin/checklistFacts';
import { type AdminAccess, currentAdminAccess } from '@/lib/admin/groupAdminPage';
import { ADMIN_TITLE } from '@/lib/admin/homeCopy';
import { readHasRatedGame } from '@/lib/admin/ratedGame';
import { INVITE_HIDDEN, inviteUrl } from '@/lib/admin/readView';
import { loadPremiumSection } from '@/lib/ai/switches';
import { readGroupInvite } from '@/lib/groups/invites';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { bareHost, pageOrigin } from '@/lib/groups/pageOrigin';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { readRatingsSince } from '@/lib/ingest/ratingsEpoch';
import { formatDayMonth } from '@/lib/night';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';
import { AdminHome, type AdminHomeAccess } from './_components/AdminHome';
import type { InviteView } from './_components/InviteCard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${ADMIN_TITLE} · Kustom`,
  robots: { index: false, follow: false },
};

/**
 * `/g/<slug>/admin`, the group's admin home (M14.21: where `/new` lands its creator, as owner; M14.22:
 * invite, tonight, members, host). Who may see what is the server's (`currentAdminAccess`), and every
 * control posts to a route that checks again. Reads only.
 */
export default async function GroupAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const group = await requirePageGroup((await params).slug);
  const access = await currentAdminAccess(group);

  if (access.kind === 'signed-out' || access.kind === 'not-admin') {
    return <AdminHome kind={access.kind} group={group} />;
  }

  const client = getServiceClient();
  const [facts, origin, ratingsSince, premium, hasRatedGame] = await Promise.all([
    loadChecklistFacts(client, group.id),
    pageOrigin(),
    readRatingsSince(client, group.id),
    // M16.3b: the owner and admins only; null for a group without Premium (D1).
    access.kind === 'runs-group' ? loadPremiumSection(client, group.id, new Date()) : null,
    // M14.75: no `Reset ratings` before the group's first rated game.
    readHasRatedGame(client, group.id),
  ]);
  const checklist = deriveChecklist(facts, {
    now: new Date(),
    groupLink: `${bareHost(origin)}/g/${group.slug}`,
  });

  return (
    <AdminHome
      kind="home"
      group={group}
      access={homeAccess(access)}
      checklist={checklist}
      discordHref={discordHref(group)}
      invite={await inviteView(access, group.id, origin)}
      origin={origin}
      members={facts.members}
      nav={adminNav(group, 'home')}
      premium={premium}
      ratingsReset={{
        lastResetDay: ratingsSince === null ? null : formatDayMonth(new Date(ratingsSince), nightTimeZone()),
        hasRatedGame,
      }}
    />
  );
}

function homeAccess(access: Exclude<AdminAccess, { kind: 'signed-out' | 'not-admin' }>): AdminHomeAccess {
  return access.kind === 'runs-group' ? access.role : access.kind;
}

/**
 * The invite as this reader may see it. The operator never gets the link (STRATEGY 3.3; the stored
 * code is not even read for them). The creator before pairing does: they started the group and are
 * about to invite it, and only an admin route can rotate it.
 */
async function inviteView(
  access: Exclude<AdminAccess, { kind: 'signed-out' | 'not-admin' }>,
  groupId: string,
  origin: string,
): Promise<InviteView> {
  if (access.kind === 'operator') return { state: 'hidden', message: INVITE_HIDDEN };
  const invite = await readGroupInvite(getServiceClient(), groupId);
  return invite === null ? { state: 'none' } : { state: 'shown', url: inviteUrl(origin, invite.code) };
}

/** This group's Discord settings (M14.23 mounts the page; designer round 1 links it from the row). */
function discordHref(group: PageGroup): Route {
  return `/g/${encodeURIComponent(group.slug)}/admin/discord` as Route;
}
