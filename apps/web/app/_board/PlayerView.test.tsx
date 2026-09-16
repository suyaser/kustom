import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ACE_LABEL,
  MVP_EXPLANATION,
  MVP_LABEL,
  NOT_RATED,
  NOT_RATED_HINT,
  PLAYER_COUNTS_SENTENCE,
  PROVEN_LABEL,
  RATING_EXPLANATION,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  RECENT_RATING_LEGEND,
  ROLE_RECORD_HEADING,
  SEED_LABEL,
  SETTLING_CHIP,
  SETTLING_SENTENCE,
  SETTLING_SENTENCE_PLAYER,
  START_LABEL,
  WEEK_BOARD_SENTENCE,
  WEEK_PLAYER_SENTENCE,
  WINDOW_EMPTY,
} from '@/lib/board/copy';
import { explainGame } from '@/lib/board/explain';
import type { PlayerBoardView } from '@/lib/board/types';
import type { PlayerStatsView } from '@/lib/stats/types';
import {
  emptyPlayerStats,
  workedPlayer,
  workedPlayerStats,
  workedRecentGame,
} from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { PlayerView } from './PlayerView';

/**
 * `/p/[puuid]` (M3.5, M3.8, M3.10) from fixture data.
 *
 * The checks that matter here are the ones a page can get subtly wrong and nobody notices for
 * a week: both numbers under the two fixed labels, the chart plotting `Rating` and not Proven,
 * a delta that adds up, the five in lane order, and the chip and its sentence.
 */

/**
 * The page takes two answers since M5.20: the board's load and `/stats`' own, narrowed to this
 * player. A test that is about the header, the chart or a game row passes the worked sections
 * and ignores them; `PlayerStats.test.tsx` is where they are the subject.
 */
function draw(player: PlayerBoardView = workedPlayer(), stats: PlayerStatsView = workedPlayerStats()) {
  return render(<PlayerView player={player} stats={stats} />);
}

