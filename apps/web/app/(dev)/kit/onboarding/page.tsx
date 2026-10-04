import type { Route } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { AdminFrame } from '@/app/(group)/g/[slug]/admin/_components/AdminFrame';
import { AdminHome } from '@/app/(group)/g/[slug]/admin/_components/AdminHome';
import { MembersTable } from '@/app/(group)/g/[slug]/admin/_components/MembersTable';
import { DiscordView } from '@/app/(group)/g/[slug]/admin/discord/DiscordView';
import { GamesView } from '@/app/(group)/g/[slug]/admin/games/GamesView';
import { HostsView } from '@/app/(group)/g/[slug]/admin/hosts/HostsView';
import { JoinView } from '@/app/join/_components/JoinView';
import { NewGroupView } from '@/app/new/_components/NewGroupView';
import { OpsView } from '@/app/ops/OpsView';
import { BareShell } from '@/components/shell/BareShell';
import { Shell } from '@/components/shell/Shell';
import { adminNav } from '@/lib/admin/adminNav';
import { type ChecklistFacts, deriveChecklist } from '@/lib/admin/checklist';
import { GAMES_COPY, listCapturedGames, listMissedLobbies } from '@/lib/admin/games';
import { loadGroupMembers } from '@/lib/admin/groupMembers';
import { DISCORD_TITLE, HOSTS_TITLE, MEMBERS_TITLE } from '@/lib/admin/homeCopy';
import type { MemberViewer } from '@/lib/admin/memberActions';
import { INVITE_HIDDEN } from '@/lib/admin/readView';
import { NAMELESS_PLAYER } from '@/lib/discord/embeds';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { bareHost, pageOrigin } from '@/lib/groups/pageOrigin';
import { listOpsGroups } from '@/lib/ops/groups';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

/**
 * Dev-only preview of the signed-in create, join and admin-home states (M14.21) with sample data: a
 * real signed-in view needs a Discord session, which the local stack cannot mint without writing auth
 * rows (lane rule: never fake a session in the real DB). `?screen=` one of `new`, `join-linked`,
 * `join-unlinked`, `join-expired`, `admin-fresh`, `admin-creator`, `admin-waiting`, `admin-seen`,
 * `admin-ready`, `admin-code`, `admin-operator`, `admin-reset`, `admin-reset-dialog`, `admin-reset-typed`, `admin-reset-as-admin`, `admin-premium`, `admin-premium-off`, `admin-premium-paused` (M16.3b), `members` (owner view), `members-admin`, `members-operator`, `members-premium`, `members-nameless`, `discord`, `discord-connected`,
 * `discord-cancelled`, `discord-test-failed`, `discord-operator`, `hosts`, `hosts-empty`, `hosts-operator`, `games` (the real customs report), `ops`. Like `/kit`, a 404 in production builds.
 */

const GROUP = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'friday-five',
  name: 'Ramzyinhović and the MANOOOOOOOO crew',
};
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const NOW = new Date();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const fresh: ChecklistFacts = {
  discord: { webhookSet: false, testPostAt: null, testPostError: null },
  members: 1,
  hosts: [],
  hasGame: false,
};

const FACTS: Record<string, ChecklistFacts> = {
  'admin-fresh': fresh,
  'admin-creator': { ...fresh, members: 0 },
  'admin-code': fresh,
  'admin-operator': { ...fresh, members: 7 },
  'admin-waiting': {
    ...fresh,
    discord: { webhookSet: true, testPostAt: minutesAgo(12), testPostError: null },
    members: 7,
    hosts: [{ label: 'Kustom (paired)', account: 'TheSHADOWREAPER', lastSeenAt: null }],
  },
  'admin-seen': {
    ...fresh,
    discord: { webhookSet: true, testPostAt: minutesAgo(12), testPostError: null },
    members: 7,
    hosts: [{ label: 'Kustom (paired)', account: 'TheSHADOWREAPER', lastSeenAt: minutesAgo(3) }],
  },
  'admin-ready': {
    discord: { webhookSet: true, testPostAt: minutesAgo(60 * 26), testPostError: null },
    members: 11,
    hosts: [{ label: 'Hana PC', account: 'Hana', lastSeenAt: minutesAgo(2) }],
    hasGame: true,
  },
};

/** M16.3b: the ready group, Premium, with AI lines on, off, or paused by the budget. */
const PREMIUM: Record<string, { linesEnabled: boolean; pausedUntilDay: string | null }> = {
  'admin-premium': { linesEnabled: true, pausedUntilDay: null },
  'admin-premium-off': { linesEnabled: false, pausedUntilDay: null },
  'admin-premium-paused': { linesEnabled: true, pausedUntilDay: '1 Nov' },
};

