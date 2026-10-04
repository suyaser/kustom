import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import {
  BOARD_EMPTY,
  BOARD_LABEL,
  boardSlotLine,
  NEXT_PAGE,
  notPlayedLine,
  PAGINATION_LABEL,
  POINTS_COLUMN_LABEL,
  PREVIOUS_PAGE,
  pageLine,
  RANKED_SECTION_TITLE,
  ratedGamesLabel,
  SEE_FALLBACK,
  SETTLING_SECTION_LINE,
  SETTLING_SECTION_TITLE,
  WEEK_BOARD_SENTENCE_SHORT,
  WINDOW_EMPTY,
  windowLabel,
} from '@/lib/board/copy';
import { type BoardSort, boardSections, DEFAULT_BOARD_SORT, sortSection } from '@/lib/board/order';
import type { BoardView as BoardModel, EmptyWindowFallback } from '@/lib/board/types';
import { isWeekWindow, windowHref } from '@/lib/board/window';
import { cn } from '@/lib/utils';
import { BoardList } from './BoardList';
import { SortSelect } from './SortSelect';
import { WindowChips } from './WindowChips';

/** Rows per page (STRATEGY §6(b): no pagination under 100). */
export const BOARD_PAGE_SIZE = 100;

export interface BoardViewProps {
  board: BoardModel;
  viewerPuuid: string | null;
  sort: BoardSort;
  /** 1-based; clamped to the pages there are. */
  page: number;
  /** `/g/<slug>/leaderboard`. */
  path: string;
  playerHref: (puuid: string) => Route;
  /**
   * The weekly storyline (M16.5), already rendered by the page: in the header, after the slot line
   * and before `Sort by`. The page passes it on `Last week` only, and only when there is a line to show; absent,
   * the board is exactly a group without Premium's.
   */
  storyline?: ReactNode;
}

/**
 * The board, 2.0 (M14.15; STRATEGY §5, §6(b); 05-design 5.2). A server component; the only client
 * part is the sort select's auto-submit.
 *
 * - **One number, `Rating`**, and the order on the page is the order of the printed Ratings
 *   within each section.
 * - All time: **Ranked** (numbered), then **Still settling** (unnumbered, with
 *   `settling · n/10`). A week is one list with no settling section.
 * - The sort select re-orders within each section; the settling section always stays below.
 * - Over 100 rows, links to the next and previous hundred (`?page=`).
 */
