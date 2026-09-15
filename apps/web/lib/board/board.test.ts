import { displayRating } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import { inChunks } from '../chunks';
import { closedWindow, formatWeekRange, type WindowKind, windowRange } from '../night';
import { displayDelta, formatWebDelta, provenRating } from '../ratingDisplay';
import { workedBoardRows, workedWindowRows } from '../testing/boardFixtures';
import { CHART_HEIGHT, CHART_WIDTH, chartGeometry } from './chart';
import {
  BOARD_LEGEND,
  gamesLabel,
  NOT_RATED,
  NOT_RATED_HINT,
  PROVEN_LABEL,
  RATING_LABEL,
  RECENT_RATING_LEGEND,
  SEED_LABEL,
  SETTLING_GAMES,
  SETTLING_SENTENCE,
  SETTLING_SENTENCE_PLAYER,
  SETTLING_SENTENCE_SHORT,
  START_LABEL,
  WINDOW_EMPTY,
  WINDOW_LABELS,
  windowSlotLine,
  winLossLabel,
} from './copy';
import { loadTopPlayers, loadTopPlayersOrNone } from './load';
import { compareBoardRows, sortBoardRows } from './order';
import { isRated, recentGames } from './recent';
import { currentStreak, formatStreak } from './streak';
import type { BoardRow } from './types';
import {
  LEADERBOARD_WINDOW,
  PLAYER_WINDOW,
  parseWindow,
  STATS_WINDOW,
  VERSUS_WINDOW,
  WINDOW_ORDER,
  windowHref,
  windowRangeLabel,
} from './window';

/**
 * The pure half of the board (M3.5, M3.8): the sort, the streak, the chart's geometry and the
 * copy product owns. Everything with a page around it is in `app/_board/*.test.tsx`; everything
 * with a database behind it is in `app/board.integration.test.ts`.
 */

/** The configured zone in every test that formats a window. */
const CAIRO = 'Africa/Cairo';

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    puuid: 'puuid-a',
    name: 'A',
    proven: 900,
    rating: 1_400,
    games: 40,
    wins: 20,
    losses: 20,
    sortKey: 15,
    streak: null,
    climb: null,
    settling: false,
    breakdown: [],
    ...overrides,
  };
}

