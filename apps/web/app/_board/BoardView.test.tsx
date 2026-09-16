import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BOARD_LEGEND,
  PROVEN_LABEL,
  SETTLING_CHIP,
  SETTLING_SENTENCE,
  WEEK_BOARD_SENTENCE,
  WINDOW_EMPTY,
  WINDOW_LABELS,
} from '@/lib/board/copy';
import type { BoardView as BoardViewModel } from '@/lib/board/types';
import { WINDOW_ORDER } from '@/lib/board/window';
import {
  emptyWindowBoard,
  workedBoard,
  workedBoardGame,
  workedBoardRows,
  workedWindowBoard,
} from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { BoardView } from './BoardView';

/**
 * `/leaderboard` (M3.5, M3.8, M3.10) from fixture data.
 *
 * These stand in for the acceptance checks a night cannot be run to re-check: the primary
 * column never goes up, line 2 names `Rating` on every row, the `settling` chip is per row and
 * its sentence is per page, and a nameless player is `Someone` with one line under the list.
 */

function draw(board: BoardViewModel = workedBoard(), viewerPuuid: string | null = null) {
  return render(<BoardView board={board} viewerPuuid={viewerPuuid} />);
}

function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('the two numbers', () => {
  it('prints the primary number in descending order, top to bottom', () => {
    draw();

    // The first text node, not the whole element: the number is followed by the
    // visually-hidden `Proven` a screen reader needs.
    const proven = rows().map((row) => Number(row.querySelector('.cn-proven')?.firstChild?.textContent));
    expect(proven).toEqual([1_548, 1_137, 1_062, 990, 987, 917, 882, 831, 654, 534]);
    for (const [index, value] of proven.entries()) {
      expect(value).toBeLessThanOrEqual(proven[index - 1] ?? value);
    }
  });

  /**
   * **The legend is the single word `Proven`** (amended 2026-09-09, from the rendered page).
   * Right-aligned, `Proven · Rating` put `Rating` directly over the Proven column and `Proven`
   * over nothing, which reads as two side-by-side columns when the two numbers are stacked.
   */
  it('names the primary number once, in the card header, and Rating again on every row', () => {
    const { container } = draw();

    const legend = container.querySelector('.cn-legend');
    expect(legend?.textContent).toBe(BOARD_LEGEND);
    expect(BOARD_LEGEND).toBe(PROVEN_LABEL);
    // In the card's `raise` header bar, and nowhere else on the page.
    expect(legend?.parentElement).toHaveClass('cn-card-head');
    expect(container.querySelectorAll('.cn-legend')).toHaveLength(1);
    // `Rating 1266` is on line 2 of every row: it is the number people arrive knowing, so its
    // name has to be where it appears (`05-design.md`).
    for (const row of rows()) {
      expect(row.querySelector('.cn-row-rating')?.textContent).toMatch(/^Rating \d+$/);
    }
  });

  it('puts the rows on `surface` inside a card, under that header bar', () => {
    const { container } = draw();

    const card = container.querySelector('.cn-board-card');
    expect(card).toHaveClass('cn-card');
    expect(card?.querySelector('.cn-card-head')).toBeInTheDocument();
    expect(card?.querySelector('.cn-board')?.children).toHaveLength(10);
  });

  it('leaves the primary number unlabelled on the row, but not to a screen reader', () => {
    draw();

    for (const row of rows()) {
      const labels = [...row.querySelectorAll('*')].filter((node) => node.textContent?.trim() === 'Proven');
      // Exactly one, and it is the visually-hidden one: `Proven` prints nowhere on the row.
      expect(labels).toHaveLength(1);
      expect(labels[0]).toHaveClass('cn-sr');
    }
  });

  it('reads line 2 in the order the design doc fixes', () => {
    draw();

    const nadia = rows().find((row) => within(row).queryByText('Nadia'));
    expect(nadia?.querySelector('.cn-row-meta')?.textContent).toBe(
      `28 games · 14W 14L · L2 · ${SETTLING_CHIP}`,
    );
    expect(nadia?.querySelector('.cn-row-rating')?.textContent).toBe('Rating 1266');
  });
});

