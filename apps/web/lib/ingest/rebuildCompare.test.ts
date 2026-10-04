import { describe, expect, it } from 'vitest';
import { type ComparePlayer, compareRebuild, formatComparison } from './rebuildCompare';

/** M18.5: the dry run's gate lines (M18.10), from a hand-checkable group. */

const player = (id: string, games: number, oldRating: number | null, newRating: number): ComparePlayer => ({
  playerId: id,
  name: id.toUpperCase(),
  games,
  oldRating,
  newRating,
});

describe('compareRebuild', () => {
  const players = [
    player('a', 12, 2000, 1260),
    player('b', 12, 1800, 1240),
    player('c', 11, 1600, 1250), // b and c swap
    player('d', 10, 1400, 1180),
    player('e', 3, 1300, 1230), // settling: in "all" only
    player('f', 2, null, 1210), // not on the current board: in neither Spearman
  ];
  const games = [
    { blueWon: true, oldBlueP: 0.8, newBlueP: 0.6 },
    { blueWon: false, oldBlueP: 0.7, newBlueP: 0.55 },
    { blueWon: true, oldBlueP: null, newBlueP: 0.5 }, // no stored odds: out of both log losses
  ];
  const changes = [
    { playerId: 'a', startedAt: '2026-09-01T20:00:00Z', oldChange: 40, newChange: 9 },
    { playerId: 'a', startedAt: '2026-09-20T20:00:00Z', oldChange: -55, newChange: -8 },
    { playerId: 'a', startedAt: '2026-09-21T20:00:00Z', oldChange: 61, newChange: 10 },
    { playerId: 'b', startedAt: '2026-09-21T20:00:00Z', oldChange: null, newChange: 7 },
  ];
  const c = compareRebuild({ games, changes, players, recentSince: '2026-09-13T03:00:00.000Z' });

  it('scores both odds over the same games', () => {
    expect(c.games).toBe(2);
    const ll = (ps: number[], ys: boolean[]) =>
      ps.reduce((sum, p, i) => sum - Math.log(ys[i] ? p : 1 - p), 0) / ps.length;
    expect(c.logLoss?.kustom).toBeCloseTo(ll([0.6, 0.55], [true, false]), 12);
    expect(c.logLoss?.openSkill).toBeCloseTo(ll([0.8, 0.7], [true, false]), 12);
    expect(c.logLoss?.coin).toBeCloseTo(Math.log(2), 12);
  });

  it('ranks the 10+ board and everyone on both boards', () => {
    // 10+: old a b c d, new a c b d: d² = 2 over n = 4 -> 1 - 12/60 = 0.8.
    expect(c.spearman).toEqual({ settled: 0.8, settledPlayers: 4, all: expect.any(Number), allPlayers: 5 });
    expect(c.top3Overlap).toBe(3);
    expect(c.placesMoved).toEqual({ mean: 0.5, max: 1 });
    expect(c.board.map((b) => [b.newPlace, b.oldPlace, b.name])).toEqual([
      [1, 1, 'A'],
      [2, 3, 'C'],
      [3, 2, 'B'],
      [4, 4, 'D'],
    ]);
  });

  it('shows the last two weeks of old and new changes, most games first', () => {
    expect(c.recent).toEqual([
      {
        name: 'A',
        changes: [
          { old: -55, new: -8 },
          { old: 61, new: 10 },
        ],
      },
      { name: 'B', changes: [{ old: null, new: 7 }] },
    ]);
  });

  it('prints the gate lines the owner reads', () => {
    const lines = formatComparison(c);
    expect(lines[0]).toMatch(
      /^gate {10}log loss 0\.\d{3} kustom vs 0\.\d{3} stored openskill fold_p over 2 games \(coin 0\.693\)$/,
    );
    expect(lines[1]).toBe(
      `              spearman 0.800 over 4 with 10+ games, ${c.spearman.all?.toFixed(3)} over all 5; top 3 3 of 3; places moved mean 0.5, max 1`,
    );
    expect(lines).toContain('board         new  old  player                 new Rating  old Rating');
    expect(
      lines.some((line) => line.startsWith('last 2 weeks  A') && line.endsWith('old -55 +61  new -8 +10')),
    ).toBe(true);
    expect(lines.some((line) => line.trimEnd().endsWith('old ?  new +7'))).toBe(true);
  });

  it('says so when no game has stored odds and too few are settled', () => {
    const empty = compareRebuild({
      games: [{ blueWon: true, oldBlueP: null, newBlueP: 0.5 }],
      changes: [],
      players: [player('a', 1, null, 1216)],
      recentSince: null,
    });
    expect(empty).toMatchObject({ games: 0, logLoss: null, top3Overlap: null, placesMoved: null, board: [] });
    expect(formatComparison(empty)[0]).toBe('gate          log loss: no game with stored OpenSkill odds');
  });
});