describe('the copy product owns', () => {
  it('is the still-settling sentence, word for word', () => {
    expect(SETTLING_SENTENCE).toBe(
      'The board sorts on Proven: your rating, minus how unsure the board still is about you. That gap shrinks as you play and settles after about 30 games.',
    );
  });

  /**
   * The player page's twin (M3.26): the same two sentences, one pronoun moved, **no name**.
   * `/leaderboard` keeps the second-person string byte for byte, and neither may be edited
   * into the other.
   */
  it('is the third-person sentence the player page prints instead', () => {
    expect(SETTLING_SENTENCE_PLAYER).toBe(
      "The board sorts on Proven: a player's rating, minus how unsure the board still is about them. That gap shrinks as they play and settles after about 30 games.",
    );
    expect(SETTLING_SENTENCE_PLAYER).not.toContain(' you');
    expect(SETTLING_SENTENCE_PLAYER).not.toContain('your');
    // No name is interpolated: a nameless player is `Someone`, and a possessive per name is
    // not one rule.
    expect(SETTLING_SENTENCE_PLAYER).not.toContain('Someone');
  });

  it('is the short form Discord gets as a footer', () => {
    expect(SETTLING_SENTENCE_SHORT).toBe(
      'Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.',
    );
  });

  /**
   * **The gap shrinks; it never closes** (product, 2026-09-10). σ falls with every game and
   * does not reach zero, so a sentence that promises Proven will catch up — `stays below your
   * rating until…`, `catches up after…` — promises a day that never comes, and the reader who
   * waits for it asks the question the sentence exists to answer. `settles` is the word both
   * forms use, and it is the word the `settling` chip already says.
   */
  it('promises a gap that settles, never one that closes', () => {
    for (const sentence of [SETTLING_SENTENCE, SETTLING_SENTENCE_PLAYER, SETTLING_SENTENCE_SHORT]) {
      expect(sentence).toContain('settles');
      expect(sentence).not.toContain('until');
      expect(sentence).not.toContain('catches up');
    }
  });

  // M3.8's acceptance check: the number in the sentence is the threshold the marker uses.
  it('says the same number the marker switches off at', () => {
    expect(SETTLING_GAMES).toBe(30);
    expect(SETTLING_SENTENCE).toContain(`about ${SETTLING_GAMES} games`);
    expect(SETTLING_SENTENCE_PLAYER).toContain(`about ${SETTLING_GAMES} games`);
    expect(SETTLING_SENTENCE_SHORT).toContain(`about ${SETTLING_GAMES} games`);
  });

  it('never prints `1 games` on the row of the newest player', () => {
    expect(gamesLabel(0)).toBe('0 games');
    expect(gamesLabel(1)).toBe('1 game');
    expect(gamesLabel(28)).toBe('28 games');
    expect(winLossLabel(13, 15)).toBe('13W 15L');
  });

  /**
   * The five windows (M5.12, `05-design.md`'s copy table). The same five words are the option,
   * the board heading and the Discord title, and **a running window says `yet` while a closed
   * one does not** — nothing more is coming to last week.
   */
  it('names the five windows the way product spells them', () => {
    expect(Object.values(WINDOW_LABELS)).toEqual([
      'This week',
      'Last week',
      'This month',
      'Last month',
      'All time',
    ]);
    expect(WINDOW_ORDER.map((kind) => WINDOW_LABELS[kind])).toEqual(Object.values(WINDOW_LABELS));
  });

  it('has one empty line per window, and only the running ones say `yet`', () => {
    expect(WINDOW_EMPTY).toEqual({
      'this-week': 'No games this week yet.',
      'last-week': 'No games last week.',
      'this-month': 'No games this month yet.',
      'last-month': 'No games last month.',
      'all-time': 'No games yet.',
    });
    expect(WINDOW_EMPTY['this-week']).toContain('yet');
    expect(WINDOW_EMPTY['last-week']).not.toContain('yet');
    expect(WINDOW_EMPTY['last-month']).not.toContain('yet');
  });

  /**
   * **The word `season` leaves the friend-facing vocabulary entirely** with M5.12 and M5.14:
   * `No games this season yet.` and `No season is active…` are deleted, and nothing that
   * replaced them may put the word back.
   */
  it('says the word season nowhere a friend can read it', () => {
    const strings = [
      ...Object.values(WINDOW_LABELS),
      ...Object.values(WINDOW_EMPTY),
      SETTLING_SENTENCE,
      SETTLING_SENTENCE_PLAYER,
      SETTLING_SENTENCE_SHORT,
      NOT_RATED_HINT,
    ];

    for (const sentence of strings) expect(sentence.toLowerCase()).not.toContain('season');
  });

  /** The hairline is a seed over a whole history and a start over a window. Two words. */
  it('does not let a window borrow the word `seed`', () => {
    expect(SEED_LABEL).toBe('seed');
    expect(START_LABEL).toBe('start');
  });

  /**
   * **The legend is one word** (`05-design.md`, "Leaderboard row", amended 2026-09-09).
   * Right-aligned over the stacked pair, `Proven · Rating` put `Rating` over the Proven column
   * and `Proven` over nothing.
   */
  it('names the one unlabelled number and nothing else', () => {
    expect(BOARD_LEGEND).toBe(PROVEN_LABEL);
    expect(BOARD_LEGEND).not.toContain(RATING_LABEL);
    // The player page's own legend is the same word the seat rack uses, lower case.
    expect(RECENT_RATING_LEGEND).toBe('rating');
  });

  it('has one vocabulary for a game that moved nothing, and one sentence under it', () => {
    expect(NOT_RATED).toBe('not rated');
    expect(NOT_RATED_HINT).toBe(
      "Some games don't move ratings: too short, short a player, or added from match history and not counted yet.",
    );
  });
});

