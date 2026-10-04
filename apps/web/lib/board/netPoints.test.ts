import { describe, expect, it } from 'vitest';
import { displayDelta, sumDisplayDeltas } from '../ratingDisplay';
import { workedPlayer } from '../testing/boardFixtures';
import { foldYourNight, type YourNightGame, type YourNightRow } from '../tonight/yourNight';
import { tonightDelta } from './explain';
import { compareBoardRows, sortBoardRows } from './order';
import { rowChange } from './rowChange';
import type { BoardRow, RecentGame } from './types';

/**
 * M14.57: one rating number everywhere. Net points on a week are the sum of the printed
 * per-game deltas; the week board orders on them with product's tie-break; Your night and the
 * player page's Tonight tile sum the same rows with the same function.
 */

function weekRow(name: string, over: Partial<BoardRow> = {}): BoardRow {
  return {
    puuid: `puuid-${name.toLowerCase()}`,
    name,
    track: 'week',
    points: 0,
    sortKey: 1500,
    rating: 1500,
    games: 5,
    wins: 3,
    losses: 2,
    ratedGames: 40,
    climb: null,
    settling: false,
    settlingChip: false,
    awards: [],
    ...over,
  };
}

const order = (rows: BoardRow[]) => sortBoardRows(rows).map((row) => row.name);

describe('sumDisplayDeltas', () => {
  it('is the sum of the printed deltas, not one rounded difference', () => {
    // Each game moves 0.54 points: printed 1, 0, 1 from these starting points.
    const pairs = [
      { rBefore: 1500, rAfter: 1500.54 },
      { rBefore: 1500.54, rAfter: 1501.08 },
      { rBefore: 1501.08, rAfter: 1501.62 },
    ];
    const rows = pairs.map((pair) => displayDelta(pair.rBefore, pair.rAfter));
    expect(sumDisplayDeltas(pairs)).toBe(rows.reduce((a, b) => a + b, 0));
  });

  it('prints a net zero as +0 and nothing at all as null', () => {
    expect(
      Object.is(
        sumDisplayDeltas([
          { rBefore: 1500, rAfter: 1530 },
          { rBefore: 1530, rAfter: 1500 },
        ]),
        0,
      ),
    ).toBe(true);
    expect(Object.is(sumDisplayDeltas([{ rBefore: 1500, rAfter: 1499.94 }]), 0)).toBe(true);
    expect(sumDisplayDeltas([])).toBeNull();
  });

  it('lets the rows win when the games do not chain (a reset or an unrebuilt backfill between them)', () => {
    const pairs = [
      { rBefore: 1500, rAfter: 1560 },
      // The next game starts somewhere else: a reset between them.
      { rBefore: 1200, rAfter: 1230 },
    ];
    expect(sumDisplayDeltas(pairs)).toBe(60 + 30);
    expect(sumDisplayDeltas(pairs)).not.toBe(displayDelta(1500, 1230));
  });
});

