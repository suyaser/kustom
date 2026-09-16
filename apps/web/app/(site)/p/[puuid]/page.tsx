import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadPlayerBoard } from '@/lib/board/load';
import { PLAYER_WINDOW, parseWindow } from '@/lib/board/window';
import type { WindowKind } from '@/lib/night';
import { createPublicClient } from '@/lib/publicClient';
import { loadPlayerStats } from '@/lib/stats/load';
import { renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import { PlayerView } from '../../../_board/PlayerView';
import '../../../board.css';

/**
 * `/p/[puuid]` (M3.5). One player: the two numbers, the `Rating` history, the role record and
 * the last few games.
 *
 * **Keyed by PUUID**, like everything else in this product: names get renamed and the link a
 * friend pasted last month still opens the right page. Read with the anon key through RLS,
 * server-rendered, no client component and nothing written.
 *
 * A puuid with no `players_public` row is a 404 rather than an empty page — there is nobody to
 * show, and an invented blank profile is worse than the browser's own answer.
 *
 * **Its default window is `All time`** (M5.12), unlike `/leaderboard`'s: the page is a person's
 * history, and one that opened on six days of games would answer a question nobody asked it.
 * The parameter is the same word on both pages, so a link keeps its meaning across them.
 *
 * **On `This week` and `Last week` every rating on it is the weekly track's** (M7.16), through
 * `loadPlayerBoard` — the same `foldWeeklyRatings` and the same `seedFor` seed rule the board
 * runs, so the number here is the digit on that player's board row. Nothing is folded in this
 * file; the loader is the one place either page reads a week.
 */
export const dynamic = 'force-dynamic';

interface PlayerPageProps {
  params: Promise<{ puuid: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
}

/**
 * Wrapped in React's `cache` so the title and the page cost one load between them: Next calls
 * `generateMetadata` and the component separately, and this page's load is several queries.
 */
const loadPlayer = cache(async (puuid: string, window: WindowKind) =>
  loadPlayerBoard(createPublicClient(), puuid, { window, timeZone: nightTimeZone() }),
);

/**
 * The sections under the chart (M5.20), read through **`/stats`' own loader** and narrowed to
 * this player: `loadStats` and this call the same window read, apply the same `gateGame`, and
 * fold with the same pure functions — the brief's rule that "the player page calls the same
 * loader and picks one player out of the answer", so a record here and the same record on
 * `/stats` are one computation.
 *
 * A second call rather than one read shared with the board above it: the board's read is a
 * different query with a different shape (one player's rows, the season's ratings), and joining
 * them would be a third query path to keep true. `cache` keeps this one to a single read per
 * request, exactly as it does for the board.
 */
const loadSections = cache(async (puuid: string, window: WindowKind) =>
  loadPlayerStats(createPublicClient(), puuid, { window, timeZone: nightTimeZone() }),
);

export async function generateMetadata({ params, searchParams }: PlayerPageProps) {
  const [{ puuid }, query] = await Promise.all([params, searchParams]);
  const window = parseWindow(query.window, PLAYER_WINDOW);
  // An unknown window is the page's 404, not the title's problem: it renders `Kustom` and the
  // component below refuses the request.
  const player = window === null ? null : await loadPlayer(puuid, window);
  return { title: player === null ? 'Kustom' : `${renderWebName(player.name)} · Kustom` };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const [{ puuid }, query] = await Promise.all([params, searchParams]);
  const window = parseWindow(query.window, PLAYER_WINDOW);
  if (window === null) notFound();

  /**
   * **The two reads are made together**, not one after the other: the board's numbers and
   * M5.20's sections are one page, and a phone on a link waits for the slower of the two rather
   * than for their sum. A puuid nobody knows then costs one read it does not use, which is the
   * cheaper of the two mistakes — it happens on a mangled URL, and the other one happens on
   * every visit.
   */
  const [player, stats] = await Promise.all([loadPlayer(puuid, window), loadSections(puuid, window)]);
  if (player === null) notFound();

  // **The session decides nothing here** (M3.19): a lineup marks the player whose page it is,
  // and marking the viewer as well put the `brand` rule on two rows of five on every night the
  // two of them played together. With nothing left for it to decide, the page does not read it.
  return <PlayerView player={player} stats={stats} />;
}
