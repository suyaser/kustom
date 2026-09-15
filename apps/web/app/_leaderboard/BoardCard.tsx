import { boardLegend, TOP_OF_BOARD_TITLE } from '@/lib/board/copy';
import type { BoardRow as BoardRowModel } from '@/lib/board/types';
import '../board-parts.css';
import { BoardRow } from './BoardRow';

/**
 * The board's rows, in a card (M3.19, `05-design.md`, "What changes on the leaderboard and the
 * player page", item 2).
 *
 * The Floodlit card recipe — `surface` fill, 1px `line`, the lit top edge — with a `raise`
 * header bar carrying the legend, instead of v1's bare list on the page. The header is the one
 * place the primary number is named:
 *
 * **The legend is the single word `Proven`**, right-aligned over that number and not
 * `Proven · Rating` (amended 2026-09-09, from the rendered page). It is a legend and not a
 * header row: it does not stick, does not sort and is not tappable, because on a phone a
 * header row has scrolled away after four rows and every row below it is then two unexplained
 * numbers.
 *
 * **On a week board the word is `Rating`** (M7.3), because that is the number in the column
 * under it — the legend names the number the board sorted on, whichever track that is, and a
 * board whose rows are weekly ratings under a legend that says `Proven` would be the one thing
 * this milestone exists to stop. The rows carry their own track, so the card reads it off them
 * rather than being told the window: the tonight rail renders the same card from five rows and
 * no window.
 */

export interface BoardCardProps {
  rows: readonly BoardRowModel[];
  viewerPuuid: string | null;
  /** The rail's card is titled; `/leaderboard`'s own card is not — the page heading is above it. */
  title?: string;
  /** Where the first row's rank starts. Always 1 today; the parameter is what stops it being a guess. */
  firstRank?: number;
}

export function BoardCard({ rows, viewerPuuid, title, firstRank = 1 }: BoardCardProps) {
  return (
    <section className="cn-card cn-board-card">
      <header className="cn-card-head cn-board-head">
        {title === undefined ? null : <h2 className="cn-board-title">{title}</h2>}
        <span className="cn-num cn-legend">{boardLegend(rows[0]?.track ?? 'all-time')}</span>
      </header>
      <ol className="cn-board">
        {rows.map((row, index) => (
          <BoardRow key={row.puuid} row={row} rank={firstRank + index} viewerPuuid={viewerPuuid} />
        ))}
      </ol>
    </section>
  );
}

/**
 * `Top of the board` — the tonight page's rail, at ≥1080px (`05-design.md`, "Breakpoints and
 * the desktop grid").
 *
 * The same component, the same five rows and the same numbers as the top of `/leaderboard`,
 * from `loadTopPlayers(client, { limit: 5 })`. **The rail never carries state**: these rows are
 * read once with the page and do not move under a thumb, unlike everything in the column beside
 * them.
 *
 * With no season, or a database with nobody in it, there is no board and the card is not
 * rendered — an empty card in a rail is a page telling you it failed.
 */
export function TopOfBoard({
  rows,
  viewerPuuid,
}: {
  rows: readonly BoardRowModel[];
  viewerPuuid: string | null;
}) {
  if (rows.length === 0) return null;
  return <BoardCard rows={rows} viewerPuuid={viewerPuuid} title={TOP_OF_BOARD_TITLE} />;
}
