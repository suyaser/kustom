import { displayRating } from '@customs/core';
import Link from 'next/link';
import { gamesLabel, LOST, PROVEN_LABEL, RATING_LABEL, WON, winLossLabel } from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import type { BoardGame, BoardRow as BoardRowModel, Climb } from '@/lib/board/types';
import { formatDuration } from '@/lib/discord/embeds';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { SettlingChip } from '../_board/parts';

/**
 * One row of the board (M3.5, dressed for Floodlit in M3.19; expand in M5.30).
 *
 * **One component, two surfaces.** `/leaderboard` renders every row and the tonight page's
 * ≥1080px rail renders the first five of the same list (`05-design.md`, "What changes on the
 * leaderboard and the player page", item 5). Building it inline in the page would mean writing
 * it twice and having the two drift the first time a number moves.
 *
 * Two lines, each a pair of groups pinned to opposite edges, and a third only on a row that won
 * one of the window's awards:
 *
 *   - Line 1: rank, name, **Proven** hard against the right edge.
 *   - Line 2: the meta under the name, and `Rating` under the Proven number, so the two numbers
 *     form one vertical pair per row rather than two competing columns.
 *   - Line 3 (M8.3): the award badges, left-aligned under the name, on `Last week` and
 *     `Last month` alone. The loader hands the row its list; see {@link AwardBadges}.
 *
 * `Proven` prints nowhere on the row — it is the unlabelled primary number, named once in the
 * card header's legend. It still carries visually-hidden text, the same way the team card's
 * bare side sum does, so a screen reader is not left with an integer and no noun.
 *
 * **A row with games opens.** The expand is a `<details>`, closed by default, the same control
 * `/games` and `/fun` use — no JavaScript, the games are in the first paint. The rail never
 * sends a breakdown, so those five rows stay a flat `<li>`.
 */

export interface BoardRowProps {
  row: BoardRowModel;
  /** 1-based, and the same rank the board reads: it is also the `Someone` disambiguator. */
  rank: number;
  /** The signed-in viewer's puuid, for the `brand` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
}

export function BoardRow({ row, rank, viewerPuuid }: BoardRowProps) {
  const you = row.puuid === viewerPuuid;
  const expandable = row.breakdown.length > 0;

  return (
    <li className={you ? 'cn-row cn-you' : 'cn-row'}>
      {expandable ? (
        <details className="cn-row-details">
          <summary className="cn-row-summary">
            <BoardRowLines row={row} rank={rank} mark />
          </summary>
          <ul className="cn-row-games">
            {row.breakdown.map((game) => (
              <BoardGameRow key={game.gameId} game={game} />
            ))}
          </ul>
        </details>
      ) : (
        <BoardRowLines row={row} rank={rank} mark={false} />
      )}
    </li>
  );
}

function BoardRowLines({ row, rank, mark }: { row: BoardRowModel; rank: number; mark: boolean }) {
  /**
   * **A week row has one number and it is `Rating`** (M7.3). The primary slot carries it, line
   * 2's small-type second number is dropped rather than replaced, and **no Proven is printed on
   * a week board at all** — not in small type, not as a label, nothing. Every other window is
   * exactly the row M3.5 shipped: Proven on the right edge, `Rating` under it.
   */
  const weekly = row.track === 'weekly';

  return (
    <>
      <div className="cn-row-top">
        {/* Rank 1 gets `brand` on the rank number only. No medals, no trophies, no emoji. */}
        <span className={rank === 1 ? 'cn-num cn-rank cn-rank-first' : 'cn-num cn-rank'}>{rank}</span>
        <Link className="cn-row-name" href={`/p/${row.puuid}`}>
          {/*
           * Two nameless players are two links called `Someone` (M3.10, the designer's M3.5
           * review). A screen reader listing the page's links then reads the same word twice
           * with nothing to choose between them, so the rank — which is on screen beside it —
           * joins the accessible name and nothing else. Never the puuid.
           *
           * A named row stays one text node: the wrapper exists only where there is something
           * to disambiguate.
           */}
          {isNameless(row.name) ? (
            <>
              <span>{renderWebName(row.name)}</span>
              {/* The comma is doing work: an accessible name concatenates its parts with no
                  separator, so ` rank 1` would be announced as `Someonerank 1`. */}
              <span className="cn-sr">{`, rank ${rank}`}</span>
            </>
          ) : (
            renderWebName(row.name)
          )}
        </Link>
        {/*
         * The disclosure sits between the name and Proven so the primary number stays on the
         * right edge, under the legend. The slot is reserved on every row so a seed with
         * nothing to open does not shift that column.
         */}
        <span className={mark ? 'cn-row-mark' : 'cn-row-mark cn-row-mark-empty'} aria-hidden="true" />
        {/*
         * **The number the board sorted on** — Proven off the stored fold, and on a week window
         * the weekly `Rating` (M7.3). One slot, one number, and the visually-hidden noun beside
         * it names whichever one it is, so a screen reader is never left with an integer that
         * means something else on the tab next door. The class is the layout's, not a claim
         * about which number is in it.
         */}
        <span className="cn-num cn-proven">
          {weekly ? row.rating : row.proven}
          <span className="cn-sr"> {weekly ? RATING_LABEL : PROVEN_LABEL}</span>
        </span>
      </div>
      <div className="cn-row-bottom">
        <span className="cn-row-meta">
          <span className="cn-num">{gamesLabel(row.games)}</span>
          {' · '}
          <span className="cn-num">{winLossLabel(row.wins, row.losses)}</span>
          {/*
           * **What happened inside the window** (M5.12): `6 games · 4W 2L · +58`. The counts
           * beside it are already the window's, and the climb closes the line.
           *
           * The delta is computed **here, at render**, from the two mu values the row carries:
           * `displayDelta` rounds both ratings before it subtracts — so the number adds up
           * against the two boards it sits between — and its `-0` for a week that lost less
           * than half a point does not survive the `JSON.stringify` the rail's rows make.
           *
           * On `All time` there is no climb and the streak takes this position instead: the
           * row is exactly today's row and gains nothing.
           */}
          {row.climb === null ? null : <ClimbValue climb={row.climb} />}
          {row.streak === null ? null : (
            <>
              {' · '}
              <span className="cn-num">{formatStreak(row.streak)}</span>
            </>
          )}
          {row.settling ? (
            <>
              {' · '}
              <SettlingChip />
            </>
          ) : null}
        </span>
        {/*
         * `Rating` prints inline on every line 2: it is the number people arrive knowing, so it
         * is the one whose name has to be where it appears.
         *
         * **Except on a week row**, where it is already the big number on line 1 and printing
         * it twice would make one row say one number in two type sizes (M7.3).
         */}
        {weekly ? null : (
          <span className="cn-row-rating">
            {RATING_LABEL} <span className="cn-num">{row.rating}</span>
          </span>
        )}
      </div>
      <AwardBadges awards={row.awards} />
    </>
  );
}

