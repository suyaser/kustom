/**
 * Test data for the mode tests only (never exported from the package). Champion ids are the
 * real Data Dragon keys so a failing test reads like a game; the tags and regions are what the
 * tests need, not a copy of the pin (M15.4 and M15.9 own the real tables, in apps/web).
 */

import type { ChampionFacts, ChampionTable, ClassTag } from './model';

export const JINX = 222;
export const ASHE = 22;
export const LEONA = 89;
export const LUX = 99;
export const GAREN = 86;
export const AHRI = 103;
export const SYNDRA = 134;
export const ZED = 238;
export const MALPHITE = 54;
export const THRESH = 412;
export const BRAUM = 201;
export const DARIUS = 122;
/** Newer than the pin: in no table. */
export const AMBESSA = 799;
/** Tags known, no region row. */
export const SMOLDER = 901;
/** Region `unaffiliated`: an empty set. */
export const RYZE = 13;
/** Two regions (M20 D1): Piltover on Universe, Zaun on the Kustom home list. Not in `ROSTER`. */
export const VI = 254;

export const ROSTER: ChampionTable = new Map([
  [JINX, { tags: ['Marksman'], region: ['zaun'] }],
  [ASHE, { tags: ['Marksman', 'Support'], region: ['freljord'] }],
  [LEONA, { tags: ['Tank', 'Support'], region: ['targon'] }],
  [LUX, { tags: ['Mage', 'Support'], region: ['demacia'] }],
  [GAREN, { tags: ['Fighter', 'Tank'], region: ['demacia'] }],
  [AHRI, { tags: ['Mage', 'Assassin'], region: ['ionia'] }],
  [SYNDRA, { tags: ['Mage'], region: ['ionia'] }],
  [ZED, { tags: ['Assassin'], region: ['ionia'] }],
  [MALPHITE, { tags: ['Tank', 'Mage'], region: ['ixtal'] }],
  [THRESH, { tags: ['Support', 'Fighter'], region: ['shadow-isles'] }],
  [BRAUM, { tags: ['Support', 'Tank'], region: ['freljord'] }],
  [DARIUS, { tags: ['Fighter', 'Tank'], region: ['noxus'] }],
  [SMOLDER, { tags: ['Marksman', 'Mage'], region: null }],
  [RYZE, { tags: ['Mage'], region: [] }],
]);

/**
 * A synthetic roster with exactly `counts[tag]` single-tag champions per class and
 * `regionCounts[region]` champions per region (ids from 10000 up, regions dealt in order, so
 * a class and a region are independent). For threshold tests.
 */
export function syntheticRoster(
  counts: Partial<Record<ClassTag | 'Fighter', number>>,
  regionCounts: Record<string, number> = {},
): ChampionTable {
  const regions: string[] = [];
  for (const [region, n] of Object.entries(regionCounts)) {
    for (let i = 0; i < n; i += 1) regions.push(region);
  }
  const table = new Map<number, ChampionFacts>();
  // One region each; `unaffiliated` is the empty set, a missing slot is no row.
  const set = (region: string | undefined) =>
    region === undefined ? null : region === 'unaffiliated' ? [] : [region];
  let id = 10000;
  for (const [tag, n] of Object.entries(counts)) {
    for (let i = 0; i < (n ?? 0); i += 1) {
      table.set(id, { tags: [tag], region: set(regions[id - 10000]) });
      id += 1;
    }
  }
  // Regions longer than the class list still get champions, with no class.
  for (let i = id - 10000; i < regions.length; i += 1) {
    table.set(10000 + i, { tags: [], region: set(regions[i]) });
  }
  return table;
}

/**
 * A roster built from region sets (M20.2): `[regions, n]` adds `n` champions whose set is exactly
 * `regions` (ids from 20000 up, in order), so a test can say "8 Ionia, 8 Noxus, 1 in both".
 */
export function setRoster(groups: readonly (readonly [readonly string[], number])[]): ChampionTable {
  const table = new Map<number, ChampionFacts>();
  let id = 20000;
  for (const [regions, n] of groups) {
    for (let i = 0; i < n; i += 1) {
      table.set(id, { tags: [], region: [...regions] });
      id += 1;
    }
  }
  return table;
}

/** Mulberry32: a tiny seeded PRNG, so a distribution test is a pinned number. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An RNG that returns the given values in turn (then repeats the last). */
export function sequence(...values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)] ?? 0;
    i += 1;
    return value;
  };
}
