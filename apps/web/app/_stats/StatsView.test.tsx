import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WINDOW_EMPTY } from '@/lib/board/copy';
import type { WindowKind } from '@/lib/night';
import type { StatsGame, StatsPlayer, StatsView as StatsViewModel } from '@/lib/stats/types';
import { statsView } from '@/lib/stats/view';
import { rosterFor, statsGame, tenPlayerGame } from '@/lib/testing/statsFixtures';
import { StatsView } from './StatsView';

/**
 * `/stats` (M5.4) from fixture games, through the page's own pure assembly (`lib/stats/view.ts`).
 *
 * The cases that matter are the ones a page gets subtly wrong and nobody notices for a month:
 * an empty window drawing five empty cards, a minimum printing a percentage it has not earned,
 * an award block on a window that has not closed, and the picker forgetting which window it is
 * on. The arithmetic itself is `lib/stats/stats.test.ts`.
 */

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function view(
  games: readonly StatsGame[],
  options: {
    window?: WindowKind;
    players?: readonly StatsPlayer[];
    capped?: boolean;
    cap?: number;
  } = {},
): StatsViewModel {
  return statsView({
    window: options.window ?? 'this-month',
    games,
    players: options.players ?? rosterFor(games),
    range: MONTH,
    capped: options.capped ?? false,
    cap: options.cap ?? 2_000,
    timeZone: 'Africa/Cairo',
  });
}

/**
 * A month with enough in it that every block has something to print: the same ten, seven times,
 * blue taking the first five.
 *
 * **Seven and not eight**, so no pair reaches the month's cursed-duo minimum of eight games
 * together — with fixed teams every pair on a side has the same record, and a window that
 * crowned one would crown ten.
 */
function busyMonth(): StatsGame[] {
  const games: StatsGame[] = [];
  const blue = ['rami:jungle', 'iris:top', 'omar:mid', 'hana:adc', 'theo:support'];
  const red = ['yuki:jungle', 'nadia:top', 'karim:mid', 'lena:adc', 'bilal:support'];

  for (let index = 0; index < 7; index += 1) {
    games.push(
      statsGame({
        at: `2026-09-0${1 + Math.floor(index / 4)}T1${index % 4}:00:00Z`,
        blue,
        red,
        durationS: 1_800,
        winner: index < 5 ? 100 : 200,
      }),
    );
  }
  return games;
}

function draw(stats: StatsViewModel) {
  return render(<StatsView stats={stats} />);
}

describe('the header', () => {
  it('names the window, the page and the days it covers', () => {
    const { container } = draw(view(busyMonth()));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This month Stats');
    expect(container.querySelector('.cn-window-line')?.textContent).toBe('September · 7 games');
    expect(screen.getByText('10 players played.')).toBeInTheDocument();
  });

  /** The same control as the two board pages, in the same slot, and it knows where it is. */
  it('mounts the window picker with this month selected', () => {
    draw(view(busyMonth()));

    const picker = screen.getByRole('navigation', { name: 'Time window' });
    expect(
      within(picker)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['This week', 'Last week', 'This month', 'Last month', 'All time']);
    expect(within(picker).getByRole('link', { name: 'This month' })).toHaveAttribute('aria-current', 'page');
    expect(within(picker).getByRole('link', { name: 'Last week' })).toHaveAttribute(
      'href',
      '/stats?window=last-week',
    );
  });

  it('says which games it is showing when the read hit its cap, and nothing when it did not', () => {
    const { unmount } = draw(view(busyMonth(), { capped: true, cap: 5 }));
    expect(screen.getByText('Showing the most recent 5 games.')).toBeInTheDocument();
    unmount();

    draw(view(busyMonth()));
    expect(screen.queryByText(/Showing the most recent/)).not.toBeInTheDocument();
  });
});

describe('a window with nothing in it', () => {
  /**
   * The M3.5 rule: not an empty page, not a spinner, and **not five empty cards** — the
   * window's own sentence, in the slot, with nothing drawn under it.
   */
  it('is the window s own sentence and no sections at all', () => {
    const { container } = draw(view([], { window: 'last-week' }));

    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toBeInTheDocument();
    expect(container.querySelectorAll('.cn-card')).toHaveLength(0);
    expect(screen.queryByText('Awards')).not.toBeInTheDocument();
    expect(screen.queryByText(/Blue wins/)).not.toBeInTheDocument();
  });

  /**
   * **The sentence is in the slot, in `dim`, exactly where the two board pages print it**
   * (the designer, 2026-09-11, M5.23). It used to be the page's own body block at `t-base` in
   * `text` under a strip with no hairline — M5.8's rule 6, written for the page whose whole
   * subject is the window. Three pages under one picker answer one tap one way.
   */
  it('puts the sentence in the slot, in the strip, and keeps the hairline', () => {
    const { container } = draw(view([], { window: 'last-week' }));
    const strip = container.querySelector('.cn-strip');

    expect(strip).not.toHaveClass('cn-strip-bare');
    expect(strip?.textContent).toContain('No games last week.');
    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toHaveClass('cn-empty');
    expect(screen.getByText(WINDOW_EMPTY['last-week']).parentElement).toBe(strip);
    // Nothing in the body says it a second time.
    expect(container.querySelector('.cn-stats-answer')).not.toBeInTheDocument();
    // No slot line either: `· 0 games` is a thing no reader needs told twice.
    expect(container.querySelector('.cn-window-line')).not.toBeInTheDocument();
  });
});