describe('the row', () => {
  it('gives rank 1 the accent, and nobody else', () => {
    draw();

    const ranks = rows().map((row) => row.querySelector('.cn-rank'));
    expect(ranks[0]).toHaveClass('cn-rank-first');
    expect(ranks.slice(1).every((rank) => !rank?.classList.contains('cn-rank-first'))).toBe(true);
    // No medals, no trophies, no emoji.
    expect(document.body.textContent).not.toMatch(/[🥇🏆]/u);
  });

  it('opens the player page from the name, keyed by puuid', () => {
    draw();

    expect(screen.getByRole('link', { name: 'Lena' })).toHaveAttribute('href', `/p/${workedPuuid('Lena')}`);
  });

  it('marks the viewer own row and nobody else', () => {
    draw(workedBoard(), workedPuuid('Theo'));

    const mine = rows().filter((row) => row.classList.contains('cn-you'));
    expect(mine).toHaveLength(1);
    expect(within(mine[0] as HTMLElement).getByText('Theo')).toBeInTheDocument();
  });
});

describe('the still-settling marker (M3.8)', () => {
  it('chips the players under 30 games and nobody else', () => {
    draw();

    const chipped = rows()
      .filter((row) => within(row).queryByText(SETTLING_CHIP))
      .map((row) => row.querySelector('.cn-row-name')?.textContent);
    expect(chipped).toEqual(['Nadia', 'Yuki']);
  });

  it('says the sentence once on the page, not once per row', () => {
    draw();

    expect(screen.getAllByText(SETTLING_SENTENCE)).toHaveLength(1);
  });

  it('disappears at 30 games, with the sentence', () => {
    const settled = workedBoardRows().map((row) => ({
      ...row,
      games: 30,
      wins: 15,
      losses: 15,
      settling: false,
    }));
    draw(workedBoard({ rows: settled }));

    expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
  });
});

