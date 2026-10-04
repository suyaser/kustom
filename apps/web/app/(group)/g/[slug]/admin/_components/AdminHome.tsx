import type { Route } from 'next';
import Link from 'next/link';
import { StatusPage } from '@/components/shell/StatusPage';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Checklist as ChecklistData } from '@/lib/admin/checklist';
import {
  ADMIN_TITLE,
  adminSignInLine,
  CREATOR_UNLINKED_LINE,
  MEMBERS_TITLE,
  membersCount,
  NOT_ADMIN_TITLE,
  notAdminReason,
  ONLY_OWNER_RESETS,
  SEE_MEMBERS_LABEL,
} from '@/lib/admin/homeCopy';
import { welcomeHref } from '@/lib/board/hrefs';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { BACK_TO_TONIGHT_LABEL, SIGN_IN_WITH_DISCORD_LABEL } from '@/lib/shellCopy';
import { AdminFrame, type AdminNavItem } from './AdminFrame';
import { Checklist } from './Checklist';
import { HostSetupCard } from './HostSetupCard';
import { InviteCard, type InviteView } from './InviteCard';
import { PremiumSection, type PremiumSectionView } from './PremiumSection';
import { ResetRatingsCard } from './ResetRatingsCard';

type Preview = { kind: 'waiting'; code: string } | { kind: 'expired' } | undefined;

export type AdminHomeAccess = 'owner' | 'admin' | 'creator-unlinked' | 'operator';

export type AdminHomeProps =
  | {
      kind: 'signed-out';
      group: PageGroup /** Where sign-in comes back to; the admin home by default. */;
      here?: Route;
    }
  | { kind: 'not-admin'; group: PageGroup }
  | {
      kind: 'home';
      group: PageGroup;
      /**
       * `creator-unlinked` sees the checklist (Connect Discord live), the invite link with `New link`,
       * and the host card (`groupAdminPage.ts`; the setup gate, M14.40); `operator` reads everything
       * with no write control and the invite masked.
       */
      access: AdminHomeAccess;
      checklist: ChecklistData;
      discordHref: Route | null;
      invite: InviteView;
      /** This site's origin, for the invite card's rotated link. */
      origin: string;
      /** `group_memberships` rows. */
      members: number;
      nav: readonly AdminNavItem[];
      /** Dev kit only. */
      hostPreview?: Preview;
      /**
       * `Reset ratings` (M14.18): the last reset's day (`1 Nov`) or null. Live for the owner, disabled
       * for an admin; members and the operator never see it.
       */
      ratingsReset?: {
        lastResetDay: string | null;
        /** M14.75: false before the group's first rated game, which hides the card. Absent reads as true. */
        hasRatedGame?: boolean;
        initialOpen?: boolean;
        initialTyped?: string;
      };
      /**
       * M16.3b's `Kustom Premium` section, or null/absent for a group without Premium (which then
       * renders exactly as before, D1). Drawn for the owner and admins only.
       */
      premium?: PremiumSectionView | null;
    };

/**
 * `/g/<slug>/admin`, the admin home (M14.21, M14.22; STRATEGY 3.1 to 3.6, section 6(d)). Top to
 * bottom: `Get your group ready`, `Invite your group`, Members, `Kustom Premium` (M16.3b, Premium
 * groups only), `Set up your PC as host` (folded to `Set up another PC` once a host is seen, M14.55),
 * `Reset ratings`. M14.55 dropped the one-link Tonight card: Tonight is a tab away, and Roll and
 * Reroll live there beside the teams. **No mode or fearless control** (the user, 2026-10-03: they
 * live on Tonight's Mode card only).
 *
 * At the bottom: `Reset ratings` (M14.18, STRATEGY 3.6). Live for the owner (typed-slug confirm,
 * `Finish tonight's game first.` in place); disabled for an admin with `Only the owner can reset
 * ratings.`; members and the operator never see it.
 */
export function AdminHome(props: AdminHomeProps) {
  const { group } = props;
  const home = `/g/${encodeURIComponent(group.slug)}` as Route;
  const here = (props.kind === 'signed-out' ? props.here : undefined) ?? (`${home}/admin` as Route);

  if (props.kind === 'not-admin') {
    return (
      <StatusPage
        title={NOT_ADMIN_TITLE}
        reason={notAdminReason(group.name)}
        primary={{ label: BACK_TO_TONIGHT_LABEL, href: home }}
      />
    );
  }

  if (props.kind === 'signed-out') {
    return (
      <AdminFrame group={group} title={ADMIN_TITLE} nav={[]}>
        <p className="text-base">{adminSignInLine(group.name)}</p>
        <form action="/auth/signin" method="post" className="pt-1">
          <input type="hidden" name="next" value={here} />
          <Button type="submit" className="w-full md:w-auto">
            {SIGN_IN_WITH_DISCORD_LABEL}
          </Button>
        </form>
      </AdminFrame>
    );
  }

  const { access } = props;
  const runsGroup = access !== 'creator-unlinked' && access !== 'operator';
  // The setup writes (M14.40): Connect Discord and New link are the creator's before they pair too.
  const canSetUp = access !== 'operator';
  const hostDone = props.checklist.rows.some((row) => row.key === 'kustom' && row.state === 'done');

  return (
    <AdminFrame
      group={group}
      title={ADMIN_TITLE}
      nav={access === 'creator-unlinked' ? [] : props.nav}
      readOnly={access === 'operator'}
    >
      {access === 'creator-unlinked' ? <p className="text-base">{CREATOR_UNLINKED_LINE}</p> : null}
      <Checklist
        checklist={props.checklist}
        discordHref={canSetUp ? props.discordHref : null}
        hostHref={access === 'operator' ? null : '#host'}
        inviteHref="#invite"
      />
      <InviteCard groupId={group.id} origin={props.origin} invite={props.invite} canRotate={canSetUp} />
      {access === 'creator-unlinked' ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{MEMBERS_TITLE}</CardTitle>
            <CardDescription>{membersCount(props.members)}</CardDescription>
          </CardHeader>
          <div className="px-(--card-pad) pb-(--card-pad)">
            <Button asChild variant="secondary" className="w-full md:w-auto">
              <Link href={`${here}/members` as Route}>{SEE_MEMBERS_LABEL}</Link>
            </Button>
          </div>
        </Card>
      )}
      {runsGroup && props.premium != null ? <PremiumSection groupId={group.id} view={props.premium} /> : null}
      {access === 'operator' ? null : (
        <HostSetupCard
          groupId={group.id}
          preview={props.hostPreview}
          quiet={hostDone}
          // An unlinked creator's pairing links them too: land on the welcome card (M14.33).
          linkedHref={access === 'creator-unlinked' ? welcomeHref(group) : null}
        />
      )}
      {runsGroup && props.ratingsReset?.hasRatedGame !== false ? (
        <ResetRatingsCard
          groupId={group.id}
          slug={group.slug}
          lastResetDay={props.ratingsReset?.lastResetDay ?? null}
          disabledReason={access === 'owner' ? null : ONLY_OWNER_RESETS}
          initialOpen={props.ratingsReset?.initialOpen ?? false}
          initialTyped={props.ratingsReset?.initialTyped ?? ''}
        />
      ) : null}
    </AdminFrame>
  );
}
