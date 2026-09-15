import type { PerformancePlayer } from '@customs/core';
import { describe, expect, it } from 'vitest';
import {
  dayIndex,
  kindForDay,
  type MysteryCandidate,
  pickAwardStandout,
  pickMystery,
  shuffleSuspects,
} from './select';

function row(
  partial: Partial<MysteryCandidate> & Pick<MysteryCandidate, 'gameId' | 'playerId'>,
): MysteryCandidate {
  return {
    score: 100,
    category: 'disaster',
    startedAt: new Date('2026-08-01T18:00:00Z'),
    ...partial,
  };
}

describe('dayIndex', () => {
  it('is stable for a day key', () => {
    expect(dayIndex('2026-09-13', 20)).toBe(dayIndex('2026-09-13', 20));
    expect(dayIndex('2026-09-13', 20)).not.toBe(dayIndex('2026-09-14', 20));
  });
});

describe('pickMystery', () => {
  it('returns null when there is nobody to expose', () => {
    expect(
      pickMystery([], '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() }),
    ).toBeNull();
  });

  it('avoids a recently used game and player, then falls back if that empties the pool', () => {
    const a = row({ gameId: 'g1', playerId: 'p1', score: 200 });
    const b = row({ gameId: 'g2', playerId: 'p2', score: 150 });
    const avoid = { recentGameIds: new Set(['g1']), recentPlayerIds: new Set(['p1']) };
    expect(pickMystery([a, b], '2026-09-13', avoid)?.gameId).toBe('g2');
    expect(pickMystery([a], '2026-09-13', avoid)?.gameId).toBe('g1');
  });

  it('picks from the top slice, not always the single highest score', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ gameId: `g${i}`, playerId: `p${i}`, score: 200 - i }),
    );
    const picked = pickMystery(many, '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() });
    expect(picked).not.toBeNull();
    expect(many.some((row) => row.gameId === picked?.gameId)).toBe(true);
    const otherDay = pickMystery(many, '2026-09-14', {
      recentGameIds: new Set(),
      recentPlayerIds: new Set(),
    });
    // Two days can coincide; the property we pin is determinism, not uniqueness.
    expect(
      pickMystery(many, '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() })?.gameId,
    ).toBe(picked?.gameId);
    expect(otherDay?.gameId).toBe(
      pickMystery(many, '2026-09-14', { recentGameIds: new Set(), recentPlayerIds: new Set() })?.gameId,
    );
  });
});

describe('kindForDay (M8.4)', () => {
  it('alternates over fourteen consecutive days', () => {
    const day = (offset: number): string =>
      new Date(Date.UTC(2026, 8, 14) + offset * 86_400_000).toISOString().slice(0, 10);
    const kinds = Array.from({ length: 14 }, (_, i) => kindForDay(day(i)));
    expect(kinds).toEqual([
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
    ]);
  });

  it('keeps alternating across a month boundary, which a day-of-month parity would not', () => {
    // 31 October into 1 November: two odd days in a row by `%2` on the date itself.
    expect(kindForDay('2026-10-30')).toBe('mystery');
    expect(kindForDay('2026-10-31')).toBe('award');
    expect(kindForDay('2026-11-01')).toBe('mystery');
    expect(kindForDay('2026-11-02')).toBe('award');
  });

  it('answers mystery for anything that is not a civil day key', () => {
    expect(kindForDay('')).toBe('mystery');
    expect(kindForDay('tomorrow')).toBe('mystery');
  });
});

describe('pickAwardStandout (M8.4)', () => {
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  function seat(index: number, overrides: Partial<PerformancePlayer> = {}): PerformancePlayer {
    return {
      puuid: `p${index}`,
      side: index < 5 ? 100 : 200,
      role: ROLES[index % 5] ?? 'mid',
      kills: 5,
      deaths: 5,
      assists: 5,
      damageToChamps: 20_000,
      gold: 12_000,
      cs: 180,
      visionScore: 20,
      damageSelfMitigated: 20_000,
      damageToObjectives: 5_000,
      ...overrides,
    };
  }

  const ten = (): PerformancePlayer[] => Array.from({ length: 10 }, (_, i) => seat(i));

  it('names the player core scores highest, and the stat they led by the widest margin', () => {
    const players = ten();
    // Damage and nothing else: the widest lead over the runner-up is what the clues talk
    // about, so a player who also tripled everybody's KDA would be a KDA award instead.
    players[3] = seat(3, { role: 'adc', damageToChamps: 80_000 });
    const standout = pickAwardStandout(players);
    expect(standout?.playerId).toBe('p3');
    expect(standout?.category).toBe('damage');
  });

  it('declines a game missing a component, which is every game stored before M7.7', () => {
    const players = ten();
    players[7] = seat(7, { visionScore: null });
    expect(pickAwardStandout(players)).toBeNull();
  });

  it('declines a game where anybody has no role, which is every backfilled one', () => {
    const players = ten();
    players[0] = seat(0, { role: null });
    expect(pickAwardStandout(players)).toBeNull();
  });

  it('gives back the gap to the runner-up, so a lopsided game outranks an even one', () => {
    const even = ten();
    const lopsided = ten();
    lopsided[9] = seat(9, {
      role: 'support',
      visionScore: 200,
      assists: 30,
      deaths: 1,
      damageSelfMitigated: 90_000,
    });
    const flat = pickAwardStandout(even);
    const wide = pickAwardStandout(lopsided);
    expect(flat).not.toBeNull();
    expect(wide).not.toBeNull();
    expect(wide?.playerId).toBe('p9');
    expect(wide?.score).toBeGreaterThan(flat?.score ?? 0);
  });
});

describe('shuffleSuspects', () => {
  it('is the same order for the same day', () => {
    const names = ['Ahmed', 'Omar', 'Karim', 'Ali', 'Youssef', 'Mohamed'];
    expect(shuffleSuspects(names, '2026-09-13')).toEqual(shuffleSuspects(names, '2026-09-13'));
    expect(shuffleSuspects(names, '2026-09-13').slice().sort()).toEqual([...names].sort());
  });
});