describe('the group numbers', () => {
  it('are blue s rate and the average game, as three parallel stopped sentences', () => {
    const { container } = draw(view(busyMonth()));

    // One card, no header bar: three lines about one subject (the designer, 2026-09-10).
    const card = container.querySelector('.cn-stats-lines');
    expect(card).toHaveClass('cn-card');
    expect(card?.querySelector('.cn-card-head')).toBeNull();
    expect([...(card?.querySelectorAll('.cn-stats-line') ?? [])]).toHaveLength(3);

    // Five of seven, and every game 1800 seconds.
    expect(screen.getByText('Blue wins 71% of the time.')).toBeInTheDocument();
    expect(screen.getByText('Average game 30 min.')).toBeInTheDocument();
    expect(screen.getByText('10 players played.')).toBeInTheDocument();
  });

  /**
   * **M5.22: the window's game count prints exactly once in the header band.** All three of
   * those numbers are one `countedGames` length passed from one field, so a count beside two of
   * the statements was the slot retyped a few lines under itself — the same thing this product
   * already refuses twice on `/p/[puuid]`. The slot keeps it byte for byte, because M5.10's
   * Sunday post is that same string.
   */
  it('prints the window s game count exactly once, in the slot', () => {
    const { container } = draw(view(busyMonth()));

    /**
     * The band is the header strip and the card of statements under it — the three places the
     * count used to print. (The lists below carry `over 7 games` on each row for a screen
     * reader, which is a denominator for that row and not the window's count.)
     */
    const band = [container.querySelector('.cn-strip'), container.querySelector('.cn-stats-lines')]
      .map((node) => node?.textContent ?? '')
      .join(' ');

    expect(band.match(/7 games/g) ?? []).toHaveLength(1);
    expect(container.querySelector('.cn-window-line')?.textContent).toBe('September · 7 games');
  });
});

