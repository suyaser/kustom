import { describe, expect, it } from 'vitest';
import { rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import { compareDuos } from './fold';
import type { DuoRecord } from './types';
import { splitDuos, statsView } from './view';

/**
 * The duos bug (M14.17; the audit): with fewer than ten qualifying pairs, `Best together` and
 * `Worst together` were the same list read from both ends, so one pair could be a group's best and
 * worst duo on one screen. These pin the fix: never the same pair in both, and under two pairs only
 * `Best together`.
 */

function pair(i: number, wins: number, games = 10): DuoRecord {
  return {
    players: [
      { puuid: `u-a${i}`, name: `A${i}` },
      { puuid: `u-b${i}`, name: `B${i}` },
    ],
    games,
    wins,
    losses: games - wins,
    winRate: Math.round((wins / games) * 100),
  };
}

const key = (duo: DuoRecord): string => `${duo.players[0].puuid}|${duo.players[1].puuid}`;

function disjoint(best: readonly DuoRecord[], worst: readonly DuoRecord[]): boolean {
  const seen = new Set(best.map(key));
  return worst.every((duo) => !seen.has(key(duo)));
}

describe('splitDuos', () => {
  it("reproduces the audit's case and fixes it: three pairs used to be in both lists", () => {
    const duos = [pair(1, 8), pair(2, 5), pair(3, 2)].sort(compareDuos);
    const { bestDuos, worstDuos } = splitDuos(duos);
    expect(disjoint(bestDuos, worstDuos)).toBe(true);
    expect(bestDuos.map((d) => d.wins)).toEqual([8, 5]);
    expect(worstDuos.map((d) => d.wins)).toEqual([2]);
  });

  it('shows only Best together with one qualifying pair, and nothing with none', () => {
    expect(splitDuos([pair(1, 6)])).toEqual({ bestDuos: [pair(1, 6)], worstDuos: [] });
    expect(splitDuos([])).toEqual({ bestDuos: [], worstDuos: [] });
  });

  it('splits two pairs one each, best first', () => {
    const { bestDuos, worstDuos } = splitDuos([pair(1, 7), pair(2, 3)].sort(compareDuos));
    expect(bestDuos.map((d) => d.wins)).toEqual([7]);
    expect(worstDuos.map((d) => d.wins)).toEqual([3]);
  });

  it('keeps five and five, worst first, once there are ten or more', () => {
    const duos = Array.from({ length: 14 }, (_, i) => pair(i, i % 11)).sort(compareDuos);
    const { bestDuos, worstDuos } = splitDuos(duos);
    expect(bestDuos).toHaveLength(5);
    expect(worstDuos).toHaveLength(5);
    expect(disjoint(bestDuos, worstDuos)).toBe(true);
    expect(worstDuos[0]?.wins).toBe(0);
  });
});

describe('statsView duos', () => {
  it('never names one pair as best and worst, on a real fold', () => {
    // Five games of the same ten: twenty qualifying pairs (ten a side), and blue wins three.
    const games = Array.from({ length: 5 }, (_, i) =>
      tenPlayerGame({
        at: `2026-09-0${i + 1}T20:00:00Z`,
        winner: i < 3 ? 100 : 200,
        blue: ['hana', 'iris', 'omar', 'lena', 'theo'],
        red: ['yuki', 'mira', 'rami', 'sara', 'noor'],
      }),
    );
    const view = statsView({
      window: 'all-time',
      games,
      players: rosterFor(games),
      range: { start: null, end: null },
      capped: false,
      cap: 2_000,
    });
    expect(view.bestDuos.length).toBeGreaterThan(0);
    expect(view.worstDuos.length).toBeGreaterThan(0);
    expect(disjoint(view.bestDuos, view.worstDuos)).toBe(true);
  });
});
