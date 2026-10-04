import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { BACK_TO_TONIGHT, gameCopy, MYSTERY_TITLE } from '@/lib/mystery/copy';
import { loadMysteryOrNone, loadTodayMysteryKind } from '@/lib/mystery/load';
import type { MysteryPageState } from '@/lib/mystery/service';
import { groupHome } from '@/lib/nav';
import { groupPageTitle } from '@/lib/og/titles';
import { MysteryLive } from '../../../../_mystery/MysteryLive';

/**
 * `/g/<slug>/mystery` (M14.17 moved it under the group; M14.38 is its 2.0 body): today's daily
 * game **of this group**, built from its own games (M13.4's `ensureTodayMystery` per group), so two
 * groups on the same day play two different challenges with their own numbers. The clue, guess and
 * result calls go to `/api/daily-mystery/<challengeId>/*`; a challenge id already belongs to one
 * group. The section is Tonight's (`currentMainTab`), so the page links back to it. `/mystery`
 * 308s here for the original group.
 */
export const dynamic = 'force-dynamic';

interface MysteryPageProps {
  params: Promise<{ slug: string }>;
}

const loadTodayGame = cache((groupId: string) => loadMysteryOrNone(new Date(), groupId));

function titleOf(state: MysteryPageState): string {
  if (state.kind === 'play') return gameCopy(state.play.kind).title;
  if (state.kind === 'closed') return gameCopy(state.result.kind).title;
  return MYSTERY_TITLE;
}

export async function generateMetadata({ params }: MysteryPageProps): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  // One read-only row (app-perf): metadata runs on every prefetch, and the page's own load builds
  // the day and touches the visitor's session. Before the day's first visit the title is `Daily`.
  const kind = await loadTodayMysteryKind(group.id);
  return { title: groupPageTitle(group, kind === null ? MYSTERY_TITLE : gameCopy(kind).title) };
}

export default async function GroupMysteryPage({ params }: MysteryPageProps) {
  const group = await requirePageGroup((await params).slug);
  const mystery = await loadTodayGame(group.id);
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-(--gutter) py-6 lg:py-8">
        <header className="flex flex-col gap-1">
          <Link
            href={groupHome(group) as Route}
            className="-ms-1 inline-flex min-h-11 w-fit items-center px-1 text-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {BACK_TO_TONIGHT}
          </Link>
          <h1 className="text-xl leading-tight font-bold text-balance">{titleOf(mystery)}</h1>
        </header>
        <MysteryLive initial={mystery} />
      </div>
    </div>
  );
}