describe('the two numbers', () => {
  it('shows both, once, under the same two labels the board uses', () => {
    const { container } = draw();

    const numbers = [...container.querySelectorAll('.cn-number')].map((node) => node.textContent?.trim());
    expect(numbers).toEqual(['Rating 1434', 'Proven 882']);
  });

  it('invents no third name for either number', () => {
    draw();

    expect(document.body.textContent).not.toMatch(/\bMMR\b|\bScore\b/);
  });

  it('prints the record directly under them, without the count the seed line carries', () => {
    const { container } = draw();

    // Hana: 37 games in the fixture, half of them won. The `37 games` half moved into the seed
    // sentence forty pixels below (the designer, 2026-09-10) — one page, one count.
    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('19W 18L');
    expect(container.querySelector('.cn-seed-line')?.textContent).toContain('37 games since.');
    // **And no count, on any window, ever** (M5.22), which is why this line carries no `rated`
    // wording either: M7.18 wrote a branch for the case and there is no case — see M7.22, where
    // naming this page's rated count is decided.
    expect(container.querySelector('.cn-row-meta')?.textContent).not.toContain('rated');
    // Directly under: the two are one block, not two blocks a gap apart.
    const summary = container.querySelector('.cn-summary');
    expect([...(summary?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-numbers',
      'cn-row-meta',
    ]);
  });

  it('says `1 game` for somebody with one, never `1 games`', () => {
    const { container } = draw(workedPlayer('Hana', { games: 1, wins: 1, losses: 0 }));

    // The count is the seed line's now, and it is still `1 game`.
    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('1W 0L');
    expect(container.querySelector('.cn-seed-line')?.textContent).toContain('1 game since.');
  });
});

/**
 * **One window, two counts, and the page says which** (M7.18, product 2026-09-16).
 *
 * The record in the header is folded over the games that moved a rating; `By role`, the sides,
 * the partners and the streak under it are folded over every game this player played, ARAM
 * included. Both are right. Before this sentence nothing on the page said so, and the two sat
 * forty pixels apart.
 */
describe('the two counts, named', () => {
  /** Where the two universes part, which is where the sentence goes. */
  const sentenceNode = (container: HTMLElement) =>
    [...container.querySelectorAll('p.cn-hint')].find((node) => node.textContent === PLAYER_COUNTS_SENTENCE);

  it('prints the sentence once, where the stats sections begin', () => {
    const { container } = draw();

    expect(screen.getAllByText(PLAYER_COUNTS_SENTENCE)).toHaveLength(1);
    // Above the first section under the chart, and below the rating card.
    const heading = screen.getByText(ROLE_RECORD_HEADING);
    const node = sentenceNode(container);
    expect(node).toBeDefined();
    expect(node?.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector('.cn-player-card')?.compareDocumentPosition(node as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  /**
   * **Not conditional on the two numbers differing.** Hana's fixture has no ARAM in it — 37
   * rated, 37 played — and she still reads it. A word that showed up only on the weeks the
   * counts disagree would teach nobody anything and would read as an error.
   */
  it('prints it for a player whose two counts are equal', () => {
    const { container } = draw(workedPlayer(), workedPlayerStats({ games: 37 }));

    expect(sentenceNode(container)).toBeDefined();
  });

  /** A window this player did not play draws no sections, so there is nothing to explain. */
  it('says nothing on a window with no sections under it', () => {
    const { container } = draw(workedPlayer('Hana', { window: 'last-week' }), emptyPlayerStats('last-week'));

    expect(sentenceNode(container)).toBeUndefined();
  });

  /**
   * **And nothing when there is no record above it either**: a window somebody spent entirely on
   * ARAM has sections under the chart and no `19W 18L` over it, and a sentence about a record the
   * page did not print would be the page explaining a number that is not there.
   */
  it('says nothing for a player whose window was all ARAM', () => {
    const { container } = draw(
      workedPlayer('Hana', { games: 0, wins: 0, losses: 0 }),
      workedPlayerStats({ games: 12 }),
    );

    expect(container.querySelector('.cn-row-meta')).not.toBeInTheDocument();
    expect(sentenceNode(container)).toBeUndefined();
  });
});

describe('the rating history chart', () => {
  it('is one line and one reference line, drawn on the server, with no library', () => {
    const { container } = draw();

    expect(container.querySelector('.cn-chart-line')).toBeInTheDocument();
    expect(container.querySelector('.cn-chart-seed')).toBeInTheDocument();
    expect(screen.getByText(SEED_LABEL)).toHaveClass('cn-chart-seed-label');
    // No fill, no points, no grid.
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelector('.cn-chart-line')).toHaveAttribute('fill', 'none');
  });

  it('titles the plot `Rating`, the same word line 2 of a board row uses', () => {
    const { container } = draw();

    expect(container.querySelector('.cn-chart-title')?.textContent).toBe('Rating');
  });

  it('ends where the number beside it says, so the chart and the label agree', () => {
    const player = workedPlayer();
    const { container } = draw(player);

    const path = container.querySelector('.cn-chart-line')?.getAttribute('d') ?? '';
    const points = path.split(' ');
    expect(points).toHaveLength(player.history.length);
    // The last point is the highest rating in this fixture, so it is the top of the plot.
    const y = (point: string | undefined): number => Number((point ?? '').split(',')[1]);
    expect(y(points.at(-1))).toBeLessThan(y(points[0]));
  });

  it('says one line instead of a chart for a player with no games', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        games: 0,
        wins: 0,
        losses: 0,
        range: null,
        history: [],
        recent: [],
      }),
      emptyPlayerStats(),
    );

    expect(screen.getByText(WINDOW_EMPTY['all-time'])).toBeInTheDocument();
    // The chart's own `<svg>`: the role icons beside a lane word are `<svg>` too (M3.19).
    expect(container.querySelector('.cn-chart-svg')).not.toBeInTheDocument();
    // And no `0 games · 0W 0L`: the sentence under it is the record (the designer, 2026-09-10).
    expect(container.querySelector('.cn-row-meta')).not.toBeInTheDocument();
  });

  /**
   * The line is about the **window's games**, not about the chart. It used to be gated on
   * `history.length === 0`, which is also true for a player whose games the read did not
   * reach — so somebody with thirty-seven games could be told they had none.
   */
  it('does not claim a window is empty for a player who has played it', () => {
    const { container } = draw(workedPlayer('Hana', { history: [] }));

    expect(screen.queryByText(WINDOW_EMPTY['all-time'])).not.toBeInTheDocument();
    // Nothing to plot, so nothing is plotted — and nothing is claimed either.
    expect(container.querySelector('.cn-chart-svg')).not.toBeInTheDocument();
    // The count is in the seed line now, and it still says forty games happened.
    expect(container.querySelector('.cn-seed-line')?.textContent).toContain('37 games since.');
    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('19W 18L');
  });
});

