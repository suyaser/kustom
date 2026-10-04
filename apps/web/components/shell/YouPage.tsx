import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { DAILY_LABEL } from '@/lib/mystery/copy';
import {
  ACCOUNT_CARD_TITLE,
  ADMIN_CARD_ACTION,
  ADMIN_CARD_TITLE,
  adminCardLine,
  PITCH_FOOT,
  PITCH_TITLE,
  pitchSub,
  SEE_YOUR_PUBLIC_PAGE_LABEL,
  SIGN_IN_WITH_DISCORD_LABEL,
  SIGN_OUT_LABEL,
  signedInAs,
  THIS_DEVICE_CARD_TITLE,
  UNLINKED_TITLE,
  unlinkedLine,
  youInGroup,
} from '@/lib/shellCopy';
import { THEME_PICKER_LABEL } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { ThemeSwitch } from './ThemeSwitch';

interface Common {
  group: PageGroup;
  /** `/g/<slug>/you`, where sign-in and sign-out come back to. */
  here: Route;
  /** The daily game, until it is a Tonight card (M14.9). `null` where the group has none yet. */
  daily: Route | null;
  /** Design round 1 (N7): the Discord name for `Signed in as <name>`; absent or null drops the row. */
  discordName?: string | null;
}

export type YouPageProps =
  | (Common & { kind: 'anonymous' })
  | (Common & {
      kind: 'unlinked';
      /** M14.51: the group's creator before they link: the Admin card, so they can get back. */
      admin?: Route | null;
    })
  | (Common & {
      kind: 'linked';
      admin: Route | null;
      /** The owner's card says `You run <Group>.`; an admin's `You help run <Group>.` */
      owner?: boolean;
      /** `/g/<slug>/p/<you>`, the public view of the same page. */
      playerPage: Route | null;
      /**
       * Your player page in the self lens (M14.15: `PlayerView lens="self"`, the header with the h1,
       * the trend and the games), or `null` when it could not be read: the page then shows a
       * fallback h1 and the link alone.
       */
      self: ReactNode;
      /** You vs them with everyone (M14.35), under the self lens. */
      versus?: ReactNode;
      /**
       * M16.3b's `AI lines about you` card, only for a member of a Premium group with AI lines on
       * (decided on the server); absent renders exactly as before (D1).
       */
      aiLines?: ReactNode;
    });

/**
 * The You tab's body (M14.7b; redesign/nav/proposal.md section 4, `a-you*.png`). A 2.0 root. One h1:
 * the player's name when linked, the pitch's question when signed out, the unlinked line otherwise.
 *
 * Slots for later tasks, deliberately not drawn now (no placeholder cards):
 * - M14.35 `You vs them` for everyone: a card after the summary.
 * - M14.36 `Your night`: a one-line summary under the header until 06:00.
 * - M14.33 the claim landing (`?welcome=1`) and `That's me` for the unlinked state.
 */
export function YouPage(props: YouPageProps) {
  const { group } = props;
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
        {(props.kind === 'linked' || props.kind === 'unlinked') && props.admin != null ? (
          <Card>
            <Link href={props.admin} className={cn(ROW, 'border-t-0 py-4')}>
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{ADMIN_CARD_TITLE}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {adminCardLine(group.name, props.kind === 'unlinked' || props.owner === true)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-sm text-primary-text">
                {ADMIN_CARD_ACTION}
                <Chevron />
              </span>
            </Link>
          </Card>
        ) : null}

        {props.kind === 'linked' ? (props.self ?? <SelfFallback group={group} />) : null}
        {props.kind === 'linked' ? (props.versus ?? null) : null}
        {props.kind === 'unlinked' ? <Unlinked group={group} /> : null}
        {props.kind === 'anonymous' ? <Pitch group={group} here={props.here} /> : null}

        {props.kind === 'linked' && props.playerPage !== null ? (
          <Card>
            <Link href={props.playerPage} className={cn(ROW, 'border-t-0')}>
              {SEE_YOUR_PUBLIC_PAGE_LABEL}
              <Chevron />
            </Link>
          </Card>
        ) : null}

        {props.kind !== 'anonymous' && props.daily !== null ? (
          <Card>
            <Link href={props.daily} className={cn(ROW, 'border-t-0')}>
              {DAILY_LABEL}
              <Chevron />
            </Link>
          </Card>
        ) : null}

        {props.kind === 'linked' ? (props.aiLines ?? null) : null}

        <Card>
          <CardHeader>
            <CardTitle>{props.kind === 'anonymous' ? THIS_DEVICE_CARD_TITLE : ACCOUNT_CARD_TITLE}</CardTitle>
          </CardHeader>
          {props.kind === 'anonymous' || props.discordName == null ? null : (
            <div className="flex min-h-11 items-center border-t border-border px-(--card-pad) py-3 text-muted-foreground">
              {signedInAs(props.discordName)}
            </div>
          )}
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-border px-(--card-pad) py-3">
            <span className="font-bold">{THEME_PICKER_LABEL}</span>
            <ThemeSwitch />
          </div>
          {props.kind === 'anonymous' ? null : (
            <form action="/auth/signout" method="post">
              <input type="hidden" name="next" value={props.here} />
              <button type="submit" className={cn(ROW, 'w-full cursor-pointer text-start')}>
                {SIGN_OUT_LABEL}
                <Chevron />
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The linked header when the player page could not be read: the tab's own word as the h1. */
function SelfFallback({ group }: { group: PageGroup }) {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        <p className="text-sm text-muted-foreground">{youInGroup(group.name)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-xl font-black tracking-[0.02em] font-stretch-70%">
            {YOU_FALLBACK}
          </h1>
          <Chip variant="you">You</Chip>
        </div>
      </div>
    </Card>
  );
}

/** The h1 when the player page could not be read: the tab's own word. */
const YOU_FALLBACK = 'You';

function Unlinked({ group }: { group: PageGroup }) {
  return (
    <Card>
      <div className="flex flex-col gap-2 p-(--card-pad)">
        <p className="text-sm text-muted-foreground">{youInGroup(group.name)}</p>
        <h1 className="text-xl font-bold">{UNLINKED_TITLE}</h1>
        <p className="text-sm text-muted-foreground">{unlinkedLine(group.name)}</p>
      </div>
    </Card>
  );
}

function Pitch({ group, here }: { group: PageGroup; here: Route }) {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        <p className="text-sm text-muted-foreground">{youInGroup(group.name)}</p>
        <h1 className="font-display text-xl font-black tracking-[0.02em] font-stretch-70%">{PITCH_TITLE}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{pitchSub(group.name)}</p>
        <form action="/auth/signin" method="post" className="pt-1">
          <input type="hidden" name="next" value={here} />
          <Button type="submit" className="w-full">
            {SIGN_IN_WITH_DISCORD_LABEL}
          </Button>
        </form>
        <p className="text-sm text-pretty text-muted-foreground">{PITCH_FOOT}</p>
      </div>
    </Card>
  );
}

const ROW =
  'flex min-h-11 items-center justify-between gap-3 border-t border-border px-(--card-pad) py-3 font-bold hover:bg-accent focus-visible:-outline-offset-2';

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="size-5 shrink-0 text-muted-foreground"
    >
      <path
        d="m9 6 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
