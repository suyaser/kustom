import { notFound } from 'next/navigation';
import { LEADERBOARD_LABEL, WINDOW_LABELS } from '@/lib/board/copy';
import { loadBoard } from '@/lib/board/load';
import { LEADERBOARD_WINDOW, parseWindow } from '@/lib/board/window';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { currentViewer } from '@/lib/viewer';
import { BoardView } from '../../_board/BoardView';
import '../../board.css';

/**
 * `/leaderboard` (M3.5), read through one of five time windows (M5.12).
 *
 * Server-rendered from the **anon key** through RLS (`lib/publicClient.ts`), like the tonight
 * page and for the same reason: it is opened from a link, on a phone, with no login. There is
 * no client component on this page and no subscription — a board is not live state, and the
 * numbers only move when a game ends.
 *
 * **`?window=` is the whole of the page's state.** Absent, it is `This week`, which is the
 * board the group is playing; anything that is not one of the five is a 404 and never a silent
 * fallback, because it can only come from a typed URL and a page that quietly showed a
 * different window than the URL names is a page whose links cannot be trusted.
 *
 * The one thing the session decides is which row gets the `brand` "you" rule. Nothing here
 * writes to the database. `includeBreakdown` is on so a row can open into the window's games
 * (M5.30); the tonight rail asks `loadBoard` without it.
 *
 * `includeAwards` is on for the same reason and with the same shape (M8.3): on `Last week` and
 * `Last month` the winners' rows carry the award's own words, and on the three windows that hand
 * nothing out it reads nothing and draws nothing. The rail asks without it — it is a snapshot of
 * tonight, not a window's story.
 */
export const dynamic = 'force-dynamic';

interface LeaderboardPageProps {
  searchParams: Promise<{ window?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: LeaderboardPageProps) {
  const kind = parseWindow((await searchParams).window, LEADERBOARD_WINDOW);
  // The tab says which board is open, so two of them side by side are two different windows
  // and not two copies of the same page.
  return {
    title:
      kind === null
        ? `Kustom · ${LEADERBOARD_LABEL}`
        : `${WINDOW_LABELS[kind]} · ${LEADERBOARD_LABEL} · Kustom`,
  };
}

export default async function LeaderboardPage({ searchParams }: LeaderboardPageProps) {
  const kind = parseWindow((await searchParams).window, LEADERBOARD_WINDOW);
  if (kind === null) notFound();

  const [board, viewer] = await Promise.all([
    loadBoard(createPublicClient(), {
      window: kind,
      timeZone: nightTimeZone(),
      includeBreakdown: true,
      includeAwards: true,
    }),
    currentViewer(),
  ]);

  return <BoardView board={board} viewerPuuid={viewer?.puuid ?? null} />;
}
