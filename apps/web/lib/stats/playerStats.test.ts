import { describe, expect, it } from 'vitest';
import { currentStreak, formatStreak } from '../board/streak';
import { windowRange } from '../night';
import { puuidOf, rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import type { PlayerStatsInput } from './player';
import { playerStatsView } from './player';
import type { StatsGame } from './types';

/**
 * The per-player sections on `/p/[puuid]` (M5.20), as arithmetic over hand-built games.
 *
 * The file follows M5.20's acceptance list in its order — the loader's universe, role, side,
 * partners, streaks, average game length, the award line, the window — because every one of
 * those checks is a number and not a pixel, and a number is a fixture.
 *
 * **Nothing here touches a database.** The section that reads one is
 * `app/playerStats.integration.test.ts`, which also pins the one claim a fixture cannot make:
 * that the streak on this page is the streak the leaderboard row prints.
 */

/** The page's own default, and every fixture's window unless it says otherwise. */
const NOW = new Date('2026-09-15T18:00:00Z');
const ZONE = 'Africa/Cairo';

/**
 * One player's sections out of a list of games.
 *
 * `now` is the instant the window's bounds are computed from — the loader's job in production,
 * and the only reason a fixture needs one: the award line names the window's calendar.
 */
function view(
  games: readonly StatsGame[],
  key: string,
  over: Partial<PlayerStatsInput> & { now?: Date } = {},
) {
  const window = over.window ?? 'all-time';
  const { now, ...input } = over;
  return playerStatsView({
    window,
    puuid: puuidOf(key),
    games,
    players: rosterFor(games),
    range: windowRange(window, now ?? NOW, ZONE),
    capped: false,
    cap: 2_000,
    timeZone: ZONE,
    ...input,
  });
}

/** `n` games with `key` on blue at `role`, the first `wins` of them won. */
function run(
  key: string,
  role: string | null,
  wins: number,
  losses: number,
  from = 1,
  withKey?: string,
): StatsGame[] {
  const games: StatsGame[] = [];
  for (let index = 0; index < wins + losses; index += 1) {
    const at = new Date(Date.UTC(2026, 8, 1 + Math.floor((from + index) / 8), 10 + ((from + index) % 8)));
    games.push(
      tenPlayerGame({
        at: at.toISOString(),
        blue: [role === null ? key : `${key}:${role}`, ...(withKey === undefined ? [] : [withKey])],
        red: [],
        winner: index < wins ? 100 : 200,
      }),
    );
  }
  return games;
}

describe('the loader s universe, read for one player', () => {
  /**
   * Acceptance 1 and 2. The gate is `countedGames`' — the same predicate `/stats` applies —
   * and the sections count that list and nothing else. A nine-player game and a five-minute
   * one are in neither page's numbers.
   */
  it('counts what the fold counts, and a game the gate refused changes nothing', () => {
    const games = [
      ...run('lena', 'jungle', 3, 1),
      tenPlayerGame({ at: '2026-09-09T19:00:00Z', blue: ['lena:jungle'], red: [], durationS: 300 }),
      statsGame({ at: '2026-09-09T20:00:00Z', blue: ['lena:jungle', 'a', 'b', 'c'], red: ['d'] }),
    ];

    const player = view(games, 'lena');

    expect(player.games).toBe(4);
    expect(player.roles).toEqual([
      expect.objectContaining({ role: 'jungle', games: 4, wins: 3, losses: 1, winRate: null }),
    ]);
  });

  /** A player nobody's scoreboard names: the empty view, and never a crash or a `NaN`. */
  it('is the empty view for somebody who did not play the window', () => {
    const player = view(run('lena', 'jungle', 2, 0), 'nobody-here');

    expect(player).toMatchObject({
      games: 0,
      roles: [],
      sides: [],
      bestPartners: [],
      worstPartners: [],
      streaks: null,
      averageMinutes: null,
      awards: [],
    });
  });
});

describe('their role record', () => {
  /**
   * Acceptance 2, verbatim: 12W 5L on jungle shows `71%`, 1W 0L on mid shows the bare record,
   * and a row with no role changes neither.
   */
  it('prints a percentage from five rows and a bare record under it', () => {
    const games = [
      ...run('lena', 'jungle', 12, 5),
      ...run('lena', 'mid', 1, 0, 40),
      ...run('lena', null, 4, 0, 60),
    ];

    const player = view(games, 'lena');

    expect(player.roles.map((record) => [record.role, record.wins, record.losses, record.winRate])).toEqual([
      ['jungle', 12, 5, 71],
      ['mid', 1, 0, null],
    ]);
    // The four role-less games are in the count and in no role row.
    expect(player.games).toBe(22);
    expect(player.noRoleGames).toBe(4);
  });

  /**
   * A player whose every game is backfilled: no role rows at all, and the footnote's number is
   * **their** games — the group form ("a game where nobody's position was recorded") cannot
   * answer this reader's question.
   */
  it('has no rows and its own count when every one of their games was backfilled', () => {
    const player = view(run('lena', null, 3, 2), 'lena');

    expect(player.roles).toEqual([]);
    expect(player.noRoleGames).toBe(5);
  });

  /** Lane order, not the order they were played in: the page reads top to support. */
  it('is in lane order', () => {
    const games = [...run('lena', 'support', 5, 0), ...run('lena', 'top', 5, 0, 30)];

    expect(view(games, 'lena').roles.map((record) => record.role)).toEqual(['top', 'support']);
  });
});

describe('their side record', () => {
  /** Acceptance 3: four games on red print a record and no percentage; at five it appears. */
  it('crosses the five-game minimum for a percentage, blue first', () => {
    const blue = run('lena', 'top', 3, 2);
    const red: StatsGame[] = [];
    for (let index = 0; index < 4; index += 1) {
      red.push(
        tenPlayerGame({
          at: `2026-09-2${index}T19:00:00Z`,
          red: ['lena:top'],
          blue: [],
          winner: 200,
        }),
      );
    }

    const four = view([...blue, ...red], 'lena');
    expect(four.sides.map(({ side, record }) => [side, record.wins, record.losses, record.winRate])).toEqual([
      [100, 3, 2, 60],
      [200, 4, 0, null],
    ]);

    const five = view(
      [...blue, ...red, tenPlayerGame({ at: '2026-09-25T19:00:00Z', red: ['lena:top'], winner: 200 })],
      'lena',
    );
    expect(five.sides[1]?.record.winRate).toBe(100);
  });

  /** A player who only ever sat on blue has one row, not a red one reading `0W 0L`. */
  it('prints only the sides they played', () => {
    expect(view(run('lena', 'top', 2, 1), 'lena').sides.map(({ side }) => side)).toEqual([100]);
  });
});

describe('their partners', () => {
  /**
   * Five games with one named partner and **nine strangers a game**, so the only pair in the
   * fixture that can reach the minimum is the one the test is about.
   *
   * `tenPlayerGame`'s filler is the same ten people every game, which makes each of them a
   * partner too — true of the product, and useless in a test about ordering.
   */
  function withPartner(partner: string, wins: number, losses: number, from: number): StatsGame[] {
    const games: StatsGame[] = [];
    for (let index = 0; index < wins + losses; index += 1) {
      const seat = from + index;
      games.push(
        statsGame({
          at: new Date(Date.UTC(2026, 8, 1 + Math.floor(seat / 8), 10 + (seat % 8))).toISOString(),
          blue: ['lena:top', partner, `x${seat}a`, `x${seat}b`, `x${seat}c`],
          red: [`y${seat}a`, `y${seat}b`, `y${seat}c`, `y${seat}d`, `y${seat}e`],
          winner: index < wins ? 100 : 200,
        }),
      );
    }
    return games;
  }

  /**
   * Acceptance 4: three best and three worst, a partner at four games together absent and at
   * five present, and a game on opposite sides in neither numerator nor denominator.
   */
  it('is the three best and the three worst at five games together', () => {
    const games = [
      ...withPartner('iris', 5, 0, 1), // 5 together, all won.
      ...withPartner('omar', 1, 3, 10), // 4 together — under the bar.
      ...withPartner('theo', 2, 4, 20), // 6 together, 2 won.
      ...withPartner('karim', 3, 2, 30), // 5 together, 3 won.
      ...withPartner('bilal', 4, 1, 40), // 5 together, 4 won.
    ];

    const player = view(games, 'lena');
    const named = (list: readonly { puuid: string }[]) => list.map((entry) => entry.puuid);

    // Rate descending: Iris 100, Bilal 80, Karim 60, Theo 33.
    expect(named(player.bestPartners)).toEqual([puuidOf('iris'), puuidOf('bilal'), puuidOf('karim')]);
    // The bottom of what is left, not the best three reversed — so Theo alone.
    expect(named(player.worstPartners)).toEqual([puuidOf('theo')]);
    // Four games together is not a partner at all, at either end of the list.
    expect(named([...player.bestPartners, ...player.worstPartners])).not.toContain(puuidOf('omar'));
    expect(player.bestPartners[0]).toMatchObject({ games: 5, wins: 5, losses: 0, winRate: 100 });
  });

  /**
   * **No name is in both lists** (the designer, 2026-09-11): `Best together` is the top three
   * and `Worst together` is the bottom three of the remainder, so at three qualifying partners
   * or fewer the worst list is empty and the page draws `Best together` alone.
   */
  it('splits one ranked list in two, and repeats nobody', () => {
    const seven = [
      ...withPartner('iris', 5, 0, 1),
      ...withPartner('bilal', 4, 1, 10),
      ...withPartner('karim', 3, 2, 20),
      ...withPartner('theo', 2, 3, 30),
      ...withPartner('omar', 1, 4, 40),
      ...withPartner('nadia', 0, 5, 50),
      ...withPartner('yuki', 2, 4, 60),
    ];

    const player = view(seven, 'lena');
    const best = player.bestPartners.map((entry) => entry.puuid);
    const worst = player.worstPartners.map((entry) => entry.puuid);

    expect(best).toHaveLength(3);
    expect(worst).toHaveLength(3);
    expect(best.filter((puuid) => worst.includes(puuid))).toEqual([]);
    // Seven qualify, six are printed: the fourth-best is in neither list, which is honest.
    expect([...best, ...worst]).toHaveLength(6);

    const three = view([...withPartner('iris', 5, 0, 1), ...withPartner('theo', 2, 3, 20)], 'lena');
    expect(three.bestPartners).toHaveLength(2);
    expect(three.worstPartners).toEqual([]);
  });

  /** `A pair that played 5 games together and 40 against each other`: only same-side games count. */
  it('counts a game they played against each other for neither side of the record', () => {
    const together = withPartner('iris', 4, 1, 1);
    const against: StatsGame[] = [];
    for (let index = 0; index < 6; index += 1) {
      against.push(
        statsGame({
          at: new Date(Date.UTC(2026, 8, 20 + index, 19)).toISOString(),
          blue: ['lena:top', `z${index}a`, `z${index}b`, `z${index}c`, `z${index}d`],
          red: ['iris:top', `w${index}a`, `w${index}b`, `w${index}c`, `w${index}d`],
          winner: 100,
        }),
      );
    }

    const player = view([...together, ...against], 'lena');

    expect(player.bestPartners).toEqual([
      expect.objectContaining({ puuid: puuidOf('iris'), games: 5, wins: 4, losses: 1 }),
    ]);
  });

  /** Nobody at five games: the section's empty line, and no half-filled list. */
  it('is empty when nobody has reached five games with them', () => {
    const games = [...withPartner('iris', 2, 0, 1), ...withPartner('theo', 1, 1, 10)];

    const player = view(games, 'lena');
    expect(player.bestPartners).toEqual([]);
    expect(player.worstPartners).toEqual([]);
  });
});

describe('their streaks', () => {
  /**
   * Acceptance 5. The current run is `currentStreak`'s — **the leaderboard row's own helper** —
   * and the two longest are hand-computable off the fixture.
   */
  it('is the run they are on and the longest of each kind', () => {
    // Won, won, lost, lost, lost, won, won, won: longest win 3, longest loss 3, current W3.
    const results = [true, true, false, false, false, true, true, true];
    const games = results.map((won, index) =>
      tenPlayerGame({
        at: new Date(Date.UTC(2026, 8, 1 + index, 19)).toISOString(),
        blue: ['lena:top'],
        winner: won ? 100 : 200,
      }),
    );

    const player = view(games, 'lena');

    expect(player.streaks?.current).toEqual({ kind: 'W', length: 3 });
    expect(formatStreak(player.streaks?.current as { kind: 'W' | 'L'; length: number })).toBe('W3');
    expect(player.streaks?.longestWin).toBe(3);
    expect(player.streaks?.longestLoss).toBe(3);
    // The same list, through the board's helper, newest first: one definition of a streak.
    expect(player.streaks?.current).toEqual(currentStreak([...results].reverse()));
  });

  /**
   * The order is the rebuild's — `started_at`, then `lcu_game_id` — so the answer does not
   * depend on the order the rows were inserted in.
   */
  it('is the same under a shuffled insert order, down to the lcu_game_id tie-break', () => {
    const at = '2026-09-09T19:00:00Z';
    const games = [
      tenPlayerGame({ at, lcuGameId: '1', blue: ['lena:top'], winner: 100 }),
      tenPlayerGame({ at, lcuGameId: '2', blue: ['lena:top'], winner: 100 }),
      tenPlayerGame({ at, lcuGameId: '3', blue: ['lena:top'], winner: 200 }),
    ];

    const ordered = view(games, 'lena');
    const shuffled = view([games[2] as StatsGame, games[0] as StatsGame, games[1] as StatsGame], 'lena');

    expect(ordered.streaks?.current).toEqual({ kind: 'L', length: 1 });
    expect(shuffled.streaks).toEqual(ordered.streaks);
    expect(ordered.streaks?.longestWin).toBe(2);
  });

  /** A player who has never lost has no losing streak at all — `L0` is not a number to print. */
  it('is zero, not a row, for a kind that never happened', () => {
    expect(view(run('lena', 'top', 3, 0), 'lena').streaks?.longestLoss).toBe(0);
  });
});

describe('their average game length', () => {
  /** Acceptance 6: the mean over **their** counted games, to the minute. */
  it('is the mean of their own games, rounded to the minute', () => {
    const games = [
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', blue: ['lena:top'], durationS: 1_800 }),
      tenPlayerGame({ at: '2026-09-02T19:00:00Z', blue: ['lena:top'], durationS: 2_040 }),
      // Somebody else's night: it is in the window and in none of Lena's numbers.
      tenPlayerGame({ at: '2026-09-03T19:00:00Z', blue: ['iris:top'], durationS: 60_000 }),
    ];

    expect(view(games, 'lena').averageMinutes).toBe(32);
  });

  /** `Zero games → the empty line, never NaN and never 0 min.` */
  it('is null and never zero for a player with no counted game in the window', () => {
    const player = view(run('iris', 'top', 2, 0), 'lena');

    expect(player.averageMinutes).toBeNull();
    expect(player.games).toBe(0);
  });
});

describe('the award line', () => {
  /**
   * Acceptance 7. September's most improved gets `Most improved, September.` on `Last month`;
   * nobody else does, and no other window prints it at all.
   */
  const september = () => {
    const games: StatsGame[] = [];
    for (let index = 0; index < 16; index += 1) {
      games.push(
        tenPlayerGame({
          at: new Date(Date.UTC(2026, 7, 3 + index, 19)).toISOString(),
          blue: [{ key: 'lena', role: 'top', mu: index === 0 ? [21.1, 24.4] : [24.4, 24.6333333] }],
          red: ['iris:top'],
          winner: 100,
        }),
      );
    }
    return games;
  };

  const august = { window: 'last-month', now: new Date('2026-09-15T18:00:00Z') } as const;

  it('names the award and the month on the winner s page, and nobody else s', () => {
    const games = september();

    expect(view(games, 'lena', august).awards).toContain('Most improved, August.');
    // Iris played the same sixteen games and climbed nothing: this award is not on their page.
    expect(view(games, 'iris', august).awards).not.toContain('Most improved, August.');
  });

  /** A week window says which Sunday it was (M5.34), in product's own form. */
  it('says `week of 1 Sep` on a week', () => {
    const games: StatsGame[] = [];
    for (let index = 0; index < 7; index += 1) {
      games.push(
        tenPlayerGame({
          at: new Date(Date.UTC(2026, 8, 1 + index, 19)).toISOString(),
          blue: [{ key: 'lena', role: 'top', mu: index === 0 ? [21.1, 24.4] : [24.4, 24.6333333] }],
          red: ['iris:top'],
          winner: 100,
        }),
      );
    }

    const player = view(games, 'lena', { window: 'last-week', now: new Date('2026-09-10T18:00:00Z') });
    expect(player.awards).toContain('Most improved, week of 30 Aug.');
  });

  /** A running window has handed nothing out, and `All time` never will. */
  it('prints nothing on a window that has not closed, and nothing on all time', () => {
    const games = september();

    expect(
      view(games, 'lena', { window: 'this-month', now: new Date('2026-08-20T18:00:00Z') }).awards,
    ).toEqual([]);
    expect(view(games, 'lena').awards).toEqual([]);
  });
});

/**
 * **The window is a filter in the query** (`load.ts`), not in this file: `statsView` folds the
 * list it is handed and so does this, which is what lets one read answer both pages.
 * Acceptance 8 — every section changes with the picker — is therefore an integration check,
 * and it is in `app/playerStats.integration.test.ts` against real rows.
 *
 * What the window decides *here* is the award line's calendar, which is pinned above.
 */
describe('the window', () => {
  it('folds exactly the games it is given, and filters none of them itself', () => {
    const games = [...run('lena', 'top', 3, 0, 1), ...run('lena', 'jungle', 1, 1, 40)];

    expect(view(games, 'lena').games).toBe(5);
    expect(view(games.slice(0, 3), 'lena').games).toBe(3);
    expect(view(games.slice(0, 3), 'lena').roles.map((record) => record.role)).toEqual(['top']);
  });
});