export default async function KitOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const screen = (await searchParams).screen ?? 'new';

  if (screen === 'new') {
    return (
      <BareShell>
        <NewGroupView signedIn />
      </BareShell>
    );
  }
  if (screen === 'join-linked') {
    return (
      <BareShell>
        <JoinView kind="linked" code={CODE} group={GROUP} />
      </BareShell>
    );
  }
  if (screen === 'join-unlinked' || screen === 'join-expired') {
    return (
      <BareShell>
        <JoinView
          kind="unlinked"
          code={CODE}
          group={GROUP}
          preview={screen === 'join-expired' ? { kind: 'expired' } : { kind: 'waiting', code: 'K7QX2M' }}
        />
      </BareShell>
    );
  }

  const origin = await pageOrigin();

  // Members: the real `customs` roster, read only, rendered as its owner / an admin / the operator
  // would see it (no session is faked; the viewer is a prop).
  if (screen.startsWith('members')) {
    const loaded = await loadGroupMembers(getServiceClient(), ORIGINAL_GROUP.id);
    // Design round 1: in the Premium state, two members already read `Not in AI lines` (in memory only).
    const rows =
      screen === 'members-premium'
        ? loaded.map((row, index) => (index === 4 || index === 6 ? { ...row, aiOptOut: true } : row))
        : screen === 'members-nameless'
          ? // Admin round 2: the owner and one member with no name yet (in memory only).
            loaded.map((row, index) =>
              index === 0 || index === 9 ? { ...row, name: NAMELESS_PLAYER, named: false } : row,
            )
          : loaded;
    const owner = rows.find((row) => row.role === 'owner');
    const admin = rows.find((row) => row.role !== 'owner' && row.role !== 'member');
    const viewer: MemberViewer =
      screen === 'members-operator'
        ? { role: 'read-only' }
        : screen === 'members-admin' && admin !== undefined
          ? { role: 'admin', playerId: admin.playerId }
          : { role: 'owner', playerId: owner?.playerId ?? '' };
    return (
      <PageGroupProvider group={ORIGINAL_GROUP}>
        <Shell group={ORIGINAL_GROUP} isAdmin account="signed-in">
          <AdminFrame
            group={ORIGINAL_GROUP}
            title={MEMBERS_TITLE}
            nav={adminNav(ORIGINAL_GROUP, 'members')}
            readOnly={viewer.role === 'read-only'}
            wide
          >
            <MembersTable
              groupId={ORIGINAL_GROUP.id}
              rows={rows}
              viewer={viewer}
              aiLines={screen === 'members-premium'}
              timeZone={nightTimeZone()}
            />
          </AdminFrame>
        </Shell>
      </PageGroupProvider>
    );
  }

  // Discord, Hosts (sample data) and Ops (the real group list, read only): M14.23.
  const frame = (page: 'discord' | 'hosts', title: string, readOnly: boolean, body: ReactNode) => (
    <PageGroupProvider group={GROUP}>
      <Shell group={GROUP} isAdmin={!readOnly} account="signed-in">
        <AdminFrame
          group={GROUP}
          title={title}
          nav={adminNav(GROUP, page)}
          readOnly={readOnly}
          wide={page === 'hosts'}
        >
          {body}
        </AdminFrame>
      </Shell>
    </PageGroupProvider>
  );
  if (screen.startsWith('discord')) {
    const status =
      screen === 'discord-connected'
        ? { connected: true, guildId: '1', testPostAt: minutesAgo(5), testPostError: null }
        : screen === 'discord-test-failed'
          ? { connected: true, guildId: '1', testPostAt: null, testPostError: 'Unknown Webhook' }
          : { connected: false, guildId: null, testPostAt: null, testPostError: null };
    const result =
      screen === 'discord-cancelled' ? 'failed' : screen === 'discord-connected' ? 'connected' : null;
    return frame(
      'discord',
      DISCORD_TITLE,
      screen === 'discord-operator',
      <DiscordView
        groupId={GROUP.id}
        status={
          screen === 'discord-operator' ? { ...status, connected: true, testPostAt: minutesAgo(90) } : status
        }
        result={result}
        readOnly={screen === 'discord-operator'}
        now={NOW}
      />,
    );
  }
  if (screen.startsWith('hosts')) {
    const readOnly = screen === 'hosts-operator';
    return frame(
      'hosts',
      HOSTS_TITLE,
      readOnly,
      <HostsView
        groupId={GROUP.id}
        hostCardHref={`/g/${GROUP.slug}/admin#host` as Route}
        hosts={
          screen === 'hosts-empty'
            ? []
            : [
                {
                  id: 'a',
                  person: 'TheSHADOWREAPER#EUW',
                  account: 'TheSHADOWREAPER',
                  label: 'Kustom (paired)',
                  createdAt: minutesAgo(3000),
                  lastSeenAt: minutesAgo(2),
                  stopped: false,
                },
                {
                  id: 'b',
                  person: 'Ramzyinhović',
                  account: 'Ramzyinhović',
                  label: 'Ramzy’s laptop upstairs',
                  createdAt: minutesAgo(20000),
                  lastSeenAt: null,
                  stopped: false,
                },
                {
                  id: 'c',
                  person: 'Used2BeATahmMain',
                  account: 'Used2BeATahmMain',
                  label: null,
                  createdAt: minutesAgo(90000),
                  lastSeenAt: minutesAgo(60000),
                  stopped: true,
                },
                {
                  id: 'd',
                  person: 'Hana',
                  account: 'Hana',
                  label: 'Kustom (paired)',
                  createdAt: minutesAgo(120000),
                  lastSeenAt: minutesAgo(100000),
                  stopped: true,
                },
              ]
        }
        readOnly={readOnly}
        now={NOW}
      />,
    );
  }
  if (screen === 'games') {
    const options = { timeZone: nightTimeZone(), groupId: ORIGINAL_GROUP.id };
    const [missed, captured] = await Promise.all([
      listMissedLobbies(getServiceClient(), options),
      listCapturedGames(getServiceClient(), options),
    ]);
    return (
      <PageGroupProvider group={ORIGINAL_GROUP}>
        <Shell group={ORIGINAL_GROUP} isAdmin account="signed-in">
          <AdminFrame
            group={ORIGINAL_GROUP}
            title={GAMES_COPY.heading}
            nav={adminNav(ORIGINAL_GROUP, 'games')}
            wide
          >
            <GamesView group={ORIGINAL_GROUP} missed={missed} captured={captured} />
          </AdminFrame>
        </Shell>
      </PageGroupProvider>
    );
  }
  if (screen === 'ops') {
    return (
      <BareShell>
        <OpsView groups={await listOpsGroups(getServiceClient())} />
      </BareShell>
    );
  }

  const premium = PREMIUM[screen] ?? null;
  const facts = FACTS[screen] ?? (premium === null ? fresh : FACTS['admin-ready']) ?? fresh;
  const checklist = deriveChecklist(facts, { now: NOW, groupLink: `${bareHost(origin)}/g/${GROUP.slug}` });
  const access =
    screen === 'admin-creator'
      ? 'creator-unlinked'
      : screen === 'admin-operator'
        ? 'operator'
        : screen === 'admin-reset-as-admin'
          ? 'admin'
          : 'owner';
  // M14.18: `admin-reset` (the card after a reset), `admin-reset-dialog` (open, nothing typed),
  // `admin-reset-typed` (open, the link typed: the action is live), `admin-reset-as-admin` (no card).
  const resetScreen = screen.startsWith('admin-reset');
  return (
    <PageGroupProvider group={GROUP}>
      <Shell
        group={GROUP}
        isAdmin={access !== 'operator' && access !== 'creator-unlinked'}
        account="signed-in"
      >
        <AdminHome
          kind="home"
          group={GROUP}
          access={access}
          checklist={checklist}
          discordHref={`/g/${GROUP.slug}/admin/discord` as Route}
          invite={
            access === 'operator'
              ? { state: 'hidden', message: INVITE_HIDDEN }
              : { state: 'shown', url: `${origin}/join/${CODE}` }
          }
          origin={origin}
          members={facts.members}
          nav={adminNav(GROUP, 'home')}
          hostPreview={screen === 'admin-code' ? { kind: 'waiting', code: 'K7QX2M' } : undefined}
          premium={premium}
          ratingsReset={{
            lastResetDay: resetScreen ? '1 Nov' : null,
            // M14.75: the card waits for a rated game (a reset screen has had one).
            hasRatedGame: resetScreen || facts.hasGame,
            initialOpen: screen === 'admin-reset-dialog' || screen === 'admin-reset-typed',
            initialTyped: screen === 'admin-reset-typed' ? GROUP.slug : '',
          }}
        />
      </Shell>
    </PageGroupProvider>
  );
}
