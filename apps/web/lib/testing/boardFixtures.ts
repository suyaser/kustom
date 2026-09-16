import { displayRating, seedFromRank } from '@customs/core';
import { SETTLING_GAMES } from '../board/copy';
import { sortBoardRows } from '../board/order';
import type { BoardGame, BoardRow, BoardView, PlayerBoardView, RecentGame } from '../board/types';
import type { WindowKind } from '../night';
import { provenRating, provenSortKey } from '../ratingDisplay';
import { CURSED_DUO, MOST_IMPROVED } from '../stats/copy';
import type { PartnerRecord, PlayerStatsView } from '../stats/types';
import { WORKED_ROSTER, workedPuuid } from './workedExample';

/**
 * The worked example as `/leaderboard` and `/p/[puuid]` see it (M3.5).
 *
 * The same ten friends and the same `mu`/`sigma` as every other fixture in this repo, so the
 * Proven numbers here are the ones printed in `docs/05-design.md`'s nightly embed — Lena
 * `1548`, Nadia `654`, Yuki `534` — and a snapshot of the embed is comparable with the design
 * doc line for line. Nothing is hand-computed: `provenRating` and `displayRating` do it.
 *
 * The game counts are the design doc's illustrative ones (the docs pin none), which is what
 * puts Nadia and Yuki under thirty and therefore under the `settling` chip.
 */

export const WORKED_GAMES: Readonly<Record<string, number>> = {
  Lena: 41,
  Bilal: 44,
  Rami: 39,
  Iris: 38,
  Karim: 40,
  Omar: 42,
  Hana: 37,
  Theo: 38,
  Nadia: 28,
  Yuki: 24,
};

/** Half their games, rounded: illustrative, like the counts. Nothing in the docs pins wins. */
function workedWins(games: number): number {
  return Math.round(games / 2);
}

/** The rank every fixture player is seeded from: Silver II, the roster's own middle. */
const SEED_TIER = 'SILVER';
const SEED_DIVISION = 'II';

export function workedBoardRows(): BoardRow[] {
  return sortBoardRows(
    WORKED_ROSTER.map((player) => {
      const games = WORKED_GAMES[player.name] ?? 0;
      const wins = workedWins(games);
      return {
        puuid: workedPuuid(player.name),
        name: player.name,
        track: 'all-time' as const,
        proven: provenRating({ mu: player.mu, sigma: player.sigma }),
        sortKey: provenSortKey({ mu: player.mu, sigma: player.sigma }),
        rating: displayRating(player.mu),
        games,
        wins,
        losses: games - wins,
        streak: games === 0 ? null : ({ kind: 'L', length: 2 } as const),
        climb: null,
        settling: games < SETTLING_GAMES,
        breakdown: [],
        // `All time` hands out no award (M5.4), so this board carries none.
        awards: [],
      };
    }),
  );
}

export function workedBoard(overrides: Partial<BoardView> = {}): BoardView {
  const rows = overrides.rows ?? workedBoardRows();
  return {
    window: 'all-time',
    rows,
    // The group's first night, and the fold's own count of what it has played since.
    range: 'Since 8 Sep 2025',
    games: 312,
    ...overrides,
  };
}

/**
 * The same ten as one **window's** board (M5.12): six games each, a 4W 2L record, and a climb
 * that is a real pair of mu values rather than a formatted number — the row computes the delta
 * at render, like every other delta in this product.
 *
 * **Two shapes, because there are two tracks** (M7.3). A month window is the stored fold, sorted
 * and printed on Proven, byte-identical to what M5.12 shipped. A week window is the weekly
 * track: the same ten `mu` values read as the week's own fold, so the row prints `Rating`,
 * orders on the raw weekly `mu`, carries no `settling` chip, and climbs from its weekly seed.
 */
