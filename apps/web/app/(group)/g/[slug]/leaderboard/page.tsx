import type { Metadata } from 'next';
import { AiRecap } from '@/components/ai/AiRecap';
import { AI_STORYLINE_TAP } from '@/lib/ai/recapCopy';
import { loadBoardStorylineOrNone } from '@/lib/ai/storylineRead';
import { BOARD_LABEL, WINDOW_LABELS } from '@/lib/board/copy';
import { leaderboardPath, playerHrefFor } from '@/lib/board/hrefs';
import { loadBoard } from '@/lib/board/load';
import { parseBoardPage, parseBoardSort } from '@/lib/board/order';
import { LEADERBOARD_WINDOW, windowHref, windowOrDefault } from '@/lib/board/window';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';
import { currentViewer } from '@/lib/viewer';
import { BoardView } from '../../../../_board/BoardView';

/**
 * `/g/<slug>/leaderboard`, the Board tab (M14.15; M13.10's move, STRATEGY §5 and §6(b)).
 *
 * Server-rendered from the **anon key** through RLS, the group's games and ratings only. No
 * subscription: a board only moves when a game ends.
 *
 * **The URL is the whole of the page's state**: `?window=` (unknown values fall back to `This week`,
 * never a 404, 05-design 5.8), `?sort=` (Rating by default) and `?page=` (over 100 rows). The
 * session decides only which row carries the `YOU` sticker. Nothing here writes.
 *
 * `/leaderboard[?window=]` 308s here for the original group (`next.config.ts`).
 */
export const dynamic = 'force-dynamic';

interface LeaderboardPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ window?: string | string[]; sort?: string | string[]; page?: string | string[] }>;
}

export async function generateMetadata({ params, searchParams }: LeaderboardPageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const group = await requirePageGroup(slug);
  const kind = windowOrDefault(query.window, LEADERBOARD_WINDOW);
  return { title: groupPageTitle(group, WINDOW_LABELS[kind], BOARD_LABEL) };
}

export default async function LeaderboardPage({ params, searchParams }: LeaderboardPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const group = await requirePageGroup(slug);
  const window = windowOrDefault(query.window, LEADERBOARD_WINDOW);
  const timeZone = nightTimeZone();

  const [board, viewer, storyline] = await Promise.all([
    loadBoard(createPublicClient(), {
      window,
      groupId: group.id,
      timeZone,
      includeAwards: true,
    }),
    currentViewer(group.id),
    // M16.5: the weekly storyline, on Last week only (nothing for a group without Premium).
    window === 'last-week'
      ? loadBoardStorylineOrNone(getServiceClient, { groupId: group.id, now: new Date(), timeZone })
      : null,
  ]);
  const here = windowHref(leaderboardPath(group), 'last-week');

  return (
    <BoardView
      board={board}
      viewerPuuid={viewer?.puuid ?? null}
      sort={parseBoardSort(query.sort)}
      page={parseBoardPage(query.page)}
      path={leaderboardPath(group)}
      playerHref={playerHrefFor(group, window)}
      storyline={
        storyline === null ? undefined : (
          <AiRecap
            recap={{ kind: 'line', lineId: storyline.lineId, text: storyline.text }}
            groupId={group.id}
            tap={AI_STORYLINE_TAP}
            // Admins and the owner only; `POST /api/admin/ai/hide` checks again.
            canHide={viewer?.isAdmin === true}
            hideRedirect={here}
          />
        )
      }
    />
  );
}
