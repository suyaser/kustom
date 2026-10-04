import { displayKustom, SETTLING_GAMES } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import { inChunks } from '../chunks';
import { SETTLING_FOOTER } from '../discord/embeds';
import { formatMinutes } from '../games/duration';
import { closedWindow, formatWeekRange, type WindowKind, windowRange } from '../night';
import { displayDelta, formatWebDelta } from '../ratingDisplay';
import { settlingRow, workedBoardRows, workedWindowRows } from '../testing/boardFixtures';
import { CHART_HEIGHT, CHART_WIDTH, chartGeometry } from './chart';
import {
  ACE_LABEL,
  BOARD_EMPTY,
  gamesLabel,
  MVP_EXPLANATION,
  MVP_LABEL,
  NOT_RATED_HINT,
  notPlayedLine,
  RATING_EXPLANATION,
  RATING_LABEL,
  SETTLING_SECTION_LINE,
  SETTLING_SECTION_TITLE,
  settlingChip,
  WEEK_BOARD_SENTENCE_SHORT,
  WEEK_PLAYER_SENTENCE,
  WINDOW_EMPTY,
  WINDOW_LABELS,
  windowSlotLine,
  winLossLabel,
  winLossParts,
} from './copy';
import { loadTopPlayers, loadTopPlayersOrNone } from './load';
import { boardSections, parseBoardPage, parseBoardSort, sortBoardRows, sortSection } from './order';
import { isRated, recentGames } from './recent';
import { currentStreak, formatStreak } from './streak';
import type { BoardRow } from './types';
import {
  LEADERBOARD_WINDOW,
  PLAYER_WINDOW,
  parseWindow,
  STATS_WINDOW,
  WINDOW_ORDER,
  windowHref,
  windowRangeLabel,
} from './window';

/**
 * The pure half of the board (M3.5; one Rating and the settling section since M14.15): the sort,
 * the sections, the streak, the chart's geometry and the copy product owns. Everything with a page around it is in `app/_board/*.test.tsx`; everything
 * with a database behind it is in `app/board.integration.test.ts`.
 */

/** The configured zone in every test that formats a window. */
const CAIRO = 'Africa/Cairo';

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    puuid: 'puuid-a',
    name: 'A',
    track: 'all-time',
    points: null,
    rating: 1_400,
    games: 40,
    wins: 20,
    losses: 20,
    ratedGames: 40,
    sortKey: 23.33,
    climb: null,
    settling: false,
    settlingChip: false,
    awards: [],
    ...overrides,
  };
}

describe('the copy product owns (M14.15, STRATEGY §5)', () => {
  it('counts settling with core, never a literal 30', () => {
    expect(SETTLING_GAMES).toBe(10);
    expect(settlingChip(4)).toBe('settling · 4/10');
    expect(settlingChip(0)).toBe('settling · 0/10');
  });

  it('is the settling section line, word for word, the same as the Discord board post', () => {
    expect(SETTLING_SECTION_TITLE).toBe('Still settling');
    expect(SETTLING_SECTION_LINE).toBe(
      "New players' ratings move fast at first. They get a rank after 10 games.",
    );
    expect(SETTLING_SECTION_LINE).toBe(SETTLING_FOOTER);
  });

  it('is the empty board line, word for word', () => {
    expect(BOARD_EMPTY).toBe("No rated games yet. The board fills in after your first Summoner's Rift game.");
  });

  it('counts the people under the board, `yet` only on a running window', () => {
    expect(notPlayedLine(9, 'all-time')).toBe("+ 9 people who haven't played a rated game yet.");
    expect(notPlayedLine(1, 'all-time')).toBe("+ 1 person who hasn't played a rated game yet.");
    expect(notPlayedLine(3, 'this-week')).toBe("+ 3 people who haven't played a rated game this week yet.");
    expect(notPlayedLine(3, 'last-week')).toBe("+ 3 people who haven't played a rated game last week.");
  });

  it('says Proven, ordinal and the word season nowhere a friend can read', () => {
    const strings = [
      RATING_LABEL,
      SETTLING_SECTION_LINE,
      BOARD_EMPTY,
      WEEK_BOARD_SENTENCE_SHORT,
      WEEK_PLAYER_SENTENCE,
      NOT_RATED_HINT,
      RATING_EXPLANATION,
      MVP_EXPLANATION,
      ...Object.values(WINDOW_LABELS),
      ...Object.values(WINDOW_EMPTY),
      notPlayedLine(2, 'all-time'),
      settlingChip(3),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/proven|ordinal|season/i);
    }
  });

  it('never prints `1 games`', () => {
    expect(gamesLabel(1)).toBe('1 game');
    expect(gamesLabel(2)).toBe('2 games');
    expect(winLossLabel(3, 1)).toBe('3W 1L');
  });

  it('splits the record into the same four tokens the label prints (the share card, M14.25)', () => {
    const parts = winLossParts(13, 15);
    expect(parts).toEqual([{ num: '13' }, { word: 'W' }, { num: '15' }, { word: 'L' }]);
    const text = (part: (typeof parts)[number]) => ('num' in part ? part.num : part.word);
    const [wins, w, losses, l] = parts.map(text);
    expect(`${wins}${w} ${losses}${l}`).toBe(winLossLabel(13, 15));
  });

  it('prints a game length in minutes, never as a clock', () => {
    expect(formatMinutes(1_306)).toBe('21 min');
    expect(formatMinutes(20)).toBe('1 min');
  });

  it('names the MVP and the ACE in two words', () => {
    expect(MVP_LABEL).toBe('MVP');
    expect(ACE_LABEL).toBe('ACE');
  });

  it('names the three windows the way product spells them, and no month (M14.48)', () => {
    expect(WINDOW_ORDER.map((kind) => WINDOW_LABELS[kind])).toEqual(['This week', 'Last week', 'All time']);
    expect(Object.values(WINDOW_LABELS).join(' ')).not.toMatch(/month/i);
  });
});