/**
 * `Recent games` lists the player's last five games, **rated or not** (M3.23, product
 * 2026-09-10): a game that landed unrated counts toward the five and prints `not rated` where
 * its rating would be. Everything the rating is folded from stays rated-only, which is the
 * loader's `played` array and not this function.
 */
describe('which games the recent list shows', () => {
  const game = (day: number, muAfter: number | null) => ({
    id: `game-${day}`,
    startedAt: `2026-09-0${day}T20:00:00.000Z`,
    muAfter,
  });

  it('takes the newest five of six, newest first, unrated among them', () => {
    const six = [
      game(1, 20),
      game(2, 21),
      // The one the fold refused, or a backfill nothing has rebuilt yet.
      game(3, null),
      game(4, 22),
      game(5, 23),
      game(6, 24),
    ];

    expect(recentGames(six, 5).map((row) => row.id)).toEqual([
      'game-6',
      'game-5',
      'game-4',
      'game-3',
      'game-2',
    ]);
    // In date order, with its `mu_after` still null: the row is what says so, not a filter.
    expect(recentGames(six, 5).map(isRated)).toEqual([true, true, true, false, true]);
  });

  it('sorts what it is given, because `game_players` comes back in no order', () => {
    const shuffled = [game(3, null), game(1, 20), game(2, 21)];

    expect(recentGames(shuffled, 5).map((row) => row.id)).toEqual(['game-3', 'game-2', 'game-1']);
  });

  it('is empty for a player with nothing to list', () => {
    expect(recentGames([], 5)).toEqual([]);
  });
});