describe('by role', () => {
  it('ranks the players past five rows and says so where nobody is', () => {
    const { container } = draw(view(busyMonth()));

    const blocks = [...container.querySelectorAll('.cn-role-block')];
    const jungle = blocks.find((block) => block.textContent?.startsWith('jungle'));
    // Rami won five of seven on jungle; Yuki lost the same five.
    expect(jungle?.textContent).toContain('Rami');
    expect(jungle?.textContent).toContain('5W 2L · 71%');
    expect(jungle?.textContent).toContain('Yuki');
    expect(jungle?.textContent).toContain('2W 5L · 29%');
  });

  it('prints the not-enough line for a role nobody has five games at', () => {
    const games = [
      statsGame({
        at: '2026-09-01T10:00:00Z',
        blue: ['rami:jungle', 'iris:top', 'omar:mid', 'hana:adc', 'theo:support'],
        red: ['yuki:jungle', 'nadia:top', 'karim:mid', 'lena:adc', 'bilal:support'],
      }),
    ];
    draw(view(games));

    expect(screen.getAllByText(/Nobody has 5 games on/)).toHaveLength(5);
    expect(screen.getByText('Nobody has 5 games on jungle yet.')).toBeInTheDocument();
  });

  /** A month of pure backfill: no role numbers at all, and the footnote is the whole answer. */
  it('prints only the footnote when no game recorded who played where', () => {
    const games = Array.from({ length: 3 }, (_, index) =>
      tenPlayerGame({ at: `2026-09-01T1${index}:00:00Z`, unrated: true }),
    );
    draw(view(games));

    expect(
      screen.getByText(
        '3 games are not in the role numbers — the client did not record who played where. Backfilled games never do.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Nobody has 5 games on/)).toHaveLength(5);
  });

  it('says nothing at all about roles when every game recorded them', () => {
    draw(view(busyMonth()));

    expect(screen.queryByText(/not in the role numbers/)).not.toBeInTheDocument();
  });
});

describe('duos and streaks', () => {
  it('lists the best and worst pairs, and the runs with their holders', () => {
    const { container } = draw(view(busyMonth()));

    const best = [...container.querySelectorAll('.cn-role-block')].find((block) =>
      block.textContent?.startsWith('Best together'),
    );
    // Blue's five took five of the seven, so every pair on that side reads the same.
    expect(best?.textContent).toContain('5W 2L · 71%');

    const worst = [...container.querySelectorAll('.cn-role-block')].find((block) =>
      block.textContent?.startsWith('Worst together'),
    );
    expect(worst?.textContent).toContain('2W 5L · 29%');

    /**
     * The two longest are blocks like `On a streak now` (the designer, 2026-09-10): a label,
     * then one 44px row per holder — five people share `W5` here, so five rows print.
     */
    const longest = [...container.querySelectorAll('.cn-role-block')].find((block) =>
      block.textContent?.startsWith('Longest win streak'),
    );
    expect(longest?.querySelectorAll('.cn-record')).toHaveLength(5);
    expect(longest?.textContent).toContain('W5');
    const losing = [...container.querySelectorAll('.cn-role-block')].find((block) =>
      block.textContent?.startsWith('Longest losing streak'),
    );
    expect(losing?.textContent).toContain('L5');
    expect(screen.getByText('On a streak now')).toBeInTheDocument();
  });

  it('says nobody is on a run when nobody is', () => {
    const games = [
      statsGame({
        at: '2026-09-01T10:00:00Z',
        blue: ['rami:jungle', 'iris:top', 'omar:mid', 'hana:adc', 'theo:support'],
        red: ['yuki:jungle', 'nadia:top', 'karim:mid', 'lena:adc', 'bilal:support'],
      }),
    ];
    draw(view(games));

    expect(screen.getByText('Nobody is on a streak of 3 or more.')).toBeInTheDocument();
    expect(screen.getAllByText('No pair has 5 games together yet.')).toHaveLength(2);
  });
});

describe('the awards block', () => {
  /**
   * A running window has **no card**: one line in the header strip, under the slot, because a
   * card with a header bar and one grey sentence in it promises something it has not got — and
   * on `This month`, the page's default, it was the first thing under the picker.
   */
  it('is one line in the header on a window that is still running', () => {
    const { container } = draw(view(busyMonth()));

    const strip = container.querySelector('.cn-strip');
    expect(strip?.textContent).toContain('Awards are handed out when the month ends.');
    expect(screen.queryByText('Awards')).not.toBeInTheDocument();
    expect(screen.queryByText('Most improved')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-awards')).toBeNull();
  });

  it('is three statements on a window that has closed', () => {
    draw(view(busyMonth(), { window: 'last-month' }));

    expect(
      screen.getByText('Three awards for the month. Nobody votes; the numbers pick.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Most improved')).toBeInTheDocument();
    expect(screen.getByText('Best off-role')).toBeInTheDocument();
    expect(screen.getByText('Cursed duo')).toBeInTheDocument();
    // Seven games is under every one of the month's minimums, so all three say so.
    expect(screen.getByText('Nobody played 15 games this month.')).toBeInTheDocument();
    expect(
      screen.getByText('Nobody spent 10 games off their main. That is the balancer doing its job.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No pair played 8 games together this month.')).toBeInTheDocument();
  });

  /**
   * The `brand` edge is the team card's mark and means the same thing: something was won here.
   * A window where nobody cleared a minimum is a plain card with three sentences in it.
   */
  it('lights the card only when somebody won something', () => {
    const nobody = draw(view(busyMonth(), { window: 'last-month' }));
    expect(nobody.container.querySelector('.cn-awards-won')).toBeNull();
    nobody.unmount();

    // Twenty games of the same ten: the month's minimums are cleared and the card is lit.
    const { container } = draw(view([...busyMonth(), ...busyMonth()], { window: 'last-month' }));
    expect(container.querySelector('.cn-awards-won')).not.toBeNull();
    expect(screen.getByText('Most improved')).toBeInTheDocument();
  });

  /** `All time` has no awards block at all: a window that never closes has no last night. */
  it('is absent entirely on all time', () => {
    draw(view(busyMonth(), { window: 'all-time' }));

    expect(screen.queryByText('Awards')).not.toBeInTheDocument();
    expect(screen.queryByText(/Awards are handed out/)).not.toBeInTheDocument();
    // The rest of the page is unchanged.
    expect(screen.getByText('Blue wins 71% of the time.')).toBeInTheDocument();
  });
});

describe('the card titles', () => {
  /**
   * A card title is language, so it is Archivo (`.cn-board-title`) — the same swap `/p/[puuid]`
   * takes in this commit. The mono micro-label is for legends.
   */
  it('are Archivo, not the mono micro-label', () => {
    const { container } = draw(view(busyMonth(), { window: 'last-month' }));

    expect([...container.querySelectorAll('h2')].map((node) => node.textContent)).toEqual([
      'Awards',
      'By role',
      'Duos',
      'Streaks',
    ]);
    for (const heading of container.querySelectorAll('h2')) {
      expect(heading).toHaveClass('cn-board-title');
      expect(heading).not.toHaveClass('cn-num');
    }
  });
});

describe('a player the database has no name for', () => {
  it('reads Someone, never a raw puuid', () => {
    const games = busyMonth();
    const players = rosterFor(games).map((player) =>
      player.puuid === 'u-rami' ? { ...player, name: null } : player,
    );
    const { container } = draw(view(games, { players }));

    expect(screen.getAllByText('Someone').length).toBeGreaterThan(0);
    // The puuid is in the href of their link — the product is keyed by PUUID — and nowhere in
    // anything a reader can read.
    expect(container.textContent).not.toContain('u-rami');
    expect(screen.getAllByRole('link', { name: 'Someone' })[0]).toHaveAttribute('href', '/p/u-rami');
  });
});