describe('the still-settling marker (M3.8)', () => {
  it('chips a player under 30 games and says the sentence once', () => {
    draw(workedPlayer('Nadia'));

    expect(screen.getByText(SETTLING_CHIP)).toBeInTheDocument();
    expect(screen.getAllByText(SETTLING_SENTENCE_PLAYER)).toHaveLength(1);
  });

  it('is gone at 30 games, chip and sentence together', () => {
    draw(workedPlayer('Nadia', { games: 30, settling: false }));

    expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_SENTENCE_PLAYER)).not.toBeInTheDocument();
  });

  /**
   * **The board's second-person sentence never renders here** (M3.26): on Yuki's page
   * `your rating` names the number twenty pixels above it, and that number is Yuki's.
   *
   * The assertion is scoped to the sentence's own element, not the page: M5.15's explanation
   * strip says `moves you more` and product ruled that its `you` stands — it states the rule
   * of the game and points at no number on the screen.
   */
  it('says neither `you` nor `your` in the sentence under the chart', () => {
    const { container } = draw(workedPlayer('Nadia'));

    const sentence = container.querySelector('.cn-settling')?.textContent ?? '';
    expect(sentence).toBe(SETTLING_SENTENCE_PLAYER);
    expect(sentence).not.toBe(SETTLING_SENTENCE);
    expect(sentence).not.toContain(' you');
    expect(sentence).not.toContain('your');
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
  });
});

/**
 * The sections themselves are `PlayerStats.test.tsx`'s subject. What this file owns is that the
 * page **mounts** them, in the brief's order, under the rating chart and above `Recent games`.
 */
describe('the sections under the chart (M5.20)', () => {
  it('draws them in the order the brief lists, between the chart and the recent games', () => {
    const { container } = draw();

    const titles = [...container.querySelectorAll('.cn-board-title')].map((node) => node.textContent);
    expect(titles).toEqual(['By role', 'By side', 'Partners', 'Streaks', RECENT_GAMES_HEADING]);
  });

  it('is in lane order, with the record and the percentage per role', () => {
    const { container } = draw();

    const roles = [...container.querySelectorAll('.cn-records')][0];
    const records = [...(roles?.querySelectorAll('.cn-record') ?? [])].map((node) =>
      node.textContent?.replace(/ over \d+ games?/, ''),
    );
    expect(records).toEqual(['top12W 8L · 60%', 'mid7W 10L · 41%']);
  });

  it('draws none of them for a window this player has no counted game in', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        window: 'last-week',
        track: 'weekly',
        games: 0,
        wins: 0,
        losses: 0,
        range: null,
        recent: [],
      }),
      emptyPlayerStats('last-week'),
    );

    // The window's own sentence is the whole answer; four cards of `Nobody…` under it are four
    // ways of repeating it.
    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toBeInTheDocument();
    expect(container.querySelectorAll('.cn-board-title')).toHaveLength(0);
  });
});

describe('the recent games', () => {
  it('computes the delta at render, and it adds up with the rating beside it', () => {
    const { container } = draw();

    // `displayRating(23.2) = 1392`, `displayRating(23.9) = 1434`, so the delta is −42 and the
    // two numbers on the line agree. The bare number carries its noun for a screen reader, the
    // same rule the board row's bare Proven follows (the designer's M3.5 review).
    const cell = container.querySelector('.cn-game-rating');
    expect(cell?.firstChild?.textContent).toBe('1392');
    expect(cell?.querySelector('.cn-sr')?.textContent).toBe(` ${RATING_LABEL}`);
    expect(cell?.querySelector('.cn-delta')?.textContent).toBe(' (−42)');
    // A loss is `dim` at 400 and never coloured by sign.
    expect(container.querySelector('.cn-delta')).not.toHaveClass('cn-delta-up');
  });

  it('dates each game, in the configured timezone and a fixed locale', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ startedAt: '2026-09-09T20:12:00.000Z' })],
      }),
    );

    const head = container.querySelector('.cn-game-head');
    // `9 Sep`, not `Sept` and not the reader's own locale: the string is decided on the server.
    expect(head?.textContent).toContain('9 Sep');
    expect(head?.textContent).not.toContain('Sept');
    // Beside the duration, both mono and dim.
    expect([...(head?.querySelectorAll('.cn-duration') ?? [])].map((node) => node.textContent)).toEqual([
      '9 Sep',
      '34:12',
    ]);
  });

  it('dates a game by the night the group played it, not by UTC', () => {
    // 23:30 UTC is 01:30 the next morning in Africa/Cairo, which is the group's timezone.
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ startedAt: '2026-09-09T23:30:00.000Z' })],
      }),
    );

    expect(container.querySelector('.cn-game-head')?.textContent).toContain('10 Sep');
  });

  it('lists the five the player was on, in lane order, with their own row marked', () => {
    const { container } = draw();

    const lineup = [...container.querySelectorAll('.cn-lineup-row')];
    expect(lineup.map((row) => row.querySelector('.cn-lineup-role')?.textContent)).toEqual([
      'top',
      'jungle',
      'mid',
      'adc',
      'support',
    ]);
    const mine = lineup.filter((row) => row.classList.contains('cn-you'));
    expect(mine).toHaveLength(1);
    expect(within(mine[0] as HTMLElement).getByText('Hana')).toBeInTheDocument();
  });

  /**
   * **One marked row, whoever is looking** (the designer, 2026-09-10). The page is about one
   * person; marking the signed-in viewer as well put the `brand` rule on two of five rows on
   * every night the two of them played together, which is two answers to "which one is mine".
   */
  it('marks the page own player and nobody else, on a night the viewer also played', () => {
    const { container } = draw();

    const marked = [...container.querySelectorAll('.cn-lineup-row.cn-you')];
    expect(marked).toHaveLength(1);
    // Iris is in this lineup and could be the viewer; her row is a plain link like the rest.
    expect(within(marked[0] as HTMLElement).queryByText('Iris')).not.toBeInTheDocument();
  });

  it('says whether this player won, not which side did', () => {
    const { unmount } = draw();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    unmount();

    draw(workedPlayer('Hana', { recent: [workedRecentGame({ won: true })] }));
    expect(screen.getByText('Won')).toBeInTheDocument();
  });
});