/**
 * Line 3: the awards this window handed this player (M8.3), and nothing else.
 *
 * **Its own run, under the meta, and inside the row's own structure** — after `.cn-row-bottom`
 * and therefore inside the `<summary>` on a row that opens and inside the `<li>` on a row that
 * does not, from one place. Outside the summary an open row would print its award under the list
 * of games it won the award with, where it reads as a caption on the last one.
 *
 * Not the last item of line 2's middot run: that run is one window fact (`12 games · 8W 4L ·
 * +153 · W3`) and an award is what came out of it, not another statistic in the same size and
 * colour (M5.4, `05-design.md`). Not on line 1 either: the name, the triangle and the primary
 * number own that line.
 *
 * **No `<a>`, no `<button>`, no `tabindex`.** The badge is a label, not a control: an
 * interactive element inside a `<summary>` is a nested control, and a thumb landing near it
 * either toggles nothing or navigates by accident. The whole row, badges included, stays one tap
 * target for the expand. No colour, no icon, no trophy, no `#1`, no count and no tooltip — a
 * screen reader hears the words as the last of the row, which is all they are.
 *
 * The titles are `lib/stats/copy.ts`'s, carried on the row exactly as `awardsView` labelled the
 * blocks, in the awards' own order. This formats nothing and sorts nothing.
 */
function AwardBadges({ awards }: { awards: readonly string[] }) {
  if (awards.length === 0) return null;

  return (
    <p className="cn-row-awards">
      {awards.map((award) => (
        <span className="cn-award" key={award}>
          {award}
        </span>
      ))}
    </p>
  );
}

/**
 * One game under a board row: `Won` / `Lost`, the night, how long, and `1512 (+43)`.
 *
 * The same four facts `/p/[puuid]` prints at the head of a recent game, without the lineup
 * and without the chance clause — those belong on the page a tap on the name already opens.
 * The side is the 3px leading rule, the same dress, and never a wash behind the word.
 */
function BoardGameRow({ game }: { game: BoardGame }) {
  const rating = displayRating(game.muAfter);
  const delta = displayDelta(game.muBefore, game.muAfter);

  return (
    <li className={`cn-game cn-game-${game.side === 100 ? 'blue' : 'red'}`}>
      <p className="cn-game-head">
        <span className="cn-game-result">{game.won ? WON : LOST}</span>
        <span className="cn-num cn-duration">{game.startedLabel}</span>
        <span className="cn-num cn-duration">{formatDuration(game.durationS)}</span>
        <span className="cn-num cn-game-rating">
          {rating}
          <span className="cn-sr"> {RATING_LABEL}</span>
          <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
            {` (${formatWebDelta(delta)})`}
          </span>
        </span>
      </p>
    </li>
  );
}

/**
 * `+58`: what the window did to this player's rating, in the same two glyphs `/p/[puuid]`
 * prints a game's delta with — `+` and U+2212, never a colour, never an arrow (`05-design.md`,
 * "Rating delta"). A gain is `text` at 600 and a loss is `dim` at 400, which is the same rule
 * and the same two classes as the per-game delta.
 */
function ClimbValue({ climb }: { climb: Climb }) {
  const delta = displayDelta(climb.muBefore, climb.muAfter);

  return (
    <>
      {' · '}
      <span className={isGain(delta) ? 'cn-num cn-delta cn-delta-up' : 'cn-num cn-delta'}>
        {formatWebDelta(delta)}
      </span>
    </>
  );
}
