import { render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardSort } from '@/lib/board/order';
import type { BoardView as BoardModel, BoardRow } from '@/lib/board/types';
import {
  badgedWindowRows,
  emptyWindowBoard,
  settlingRow,
  workedBoard,
  workedBoardRows,
  workedWindowBoard,
} from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { BoardView } from './BoardView';

/**
 * The board, 2.0 (M14.15; STRATEGY §5, §6(b)). Role and text queries only.
 */

const PATH = '/g/customs/leaderboard';
const playerHref = (puuid: string) => `/g/customs/p/${puuid}` as Route;

function draw(
  board: BoardModel = workedBoard(),
  options: { viewer?: string | null; sort?: BoardSort; page?: number } = {},
) {
  return render(
    <BoardView
      board={board}
      viewerPuuid={options.viewer ?? null}
      sort={options.sort ?? 'rating'}
      page={options.page ?? 1}
      path={PATH}
      playerHref={playerHref}
    />,
  );
}

/** The rows of a section's list, as their links. */
function rowLinks(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole('link');
}

/** The Rating printed on a row: the number before ` Rating` in its accessible text. */
function printedRating(link: HTMLElement): number {
  const match = link.textContent?.match(/(\d+) Rating/);
  return Number(match?.[1]);
}

/** A board of the worked ten with Nadia and Yuki under 10 rated games. */
function settlingBoard(): BoardModel {
  const rows = workedBoardRows().map((row) =>
    row.name === 'Nadia' ? settlingRow(row, 4) : row.name === 'Yuki' ? settlingRow(row, 9) : row,
  );
  return workedBoard({ rows, notPlayed: 9 });
}

describe('the page', () => {
  it('has one h1, the window chips as links with the current one marked, and the slot line', () => {
    draw();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // M14.72: one word, Board, on the tab and the h1.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Board$/);
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    const links = within(nav).getAllByRole('link');
    // Three windows since M14.48: no month chip.
    expect(links.map((link) => link.textContent)).toEqual(['This week', 'Last week', 'All time']);
    expect(within(nav).getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'This week' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'This week' })).toHaveAttribute(
      'href',
      `${PATH}?window=this-week`,
    );
    expect(screen.getByText('Since 8 Sep 2025 · 312 rated games')).toBeInTheDocument();
  });

  it('carries a non-default sort across the window chips', () => {
    draw(workedBoard(), { sort: 'games' });
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    expect(within(nav).getByRole('link', { name: 'Last week' })).toHaveAttribute(
      'href',
      `${PATH}?window=last-week&sort=games`,
    );
  });

  it('never prints Proven or ordinal', () => {
    const { container } = draw(settlingBoard());
    expect(container.textContent).not.toMatch(/proven|ordinal/i);
  });
});