describe('a player with no name (M3.10)', () => {
  it('is `Someone` in the heading, with one line at the foot and never a puuid', () => {
    draw(workedPlayer('Hana', { name: null }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone');
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(workedPuuid('Hana'));
  });

  it('is `Someone` for a nameless teammate too, and the line is still said once', () => {
    draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({
            team: [
              { puuid: workedPuuid('Hana'), name: 'Hana', role: 'top' },
              { puuid: 'puuid-x', name: null, role: 'jungle' },
              { puuid: 'puuid-y', name: null, role: 'mid' },
            ],
          }),
        ],
      }),
    );

    expect(screen.getAllByText('Someone')).toHaveLength(2);
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });

  it('says nothing about names when everybody on the page has one', () => {
    draw();

    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

/**
 * A window on a person's page (M5.12): the same five options, the window's own games, and a
 * hairline that says `start` instead of `seed`.
 *
 * This block replaces the `no season` one that stood here until 2026-09-10. That state was the
 * page's second shape — a name and one sentence — and it is gone with the sentence and the
 * button behind it (M5.14): a deployment with no season row has no games either, so the
 * honest page is this one with the window's empty line on it.
 */
describe('a window on the player page', () => {
  const week = workedPlayer('Hana', {
    window: 'this-week',
    // A week window is the weekly track since M7.16, and the page reads the track: a fixture
    // that said `this-week` and carried the stored one would be a state the loader cannot make.
    track: 'weekly',
    games: 6,
    wins: 4,
    losses: 2,
    range: 'Sunday 6 Sep to Saturday 12 Sep',
    reference: 1_376,
    history: [1_376, 1_402, 1_434],
  });

  it('carries the picker, marked, and links its four neighbours at this player', () => {
    draw(week);
    const picker = within(screen.getByRole('navigation', { name: 'Time window' }));

    expect(picker.getByRole('link', { name: 'This week' })).toHaveAttribute('aria-current', 'page');
    expect(picker.getByRole('link', { name: 'All time' })).toHaveAttribute(
      'href',
      `/p/${workedPuuid('Hana')}?window=all-time`,
    );
  });

  /**
   * **The range half alone** (product, 2026-09-10): the record under the two numbers already
   * says `6 games · 4W 2L`, and no page says one number twice.
   */
  it("prints the window's dates in the strip, with no count beside them", () => {
    const { container } = draw(week);
    const line = container.querySelector('.cn-window-line');

    expect(line?.textContent).toBe('Sunday 6 Sep to Saturday 12 Sep');
    expect(line?.parentElement).toHaveClass('cn-strip');
    expect(line?.textContent).not.toContain('games');
  });

  it('counts the window games, once: the record and the line under it are one count', () => {
    const { container } = draw(week);

    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('4W 2L');
    // The week's own count lives in the line that says what it is counted since.
    expect(container.querySelector('.cn-seed-line')?.textContent).toContain('6 games since.');
  });

  /** `seed` is where the board started them; `start` is where the week found them. */
  it('labels the reference line `start`, and keeps `seed` for all time', () => {
    const { container, unmount } = draw(week);
    expect(container.querySelector('.cn-chart-seed-label')?.textContent).toBe(START_LABEL);
    expect(container.querySelector('.cn-chart-svg')?.getAttribute('aria-label')).toContain(
      `${START_LABEL} 1376`,
    );
    unmount();

    const { container: allTime } = draw();
    expect(allTime.querySelector('.cn-chart-seed-label')?.textContent).toBe(SEED_LABEL);
  });

  it('says the empty line of the window the reader chose, and keeps their rating on screen', () => {
    draw(
      workedPlayer('Hana', {
        window: 'last-week',
        track: 'weekly',
        games: 0,
        wins: 0,
        losses: 0,
        range: null,
        history: [],
        recent: [],
      }),
      emptyPlayerStats('last-week'),
    );

    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toBeInTheDocument();
    // Their rating is still on the page: this is a person, not a board row that is missing.
    expect(screen.getByText(RATING_LABEL)).toBeInTheDocument();
  });

  /** The word `season` is gone from every friend-facing surface (M5.12, M5.14). */
  it('never says season, in any window', () => {
    draw(week);

    expect(document.body.textContent?.toLowerCase()).not.toContain('season');
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  /**
   * **A week window reads the weekly track** (M7.16), and the page says so by printing one
   * number instead of two. The loader's half is `board.integration.test.ts` and
   * `weekBoard.integration.test.ts`; what this block owns is what a reader sees.
   */
  describe('on a week window (M7.16)', () => {
    it('prints the weekly Rating as the one number and no Proven at all', () => {
      const { container } = draw(week);

      const numbers = [...container.querySelectorAll('.cn-number')].map((node) => node.textContent?.trim());
      expect(numbers).toEqual(['Rating 1434']);
      // Not as a label, not as a second number, not in small type, not visually hidden.
      expect(document.body.textContent).not.toContain(PROVEN_LABEL);
      // The one number takes the primary slot, which is the display cut.
      expect(container.querySelector('.cn-number-primary')?.textContent?.trim()).toBe('Rating 1434');
    });

    it('says the week sentence in the third person, and never the Proven one', () => {
      const { container } = draw({ ...week, settling: false });

      const sentence = container.querySelector('.cn-settling')?.textContent ?? '';
      expect(sentence).toBe(WEEK_PLAYER_SENTENCE);
      // The board's own week sentence is second person and is not this page's (M3.26).
      expect(sentence).not.toBe(WEEK_BOARD_SENTENCE);
      expect(sentence).not.toContain(' you');
      expect(sentence).not.toContain('your');
      expect(screen.queryByText(SETTLING_SENTENCE_PLAYER)).not.toBeInTheDocument();
      expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
    });

    /**
     * The chip is an all-time fact and a week window does not print the number it is about.
     * The fixture is `Nadia`, whose all-time count is under the threshold: on `All time` she
     * carries it, and the same player read through a week carries neither it nor its sentence.
     */
    it('carries no settling chip, on a week the same player would be chipped on', () => {
      const { unmount } = draw(workedPlayer('Nadia'));
      expect(screen.getByText(SETTLING_CHIP)).toBeInTheDocument();
      unmount();

      draw(workedPlayer('Nadia', { window: 'this-week', track: 'weekly', settling: false }));
      expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
      expect(screen.getByText(WEEK_PLAYER_SENTENCE)).toBeInTheDocument();
    });

    /** Both, byte for byte, on the three windows that still read the stored track. */
    it('keeps Proven and its own sentence on `All time` and the month windows', () => {
      for (const window of ['all-time', 'this-month', 'last-month'] as const) {
        const { container, unmount } = draw(workedPlayer('Nadia', { window }));

        expect(container.querySelector('.cn-settling')?.textContent).toBe(SETTLING_SENTENCE_PLAYER);
        expect([...container.querySelectorAll('.cn-number-label')].map((node) => node.textContent)).toEqual([
          RATING_LABEL,
          PROVEN_LABEL,
        ]);
        expect(screen.queryByText(WEEK_PLAYER_SENTENCE)).not.toBeInTheDocument();
        unmount();
      }
    });

    /** The empty week still explains the number it is showing: the seed is a weekly one. */
    it('says the week sentence even on a week this player did not play', () => {
      draw(
        workedPlayer('Hana', {
          window: 'this-week',
          track: 'weekly',
          games: 0,
          wins: 0,
          losses: 0,
          range: null,
          history: [],
          recent: [],
        }),
        emptyPlayerStats('this-week'),
      );

      expect(screen.getByText(WINDOW_EMPTY['this-week'])).toBeInTheDocument();
      expect(screen.getByText(WEEK_PLAYER_SENTENCE)).toBeInTheDocument();
      expect(document.body.textContent).not.toContain(PROVEN_LABEL);
    });
  });

  it('says `Someone` for a nameless player, and explains it once', () => {
    draw(
      workedPlayer('Hana', {
        name: null,
        window: 'last-month',
        games: 0,
        wins: 0,
        losses: 0,
        range: null,
        history: [],
        recent: [],
      }),
      emptyPlayerStats('last-month'),
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone');
    // The hint is the answer to the heading (M3.10): a player with no games is exactly the
    // player the database has no name for yet, and the sentence says why.
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });
});

describe('getting back to the board', () => {
  /**
   * The back link is **deleted with the shell** (`05-design.md`, "The player page"): the
   * `Leaderboard` tab in the top bar is the same destination, and a page does not carry two
   * ways to one place. The tab is `Shell.test.tsx`'s; this only asserts the second one is gone.
   */
  it('carries no back link of its own', () => {
    draw();

    expect(screen.queryByRole('link', { name: '← Leaderboard' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('←');
  });
});

describe('the Floodlit rank order down the page (M3.19)', () => {
  /**
   * v1 set the name and both section headings at the same `t-lg` 600 and put the numbers below
   * all three, which made the largest type on a page about a person the words `By role`.
   *
   * The two card titles are `.cn-board-title` since M5.4 (the designer, 2026-09-10): **a card
   * title is language, so it is Archivo** — the rule the rail's `Top of the board` already
   * followed — and the mono micro-label is kept for legends. One rule, both pages.
   */
  it('is the name in the display cut, the two numbers above it, the card titles in Archivo', () => {
    const { container } = draw();

    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('cn-display');
    expect(container.querySelector('.cn-number-primary .cn-number-value')?.textContent).toBe('882');
    // **Every card title on the page, and the same rule for all of them** — four of them are
    // M5.20's sections, and a fifth heading level for those would be the swap undone.
    const titles = [...container.querySelectorAll('h2')];
    expect(titles.map((node) => node.className)).toEqual(titles.map(() => 'cn-board-title'));
    expect(titles.map((node) => node.textContent)).toEqual([
      'By role',
      'By side',
      'Partners',
      'Streaks',
      RECENT_GAMES_HEADING,
    ]);
  });

  /**
   * The second level, and there is no third (M5.8): a group label inside a card is `dim`, so a
   * card's own name is the loudest thing in it and the sub-head is not.
   */
  it('opens a block inside a card with a dim group label, never a second title', () => {
    const { container } = draw();

    expect([...container.querySelectorAll('.cn-stats-subtitle')].map((node) => node.textContent)).toEqual([
      'Best together',
      'Worst together',
      'Current streak',
      'Longest win streak',
      'Longest losing streak',
    ]);
    expect(container.querySelectorAll('h3')).toHaveLength(0);
  });

  it('puts each list in a card with a `raise` header bar', () => {
    const { container } = draw();

    for (const head of container.querySelectorAll('.cn-list-head')) {
      expect(head).toHaveClass('cn-card-head');
      expect(head.parentElement).toHaveClass('cn-card');
    }
  });

  /** The same legend rule the board row's bare Proven and the seat rack's rating column follow. */
  it('names the `Recent games` rating column once, in the header, right-aligned', () => {
    const { container } = draw();

    const heads = [...container.querySelectorAll('.cn-list-head')];
    const recent = heads.find((head) => head.textContent?.includes(RECENT_GAMES_HEADING));
    expect(recent?.querySelector('.cn-legend')?.textContent).toBe(RECENT_RATING_LEGEND);
  });

  it('sends All games at this person on /games, in the window the page is on', () => {
    draw();
    expect(screen.getByRole('link', { name: 'All games' })).toHaveAttribute(
      'href',
      '/games?window=all-time&p=puuid-hana',
    );
  });

  it('names a role with its icon and its word, never the icon alone', () => {
    const { container } = draw();

    for (const role of container.querySelectorAll('.cn-lineup-role')) {
      // The word carries the meaning; the mark is `aria-hidden` and never on its own.
      expect(role.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(role.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('the four teammates', () => {
  /**
   * This is the one screen in the product that lists other people by name, and hopping between
   * friends is what the board is for (the designer's M3.5 review). The viewed player's own row
   * is plain text: a link back to the page you are already on is not a destination.
   */
  it('link to their own pages, while the viewed player row stays plain text', () => {
    const { container } = draw();

    const lineup = [...container.querySelectorAll('.cn-lineup-row')];
    const links = lineup.map((row) => row.querySelector('a')?.getAttribute('href') ?? null);
    expect(links).toEqual([
      null,
      `/p/${workedPuuid('Iris')}`,
      `/p/${workedPuuid('Karim')}`,
      `/p/${workedPuuid('Bilal')}`,
      `/p/${workedPuuid('Theo')}`,
    ]);
    expect(within(lineup[0] as HTMLElement).getByText('Hana').tagName).toBe('SPAN');
  });

  /** A phone has no hover, so the affordance cannot live only in one (the designer, 2026-09-10). */
  it('are dressed as links at rest, and the viewed player is not', () => {
    const { container } = draw();

    for (const link of container.querySelectorAll('.cn-lineup-name')) {
      expect(link.classList.contains('cn-lineup-link')).toBe(link.tagName === 'A');
    }
  });
});

describe('a game that moved nothing (M3.23)', () => {
  /**
   * Product, 2026-09-10: the five are the player's last five games, **rated or not**. A
   * backfilled game that `rebuild-ratings` has not folded yet, and a game the fold refused for
   * being too short or a player short, both read `not rated` — one vocabulary, because the
   * reader's question is the same one.
   */
  it('is listed, reads `not rated`, and carries no delta', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ gameId: 'game-unrated', muBefore: null, muAfter: null })],
      }),
    );

    const cell = container.querySelector('.cn-game-rating');
    expect(cell?.textContent).toBe(NOT_RATED);
    expect(container.querySelector('.cn-delta')).not.toBeInTheDocument();
    // No visually-hidden `Rating` either: there is no rating on this row to name.
    expect(cell?.querySelector('.cn-sr')).not.toBeInTheDocument();
    // Everything else about the row prints as normal.
    expect(container.querySelector('.cn-game-head')?.textContent).toContain('Lost');
    expect(container.querySelector('.cn-game-head')?.textContent).toContain('34:12');
  });

  it('says why once, under the list, and only while a row reads `not rated`', () => {
    const { unmount } = draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({ gameId: 'game-unrated', muBefore: null, muAfter: null }),
          workedRecentGame({ gameId: 'game-2' }),
        ],
      }),
    );

    expect(screen.getAllByText(NOT_RATED_HINT)).toHaveLength(1);
    unmount();

    draw();
    expect(screen.queryByText(NOT_RATED_HINT)).not.toBeInTheDocument();
  });
});

/**
 * "How you got here" (M5.15). The page's own half of it: every row carries its sentence, the
 * seed line sits above the chart, and the one explanation line is drawn once. The sentences
 * themselves are `lib/board/explain.test.ts`; these are about what is on the screen.
 */
describe('why each change is the size it is', () => {
  it('carries the chance its own side was given, on every row that has one', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({ gameId: 'game-1', won: true, side: 200, blueWinProb: 0.58 }),
          workedRecentGame({ gameId: 'game-2', won: false, side: 100, blueWinProb: 0.58 }),
        ],
      }),
    );

    const sentences = [...container.querySelectorAll('.cn-game-why')].map((node) => node.textContent);
    // Red's chance on the first row, blue's on the second, from one split: 42 and 58.
    expect(sentences).toEqual(['As the 42% side.', 'As the 58% side.']);
    expect(sentences[0]).toBe(explainGame(workedRecentGame({ won: true, side: 200, blueWinProb: 0.58 })));
    // And it says nothing the head above it already said.
    expect(sentences.join(' ')).not.toMatch(/Won|Lost|[+−]/);
  });

  it('draws no caption at all on a backfilled row, and still prints the row', () => {
    const { container } = draw(
      workedPlayer('Hana', { recent: [workedRecentGame({ won: true, blueWinProb: null })] }),
    );

    expect(container.querySelector('.cn-game-why')).not.toBeInTheDocument();
    // The row itself is untouched: result, date, duration, rating and delta.
    expect(container.querySelector('.cn-game-head')?.textContent).toContain('Won');
    expect(container.querySelector('.cn-delta')).toBeInTheDocument();
  });

  it('leaves an unrated row untouched: three words, and no sentence under them', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ gameId: 'game-unrated', muBefore: null, muAfter: null })],
      }),
    );

    expect(container.querySelector('.cn-game-rating')?.textContent).toBe(NOT_RATED);
    expect(container.querySelector('.cn-game-why')).not.toBeInTheDocument();
  });

  it('prints the explanation line once per page, not once per row', () => {
    draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ gameId: 'a' }), workedRecentGame({ gameId: 'b' })],
      }),
    );

    // The strip is one paragraph of two sentences since M7.10: why a change is the size it is,
    // and then what carrying a game is worth.
    const strip = `${RATING_EXPLANATION} ${MVP_EXPLANATION}`;
    expect(screen.getAllByText(strip)).toHaveLength(1);
    // In the tonight page's explanation-strip dress: the 3px `brand` rule that means "the bot
    // is explaining itself" (the designer, 2026-09-10).
    expect(screen.getByText(strip)).toHaveClass('cn-explain');
  });
});