describe('the board is ordered by Proven, descending', () => {
  it('never lets the primary column go up as you read down it', () => {
    const rows = workedBoardRows();

    expect(rows.map((entry) => entry.name)).toEqual([
      'Lena',
      'Bilal',
      'Rami',
      'Iris',
      'Karim',
      'Omar',
      'Hana',
      'Theo',
      'Nadia',
      'Yuki',
    ]);
    // The design doc's own arithmetic: Lena `34.80 - 2 * 4.50 = 25.80`, `* 60 = 1548`.
    expect(rows.map((entry) => entry.proven)).toEqual([
      1_548, 1_137, 1_062, 990, 987, 917, 882, 831, 654, 534,
    ]);
    for (const [index, entry] of rows.entries()) {
      expect(entry.proven).toBeLessThanOrEqual(rows[index - 1]?.proven ?? entry.proven);
    }
  });

  it('compresses: Proven is not Rating with a constant taken off it', () => {
    const rows = workedBoardRows();
    const by = (name: string): BoardRow => rows.find((entry) => entry.name === name) as BoardRow;

    // `05-design.md`: Iris and Karim land 3 points apart on Proven against a 27-point Rating
    // gap, which is why the number is `t-md` mono tabular and never abbreviated — `990` above
    // `987` has to read as ordered rather than as equal.
    expect(by('Iris').rating - by('Karim').rating).toBe(27);
    expect(by('Iris').proven - by('Karim').proven).toBe(3);

    // And Yuki is last by a wider margin than her rating suggests: her sigma is the second
    // highest in the room. That is the whole point of the column.
    expect(rows.at(-1)?.name).toBe('Yuki');
    expect(by('Nadia').rating - by('Yuki').rating).toBe(132);
    expect(by('Nadia').proven - by('Yuki').proven).toBe(120);
  });

  it('breaks a tie on Rating, then on the name a reader sees, then on the puuid', () => {
    const tied = sortBoardRows([
      row({ puuid: 'puuid-c', name: 'Cara', proven: 900, rating: 1_400 }),
      row({ puuid: 'puuid-a', name: 'Ali', proven: 900, rating: 1_400 }),
      row({ puuid: 'puuid-b', name: 'Bea', proven: 900, rating: 1_450 }),
    ]);

    expect(tied.map((entry) => entry.name)).toEqual(['Bea', 'Ali', 'Cara']);
  });

  it('keeps two nameless players in the same order between renders', () => {
    const a = row({ puuid: 'puuid-a', name: null });
    const b = row({ puuid: 'puuid-b', name: null });

    expect(compareBoardRows(a, b)).toBeLessThan(0);
    expect(compareBoardRows(b, a)).toBeGreaterThan(0);
  });

  it('puts a seeded player with no games at the bottom rather than filtering them out', () => {
    // An unranked seed is `mu 20, sigma 10`: ordinal 0, so Proven 0 and Rating 1200.
    const seeded = row({
      puuid: 'puuid-new',
      name: 'New',
      proven: 0,
      sortKey: 0,
      rating: 1_200,
      games: 0,
    });
    const rows = sortBoardRows([seeded, ...workedBoardRows()]);

    expect(rows.at(-1)?.name).toBe('New');
    expect(rows).toHaveLength(11);
  });

  it('keeps two rows below zero in their true order, both printing zero', () => {
    // Both display `0` — an Iron IV seed is `-160` unfloored — so the tie-break that decides
    // the page is the raw ordinal and not the name.
    const rows = sortBoardRows([
      row({ puuid: 'puuid-iron', name: 'Ali', proven: 0, sortKey: -2.66, rating: 840 }),
      row({ puuid: 'puuid-unranked', name: 'Zoe', proven: 0, sortKey: 0, rating: 1_200 }),
    ]);

    expect(rows.map((entry) => entry.name)).toEqual(['Zoe', 'Ali']);
    expect(rows.map((entry) => entry.proven)).toEqual([0, 0]);
    // Alphabetical order would have put Ali first: the sort is not reading the printed number.
    expect(rows[0]?.sortKey).toBeGreaterThan(rows[1]?.sortKey as number);
  });

  it('still never lets the printed column go up, with the floor in place', () => {
    const rows = sortBoardRows([
      row({ puuid: 'puuid-a', proven: 0, sortKey: -6 }),
      row({ puuid: 'puuid-b', proven: 300, sortKey: 5 }),
      row({ puuid: 'puuid-c', proven: 0, sortKey: -1 }),
    ]);

    const printed = rows.map((entry) => entry.proven);
    expect(printed).toEqual([300, 0, 0]);
    for (const [index, value] of printed.entries()) {
      expect(value).toBeLessThanOrEqual(printed[index - 1] ?? value);
    }
  });

  it('agrees with `provenRating`, which is the one place the number is computed', () => {
    expect(provenRating({ mu: 34.8, sigma: 4.5 })).toBe(1_548);
    expect(provenRating({ mu: 24.49, sigma: 4.6 })).toBe(917);
  });
});

describe('the streak column', () => {
  it('counts the run at the front of the list, newest first', () => {
    expect(currentStreak([false, false, true, false])).toEqual({ kind: 'L', length: 2 });
    expect(currentStreak([true, true, true])).toEqual({ kind: 'W', length: 3 });
    expect(currentStreak([true, false])).toEqual({ kind: 'W', length: 1 });
  });

  it('is nothing at all for a player who has not played', () => {
    expect(currentStreak([])).toBeNull();
  });

  it('prints as `L2`', () => {
    expect(formatStreak({ kind: 'L', length: 2 })).toBe('L2');
    expect(formatStreak({ kind: 'W', length: 11 })).toBe('W11');
  });
});

/**
 * The rail's read, on the tonight page (M3.19, reviewer).
 *
 * The tonight page is the one a friend opens from WhatsApp at 21:40 to find out whether the
 * night is happening. It gained four board queries when the rail arrived, and a page that 500s
 * because a sidebar could not be read is a worse page than one with an empty sidebar.
 */