export function workedWindowRows(window: WindowKind = 'this-week'): BoardRow[] {
  const weekly = window === 'this-week' || window === 'last-week';

  return sortBoardRows(
    WORKED_ROSTER.map((player) => {
      const rating = { mu: player.mu, sigma: player.sigma };
      return {
        puuid: workedPuuid(player.name),
        name: player.name,
        track: weekly ? ('weekly' as const) : ('all-time' as const),
        proven: provenRating(rating),
        // The number the board sorted on, unrounded: the weekly `mu` on a week, the `ordinal`
        // on a month.
        sortKey: weekly ? rating.mu : provenSortKey(rating),
        rating: displayRating(player.mu),
        games: 6,
        wins: 4,
        losses: 2,
        streak: null,
        // +58 at the display multiplier of 60: `mu` 23.9 to 24.87 is 1434 to 1492.
        climb: { muBefore: 23.9, muAfter: 24.87 },
        // No chip on a week, ever (M7.3); the all-time count still decides it on a month.
        settling: weekly ? false : (WORKED_GAMES[player.name] ?? 0) < SETTLING_GAMES,
        breakdown: [],
        /**
         * **No badge unless a test asks for one** (M8.3). Only a closed window hands an award
         * out, and even there most rows win nothing: the default board is the board as it was
         * before the badges existed, which is what the byte-identity tests read.
         * {@link badgedWindowRows} is the fixture for the other case.
         */
        awards: [],
      };
    }),
  );
}

/**
 * The same window's board with the awards handed out (M8.3): `Most improved` to one row and
 * `Cursed duo` to both halves of a pair — so the fixture holds a row with two badges, a row with
 * one, and eight with none, which is the shape of an ordinary closed week.
 *
 * The titles come from `lib/stats/copy.ts`, the same constants `awardsView` labels its blocks
 * with; the awards themselves are not computed here, because a board fixture is what the page
 * does with an answer and never how the answer was reached.
 */
export function badgedWindowRows(window: WindowKind = 'last-week'): BoardRow[] {
  const won: Readonly<Record<string, readonly string[]>> = {
    [workedPuuid('Nadia')]: [MOST_IMPROVED, CURSED_DUO],
    [workedPuuid('Yuki')]: [CURSED_DUO],
  };

  return workedWindowRows(window).map((row) => ({ ...row, awards: won[row.puuid] ?? [] }));
}

export function workedWindowBoard(window: WindowKind = 'this-week'): BoardView {
  return {
    window,
    rows: workedWindowRows(window),
    // The week `05-design.md`'s copy table prints, and the count the ten rows add up to.
    range:
      window === 'this-month' || window === 'last-month' ? 'September' : 'Sunday 6 Sep to Saturday 12 Sep',
    games: 6,
  };
}

/** The same board with nothing in the window: the slot prints the sentence and no card. */
export function emptyWindowBoard(window: WindowKind = 'last-week'): BoardView {
  return { window, rows: [], range: null, games: 0 };
}

/** One player's page, built from the same roster. `Hana` by default: 37 games, no chip. */
export function workedPlayer(name = 'Hana', overrides: Partial<PlayerBoardView> = {}): PlayerBoardView {
  const player = WORKED_ROSTER.find((entry) => entry.name === name);
  if (player === undefined) throw new Error(`no worked player called ${name}`);

  const games = WORKED_GAMES[name] ?? 0;
  const wins = workedWins(games);
  const rating = displayRating(player.mu);
  // A player seeded under the **old** rank rule, which is what a stored row folded before
  // 2026-09-16's re-seed was: the chart's hairline sits at the number that rank gave. The fixture
  // keeps that shape on purpose — a seed number that is *not* 1200 is what makes the copy tests
  // prove the seed line interpolates the fold's own number rather than printing a constant. The
  // rank itself is not a field on the view any more (M7.20); only the number it produced is here.
  const seed = displayRating(seedFromRank(SEED_TIER, SEED_DIVISION).mu);

  return {
    puuid: workedPuuid(name),
    name,
    window: 'all-time',
    // The stored track, like the window above it. A week-window fixture overrides both — the
    // page reads `track` and not `window` to decide which number it prints (M7.16).
    track: 'all-time',
    rating,
    proven: provenRating({ mu: player.mu, sigma: player.sigma }),
    games,
    wins,
    losses: games - wins,
    settling: games < SETTLING_GAMES,
    range: 'Since 8 Sep 2025',
    reference: seed,
    // A short walk that ends where the roster says they are, so the chart's last point and the
    // `Rating` beside it are the same number — and that starts above the seed, so the
    // reference line is outside the series and the range has to widen to keep it on screen.
    history: [seed + 60, seed + 90, rating - 42, rating],
    recent: [workedRecentGame()],
    ...overrides,
  };
}

/**
 * The sections under the chart (M5.20) for the same worked player: `Hana`, all-time.
 *
 * Hand-written rather than folded, because these are **component** fixtures — what the page
 * does with an answer, not how the answer is computed. The arithmetic that produces one of
 * these from a list of games is `lib/stats/player.ts` and is tested against its own fixtures.
 *
 * The numbers are the worked example's: 37 games, a role record that clears the five-row
 * minimum on both roles, one side under it, and the `W3` her board row prints.
 */
