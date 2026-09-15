import { describe, expect, it } from 'vitest';
import { FILLER, rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { NOBODY_ON_A_STREAK, ON_A_STREAK, ON_A_STREAK_GAMES } from './copy';
import {
  averageGameMinutes,
  blueWinRate,
  compareDuosWorst,
  countedGames,
  duoRecords,
  longestStreak,
  noRoleGames,
  onAStreak,
  playerRoleRecords,
  playerSideRecords,
  playerStreaks,
  playersWhoPlayed,
  roleBlocks,
} from './fold';
import type { DuoRecord, PlayerStreaks, StatsGame } from './types';

/**
 * The numbers on `/stats` (M5.4), as arithmetic over hand-built games.
 *
 * The brief's acceptance list is the outline of this file, in its order: the universe, by role,
 * by side, duos, average length, streaks. The awards are `awards.test.ts`.
 */

/**
 * One named pair out of a list of duo records: the filler eight are on the same sides as each
 * other all fixture long, so they make pairs too and a test has to say which one it means.
 */
function pairOf(records: readonly DuoRecord[], one: string, two: string): DuoRecord | undefined {
  const wanted = new Set([`u-${one}`, `u-${two}`]);
  return records.find((record) => record.players.every((ref) => wanted.has(ref.puuid)));
}

/** `n` games in which `key` plays `role` on blue, the first `wins` of them won. */
function run(key: string, role: string, wins: number, losses: number, from = 1): StatsGame[] {
  const games: StatsGame[] = [];
  for (let index = 0; index < wins + losses; index += 1) {
    games.push(
      tenPlayerGame({
        at: `2026-09-0${1 + Math.floor((from + index) / 10)}T${String(10 + ((from + index) % 10)).padStart(2, '0')}:00:00Z`,
        blue: [`${key}:${role}`],
        red: [],
        winner: index < wins ? 100 : 200,
      }),
    );
  }
  return games;
}

describe('the universe: what counts as a game', () => {
  /**
   * Acceptance 1. **`gateRatedGame` decides, and nothing else**, which is what makes the games number
   * here the games number the fold used. The backfilled ten-player game counts: it has a
   * scoreboard, a duration and a winner, and only its climb is missing.
   */
  it('counts the rated game and the backfilled one, and neither the short nor the nine-player one', () => {
    const games = [
      tenPlayerGame({ at: '2026-09-01T19:00:00Z' }),
      // 300 seconds exactly is not rated: the gate is `> 300`.
      tenPlayerGame({ at: '2026-09-01T20:00:00Z', durationS: 300 }),
      statsGame({
        at: '2026-09-01T21:00:00Z',
        blue: ['a', 'b', 'c', 'd'],
        red: FILLER.slice(0, 5),
      }),
      tenPlayerGame({ at: '2026-09-01T22:00:00Z', unrated: true }),
    ];

    const counted = countedGames(games);
    expect(counted).toHaveLength(2);
    expect(counted.map((game) => game.durationS)).toEqual([1_800, 1_800]);
    expect(playersWhoPlayed(counted)).toBe(10);
  });

  it('refuses a game with the same player twice, the way the fold does', () => {
    const twice = statsGame({
      at: '2026-09-01T19:00:00Z',
      blue: ['a', 'a', 'b', 'c', 'd'],
      red: FILLER.slice(0, 5),
    });

    expect(countedGames([twice])).toHaveLength(0);
  });

  it('does not count ARAM, even with ten players over 300 seconds', () => {
    const aram = tenPlayerGame({ at: '2026-09-01T19:00:00Z', gameMode: 'ARAM' });
    const kiwi = tenPlayerGame({ at: '2026-09-01T19:30:00Z', gameMode: 'KIWI' });
    const rift = tenPlayerGame({ at: '2026-09-01T21:00:00Z', gameMode: 'CLASSIC' });
    const missing = tenPlayerGame({ at: '2026-09-01T22:00:00Z' });

    expect(countedGames([aram, kiwi, rift, missing])).toHaveLength(2);
    expect(countedGames([aram, kiwi], { allMaps: true })).toHaveLength(2);
  });

  /** Oldest first, `lcu_game_id` breaking a shared instant: the rebuild's own ordering. */
  it('orders by started_at, then by the client game id', () => {
    const games = [
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', lcuGameId: 'b', blue: [], red: [] }),
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', lcuGameId: 'a', blue: [], red: [] }),
      tenPlayerGame({ at: '2026-09-01T18:00:00Z', lcuGameId: 'z', blue: [], red: [] }),
    ];

    expect(countedGames(games).map((game) => game.lcuGameId)).toEqual(['z', 'a', 'b']);
  });
});

describe('win rate by role', () => {
  /**
   * Acceptance 2: 12W 5L on jungle is `71%`; one game on mid is the bare record and no
   * percentage; and the group's jungle list is ranked by the tie rule.
   */
  it('is a percentage at five rows and a bare record under it', () => {
    const games = countedGames([...run('rami', 'jungle', 12, 5), ...run('rami', 'mid', 1, 0, 40)]);
    const roster = rosterFor(games);
    const rami = roster.find((player) => player.puuid === 'u-rami');

    const records = playerRoleRecords(games, rami as (typeof roster)[number]);
    expect(records.map((record) => [record.role, record.games, record.winRate])).toEqual([
      ['jungle', 17, 71],
      ['mid', 1, null],
    ]);
    expect(records[0]?.wins).toBe(12);
    expect(records[1]?.losses).toBe(0);
  });

  it('lists only the players past five rows at a role, ranked by the tie rule', () => {
    const games = countedGames([
      // Two 60% players — the one with more games is first — and one at four rows, who is out.
      ...run('rami', 'jungle', 3, 2),
      ...run('iris', 'jungle', 6, 4, 20),
      ...run('yuki', 'jungle', 4, 0, 50),
    ]);
    const jungle = roleBlocks(games, rosterFor(games)).find((block) => block.role === 'jungle');

    expect(jungle?.entries.map((entry) => [entry.puuid, entry.games, entry.winRate])).toEqual([
      ['u-iris', 10, 60],
      ['u-rami', 5, 60],
    ]);
  });

  it('has one block per role, in lane order, empty when nobody qualifies', () => {
    const games = countedGames(run('rami', 'jungle', 3, 2));
    const blocks = roleBlocks(games, rosterFor(games));

    expect(blocks.map((block) => block.role)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    expect(blocks.filter((block) => block.entries.length > 0).map((block) => block.role)).toEqual(['jungle']);
  });

  /**
   * A null-role row changes no role number and is named in the footnote instead — the sentence
   * a page of backfilled games needs, and the reason the two totals can differ.
   */
  it('leaves null-role rows out of every role number and counts their games once', () => {
    const withRoles = run('rami', 'jungle', 5, 0);
    const backfilled = [
      tenPlayerGame({ at: '2026-09-02T19:00:00Z', blue: ['rami'], red: [], unrated: true }),
      tenPlayerGame({ at: '2026-09-02T20:00:00Z', blue: ['rami'], red: [], unrated: true }),
    ];
    const games = countedGames([...withRoles, ...backfilled]);
    const roster = rosterFor(games);

    expect(games).toHaveLength(7);
    // The two backfilled games carry no role on any row: they are the footnote's, and the five
    // Rami played on jungle are not, whatever the other nine seats in them recorded.
    expect(noRoleGames(games)).toBe(2);
    const jungle = roleBlocks(games, roster).find((block) => block.role === 'jungle');
    expect(jungle?.entries[0]?.games).toBe(5);
  });

  it('is silent about a game that has roles on some of its rows', () => {
    const games = countedGames([
      statsGame({
        at: '2026-09-02T19:00:00Z',
        blue: ['rami:jungle', 'iris:top', 'omar:mid', 'hana:adc', 'theo'],
        red: ['yuki:top', 'nadia:jungle', 'karim:mid', 'lena:adc', 'bilal:support'],
      }),
    ]);

    // Nine of its ten rows are in the role numbers, so the game is not one the footnote is
    // about; the tenth row belongs to no role, which is true of it everywhere on this page.
    expect(noRoleGames(games)).toBe(0);
    expect(roleBlocks(games, rosterFor(games)).every((block) => block.entries.length === 0)).toBe(true);
  });
});

describe('win rate by side', () => {
  it('is blue wins over counted games, to the printed percent', () => {
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', blue: [], red: [], winner: 100 }),
      tenPlayerGame({ at: '2026-09-01T20:00:00Z', blue: [], red: [], winner: 100 }),
      tenPlayerGame({ at: '2026-09-01T21:00:00Z', blue: [], red: [], winner: 200 }),
    ]);

    expect(blueWinRate(games)).toBe(67);
    expect(blueWinRate([])).toBeNull();
  });

  /** A player with four games on red has a record and no percentage. Acceptance 3. */
  it('gives a player under five games on a side a record and no percentage', () => {
    const games = countedGames([
      ...run('yuki', 'adc', 2, 1),
      tenPlayerGame({ at: '2026-09-03T19:00:00Z', blue: [], red: ['yuki:adc'], winner: 100 }),
      tenPlayerGame({ at: '2026-09-03T20:00:00Z', blue: [], red: ['yuki:adc'], winner: 200 }),
      tenPlayerGame({ at: '2026-09-03T21:00:00Z', blue: [], red: ['yuki:adc'], winner: 200 }),
      tenPlayerGame({ at: '2026-09-03T22:00:00Z', blue: [], red: ['yuki:adc'], winner: 100 }),
    ]);
    const roster = rosterFor(games);
    const yuki = roster.find((player) => player.puuid === 'u-yuki');

    const sides = playerSideRecords(games, yuki as (typeof roster)[number]);
    expect(sides.map((side) => [side.side, side.record.games, side.record.winRate])).toEqual([
      [100, 3, null],
      [200, 4, null],
    ]);
    expect(sides[1]?.record.wins).toBe(2);
  });
});