describe('the ranked list and the settling section', () => {
  it('numbers the ranked rows and prints their Ratings in order (acceptance 7)', () => {
    draw(settlingBoard());
    const ranked = screen.getAllByRole('list')[1] as HTMLElement;
    const links = rowLinks(ranked);
    expect(links).toHaveLength(8);
    const ratings = links.map(printedRating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    expect(links[0]).toHaveTextContent(/Rank 1,/);
    expect(links[7]).toHaveTextContent(/Rank 8,/);
  });

  it('puts the under-10 players below, unnumbered, with the chip and the section line', () => {
    draw(settlingBoard());
    const heading = screen.getByRole('heading', { name: 'Still settling' });
    const section = heading.closest('section') as HTMLElement;
    expect(
      within(section).getByText("New players' ratings move fast at first. They get a rank after 10 games."),
    ).toBeInTheDocument();
    const links = rowLinks(section);
    expect(links.map((link) => link.textContent?.includes('Rank'))).toEqual([false, false]);
    expect(within(section).getByText('settling · 4/10')).toBeInTheDocument();
    expect(within(section).getByText('settling · 9/10')).toBeInTheDocument();
    const ratings = links.map(printedRating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it('counts the people who are not on the board underneath it', () => {
    draw(settlingBoard());
    expect(screen.getByText("+ 9 people who haven't played a rated game yet.")).toBeInTheDocument();
  });

  it('is one list on a week, with no settling section and the week note', () => {
    draw(workedWindowBoard('this-week'));
    expect(screen.queryByRole('heading', { name: 'Still settling' })).not.toBeInTheDocument();
    expect(screen.queryByText(/settling ·/)).not.toBeInTheDocument();
    expect(screen.getByText(/Everyone starts the week at 0. Points come from this week's games only/)).toBeInTheDocument();
  });

  it('M14.57: names the sorted number once, Points this week / Points last week; All time has none', () => {
    const { unmount } = draw(workedWindowBoard('this-week'));
    expect(screen.getByText('Points this week')).toBeInTheDocument();
    unmount();
    const again = draw(workedWindowBoard('last-week'));
    expect(screen.getByText('Points last week')).toBeInTheDocument();
    again.unmount();
    draw(workedBoard());
    expect(screen.queryByText(/^Points (this|last) week$/)).toBeNull();
  });

  it('M14.57: on a week the default sort reads Points, not Rating; All time keeps Rating', () => {
    const { unmount } = draw(workedWindowBoard('last-week'));
    const select = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Points',
      'Games',
      'Win rate',
    ]);
    expect(select.selectedOptions[0]).toHaveTextContent('Points');
    unmount();
    draw(workedBoard());
    const allTime = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(allTime.selectedOptions[0]).toHaveTextContent('Rating');
  });

  it("M14.57: a week row's big number is its net points, with the all-time Rating small under it", () => {
    const board = workedWindowBoard('last-week');
    draw(board);
    const row = board.rows.find((candidate) => candidate.points !== null) as (typeof board.rows)[number];
    const link = screen.getByRole('link', { name: new RegExp(row.name ?? 'Someone') });
    const [first, second] = Array.from(link.lastElementChild?.children ?? []);
    expect(first).toHaveTextContent(/^[+−±]\d+/);
    expect(second).toHaveTextContent(`${row.rating} Rating`);
  });
});

describe('a row', () => {
  it('is one link to the player page, with no details, summary or nested link (the audit)', () => {
    const { container } = draw();
    expect(container.querySelector('details, summary')).toBeNull();
    const lena = screen.getByRole('link', { name: /Lena/ });
    expect(lena).toHaveAttribute('href', `/g/customs/p/${workedPuuid('Lena')}`);
    expect(within(lena).queryByRole('link')).toBeNull();
  });

  it('prints games and the record, and the window change signed with words for a screen reader', () => {
    draw(workedWindowBoard('last-week'));
    const lena = screen.getByRole('link', { name: /Lena/ });
    expect(lena).toHaveTextContent('6 games · 4W 2L');
    expect(within(lena).getByText('58 points last week')).toBeInTheDocument();
    expect(lena).toHaveTextContent('+58');
  });

  it("marks the viewer's own row with the YOU sticker, and nobody else's", () => {
    draw(workedBoard(), { viewer: workedPuuid('Hana') });
    expect(screen.getAllByText('You')).toHaveLength(1);
    expect(within(screen.getByRole('link', { name: /Hana/ })).getByText('You')).toBeInTheDocument();
  });

  it("prints a closed window's award titles on the winners' rows", () => {
    draw({ ...workedWindowBoard('last-week'), rows: badgedWindowRows() });
    expect(
      within(screen.getByRole('link', { name: /Nadia/ })).getByText('Best off-role'),
    ).toBeInTheDocument();
  });
});

describe('the sort select', () => {
  it('is a labelled native select in a GET form that keeps the window', () => {
    draw();
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Rating', 'Games', 'Win rate']);
    const form = select.closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', PATH);
  });

  it('re-orders within each section and keeps the settling section below', () => {
    const rows = settlingBoard().rows.map((row) =>
      row.name === 'Yuki' ? { ...row, games: 500 } : row.name === 'Theo' ? { ...row, games: 400 } : row,
    );
    draw(workedBoard({ rows }), { sort: 'games' });
    const ranked = screen.getAllByRole('list')[1] as HTMLElement;
    expect(rowLinks(ranked)[0]).toHaveTextContent('Theo');
    const settling = screen
      .getByRole('heading', { name: 'Still settling' })
      .closest('section') as HTMLElement;
    expect(rowLinks(settling)[0]).toHaveTextContent('Yuki');
  });
});

describe('same-name labels (M14.69)', () => {
  it('prints the suffix muted at weight 400 after the name', () => {
    const rows = workedBoardRows().map((row, i) =>
      i === 0 ? { ...row, name: 'Ali', nameSuffix: '#EUW' } : row,
    );
    draw(workedBoard({ rows }));
    const suffix = screen.getByText('#EUW');
    expect(suffix).toHaveClass('font-normal', 'text-muted-foreground');
    expect(suffix.parentElement).toHaveTextContent('Ali #EUW');
  });
});

describe('the empty states', () => {
  it('says the board fills in after the first game, for a group with no rated game', () => {
    draw({ ...workedBoard(), rows: [], range: null, games: 0, everRated: false, notPlayed: 4 });
    expect(
      screen.getByText("No rated games yet. The board fills in after your first Summoner's Rift game."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says the window is empty and offers all time, on a week nobody played', () => {
    draw(emptyWindowBoard('last-week'));
    expect(screen.getByText('No games last week.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all time' })).toHaveAttribute(
      'href',
      `${PATH}?window=all-time`,
    );
  });

  it('an empty This week points to last week when last week had a game (M14.70)', () => {
    draw({ ...emptyWindowBoard('this-week'), fallback: 'last-week' });
    expect(screen.getByText('No games this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See last week' })).toHaveAttribute(
      'href',
      `${PATH}?window=last-week`,
    );
    expect(screen.queryByRole('link', { name: 'See all time' })).not.toBeInTheDocument();
  });

  it('an empty week prints its dates in the meta line, with no games count (M14.70)', () => {
    draw({
      ...emptyWindowBoard('this-week'),
      range: 'Sunday 4 Oct to Saturday 10 Oct',
      fallback: 'last-week',
    });
    expect(screen.getByText('Sunday 4 Oct to Saturday 10 Oct')).toBeInTheDocument();
    expect(screen.queryByText(/rated game/)).not.toBeInTheDocument();
  });

  it('an empty This week points to all time when last week was empty too (M14.70)', () => {
    draw({ ...emptyWindowBoard('this-week'), fallback: 'all-time' });
    expect(screen.getByText('No games this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all time' })).toHaveAttribute(
      'href',
      `${PATH}?window=all-time`,
    );
  });
});

/** A hundred-and-fifty-player board, real-shaped: distinct names and Ratings. */
function bigBoard(count: number): BoardModel {
  const template = workedBoardRows()[0] as BoardRow;
  const rows: BoardRow[] = Array.from({ length: count }, (_, index) => ({
    ...template,
    puuid: `puuid-${index}`,
    name: `Player Number ${index}`,
    rating: 2_000 - index * 3,
    sortKey: 2_000 - index * 3,
    climb: { rBefore: 1200, rAfter: 1200 + index * 0.6 },
  }));
  return workedBoard({ rows });
}

describe('long boards', () => {
  it('pages at 100 rows and numbers on from 101', () => {
    draw(bigBoard(150), { page: 2 });
    const ranked = screen.getAllByRole('list')[1] as HTMLElement;
    const links = rowLinks(ranked);
    expect(links).toHaveLength(50);
    expect(links[0]).toHaveTextContent(/Rank 101,/);
    const pages = screen.getByRole('navigation', { name: 'Board pages' });
    expect(within(pages).getByText('Page 2 of 2')).toBeInTheDocument();
    expect(within(pages).getByRole('link', { name: 'Previous 100' })).toHaveAttribute(
      'href',
      `${PATH}?window=all-time`,
    );
  });

  it('has no pagination under 100 rows', () => {
    draw(bigBoard(99));
    expect(screen.queryByRole('navigation', { name: 'Board pages' })).not.toBeInTheDocument();
  });

  it("keeps the all-time board's HTML for 100 players under 300 KB (acceptance 9)", () => {
    const html = renderToStaticMarkup(
      <BoardView
        board={bigBoard(100)}
        viewerPuuid={null}
        sort="rating"
        page={1}
        path={PATH}
        playerHref={playerHref}
      />,
    );
    expect(new TextEncoder().encode(html).byteLength).toBeLessThan(300_000);
    expect(html).not.toMatch(/proven|ordinal/i);
  });
});