export function workedPlayerStats(overrides: Partial<PlayerStatsView> = {}): PlayerStatsView {
  const partner = (name: string, wins: number, losses: number): PartnerRecord => ({
    puuid: workedPuuid(name),
    name,
    games: wins + losses,
    wins,
    losses,
    winRate: Math.round((wins / (wins + losses)) * 100),
  });

  /**
   * **The rows add up, because a reader adds them up.** Hana's 37 games and `19W 18L` are the
   * board fixture's, so the role rows total 37 and 19 wins, the side rows total the same 37 and
   * the same 19, and a screenshot of this page holds no two numbers that contradict. The fold
   * guarantees this from real rows; a hand-written fixture has to be written that way.
   */
  return {
    window: 'all-time',
    games: 37,
    roles: [
      { role: 'top', puuid: workedPuuid('Hana'), name: 'Hana', games: 20, wins: 12, losses: 8, winRate: 60 },
      { role: 'mid', puuid: workedPuuid('Hana'), name: 'Hana', games: 17, wins: 7, losses: 10, winRate: 41 },
    ],
    noRoleGames: 0,
    sides: [
      {
        side: 100,
        record: { puuid: workedPuuid('Hana'), name: 'Hana', games: 33, wins: 16, losses: 17, winRate: 48 },
      },
      // Under the five-row minimum, so this one prints bare — the page's own edge case.
      {
        side: 200,
        record: { puuid: workedPuuid('Hana'), name: 'Hana', games: 4, wins: 3, losses: 1, winRate: null },
      },
    ],
    // Five qualifying partners: the top three, then the bottom of what is left, so no name is
    // in both lists (the designer, 2026-09-11).
    bestPartners: [partner('Iris', 9, 3), partner('Karim', 7, 4), partner('Theo', 6, 4)],
    worstPartners: [partner('Bilal', 2, 9), partner('Omar', 3, 8)],
    streaks: {
      puuid: workedPuuid('Hana'),
      name: 'Hana',
      current: { kind: 'W', length: 3 },
      longestWin: 6,
      longestLoss: 4,
    },
    averageMinutes: 32,
    awards: [],
    capped: false,
    cap: 2_000,
    ...overrides,
  };
}

/** The same sections for a window this player has no counted game in: the page draws none. */
export function emptyPlayerStats(window: WindowKind = 'all-time'): PlayerStatsView {
  return {
    window,
    games: 0,
    roles: [],
    noRoleGames: 0,
    sides: [],
    bestPartners: [],
    worstPartners: [],
    streaks: null,
    averageMinutes: null,
    awards: [],
    capped: false,
    cap: 2_000,
  };
}

/** One rated game under a board row (M5.30). Dates are already formatted, like the loader. */
export function workedBoardGame(overrides: Partial<BoardGame> = {}): BoardGame {
  return {
    gameId: 'game-1',
    startedLabel: '8 Sep',
    durationS: 2_052,
    won: false,
    side: 100,
    muBefore: 23.9,
    muAfter: 23.2,
    ...overrides,
  };
}

export function workedRecentGame(overrides: Partial<RecentGame> = {}): RecentGame {
  return {
    gameId: 'game-1',
    startedAt: '2026-09-08T20:12:00.000Z',
    durationS: 2_052,
    won: false,
    side: 100,
    role: 'top',
    muBefore: 23.9,
    muAfter: 23.2,
    // Hana carried nothing in the worked example, which is the ordinary row (M7.10): nine rows
    // in ten print no word, and a fixture that awarded one by default would hide that.
    award: null,
    // The split the group played gave blue 58%: Hana was on 100 and lost as the favourite,
    // which is the second of product's two worked sentences (M5.15).
    blueWinProb: 0.58,
    team: [
      { puuid: workedPuuid('Hana'), name: 'Hana', role: 'top' },
      { puuid: workedPuuid('Iris'), name: 'Iris', role: 'jungle' },
      { puuid: workedPuuid('Karim'), name: 'Karim', role: 'mid' },
      { puuid: workedPuuid('Bilal'), name: 'Bilal', role: 'adc' },
      { puuid: workedPuuid('Theo'), name: 'Theo', role: 'support' },
    ],
    ...overrides,
  };
}