/**
 * `MVP` and `ACE` on a game row (M7.10).
 *
 * The page never decides who they were — `lib/board/load.ts` asks `gameAward`, the fold's own
 * call, and hands this component one of two words or nothing. What is tested here is the
 * printing rule product wrote: the word, beside the delta, in the row's own size, and nothing
 * else anywhere near it.
 */
describe('the MVP and the ACE on a game row', () => {
  it('prints the word beside the delta on the row that won it', () => {
    const { container } = draw(
      workedPlayer('Hana', { recent: [workedRecentGame({ won: true, award: 'mvp' })] }),
    );

    const rating = container.querySelector('.cn-game-rating');
    // In the same column as the number and the delta, after them, in one readable string.
    expect(rating?.textContent).toContain(`) ${MVP_LABEL}`);
    expect(container.querySelector('.cn-game-award')?.textContent?.trim()).toBe(MVP_LABEL);
  });

  it('prints ACE for the best player on the losing side', () => {
    const { container } = draw(workedPlayer('Hana', { recent: [workedRecentGame({ award: 'ace' })] }));

    expect(container.querySelector('.cn-game-award')?.textContent?.trim()).toBe(ACE_LABEL);
    expect(container.querySelector('.cn-game-rating')?.textContent).not.toContain(MVP_LABEL);
  });

  /** Nine rows in ten. Absent, not empty: no placeholder, no dash, no "nearly MVP". */
  it('prints nothing at all on a game that named neither', () => {
    const { container } = draw(workedPlayer('Hana', { recent: [workedRecentGame({ award: null })] }));

    expect(container.querySelector('.cn-game-award')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-game-head')?.textContent).not.toContain(MVP_LABEL);
    expect(container.querySelector('.cn-game-head')?.textContent).not.toContain(ACE_LABEL);
  });

  /**
   * Acceptance 6, Floodlit: **the word and nothing around it**. No emoji, no trophy, no `#1`,
   * and no colour of its own — the class carries the delta's size and the page's own text
   * colour, which is a rule a stylesheet can be read for and a test can pin the markup of.
   */
  it('is a word, not a badge: no emoji, no icon, no rank number', () => {
    const { container } = draw(
      workedPlayer('Hana', { recent: [workedRecentGame({ won: true, award: 'mvp' })] }),
    );

    const word = container.querySelector('.cn-game-award');
    expect(word?.tagName).toBe('SPAN');
    expect(word?.children).toHaveLength(0);
    expect(word?.textContent).not.toMatch(/[#0-9]/u);
    // Nothing outside the Basic Latin block: no 🏆, no ★, no medal.
    expect(word?.textContent ?? '').toMatch(/^[ -~]+$/u);
  });

  /**
   * The sentence is about the model, so it prints for a reader who has never been either one —
   * which is most readers, most weeks.
   */
  it('explains the bonus even on a page where no row won anything', () => {
    draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ gameId: 'a' }), workedRecentGame({ gameId: 'b', award: null })],
      }),
    );

    expect(screen.getByText(`${RATING_EXPLANATION} ${MVP_EXPLANATION}`)).toBeInTheDocument();
  });
});