describe('duo pairings', () => {
  /** Acceptance 4: four together is nothing, five is a row, and opposite sides count for neither. */
  it('appears at five games together and not at four', () => {
    const four = countedGames([
      ...Array.from({ length: 4 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T${10 + index}:00:00Z`,
          blue: ['yuki', 'theo'],
          red: [],
          winner: 100,
        }),
      ),
    ]);
    expect(duoRecords(four, rosterFor(four))).toHaveLength(0);

    const fifth = tenPlayerGame({
      at: '2026-09-01T20:00:00Z',
      blue: ['yuki', 'theo'],
      red: [],
      winner: 200,
    });
    const five = countedGames([...four, fifth]);
    const pair = pairOf(duoRecords(five, rosterFor(five)), 'yuki', 'theo');

    expect(pair?.games).toBe(5);
    expect(pair?.wins).toBe(4);
    expect(pair?.winRate).toBe(80);
    // Named in one order, whoever was on which side: display name A–Z, then puuid.
    expect(pair?.players.map((ref) => ref.name)).toEqual(['Theo', 'Yuki']);
  });

  it('counts nothing for a game the two played against each other', () => {
    const games = countedGames([
      ...Array.from({ length: 5 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T${10 + index}:00:00Z`,
          blue: ['yuki', 'theo'],
          red: [],
          winner: 100,
        }),
      ),
      ...Array.from({ length: 40 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-02T${String(index % 24).padStart(2, '0')}:00:00Z`,
          lcuGameId: `against-${index}`,
          blue: ['yuki'],
          red: ['theo'],
          winner: 100,
        }),
      ),
    ]);
    const pair = pairOf(duoRecords(games, rosterFor(games)), 'yuki', 'theo');

    expect(pair?.games).toBe(5);
    expect(pair?.wins).toBe(5);
  });

  it('reads the same list from both ends, and the worst end is not the best end reversed', () => {
    const games = countedGames([
      ...Array.from({ length: 6 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T${10 + index}:00:00Z`,
          blue: ['yuki', 'theo'],
          red: ['iris', 'omar'],
          // Blue wins five of six: the pair on red is the worse one.
          winner: index === 5 ? 200 : 100,
        }),
      ),
    ]);
    const pairs = duoRecords(games, rosterFor(games));
    const worst = [...pairs].sort(compareDuosWorst);

    // Blue's five took five of six, so every pair on blue is 83% and every pair on red is 17%.
    expect(pairs[0]?.winRate).toBe(83);
    expect(pairOf(pairs, 'yuki', 'theo')?.winRate).toBe(83);
    expect(worst[0]?.winRate).toBe(17);
    expect(pairOf(worst, 'iris', 'omar')?.winRate).toBe(17);
    expect(worst[0]?.games).toBe(6);
  });
});

