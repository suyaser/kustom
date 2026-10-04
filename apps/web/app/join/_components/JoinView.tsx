import type { GroupSummary } from '@customs/db/schemas';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import {
  DONT_HAVE_KUSTOM_LINE,
  DONT_HAVE_KUSTOM_TITLE,
  HAVE_KUSTOM_LINE,
  HAVE_KUSTOM_TITLE,
  INVITE_DEAD_LINE,
  INVITE_DEAD_TITLE,
  joinPitch,
  openGroupLabel,
  WHICH_ACCOUNT_REASON,
  WHICH_ACCOUNT_TITLE,
} from '@/lib/groups/pageCopy';
import { BACK_TO_KUSTOM_LABEL, SIGN_IN_WITH_DISCORD_LABEL } from '@/lib/shellCopy';
import { JoinButton, JoinPairing } from './JoinControls';

/** What `/join/<code>` draws. `member` never gets here: the page redirects it to the group. */
export type JoinViewProps =
  | { kind: 'dead' }
  | { kind: 'signed-out'; code: string; group: GroupSummary }
  | { kind: 'linked'; code: string; group: GroupSummary }
  | {
      kind: 'unlinked';
      code: string;
      group: GroupSummary;
      /** Dev kit only: the code card's state without the network. */
      preview?: { kind: 'waiting'; code: string } | { kind: 'expired' } | undefined;
    };

/**
 * `/join/<code>`'s body (M13.13, M14.21; STRATEGY 3.4), a 2.0 root under the bare shell (no group
 * tabs: the visitor is not in the group yet, and neither page is in any group's nav). One h1 per
 * state. Phone first: every button is full width under 768.
 */
export function JoinView(props: JoinViewProps) {
  if (props.kind === 'dead') {
    return (
      <Page>
        <h1 className="font-display text-xl font-black tracking-[0.02em] [overflow-wrap:anywhere] font-stretch-70%">
          {INVITE_DEAD_TITLE}
        </h1>
        <p className="text-base">{INVITE_DEAD_LINE}</p>
        <div className="pt-2">
          <Button asChild variant="secondary" className="w-full md:w-auto">
            <Link href="/">{BACK_TO_KUSTOM_LABEL}</Link>
          </Button>
        </div>
      </Page>
    );
  }

  const { group } = props;
  const here = `/join/${encodeURIComponent(props.code)}`;

  if (props.kind === 'signed-out') {
    return (
      <Page>
        <h1 className="font-display text-xl font-black tracking-[0.02em] [overflow-wrap:anywhere] font-stretch-70%">
          {joinPitch(group.name)}
        </h1>
        <form action="/auth/signin" method="post" className="pt-2">
          <input type="hidden" name="next" value={here} />
          <Button type="submit" className="w-full md:w-auto">
            {SIGN_IN_WITH_DISCORD_LABEL}
          </Button>
        </form>
      </Page>
    );
  }

  if (props.kind === 'linked') {
    return (
      <Page>
        <h1 className="font-display text-xl font-black tracking-[0.02em] [overflow-wrap:anywhere] font-stretch-70%">
          {group.name}
        </h1>
        <p className="text-base">{joinPitch(group.name)}</p>
        <div className="pt-2">
          <JoinButton code={props.code} group={group} />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{group.name}</p>
      <h1 className="font-display text-xl font-black tracking-[0.02em] [overflow-wrap:anywhere] font-stretch-70%">
        {WHICH_ACCOUNT_TITLE}
      </h1>
      <p className="text-base text-pretty">{WHICH_ACCOUNT_REASON}</p>
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card>
          <div className="flex flex-col gap-3 p-(--card-pad)">
            <CardTitle>{HAVE_KUSTOM_TITLE}</CardTitle>
            <JoinPairing
              code={props.code}
              preview={props.preview}
              instruction={<p className="text-base">{HAVE_KUSTOM_LINE}</p>}
            />
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-3 p-(--card-pad)">
            <CardTitle>{DONT_HAVE_KUSTOM_TITLE}</CardTitle>
            <p className="text-base">{DONT_HAVE_KUSTOM_LINE}</p>
            <Button asChild variant="secondary" className="w-full md:w-auto md:self-start">
              <Link href={`/g/${encodeURIComponent(group.slug)}` as Route}>{openGroupLabel(group.name)}</Link>
            </Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}

/** The column every state sits in: the 2.0 root, the gutter, and a reading width. */
function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-8 *:max-w-3xl lg:py-16">
        {children}
      </div>
    </div>
  );
}