describe('the rail board read', () => {
  /** A client whose very first call fails, the way a timed-out season lookup would. */
  const broken = {
    from() {
      throw new Error('boom');
    },
  } as unknown as Parameters<typeof loadTopPlayersOrNone>[0];

  it('is an empty rail and one log line, not a failed page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(loadTopPlayersOrNone(broken, { limit: 5, window: 'this-week' })).resolves.toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);

    logged.mockRestore();
  });

  it('still throws for anybody who asks for the board itself', async () => {
    // `/leaderboard` is the board: an empty page there would be a lie, so the unguarded read is
    // what that page uses and this guard is the rail's alone.
    await expect(loadTopPlayers(broken, { limit: 5, window: 'this-week' })).rejects.toThrow();
  });
});

describe('the rating chart', () => {
  it('draws nothing for a player with no history', () => {
    expect(chartGeometry([], 1_200)).toBeNull();
  });

  it('plots the series across the full width, oldest at the left', () => {
    const geometry = chartGeometry([1_200, 1_300, 1_250], 1_200);

    expect(geometry?.path.startsWith('M0,')).toBe(true);
    expect(geometry?.path).toContain(`L${CHART_WIDTH},`);
    expect(geometry?.path.split(' ')).toHaveLength(3);
    expect(geometry?.width).toBe(CHART_WIDTH);
    expect(geometry?.height).toBe(CHART_HEIGHT);
  });

  it('pads the range by 5% so the highest and lowest points are not on the edge', () => {
    const geometry = chartGeometry([1_000, 1_100], 1_050);

    expect(geometry?.low).toBeCloseTo(995, 5);
    expect(geometry?.high).toBeCloseTo(1_105, 5);
  });

  /**
   * The pad on the widened side is **0.15 of the span**, not the series' own 0.05 (the
   * designer's M3.5 review): at 5% the hairline landed two or three pixels inside a 140px plot,
   * under the edge of the stroke, with its `seed` label half off the box.
   */
  it('pads the side the seed widened by 0.15 of the span', () => {
    // Series 1400–1500 pads to 1395–1505; the seed at 1200 then takes the low edge, and the
    // low edge is padded by 0.15 of what is left above it.
    const geometry = chartGeometry([1_400, 1_500], 1_200);

    expect(geometry?.low).toBeCloseTo(1_200 - (1_505 - 1_200) * 0.15, 5);
    // Comfortably inside the plot, not on its boundary.
    expect(geometry?.seedPercent).toBeLessThan(90);
    expect(geometry?.seedPercent).toBeGreaterThan(10);
  });

  it('keeps the seed line inside the range even when that widens it', () => {
    const below = chartGeometry([1_400, 1_500], 1_200);
    expect(below?.low).toBeLessThan(1_200);
    expect(below?.seedY).toBeLessThan(CHART_HEIGHT);
    expect(below?.seedY).toBeGreaterThan(0);

    const above = chartGeometry([1_000, 1_050], 1_400);
    expect(above?.high).toBeGreaterThan(1_400);
    expect(above?.seedY).toBeGreaterThan(0);
    expect(above?.seedPercent).toBeGreaterThan(0);
    expect(above?.seedPercent).toBeLessThan(100);
  });

  it('draws a flat rating as a line rather than dividing by zero', () => {
    const geometry = chartGeometry([1_200, 1_200, 1_200], 1_200);

    expect(geometry?.path).toBe('M0,70 L160,70 L320,70');
    expect(geometry?.seedY).toBe(70);
  });

  it('puts a higher rating higher up the box', () => {
    const geometry = chartGeometry([1_000, 1_500], 1_200);
    const [first, last] = (geometry?.path ?? '').split(' ');

    const y = (point: string | undefined): number => Number((point ?? '').split(',')[1]);
    expect(y(last)).toBeLessThan(y(first));
  });
});