describe('a player with no name (M3.10)', () => {
  it('is `Someone`, with one line under the list and never a puuid', () => {
    const [first, ...rest] = workedBoardRows();
    draw(workedBoard({ rows: [{ ...(first as (typeof rest)[number]), name: null }, ...rest] }));

    expect(screen.getByText('Someone')).toBeInTheDocument();
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
    // Everything else about the row is unaffected.
    expect(rows()[0]?.querySelector('.cn-proven')?.textContent).toContain('1548');
  });

  /**
   * Two nameless players are two links called `Someone` (the designer's M3.5 review): a screen
   * reader listing the page's links reads the same word twice with nothing to choose between
   * them. The rank is on screen beside the name already; the puuid never is.
   */
  it('gives each `Someone` link its rank, out loud and only out loud', () => {
    const [first, second, ...rest] = workedBoardRows();
    draw(
      workedBoard({
        rows: [
          { ...(first as (typeof rest)[number]), name: null },
          { ...(second as (typeof rest)[number]), name: null },
          ...rest,
        ],
      }),
    );

    expect(screen.getByRole('link', { name: 'Someone, rank 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Someone, rank 2' })).toBeInTheDocument();
    // On screen it is still one word, and the disambiguator is never a puuid.
    for (const link of screen.getAllByText('Someone')) {
      expect(link.parentElement?.querySelector('.cn-sr')?.textContent).toMatch(/^, rank \d+$/);
    }
    expect(document.body.textContent).not.toContain(workedPuuid('Lena'));
  });

  it('says nothing about names when every row has one', () => {
    draw();

    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('the empty states', () => {
  /**
   * **The sentence, and no card under it** (product, 2026-09-10). The page used to print the
   * rank-seeded rows below the line so a friend who had not played could find themselves; with
   * the sentence in the header's slot that board was ten names against ten `0 games`, which is
   * the same list the nightly post refuses to send. One answer, in one place.
   */
  it('is a heading and one sentence when nothing has been played at all', () => {
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));
    draw(workedBoard({ rows: seeded, range: null, games: 0 }));

    expect(screen.getByText(WINDOW_EMPTY['all-time'])).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(document.querySelector('.cn-board-card')).not.toBeInTheDocument();
    // And never `· 0 games` beside it: the slot holds the sentence instead of the range.
    expect(document.body.textContent).not.toContain('· 0 games');
    // Nothing is drawn for the settling note to explain either.
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
  });

  /**
   * **Each of the five prints its own sentence, and no page renders a blank card** (M5.12).
   * In a window, membership is the games, so an empty window is no rows at all — and the line
   * says which window is empty, because the reader may be two taps from a board with games in
   * it.
   */
  it('prints its own sentence for each of the five, with no card under it', () => {
    for (const window of WINDOW_ORDER) {
      const { unmount } = draw(emptyWindowBoard(window));

      expect(screen.getByText(WINDOW_EMPTY[window])).toBeInTheDocument();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(document.querySelector('.cn-board-card')).not.toBeInTheDocument();
      unmount();
    }
  });

  /** The word `season` is gone from the friend-facing vocabulary with M5.12 and M5.14. */
  it('never says season, and never sends a reader looking for an admin', () => {
    draw(emptyWindowBoard('this-week'));

    expect(document.body.textContent?.toLowerCase()).not.toContain('season');
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  it('has a heading in every window, and it is the window beside `Leaderboard`', () => {
    for (const window of WINDOW_ORDER) {
      const { unmount, container } = draw(emptyWindowBoard(window));

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        `${WINDOW_LABELS[window]} Leaderboard`,
      );
      // The page's noun is the dim sub-word beside the window's own name.
      expect(container.querySelector('.cn-strip-sub')?.textContent).toBe('Leaderboard');
      unmount();
    }
  });
});

/**
 * The picker (M5.12): five options, in one order, on every window — the control that is the
 * difference between two boards which otherwise look identical.
 */
describe('the window picker', () => {
  it("is five options in product's order, in the page header", () => {
    const { container } = draw(workedWindowBoard('this-week'));
    const picker = container.querySelector('.cn-windows');

    expect(picker?.parentElement).toHaveClass('cn-strip');
    expect([...(picker?.children ?? [])].map((option) => option.textContent)).toEqual([
      'This week',
      'Last week',
      'This month',
      'Last month',
      'All time',
    ]);
  });

  /**
   * **All five are links; the selected one is the current page** (the designer, 2026-09-10).
   * `aria-current="page"` is what a screen reader announces as the one you are on, and the
   * chip keeps its 44px target — a mis-tap on the window you are already reading should do
   * nothing, not land on the one beside it.
   */
  it('marks the selected window as the current page and still links it', () => {
    draw(workedWindowBoard('last-week'));
    // Scoped to the control: `Last week` is also the page's heading, which is the point of it.
    const picker = within(screen.getByRole('navigation', { name: 'Time window' }));

    const selected = picker.getByRole('link', { name: 'Last week' });
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected).toHaveClass('cn-window-on');
    expect(selected).toHaveAttribute('href', '/leaderboard?window=last-week');

    expect(picker.getByRole('link', { name: 'This week' })).toHaveAttribute(
      'href',
      '/leaderboard?window=this-week',
    );
    expect(picker.getByRole('link', { name: 'All time' })).toHaveAttribute(
      'href',
      '/leaderboard?window=all-time',
    );
    // Exactly one of the five is marked, and the other four say nothing about being current.
    expect(picker.getAllByRole('link')).toHaveLength(5);
    for (const link of picker.getAllByRole('link', { name: /week|month|time/ })) {
      if (link === selected) continue;
      expect(link).not.toHaveAttribute('aria-current');
      expect(link).not.toHaveClass('cn-window-on');
    }
  });

  /**
   * The slot under the chips (the designer, 2026-09-10): what the window covers and how many
   * games are in it — **or** the window's empty sentence, never both and never `· 0 games`.
   *
   * **The count says what it counted** (M7.18): this board's number is the games that moved a
   * rating, `/stats` prints the games the group played under the same dates, and since the two
   * differ by every ARAM in the window the word is not optional. It is `boardSlotLine`'s, pinned
   * by code point here and in `lib/board/counts.test.ts` — **not** in `lib/board/board.test.ts`,
   * whose slot-line block pins the older `windowSlotLine` form that `/stats`, `/fun` and `/games`
   * still print.
   */
  it("prints the window's dates and its rated game count, inside the strip", () => {
    const { container } = draw(workedWindowBoard('last-week'));
    const line = container.querySelector('.cn-window-line');

    expect(line?.textContent).toBe('Sunday 6 Sep to Saturday 12 Sep · 6 rated games');
    // In the header, under the picker, and there is only one of it.
    expect(line?.parentElement).toHaveClass('cn-strip');
    expect(line?.previousElementSibling).toHaveClass('cn-windows');
    expect(container.querySelectorAll('.cn-window-line')).toHaveLength(1);
    // Sentence case in the DOM; the stylesheet upper-cases it, like the tonight page's slug.
    expect(line?.textContent).not.toBe(line?.textContent?.toUpperCase());
  });

  it('shows the empty sentence in the same slot instead, never both', () => {
    const { container } = draw(emptyWindowBoard('last-week'));

    expect(container.querySelector('.cn-window-line')).not.toBeInTheDocument();
    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toBeInTheDocument();
    expect(screen.getByText(WINDOW_EMPTY['last-week']).parentElement).toHaveClass('cn-strip');
  });

  it('works with no JavaScript: every option is a real href, not a button', () => {
    draw(workedWindowBoard('this-week'));

    for (const link of screen.getAllByRole('link', { name: /week|month|time/ })) {
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toMatch(/^\/leaderboard\?window=/);
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/**
 * A window's row: `6 games · 4W 2L · +58` (M5.12). The counts are the window's, the climb is
 * computed at render from the two mu values, and the shape of line 2 is the same on both tracks.
 */
describe('a row inside a window', () => {
  it('reads the window line, with the climb last and no streak', () => {
    draw(workedWindowBoard('this-week'));

    const meta = rows()[0]?.querySelector('.cn-row-meta')?.textContent;
    expect(meta).toBe('6 games · 4W 2L · +58');
  });

  it('keeps the two numbers and the order exactly as the board has them on a month', () => {
    draw(workedWindowBoard('this-month'));

    const proven = rows().map((row) => Number(row.querySelector('.cn-proven')?.firstChild?.textContent));
    expect(proven).toEqual([1_548, 1_137, 1_062, 990, 987, 917, 882, 831, 654, 534]);
    // And `Rating` is still under it on every row: a month is the board M5.12 shipped.
    for (const row of rows()) {
      expect(row.querySelector('.cn-row-rating')?.textContent).toMatch(/^Rating \d+$/);
    }
  });

  it('is the same row it always was on `All time`: the streak, and no climb', () => {
    draw();

    expect(rows()[0]?.querySelector('.cn-row-meta')?.textContent).toBe('41 games · 21W 20L · L2');
  });
});

/**
 * **A week row has one number, and it is `Rating`** (M7.3). The week is folded from scratch
 * every Sunday and sorts on the weekly Rating, so the board prints the number it sorted on and
 * prints no Proven at all — not in the legend, not in small type, not as a hidden label.
 */
describe('a row inside a week', () => {
  it('prints the weekly Rating in the primary slot, in descending order', () => {
    draw(workedWindowBoard('this-week'));

    const primary = rows().map((row) => Number(row.querySelector('.cn-proven')?.firstChild?.textContent));
    // `round(mu * 60)` for the same ten, ordered by the weekly mu rather than by the ordinal.
    expect(primary).toEqual([2_088, 1_713, 1_638, 1_578, 1_551, 1_469, 1_434, 1_419, 1_266, 1_134]);
    for (const [index, value] of primary.entries()) {
      expect(value).toBeLessThanOrEqual(primary[index - 1] ?? value);
    }
  });

  it('prints no Proven anywhere: not the legend, not the row, not the hidden label', () => {
    const { container } = draw(workedWindowBoard('this-week'));

    expect(container.querySelector('.cn-legend')?.textContent).toBe('Rating');
    expect(container.textContent).not.toContain(PROVEN_LABEL);
    for (const row of rows()) {
      // The one number carries `Rating` for a screen reader, and line 2 does not repeat it.
      const hidden = [...row.querySelectorAll('.cn-sr')].map((node) => node.textContent?.trim());
      expect(hidden).toContain('Rating');
      expect(hidden).not.toContain(PROVEN_LABEL);
      expect(row.querySelector('.cn-row-rating')).toBeNull();
    }
  });

  it('carries no settling chip and says the week sentence once instead', () => {
    for (const window of ['this-week', 'last-week'] as const) {
      const { unmount } = draw(workedWindowBoard(window));

      expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
      expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
      // Every week, under either heading, exactly once.
      expect(screen.getAllByText(WEEK_BOARD_SENTENCE)).toHaveLength(1);
      unmount();
    }
  });

  it('says nothing under an empty week, because there is no board to explain', () => {
    draw(emptyWindowBoard('this-week'));

    expect(screen.queryByText(WEEK_BOARD_SENTENCE)).not.toBeInTheDocument();
    expect(screen.getByText(WINDOW_EMPTY['this-week'])).toBeInTheDocument();
  });
});

/**
 * The per-game expand (M5.30): closed by default, a `<details>` so the games are in the first
 * paint, and the name is still the link to `/p/[puuid]`.
 */
describe('the score breakdown', () => {
  const withGames = () => {
    const [first, ...rest] = workedBoardRows();
    return workedBoard({
      rows: [
        {
          ...(first as (typeof rest)[number]),
          breakdown: [
            workedBoardGame({
              gameId: 'newer',
              startedLabel: '9 Sep',
              won: true,
              side: 200,
              muBefore: 23.9,
              muAfter: 24.87,
            }),
            workedBoardGame({ gameId: 'older', startedLabel: '8 Sep' }),
          ],
        },
        ...rest,
      ],
    });
  };

  it('is closed by default and still prints the two-line row', () => {
    const { container } = draw(withGames());
    const details = container.querySelector('details');

    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('.cn-row-meta')?.textContent).toContain('41 games');
    expect(details?.querySelector('.cn-proven')?.textContent).toContain('1548');
  });

  it('lists each game with the result, the night and the rating change', () => {
    const { container } = draw(withGames());
    const games = [...(container.querySelectorAll('.cn-row-games .cn-game') ?? [])];

    expect(games).toHaveLength(2);
    expect(games[0]?.textContent).toContain('Won');
    expect(games[0]?.textContent).toContain('9 Sep');
    expect(games[0]?.textContent).toContain('1492');
    expect(games[0]?.textContent).toContain('+58');
    expect(games[1]?.textContent).toContain('Lost');
    expect(games[1]?.textContent).toContain('8 Sep');
    expect(games[1]?.className).toContain('cn-game-blue');
  });

  it('keeps the name as the link to the player page', () => {
    draw(withGames());

    expect(screen.getByRole('link', { name: 'Lena' })).toHaveAttribute('href', `/p/${workedPuuid('Lena')}`);
  });

  it('is a details element, not a button, so it works with JavaScript off', () => {
    const { container } = draw(withGames());

    expect(container.querySelector('details')?.tagName).toBe('DETAILS');
    expect(container.querySelector('details summary')).not.toBeNull();
    // The summary is announced as a button; it is not a `<button>`, which is the point.
    expect(container.querySelector('button')).toBeNull();
  });
});
