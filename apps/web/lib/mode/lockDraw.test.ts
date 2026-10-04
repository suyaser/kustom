import {
  type ChampionFacts,
  type ChampionTable,
  drawRegions,
  type ModeState,
  regionOpenCounts,
} from '@customs/core';
import { describe, expect, it } from 'vitest';
import { lockFor } from './lock';

/**
 * M20.3: Roll draws region wars on the roster, so M20 D2's shared-champion rule holds. Ionia and
 * Noxus each have 8 open but share one champion (15 different), so that pair fails only on the
 * union; Demacia (9, its own) passes with either.
 */

function roster(): ChampionTable {
  const rows = new Map<number, ChampionFacts>();
  for (let i = 1; i <= 7; i += 1) rows.set(i, { tags: ['Mage'], region: ['ionia'] });
  rows.set(8, { tags: ['Mage'], region: ['ionia', 'noxus'] });
  for (let i = 11; i <= 17; i += 1) rows.set(i, { tags: ['Tank'], region: ['noxus'] });
  for (let i = 21; i <= 29; i += 1) rows.set(i, { tags: ['Marksman'], region: ['demacia'] });
  return rows;
}

const regionWars: ModeState = {
  standing: 'normal',
  pending: { id: 'region' },
  ratedOverride: null,
  version: 3,
};

/** The i-th of n evenly spread RNG values, the same for both picks of one draw. */
const rngAt = (i: number, n: number) => () => i / n;

describe('Roll applies the union rule (M20 D2)', () => {
  it('never draws a pair that fails only on the union, over 1,000 RNG values', () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const lock = lockFor(regionWars, null, {
        table: roster(),
        regions: ['ionia', 'noxus', 'demacia', 'unaffiliated'],
        bans: [],
        rng: rngAt(i, 1000),
      });
      const mode = lock.lock.mode;
      expect(mode.id).toBe('region');
      if (mode.id === 'region') drawn.add([mode.blue, mode.red].sort().join(' vs '));
    }
    expect([...drawn].sort()).toEqual(['demacia vs ionia', 'demacia vs noxus']);
  });

  it('with only the failing pair on offer, the game locks the standing mode (no draw)', () => {
    const lock = lockFor(regionWars, null, {
      table: roster(),
      regions: ['ionia', 'noxus'],
      bans: [],
      rng: () => 0,
    });
    expect(lock.lock.mode).toEqual({ id: 'normal' });
    expect(lock.noDraw).toBe(true);
    // The count form this replaced would have drawn it: it cannot see the shared champion.
    expect(drawRegions(['ionia', 'noxus'], regionOpenCounts(roster(), []), () => 0)).not.toBeNull();
  });
});