export function BoardView({ board, viewerPuuid, sort, page, path, playerHref, storyline }: BoardViewProps) {
  const week = isWeekWindow(board.window);
  const { ranked, settling } = boardSections(board.rows);
  const sortedRanked = sortSection(ranked, sort);
  const sortedSettling = sortSection(settling, sort);
  const all = [...sortedRanked, ...sortedSettling];
  const pages = Math.max(1, Math.ceil(all.length / BOARD_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * BOARD_PAGE_SIZE;
  const shown = all.slice(from, from + BOARD_PAGE_SIZE);
  const shownRanked = shown.filter((row) => !row.settling);
  const shownSettling = shown.filter((row) => row.settling);
  const query = sort === DEFAULT_BOARD_SORT ? {} : { sort };
  const empty = board.rows.length === 0;

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-bold text-balance hyphens-auto [overflow-wrap:break-word]">
            {BOARD_LABEL}
          </h1>
          <WindowChips path={path} selected={board.window} query={query} resetDay={board.resetDay ?? null} />
          <p className="text-sm text-muted-foreground">
            <span className="font-bold text-foreground">
              {windowLabel(board.window, board.resetDay ?? null)}
            </span>
            {board.range === null ? (
              // `All time` after a reset: its label already carries the date (M14.18).
              board.games > 0 ? (
                <>
                  {' · '}
                  <span className="tabular-nums">{ratedGamesLabel(board.games)}</span>
                </>
              ) : null
            ) : (
              <>
                {' · '}
                {/* An empty week prints its dates alone (M14.70): the empty card says there are no games. */}
                <span className="tabular-nums">
                  {board.games === 0 ? board.range : boardSlotLine(board.range, board.games)}
                </span>
              </>
            )}
          </p>
          {storyline !== undefined && storyline !== null && board.window === 'last-week' && !empty
            ? storyline
            : null}
          {empty ? null : <SortSelect action={path} window={board.window} sort={sort} />}
        </header>

        {empty ? (
          <EmptyBoard
            line={board.everRated ? WINDOW_EMPTY[board.window] : BOARD_EMPTY}
            fallback={board.everRated && board.window !== 'all-time' ? (board.fallback ?? 'all-time') : null}
            path={path}
          />
        ) : null}

        {shownRanked.length === 0 ? null : (
          <section aria-labelledby="board-ranked">
            <h2 id="board-ranked" className="sr-only">
              {RANKED_SECTION_TITLE}
            </h2>
            <Card>
              {week && board.window !== 'all-time' ? (
                // M14.57: the week's sorted number, named once over its column.
                <p className="flex justify-end border-b border-border px-(--card-pad) py-2 text-xs text-muted-foreground">
                  {POINTS_COLUMN_LABEL[board.window]}
                </p>
              ) : null}
              <BoardList
                rows={shownRanked}
                window={board.window}
                firstRank={from + 1}
                viewerPuuid={viewerPuuid}
                playerHref={playerHref}
              />
            </Card>
          </section>
        )}

        {shownSettling.length === 0 ? null : (
          <section aria-labelledby="board-settling" className="flex flex-col gap-2 pt-4">
            <h2 id="board-settling" className="text-md font-bold">
              {SETTLING_SECTION_TITLE}
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">{SETTLING_SECTION_LINE}</p>
            <Card>
              <BoardList
                rows={shownSettling}
                window={board.window}
                firstRank={null}
                viewerPuuid={viewerPuuid}
                playerHref={playerHref}
              />
            </Card>
          </section>
        )}

        {pages > 1 ? (
          <Pagination path={path} window={board.window} query={query} page={current} pages={pages} />
        ) : null}

        {board.notPlayed > 0 && !empty ? (
          <p className="text-sm text-muted-foreground">{notPlayedLine(board.notPlayed, board.window)}</p>
        ) : null}

        {week && !empty ? (
          <p className="text-sm text-pretty text-muted-foreground">{WEEK_BOARD_SENTENCE_SHORT}</p>
        ) : null}
      </div>
    </div>
  );
}

/** M14.70: an empty week points to last week when that had a game, else to all time. */
function EmptyBoard({
  line,
  fallback,
  path,
}: {
  line: string;
  fallback: EmptyWindowFallback | null;
  path: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-strong p-(--card-pad)">
      <p>{line}</p>
      {fallback === null ? null : (
        <Link
          href={windowHref(path, fallback) as Route}
          className={cn(
            'inline-flex min-h-11 items-center rounded-control border border-border-strong bg-raised px-4 font-bold',
            'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          )}
        >
          {SEE_FALLBACK[fallback]}
        </Link>
      )}
    </div>
  );
}

function Pagination({
  path,
  window,
  query,
  page,
  pages,
}: {
  path: string;
  window: BoardModel['window'];
  query: Record<string, string>;
  page: number;
  pages: number;
}) {
  const href = (target: number) =>
    windowHref(path, window, target === 1 ? query : { ...query, page: String(target) }) as Route;
  const link =
    'inline-flex min-h-11 items-center rounded-control border border-border-strong bg-card px-4 font-bold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return (
    <nav aria-label={PAGINATION_LABEL} className="flex flex-wrap items-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={link}>
          {PREVIOUS_PAGE}
        </Link>
      ) : null}
      <span className="num text-sm text-muted-foreground">{pageLine(page, pages)}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className={link}>
          {NEXT_PAGE}
        </Link>
      ) : null}
    </nav>
  );
}