describe('the seed line', () => {
  it('names the displayed seed and the games since, above the chart', () => {
    const player = workedPlayer();
    const { container } = draw(player);

    const line = container.querySelector('.cn-seed-line');
    expect(line?.textContent).toBe(`Started at ${player.reference}, 37 games since.`);
    // M7.19: the fixture is seeded `Silver II` and the page says so nowhere — the rank clause
    // was dropped, not softened, because no rating starts from a rank any more.
    expect(line?.textContent).not.toContain('Silver');
    expect(line?.textContent).not.toContain('Seeded');
    // Above the chart, and it is the chart's own reference number: one value, read once, so
    // the hairline and the sentence cannot disagree (M5.15, acceptance check 4).
    expect(line?.nextElementSibling?.className).toContain('cn-chart');
    expect(screen.getByText(SEED_LABEL)).toBeInTheDocument();
  });

  it('is the whole of a page for a player who has never played: no chart, no list, no zeros', () => {
    const player = workedPlayer('Hana', {
      games: 0,
      wins: 0,
      losses: 0,
      history: [],
      recent: [],
      range: null,
    });
    const { container } = draw(player, emptyPlayerStats());

    expect(container.querySelector('.cn-seed-line')?.textContent).toBe(`Started at ${player.reference}.`);
    expect(container.querySelector('.cn-chart')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-games')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-row-meta')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('NaN');
    // The window's own empty sentence is what says there is nothing here.
    expect(screen.getByText(WINDOW_EMPTY['all-time'])).toBeInTheDocument();
  });

  it('says where the window found them, not where the board seeded them', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        window: 'this-week',
        track: 'weekly',
        games: 6,
        wins: 4,
        losses: 2,
        reference: 1469,
      }),
    );

    expect(container.querySelector('.cn-seed-line')?.textContent).toBe(
      'Started the week at 1469, 6 games since.',
    );
    expect(screen.getByText(START_LABEL)).toBeInTheDocument();
  });
});