/**
 * `Recent games` lists the player's last five games, **rated or not** (M3.23, product
 * 2026-09-10): a game that landed unrated counts toward the five and prints `not rated` where
 * its rating would be. Everything the rating is folded from stays rated-only, which is the
 * loader's `played` array and not this function.
 */
describe('which games the recent list shows', () => {
  const game = (day: number, rAfter: number | null) => ({
    id: `game-${day}`,
    startedAt: `2026-09-0${day}T20:00:00.000Z`,
    rated: rAfter !== null,
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
    // In date order, with its `r_after` still null: the row is what says so, not a filter.
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

describe('the board is ordered by Rating, the number it prints (M14.15)', () => {
  it('never lets the printed Rating go up as you read down a section', () => {
    const rows = workedBoardRows();
    for (let index = 1; index < rows.length; index += 1) {
      expect((rows[index - 1] as BoardRow).rating).toBeGreaterThanOrEqual((rows[index] as BoardRow).rating);
    }
  });

  /**
   * The audit's case: under the old Proven sort a 1361 sat below a 1287, because the board ordered
   * on `mu - 2σ` and printed `mu`. Real-shaped: a confident 1287 and an unsure 1361, both ranked.
   */
  it('puts the 1361 above the 1287, whatever their uncertainty', () => {
    const steady = row({
      puuid: 'p-steady',
      name: 'PRT Khokha',
      rating: 1_287,
      sortKey: 21.45,
      ratedGames: 83,
    });
    const unsure = row({ puuid: 'p-unsure', name: 'knifiy', rating: 1_361, sortKey: 22.68, ratedGames: 12 });
    expect(sortBoardRows([steady, unsure]).map((entry) => entry.rating)).toEqual([1_361, 1_287]);
  });

  it('breaks a tie on Rating with the unrounded mu, then the name a reader sees, then the puuid', () => {
    const a = row({ puuid: 'p-a', name: 'Zed', rating: 1_400, sortKey: 23.34 });
    const b = row({ puuid: 'p-b', name: 'Ann', rating: 1_400, sortKey: 23.31 });
    const c = row({ puuid: 'p-c', name: 'Ann', rating: 1_400, sortKey: 23.31 });
    expect(sortBoardRows([c, b, a]).map((entry) => entry.puuid)).toEqual(['p-a', 'p-b', 'p-c']);
    const nameless = [row({ puuid: 'p-2', name: null }), row({ puuid: 'p-1', name: null })];
    expect(sortBoardRows(nameless).map((entry) => entry.puuid)).toEqual(['p-1', 'p-2']);
  });

  it('puts a 9-game player in settling and a 10-game player in the ranked list', () => {
    const nine = settlingRow(row({ puuid: 'p-nine', rating: 1_700, sortKey: 28.3 }), 9);
    const ten = settlingRow(row({ puuid: 'p-ten', rating: 1_250, sortKey: 20.8 }), 10);
    expect(nine.settling).toBe(true);
    expect(ten.settling).toBe(false);
    const { ranked, settling } = boardSections([nine, ten]);
    expect(ranked.map((entry) => entry.puuid)).toEqual(['p-ten']);
    expect(settling.map((entry) => entry.puuid)).toEqual(['p-nine']);
    // The settling section is always below, however high its Rating.
    expect(sortBoardRows([nine, ten]).map((entry) => entry.puuid)).toEqual(['p-ten', 'p-nine']);
  });

  it('re-sorts a section by games or win rate on request, ties keeping the board order', () => {
    const a = row({ puuid: 'p-a', rating: 1_500, sortKey: 25, games: 10, wins: 9, losses: 1 });
    const b = row({ puuid: 'p-b', rating: 1_400, sortKey: 23.3, games: 30, wins: 15, losses: 15 });
    const c = row({ puuid: 'p-c', rating: 1_300, sortKey: 21.7, games: 30, wins: 20, losses: 10 });
    expect(sortSection([c, b, a], 'rating').map((entry) => entry.puuid)).toEqual(['p-a', 'p-b', 'p-c']);
    expect(sortSection([c, b, a], 'games').map((entry) => entry.puuid)).toEqual(['p-b', 'p-c', 'p-a']);
    expect(sortSection([c, b, a], 'winrate').map((entry) => entry.puuid)).toEqual(['p-a', 'p-c', 'p-b']);
  });

  it('reads `?sort=` and `?page=` and falls back on anything else', () => {
    expect(parseBoardSort(undefined)).toBe('rating');
    expect(parseBoardSort('games')).toBe('games');
    expect(parseBoardSort('winrate')).toBe('winrate');
    expect(parseBoardSort('ordinal')).toBe('rating');
    expect(parseBoardSort(['games', 'rating'])).toBe('rating');
    expect(parseBoardPage('2')).toBe(2);
    expect(parseBoardPage('0')).toBe(1);
    expect(parseBoardPage('-3')).toBe(1);
    expect(parseBoardPage('abc')).toBe(1);
    expect(parseBoardPage(undefined)).toBe(1);
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
  /** A client whose very first call fails, the way a timed-out lookup would. */
  const broken = {
    from() {
      throw new Error('boom');
    },
  } as unknown as Parameters<typeof loadTopPlayersOrNone>[0];

  it('is an empty rail and one rail log line, not a failed page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      loadTopPlayersOrNone(broken, { limit: 5, window: 'this-week', groupId: 'g' }),
    ).resolves.toEqual([]);
    // The board's reads run side by side (app-perf), so the roster labels, which fail soft on their
    // own, may log their line too; the rail logs exactly once.
    const rail = logged.mock.calls.filter(
      ([message]) => message === 'tonight: reading the rail board failed',
    );
    expect(rail).toHaveLength(1);
    expect(logged.mock.calls.length).toBeLessThanOrEqual(2);

    logged.mockRestore();
  });

  it('still throws for anybody who asks for the board itself', async () => {
    // `/leaderboard` is the board: an empty page there would be a lie, so the unguarded read is
    // what that page uses and this guard is the rail's alone.
    await expect(loadTopPlayers(broken, { limit: 5, window: 'this-week', groupId: 'g' })).rejects.toThrow();
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
  it('defaults per page: the board opens on the week, a person and every Stats segment on all time', () => {
    expect(LEADERBOARD_WINDOW).toBe('this-week');
    expect(PLAYER_WINDOW).toBe('all-time');
    expect(STATS_WINDOW).toBe('all-time');
  });

  it('takes the page default when the parameter is absent', () => {
    expect(parseWindow(undefined, LEADERBOARD_WINDOW)).toBe('this-week');
    expect(parseWindow(undefined, PLAYER_WINDOW)).toBe('all-time');
  });

  it('takes any of the three, spelled the way the URL spells them', () => {
    for (const kind of WINDOW_ORDER) expect(parseWindow(kind, LEADERBOARD_WINDOW)).toBe(kind);
  });

  /**
   * **An unknown value is `null`, which every page turns into a 404** — never a silent
   * fallback to the default. It can only come from a typed or mangled URL, and a page that
   * quietly showed a different window than the URL names is a page whose links cannot be
   * trusted.
   */
  it('refuses anything that is not one of the three, including a repeated parameter', () => {
    expect(parseWindow('this-year', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('This week', LEADERBOARD_WINDOW)).toBeNull();
    expect(parseWindow('season-1', LEADERBOARD_WINDOW)).toBeNull();
    // `?window=this-week&window=all-time` arrives as an array and is not one of the three.
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
  it('is the two displayed Ratings subtracted, never the raw difference', () => {
    const climb = workedWindowRows('all-time')[0]?.climb as { rBefore: number; rAfter: number };

    expect(displayDelta(climb.rBefore, climb.rAfter)).toBe(58);
    expect(formatWebDelta(displayDelta(climb.rBefore, climb.rAfter))).toBe('+58');
    // The rule, spelled out: round both, then subtract.
    expect(displayDelta(climb.rBefore, climb.rAfter)).toBe(
      displayKustom(climb.rAfter) - displayKustom(climb.rBefore),
    );
  });

  it('keeps a week that lost less than half a point pointing down', () => {
    // `-0` is a real value on this row and it is why the pair of Ratings travels instead of
    // a formatted string: `JSON.stringify` would turn it into `0` and print `+0`.
    expect(formatWebDelta(displayDelta(1434.2, 1434.1))).toBe('−0');
  });

  it('prints the window line, games and record', () => {
    for (const row of workedWindowRows()) {
      expect(row.games).toBe(6);
      expect(`${gamesLabel(row.games)} · ${winLossLabel(row.wins, row.losses)}`).toBe('6 games · 4W 2L');
    }
  });

  /** The sort is Rating on every window, never who climbed most in it. */
  it('does not reorder a window by who climbed most in it', () => {
    const rows = workedWindowRows();
    const climber = { ...(rows.at(-1) as (typeof rows)[number]), climb: { rBefore: 1200, rAfter: 1560 } };
    const sorted = sortBoardRows([climber, ...rows.slice(0, -1)]);

    // Yuki climbed 360 display points and is still last, because Rating is what sorts.
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
 *
 * **Since M7.18 this block covers the *played*-count form only** — `windowSlotLine`, which
 * `/stats`, `/fun` and `/games` print. The board's own `boardSlotLine` (`· 12 rated games`) is
 * pinned in `lib/board/counts.test.ts` and in `app/_board/BoardView.test.tsx`, not here.
 */
describe('the line under the picker', () => {
  /** Wednesday 2026-09-09, 21:00 Cairo. */
  const now = new Date('2026-09-09T18:00:00Z');
  const label = (kind: WindowKind, firstCountedAt: Date | null = null) =>
    windowRangeLabel(kind, windowRange(kind, now, CAIRO), firstCountedAt, CAIRO);

  it('names each of the three the way product spells it', () => {
    expect(label('this-week')).toBe('Sunday 6 Sep to Saturday 12 Sep');
    expect(label('last-week')).toBe('Sunday 30 Aug to Saturday 5 Sep');
    // `first game`, never `Since`: that word belongs to a ratings reset (M14.42).
    expect(label('all-time', new Date('2025-09-08T18:00:00Z'))).toBe('first game 8 Sep 2025');
  });

  /** Only `All time` can fail to have a date, and only on a database with no counted game. */
  it('has nothing to date all time from until a game has been played', () => {
    expect(label('all-time')).toBeNull();
    expect(label('this-week')).not.toBeNull();
  });

  it('assembles the range and the count, and never `1 games`', () => {
    expect(windowSlotLine('Sunday 6 Sep to Saturday 12 Sep', 14)).toBe(
      'Sunday 6 Sep to Saturday 12 Sep · 14 games',
    );
    expect(windowSlotLine('September', 34)).toBe('September · 34 games');
    expect(windowSlotLine('first game 8 Sep 2025', 312)).toBe('first game 8 Sep 2025 · 312 games');
    expect(windowSlotLine('Sunday 6 Sep to Saturday 12 Sep', 1)).toBe(
      'Sunday 6 Sep to Saturday 12 Sep · 1 game',
    );
  });

  /**
   * **The week form is M5.10's post description byte for byte.** The Sunday post and the board
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