/**
 * The window parameter (M5.12). The boundaries are `lib/night.test.ts`'s; this is the reading
 * of a URL, the three defaults and the link behind an option.
 */
describe('the window a page is read through', () => {
  it('defaults per page: the board opens on the week, a person on all time, stats on the month, 1v1 on all time', () => {
    expect(LEADERBOARD_WINDOW).toBe('this-week');
    expect(PLAYER_WINDOW).toBe('all-time');
    expect(STATS_WINDOW).toBe('this-month');
    expect(VERSUS_WINDOW).toBe('all-time');
  });

  it('takes the page default when the parameter is absent', () => {
    expect(parseWindow(undefined, LEADERBOARD_WINDOW)).toBe('this-week');
    expect(parseWindow(undefined, PLAYER_WINDOW)).toBe('all-time');
  });

  it('takes any of the five, spelled the way the URL spells them', () => {
    for (const kind of WINDOW_ORDER) expect(parseWindow(kind, LEADERBOARD_WINDOW)).toBe(kind);
  });

  /**
   * **An unknown value is `null`, which every page turns into a 404** — never a silent
   * fallback to the default. It can only come from a typed or mangled URL, and a page that
   * quietly showed a different window than the URL names is a page whose links cannot be
   * trusted.
   */
  it('refuses anything that is not one of the five, including a repeated parameter', () => {
    expect(parseWindow('this-year', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('This week', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('season-1', LEADERBOARD_WINDOW)).toBeNull();
    // `?window=this-week&window=all-time` arrives as an array and is not one of the five.
    expect(parseWindow(['this-week', 'all-time'], LEADERBOARD_WINDOW)).toBeNull();
  });

  it('links every option, the page default included, so a copied URL says which board it is', () => {
    expect(windowHref('/leaderboard', 'last-week')).toBe('/leaderboard?window=last-week');
    expect(windowHref('/leaderboard', 'this-week')).toBe('/leaderboard?window=this-week');
    expect(windowHref('/p/puuid-a', 'all-time')).toBe('/p/puuid-a?window=all-time');
    expect(windowHref('/games', 'this-week', { p: 'u-lena' })).toBe('/games?window=this-week&p=u-lena');
  });
});

/**
 * The window line on a row: `6 games · 4W 2L · +58` (M5.12).
 *
 * The change is `displayDelta` over the window's first and last counted game — the difference
 * of two **displayed** numbers, `00-product.md`'s rule — and it is asserted through
 * `lib/ratingDisplay.ts` here rather than recomputed, which is the acceptance check.
 */
describe('what a window did to a row', () => {
  it('is the two displayed ratings subtracted, never the raw mu difference', () => {
    const climb = workedWindowRows()[0]?.climb as { muBefore: number; muAfter: number };

    expect(displayDelta(climb.muBefore, climb.muAfter)).toBe(58);
    expect(formatWebDelta(displayDelta(climb.muBefore, climb.muAfter))).toBe('+58');
    // The rule, spelled out: round both, then subtract.
    expect(displayDelta(climb.muBefore, climb.muAfter)).toBe(
      displayRating(climb.muAfter) - displayRating(climb.muBefore),
    );
  });

  it('keeps a week that lost less than half a point pointing down', () => {
    // `-0` is a real value on this row and it is why the pair of mu values travels instead of
    // a formatted string: `JSON.stringify` would turn it into `0` and print `+0`.
    expect(formatWebDelta(displayDelta(23.9, 23.896))).toBe('−0');
  });

  it('carries no streak, because product fixed the line without one', () => {
    for (const row of workedWindowRows()) {
      expect(row.streak).toBeNull();
      expect(row.games).toBe(6);
      expect(`${gamesLabel(row.games)} · ${winLossLabel(row.wins, row.losses)}`).toBe('6 games · 4W 2L');
    }
  });

  /** The sort is the window's only untouched thing: Proven descending, on every window. */
  it('does not reorder a window by who climbed most in it', () => {
    const rows = workedWindowRows();
    const climber = { ...(rows.at(-1) as (typeof rows)[number]), climb: { muBefore: 20, muAfter: 26 } };
    const sorted = sortBoardRows([climber, ...rows.slice(0, -1)]);

    // Yuki climbed 360 display points and is still last, because Proven is what sorts.
    expect(sorted.at(-1)?.name).toBe('Yuki');
    expect(sorted[0]?.name).toBe('Lena');
  });
});

/**
 * **A PostgREST filter is a URL** (M5.12, 2026-09-10). Reading a busy week's board against a
 * database with a few hundred players answered `414 URI too long` from the gateway before
 * Postgres saw the query — the board's `in (…)` lists had no cap on them. Three reads chunk
 * now: the players on a window's board, their `ratings` rows, and the scoreboard rows.
 */
describe('the id lists the board filters on', () => {
  const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => `id-${index}`);

  it('asks for nothing when there is nothing to ask for', () => {
    expect(inChunks([])).toEqual([]);
  });

  it('keeps a group-sized list as one request', () => {
    expect(inChunks(ids(20))).toHaveLength(1);
  });

  it('splits a list no URL would carry, losing nobody', () => {
    const chunks = inChunks(ids(275));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 90)).toBe(true);
    expect(chunks.flat()).toEqual(ids(275));
  });

  it('asks for each id once, however many times a scoreboard names it', () => {
    expect(inChunks(['a', 'b', 'a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
  });
});

/**
 * The header slot (M5.12, the designer's slot; `05-design.md`'s copy table). One line under the
 * picker: what the window covers and how many games are in it, or — when there are none — the
 * window's own empty sentence, never both.
 */
describe('the line under the picker', () => {
  /** Wednesday 2026-09-09, 21:00 Cairo. */
  const now = new Date('2026-09-09T18:00:00Z');
  const label = (kind: WindowKind, firstCountedAt: Date | null = null) =>
    windowRangeLabel(kind, windowRange(kind, now, CAIRO), firstCountedAt, CAIRO);

  it('names each of the five the way product spells it', () => {
    expect(label('this-week')).toBe('Monday 7 Sep to Sunday 13 Sep');
    expect(label('last-week')).toBe('Monday 31 Aug to Sunday 6 Sep');
    expect(label('this-month')).toBe('September');
    expect(label('last-month')).toBe('August');
    expect(label('all-time', new Date('2025-09-08T18:00:00Z'))).toBe('Since 8 Sep 2025');
  });

  /** Only `All time` can fail to have a date, and only on a database with no counted game. */
  it('has nothing to date all time from until a game has been played', () => {
    expect(label('all-time')).toBeNull();
    expect(label('this-week')).not.toBeNull();
  });

  it('assembles the range and the count, and never `1 games`', () => {
    expect(windowSlotLine('Monday 1 Sep to Sunday 7 Sep', 14)).toBe(
      'Monday 1 Sep to Sunday 7 Sep · 14 games',
    );
    expect(windowSlotLine('September', 34)).toBe('September · 34 games');
    expect(windowSlotLine('Since 8 Sep 2025', 312)).toBe('Since 8 Sep 2025 · 312 games');
    expect(windowSlotLine('Monday 1 Sep to Sunday 7 Sep', 1)).toBe('Monday 1 Sep to Sunday 7 Sep · 1 game');
  });

  /**
   * **The week form is M5.10's post description byte for byte.** The Monday post and the board
   * a tap later have to say the same words, so there is one formatter and this is the test that
   * says so.
   */
  it('is the same string the closed week posts itself under', () => {
    const week = closedWindow('last-week', now, CAIRO);

    expect(windowRangeLabel('last-week', windowRange('last-week', now, CAIRO), null, CAIRO)).toBe(
      formatWeekRange(week.start, week.end, CAIRO),
    );
  });
});