describe('average game length', () => {
  /** Acceptance 5: the mean to the nearest minute, and never `0 min` at zero games. */
  it('is the mean of duration_s to the minute, and null with nothing to average', () => {
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', blue: [], red: [], durationS: 1_800 }),
      tenPlayerGame({ at: '2026-09-01T20:00:00Z', blue: [], red: [], durationS: 2_100 }),
      tenPlayerGame({ at: '2026-09-01T21:00:00Z', blue: [], red: [], durationS: 1_900 }),
    ]);

    // (1800 + 2100 + 1900) / 3 = 1933.3s = 32.2 min.
    expect(averageGameMinutes(games)).toBe(32);
    expect(averageGameMinutes([])).toBeNull();
  });
});

describe('streaks', () => {
  /**
   * Acceptance 6: W W L W W W with two games sharing an instant gives `longest = 3` and
   * `current = W3` under ten shuffled insert orders — the `lcu_game_id` tie-break doing its job.
   */
  it('is the same answer whatever order the games arrive in', () => {
    const results: { at: string; lcuGameId: string; winner: 100 | 200 }[] = [
      { at: '2026-09-01T19:00:00Z', lcuGameId: 'a1', winner: 100 },
      { at: '2026-09-01T20:00:00Z', lcuGameId: 'a2', winner: 100 },
      // These two share an instant: the loss is `b1` and the win after it is `b2`.
      { at: '2026-09-02T19:00:00Z', lcuGameId: 'b1', winner: 200 },
      { at: '2026-09-02T19:00:00Z', lcuGameId: 'b2', winner: 100 },
      { at: '2026-09-03T19:00:00Z', lcuGameId: 'c1', winner: 100 },
      { at: '2026-09-03T20:00:00Z', lcuGameId: 'c2', winner: 100 },
    ];

    for (let shuffle = 0; shuffle < 10; shuffle += 1) {
      const order = [...results].sort(() => Math.random() - 0.5);
      const games = countedGames(
        order.map((result) =>
          tenPlayerGame({
            at: result.at,
            lcuGameId: result.lcuGameId,
            blue: ['rami'],
            red: [],
            winner: result.winner,
          }),
        ),
      );
      const streaks = playerStreaks(games, rosterFor(games));
      const rami = streaks.find((streak) => streak.puuid === 'u-rami');

      expect(rami?.current).toEqual({ kind: 'W', length: 3 });
      expect(rami?.longestWin).toBe(3);
      expect(rami?.longestLoss).toBe(1);
    }
  });

  it("names every holder of the window's longest run, and nobody at all with no games", () => {
    // The same ten, three times, blue winning every one: five people are on a 3-win run and
    // five are on a 3-loss run, which is the only shape that makes "the holder" plural.
    const blue = ['rami', 'iris', 'omar', 'hana', 'theo'];
    const red = ['yuki', 'nadia', 'karim', 'lena', 'bilal'];
    const games = countedGames(
      Array.from({ length: 3 }, (_, index) =>
        statsGame({ at: `2026-09-01T1${index}:00:00Z`, blue, red, winner: 100 }),
      ),
    );
    const streaks = playerStreaks(games, rosterFor(games));

    const win = longestStreak(streaks, 'W');
    expect(win?.length).toBe(3);
    expect(win?.holders.map((ref) => ref.name).sort()).toEqual(['Hana', 'Iris', 'Omar', 'Rami', 'Theo']);
    const loss = longestStreak(streaks, 'L');
    expect(loss?.length).toBe(3);
    expect(loss?.holders.map((ref) => ref.name)).toContain('Yuki');
    expect(longestStreak([], 'W')).toBeNull();
  });

  it('lists anyone on a streak of three or more right now, longest first', () => {
    const blue = ['rami', 'iris', 'omar', 'hana', 'theo'];
    const red = ['yuki', 'nadia', 'karim', 'lena', 'bilal'];
    const games = countedGames([
      // Blue take three; then red take two, which puts blue on `L2` and out of the list.
      ...Array.from({ length: 3 }, (_, index) =>
        statsGame({ at: `2026-09-01T1${index}:00:00Z`, blue, red, winner: 100 }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        statsGame({ at: `2026-09-02T1${index}:00:00Z`, blue, red, winner: 200 }),
      ),
    ]);
    const running = onAStreak(playerStreaks(games, rosterFor(games)));

    // Red's run is `L3` then `W2`, so nobody is on three: the quiet-week answer, and the one
    // the page prints its `Nobody is on a run of three or more.` line for.
    expect(running).toHaveLength(0);

    const longer = countedGames([
      ...Array.from({ length: 3 }, (_, index) =>
        statsGame({ at: `2026-09-01T1${index}:00:00Z`, blue, red, winner: 100 }),
      ),
    ]);
    expect(
      onAStreak(playerStreaks(longer, rosterFor(longer))).map((streak: PlayerStreaks) => [
        streak.name,
        streak.current?.kind,
        streak.current?.length,
      ]),
    ).toEqual([
      ['Bilal', 'L', 3],
      ['Hana', 'W', 3],
      ['Iris', 'W', 3],
      ['Karim', 'L', 3],
      ['Lena', 'L', 3],
      ['Nadia', 'L', 3],
      ['Omar', 'W', 3],
      ['Rami', 'W', 3],
      ['Theo', 'W', 3],
      ['Yuki', 'L', 3],
    ]);
  });
});

describe('the copy product ruled on (2026-09-10)', () => {
  /**
   * `On a streak now`, not `On a run now`: the card is `Streaks`, the two labels above it end in
   * `streak` and the rows print `W3`. One thing, one name.
   */
  it('calls a streak a streak, in the label and in the sentence', () => {
    expect(ON_A_STREAK).toBe('On a streak now');
    expect(ON_A_STREAK).not.toContain('run');
    expect(NOBODY_ON_A_STREAK).toBe('Nobody is on a streak of 3 or more.');
    expect(NOBODY_ON_A_STREAK).not.toContain('run');
  });

  /**
   * **The digit is the constant the block filters on.** Lowering the constant has to change the
   * sentence, or the page says three while the list shows two.
   */
  it('prints the same number the block is filtered on', () => {
    expect(ON_A_STREAK_GAMES).toBe(3);
    expect(NOBODY_ON_A_STREAK).toContain(`of ${ON_A_STREAK_GAMES} or more`);
  });
});
