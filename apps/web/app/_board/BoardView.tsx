import { LEADERBOARD_LABEL, WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import type { BoardView as BoardViewModel } from '@/lib/board/types';
import { isNameless } from '@/lib/tonight/copy';
import { BoardCard } from '../_leaderboard/BoardCard';
import { NamelessHint, SettlingNote, WeekBoardNote } from './parts';
import { WindowPicker } from './WindowPicker';
import { WindowSlot } from './WindowSlot';

/**
 * `/leaderboard` (M3.5, M3.8, M3.10; dressed for Floodlit in M3.19). A pure function of one
 * snapshot and who is looking, so every edge case in the brief — a season with no games, a
 * player with none, a nameless row, a near-tie on Proven — is a component test rather than a
 * night of waiting.
 *
 * The rule this file exists to keep: **the sort order and the primary number are the same
 * number.** Rows arrive ordered by Proven descending and are rendered in that order, so
 * reading the primary column top to bottom never goes up.
 *
 * The row itself is `app/_leaderboard/BoardRow.tsx`, because the tonight page's rail renders
 * the first five of the same list and one row drawn twice would be two rows by Christmas.
 */

export interface BoardViewProps {
  board: BoardViewModel;
  /** The signed-in viewer's puuid, for the `brand` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
}

export function BoardView({ board, viewerPuuid }: BoardViewProps) {
  /**
   * **Which sentence goes under the card.**
   *
   * On a week window it is the week's own (M7.3), printed whenever there is a board to explain:
   * the column is the weekly `Rating`, which the Proven sentence does not describe, and the
   * week's sentence is about every row rather than about the few the board is least sure of —
   * on a week that is all of them.
   *
   * Everywhere else it is M3.8's, gated as it always was on a row that carries the chip. Only
   * about rows that are on the screen: with an empty window nothing is drawn for the sentence
   * to explain, and it is a note under a column, not a note about the product.
   */
  const weekly = board.rows[0]?.track === 'weekly';
  const settling = !weekly && board.range !== null && board.rows.some((row) => row.settling);
  const nameless = board.rows.some((row) => isNameless(row.name));
  /**
   * **A window with nothing in it**, counted by the loader rather than guessed from the rows:
   * in a window membership *is* the games, and on `All time` the board still lists everybody
   * the database knows, seeded from rank, so a row count would say "played" for a board of
   * `0 games` rows.
   *
   * When it is empty the slot prints the window's sentence and **no card is drawn at all**
   * (product, 2026-09-10) — which is how "never a blank card" and "never say it twice" are
   * both true.
   */
  const empty = board.range === null;

  return (
    <main className="cn-page">
      <header className="cn-strip">
        {/*
         * `This week Leaderboard` (M5.12): the **window's** name at full weight with the
         * page's noun beside it in `dim` — where the season's name used to be, in the shape
         * the designer settled on 2026-09-09. A season's name is never printed to a friend
         * again, and the heading and the picker say the same three words.
         */}
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[board.window]} <span className="cn-strip-sub">{LEADERBOARD_LABEL}</span>
        </h1>
        <WindowPicker path="/leaderboard" selected={board.window} />

        {/*
         * **The strip's one line about the window**, under the chips and above the hairline
         * (the designer, 2026-09-10). Not an empty page and not a spinner: one sentence, in
         * `dim`, over a board that is simply not drawn — the sentence is the whole answer.
         *
         * The slot itself is `WindowSlot`, shared with `/p/[puuid]` and `/stats` (M5.23): one
         * component, so three pages under one picker cannot dress one sentence three ways.
         */}
        <WindowSlot
          window={board.window}
          line={empty ? null : windowSlotLine(board.range as string, board.games)}
        />
      </header>

      <section className="cn-block">
        {empty || board.rows.length === 0 ? null : <BoardCard rows={board.rows} viewerPuuid={viewerPuuid} />}

        {/*
         * Once per page, **under the board** and never once per row (M3.8, moved below the card
         * by the designer 2026-09-10): it explains the column you have just read, and above the
         * card it separated the heading from the thing the heading names.
         */}
        {weekly && !empty ? <WeekBoardNote /> : null}
        {settling ? <SettlingNote /> : null}
      </section>

      {nameless ? <NamelessHint /> : null}
    </main>
  );
}
