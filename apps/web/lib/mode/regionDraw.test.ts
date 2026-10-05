import {
  type ChampionFacts,
  type ChampionTable,
  drawRegions,
  type ModeRow,
  regionOpenCounts,
  take,
  transition,
} from '@customs/core';
import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { championTable, regionIds } from './champions';
import { modeContext } from './context';

/**
 * M20.3, moved by M20.7: region wars is drawn on the roster (the champion table, not per-region
 * counts), so M20 D2's shared-champion rule holds, now when region wars is **chosen** (M20 D9) and
 * when Roll redraws a pair the bans made short (M20 D11). Ionia and Noxus each have 8 open but
 * share one champion (15 different), so that pair fails only on the union; Demacia (9, its own)
 * passes with either.
 */

function roster(): ChampionTable {
  const rows = new Map<number, ChampionFacts>();
  for (let i = 1; i <= 7; i += 1) rows.set(i, { tags: ['Mage'], region: ['ionia'] });
  rows.set(8, { tags: ['Mage'], region: ['ionia', 'noxus'] });
  for (let i = 11; i <= 17; i += 1) rows.set(i, { tags: ['Tank'], region: ['noxus'] });
  for (let i = 21; i <= 29; i += 1) rows.set(i, { tags: ['Marksman'], region: ['demacia'] });
  return rows;
}

const normal: ModeRow = { standing: 'normal', pending: null, rated: null };

/** The i-th of n evenly spread RNG values, the same for both picks of one draw. */
const rngAt = (i: number, n: number) => () => i / n;

describe('choosing region wars applies the union rule (M20 D2, D9)', () => {
  it('never draws a pair that fails only on the union, over 1,000 RNG values', () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const result = transition(
        normal,
        { type: 'pick', rule: { id: 'region' } },
        {
          roster: roster(),
          regions: ['ionia', 'noxus', 'demacia', 'unaffiliated'],
          fearlessPool: [],
          rng: rngAt(i, 1000),
        },
      );
      expect(result.ok).toBe(true);
      const pending = result.ok ? result.patch.pending : null;
      if (pending?.id === 'region') drawn.add([pending.blue, pending.red].sort().join(' vs '));
    }
    expect([...drawn].sort()).toEqual(['demacia vs ionia', 'demacia vs noxus']);
  });

  it('with only the failing pair on offer, region wars cannot be chosen; Roll with it pending is the no-draw path', () => {
    const context = { roster: roster(), regions: ['ionia', 'noxus'], fearlessPool: [], rng: () => 0 };
    expect(transition(normal, { type: 'pick', rule: { id: 'region' } }, context)).toEqual({
      ok: false,
      refusal: 'too-few-open',
    });
    const pending: ModeRow = { ...normal, pending: { id: 'region', blue: 'ionia', red: 'noxus' } };
    expect(take(pending, context)).toMatchObject({
      lock: { mode: { id: 'normal' } },
      regions: { outcome: 'no-draw' },
    });
    // The count form this replaced would have drawn it: it cannot see the shared champion.
    expect(drawRegions(['ionia', 'noxus'], regionOpenCounts(roster(), []), () => 0)).not.toBeNull();
  });
});

describe('the server context (lib/mode/context.ts)', () => {
  it('is the roster form of the champion table and every region id, with no read on a Normal night', async () => {
    const untouchable = {} as ServiceClient;
    const context = await modeContext(untouchable, 'g', 'normal', { rng: () => 0.5 });
    expect(context.roster).toBe(championTable());
    expect(context.regions).toBe(regionIds());
    expect(context.fearlessPool).toEqual([]);
    expect(context.rng()).toBe(0.5);
  });

  it('reads no pool for a lock taken at game start, Fearless or not', async () => {
    const context = await modeContext({} as ServiceClient, 'g', 'fearless', { bans: false });
    expect(context.fearlessPool).toEqual([]);
  });
});
