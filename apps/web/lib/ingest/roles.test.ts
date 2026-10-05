import type { Role } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { fillGuardFlags, type SplitSeat, stillFilled } from './roles';

/**
 * The fill guard's rule (M5.17, amended by M21.8), on the pure half. The I/O around it
 * (`roleInferenceFlags`, `selectReleasedFillFlags`) is in `roles.integration.test.ts`.
 *
 * Ten players `p0..p9`, every one a mid main with a top backup, so every seat but mid and top is a
 * fill. The split puts `p0..p4` on blue and `p5..p9` on red, in lane order.
 */

const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const puuid = (i: number) => `p${i}`;

const SPLIT: SplitSeat[] = Array.from({ length: 10 }, (_, i) => ({
  puuid: puuid(i),
  side: i < 5 ? 100 : 200,
  role: LANES[i % 5] as Role,
}));

interface Seat {
  side: number;
  role: Role | null;
}

/** The ten as they played: the split's seats unless `changes` says otherwise. */
function played(changes: Record<number, Partial<Seat>> = {}) {
  return SPLIT.map((seat, i) => {
    const change = changes[i] ?? {};
    return {
      playerId: `id${i}`,
      puuid: seat.puuid,
      mainRole: 'mid' as Role,
      secondaryRole: 'top' as Role,
      roleOverride: null as Role | null,
      side: change.side ?? seat.side,
      role: 'role' in change ? (change.role ?? null) : seat.role,
    };
  });
}

/** The ids the guard marks filled, sorted. */
function filled(flags: Map<string, boolean>): string[] {
  return [...flags]
    .filter(([, counts]) => !counts)
    .map(([id]) => id)
    .sort();
}

const ROLLED_FILLS = ['id1', 'id3', 'id4', 'id6', 'id8', 'id9'];

describe('fillGuardFlags', () => {
  it('marks the off-role seats of a split played as rolled', () => {
    expect(filled(fillGuardFlags(SPLIT, played()))).toEqual(ROLLED_FILLS);
  });

  it('marks the same seats when the split was played on swapped sides', () => {
    const swapped = played(Object.fromEntries(SPLIT.map((s, i) => [i, { side: s.side === 100 ? 200 : 100 }])));
    expect(filled(fillGuardFlags(SPLIT, swapped))).toEqual(ROLLED_FILLS);
  });

  it('M21.8 (b): counts everybody when the room played other teams', () => {
    // p1 and p6 swap teams (and keep their roles): the bot did not choose these teams.
    expect(fillGuardFlags(SPLIT, played({ 1: { side: 200 }, 6: { side: 100 } }))).toEqual(new Map());
  });

  it('M21.8: counts a player who played another role than the split gave them', () => {
    // p1 was put on jungle but played mid; p2 (mid in the split) took jungle by choice.
    const seats = played({ 1: { role: 'mid' }, 2: { role: 'jungle' } });
    expect(filled(fillGuardFlags(SPLIT, seats))).toEqual(['id3', 'id4', 'id6', 'id8', 'id9']);
  });

  it('keeps the split role when the client reported none', () => {
    expect(filled(fillGuardFlags(SPLIT, played({ 1: { role: null } })))).toEqual(ROLLED_FILLS);
  });

  it('counts everybody when there is no split', () => {
    expect(fillGuardFlags(null, played())).toEqual(new Map());
    expect(fillGuardFlags([], played())).toEqual(new Map());
  });

  it("reads tonight's tap as the main: a jungle tap on a jungle seat counts", () => {
    const seats = played().map((p) => (p.playerId === 'id1' ? { ...p, roleOverride: 'jungle' as Role } : p));
    expect(filled(fillGuardFlags(SPLIT, seats))).toEqual(['id3', 'id4', 'id6', 'id8', 'id9']);
  });
});

describe('stillFilled (the refold of a stored false)', () => {
  it('keeps a false when the split was played as rolled', () => {
    expect(stillFilled(SPLIT, played(), 'id1')).toBe(true);
  });

  it('releases every false of a game whose teams were not the split', () => {
    const swapped = played({ 1: { side: 200 }, 6: { side: 100 } });
    for (const id of ROLLED_FILLS) expect(stillFilled(SPLIT, swapped, id)).toBe(false);
  });

  it('releases a player who played another role, and only them', () => {
    const roles = played({ 1: { role: 'mid' }, 2: { role: 'jungle' } });
    expect(stillFilled(SPLIT, roles, 'id1')).toBe(false);
    expect(stillFilled(SPLIT, roles, 'id3')).toBe(true);
  });

  it('releases a false with no split or a player the split does not name', () => {
    expect(stillFilled(null, played(), 'id1')).toBe(false);
    expect(stillFilled(SPLIT, played(), 'nobody')).toBe(false);
  });
});