describe('the week board order (M14.57 tie-break)', () => {
  it('ranks by net points first', () => {
    expect(
      order([weekRow('A', { points: 10 }), weekRow('B', { points: 86 }), weekRow('C', { points: -4 })]),
    ).toEqual(['B', 'A', 'C']);
  });

  it('then by more wins', () => {
    expect(order([weekRow('A', { points: 40, wins: 2 }), weekRow('B', { points: 40, wins: 4 })])).toEqual([
      'B',
      'A',
    ]);
  });

  it('then by fewer games (the same points in fewer games)', () => {
    expect(order([weekRow('A', { points: 40, games: 7 }), weekRow('B', { points: 40, games: 5 })])).toEqual([
      'B',
      'A',
    ]);
  });

  it('then by the higher all-time Rating', () => {
    expect(
      order([
        weekRow('A', { points: 40, rating: 1400, sortKey: 1398 }),
        weekRow('B', { points: 40, rating: 1520, sortKey: 1518 }),
      ]),
    ).toEqual(['B', 'A']);
  });

  it('then by display name A to Z, stable', () => {
    const rows = [weekRow('Zed', { points: 40 }), weekRow('Amy', { points: 40 })];
    expect(order(rows)).toEqual(['Amy', 'Zed']);
    expect(order([...rows].reverse())).toEqual(['Amy', 'Zed']);
  });

  it('keeps a settling newcomer in the one list, with the chip, by points', () => {
    const rows = sortBoardRows([
      weekRow('Old', { points: 20 }),
      weekRow('New', { points: 120, ratedGames: 3, settlingChip: true }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['New', 'Old']);
    expect(rows.every((row) => !row.settling)).toBe(true);
  });

  it('still orders All time rows by Rating', () => {
    const a = weekRow('A', { track: 'all-time', points: null, rating: 1600, sortKey: 1602 });
    const b = weekRow('B', { track: 'all-time', points: null, rating: 1500, sortKey: 1500 });
    expect([b, a].sort(compareBoardRows).map((row) => row.name)).toEqual(['A', 'B']);
  });

  it('prints the number it sorts on: rowChange is the points on a week, the climb on All time', () => {
    expect(rowChange(weekRow('A', { points: 86 }))).toBe(86);
    expect(rowChange({ points: null, climb: { rBefore: 1434, rAfter: 1492.2 } })).toBe(58);
  });
});

/* ---------------------------------------------------------------------------
 * Your night and the Tonight tile (acceptance 4).
 * ------------------------------------------------------------------------- */

const ME = 'p0';
const PUUID_OF = new Map(Array.from({ length: 10 }, (_, i) => [`p${i}`, `u${i}`]));
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const NIGHT = new Date('2026-10-03T16:00:00Z');

function nightGame(
  id: string,
  at: string,
  mine: { before: number; after: number },
  winner: 100 | 200,
): YourNightGame {
  return {
    id,
    started_at: at,
    duration_s: 1_800,
    winning_side: winner,
    gameMode: 'CLASSIC',
    game_players: Array.from({ length: 10 }, (_, i): YourNightRow => {
      const won = (i < 5 ? 100 : 200) === winner;
      return {
        player_id: `p${i}`,
        side: i < 5 ? 100 : 200,
        role: ROLES[i % 5] ?? 'top',
        kills: 3,
        deaths: 3,
        assists: 3,
        gold: 10_000,
        cs: 150,
        vision_score: 20,
        damage_self_mitigated: 10_000,
        damage_to_objectives: 3_000,
        damage_to_champs: 15_000,
        champion_id: 145,
        r_before: i === 0 ? mine.before : 1500,
        r_after: i === 0 ? mine.after : won ? 1536 : 1464,
      };
    }),
  };
}

function recent(id: string, at: string, mine: { before: number; after: number }): RecentGame {
  return {
    gameId: id,
    startedAt: at,
    durationS: 1_800,
    won: mine.after > mine.before,
    side: 100,
    winningSide: mine.after > mine.before ? 100 : 200,
    role: 'top',
    rBefore: mine.before,
    rAfter: mine.after,
    weekRBefore: null,
    weekRAfter: null,
    award: null,
    blueWinProb: null,
    pickRank: null,
    ratingsBefore: null,
    aram: false,
    team: [],
  };
}

describe('Your night and the Tonight tile agree', () => {
  function both(games: { id: string; at: string; before: number; after: number }[]) {
    const night = foldYourNight(
      games.map((g) => nightGame(g.id, g.at, g, g.after > g.before ? 100 : 200)),
      ME,
      PUUID_OF,
      NIGHT,
    );
    const tile = tonightDelta(
      workedPlayer('Hana', { recent: games.map((g) => recent(g.id, g.at, g)).reverse() }),
      NIGHT,
    );
    const rows = games.reduce((sum, g) => sum + displayDelta(g.before, g.after), 0);
    return { night: night?.ratingDelta, tile, rows };
  }

  it('both equal the sum of the night s printed rows when the games chain', () => {
    const { night, tile, rows } = both([
      { id: 'g1', at: '2026-10-03T18:00:00Z', before: 1500, after: 1530.54 },
      { id: 'g2', at: '2026-10-03T19:00:00Z', before: 1530.54, after: 1501.08 },
      { id: 'g3', at: '2026-10-03T20:00:00Z', before: 1501.08, after: 1531.62 },
    ]);
    expect(night).toBe(rows);
    expect(tile).toBe(rows);
  });

  it('both follow the rows, not one difference, when the games do not chain', () => {
    const games = [
      { id: 'g1', at: '2026-10-03T18:00:00Z', before: 1500, after: 1560 },
      // Not chained: the second game starts from a reset.
      { id: 'g2', at: '2026-10-03T19:00:00Z', before: 1200, after: 1230 },
    ];
    const { night, tile, rows } = both(games);
    expect(rows).toBe(90);
    expect(night).toBe(90);
    expect(tile).toBe(90);
    expect(tile).not.toBe(displayDelta(1500, 1230));
  });
});
