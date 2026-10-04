import { rateGameKustom } from '@customs/core';
import { describe, expect, it } from 'vitest';
import {
  type FoldRatedPlayer,
  foldGameKustom,
  gameAward,
  gameScores,
  gateRatedGame,
  KUSTOM_FRESH,
} from './fold';

/**
 * M18.5: `foldGameKustom` is `rateGameKustom` once per track on the same ten and the same scores,
 * keyed by player id, and nothing else. The database half is `kustom.integration.test.ts`.
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

function ten(scored = true): FoldRatedPlayer[] {
  return Array.from({ length: 10 }, (_, index) => ({
    playerId: `p${index}`,
    puuid: `u${9 - index}`,
    side: index < 5 ? (100 as const) : (200 as const),
    role: ROLES[index % 5] ?? null,
    kills: index,
    deaths: 10 - index,
    assists: index * 2,
    damageToChamps: 20_000 + index * 2_500,
    gold: 10_000 + index * 250,
    cs: 150 + index * 3,
    visionScore: scored ? 20 + index : null,
    damageSelfMitigated: 8_000 + index * 400,
    damageToObjectives: 3_000 + index * 600,
  }));
}

function gated(players: readonly FoldRatedPlayer[]) {
  const gate = gateRatedGame(players, 1_800, { gameMode: 'CLASSIC' }, true);
  if (!gate.ok) throw new Error(gate.reason);
  return gate;
}

const allTime = new Map(
  Array.from({ length: 10 }, (_, index) => [`p${index}`, { r: 1150 + index * 17.5, n: index * 3 }]),
);
const week = new Map([
  ['p0', { r: 1216, n: 1 }],
  ['p7', { r: 1184.5, n: 2 }],
]);

describe('foldGameKustom (M18.5)', () => {
  it('is rateGameKustom on each track, with a missing player at 1200 and 0', () => {
    const players = ten();
    const { blue, red } = gated(players);
    const out = foldGameKustom(blue, red, { allTime, week }, 200);
    const scores = new Map((gameScores([...blue, ...red]) ?? []).map((s) => [s.puuid, s.score]));
    const byHand = (track: ReadonlyMap<string, { r: number; n: number }>) =>
      rateGameKustom({
        players: [...blue, ...red].map((p) => ({
          puuid: p.puuid,
          side: p.side,
          r: track.get(p.playerId)?.r ?? 1200,
          n: track.get(p.playerId)?.n ?? 0,
          score: scores.get(p.puuid) ?? null,
        })),
        winningSide: 200,
      });
    const allRows = byHand(allTime);
    const weekRows = byHand(week);
    [...blue, ...red].forEach((p, index) => {
      const outcome = out.get(p.playerId);
      const a = allRows[index];
      const w = weekRows[index];
      expect(outcome?.allTime).toEqual({
        rBefore: a?.rBefore,
        rAfter: a?.rAfter,
        k: a?.k,
        expected: a?.expected,
        n: allTime.get(p.playerId)?.n,
      });
      expect(outcome?.week).toEqual({
        rBefore: w?.rBefore,
        rAfter: w?.rAfter,
        k: w?.k,
        expected: w?.expected,
        n: week.get(p.playerId)?.n ?? 0,
      });
      expect(outcome?.shareRank).toBe(w?.shareRank);
      expect(outcome?.award).toBe(w?.award);
    });
    // A player with no weekly row: 1200, n 0, K 32.
    expect(out.get('p3')?.week).toMatchObject({ rBefore: KUSTOM_FRESH.r, n: 0, k: 32 });
  });

  it('names the same MVP and ACE the OpenSkill bonus does (one score, one tie-break)', () => {
    const players = ten();
    const { blue, red } = gated(players);
    for (const winner of [100, 200] as const) {
      const out = foldGameKustom(blue, red, { allTime, week }, winner);
      const award = gameAward([...blue, ...red], winner);
      for (const p of players) {
        expect(out.get(p.playerId)?.award).toBe(
          p.puuid === award?.mvp ? 'mvp' : p.puuid === award?.ace ? 'ace' : 'none',
        );
      }
    }
  });

  it('folds the weekly track alone when the all-time map is null (a game before the reset)', () => {
    const { blue, red } = gated(ten());
    const out = foldGameKustom(blue, red, { allTime: null, week: new Map() }, 100);
    for (const outcome of out.values()) {
      expect(outcome.allTime).toBeNull();
      expect(outcome.week).toMatchObject({ rBefore: 1200, k: 32, expected: 0.5, n: 0 });
    }
  });

  it('gives a game with no performance score no share rank and nobody named, on both tracks', () => {
    const { blue, red } = gated(ten(false));
    const out = foldGameKustom(blue, red, { allTime, week }, 100);
    for (const outcome of out.values()) {
      expect([outcome.shareRank, outcome.award]).toEqual([null, 'none']);
    }
  });
});
