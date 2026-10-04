/**
 * Pools (M15.2, brief D4 and D7): which champions a mode allows, minus the Fearless bans the
 * caller passes. Pass bans only on a standing-Fearless night; under Normal pass none, and the
 * panel shows the rule's whole pool.
 *
 * Every list is sorted by champion key, so the same input gives the same output.
 */

import { config } from '../config';
import {
  type ChampionTable,
  type ClassTag,
  inRegion,
  type Mode,
  type RegionId,
  type RuleOption,
  UNAFFILIATED,
} from './model';

/** A pool split into what is still open and what Fearless banned. */
export interface PoolSplit {
  open: number[];
  banned: number[];
}

/** One pool both sides share, or one per side (region wars). */
export type ModePool =
  | { kind: 'shared'; pool: PoolSplit }
  | { kind: 'sides'; blue: PoolSplit; red: PoolSplit };

export type Bans = ReadonlySet<number> | readonly number[];

const byKey = (a: number, b: number) => a - b;

function toSet(bans: Bans): ReadonlySet<number> {
  return bans instanceof Set ? bans : new Set(bans as readonly number[]);
}

function split(ids: readonly number[], bans: ReadonlySet<number>): PoolSplit {
  const sorted = [...ids].sort(byKey);
  return { open: sorted.filter((id) => !bans.has(id)), banned: sorted.filter((id) => bans.has(id)) };
}

/** Every champion with the class among **any** of its tags (not only the first). */
export function classPool(tag: ClassTag, roster: ChampionTable): number[] {
  const ids: number[] = [];
  for (const [id, facts] of roster) if (facts.tags?.includes(tag)) ids.push(id);
  return ids.sort(byKey);
}

/** Every champion whose region set contains `region` (a shared champion is in both its pools). */
export function regionPool(region: RegionId, roster: ChampionTable): number[] {
  const ids: number[] = [];
  for (const [id, facts] of roster) if (inRegion(facts, region)) ids.push(id);
  return ids.sort(byKey);
}

/** The mode's pool, minus `fearlessBans`. A ban outside the pool is ignored here. */
export function modePool(mode: Mode, roster: ChampionTable, fearlessBans: Bans): ModePool {
  const bans = toSet(fearlessBans);
  switch (mode.id) {
    case 'class':
      return { kind: 'shared', pool: split(classPool(mode.tag, roster), bans) };
    case 'region':
      return {
        kind: 'sides',
        blue: split(regionPool(mode.blue, roster), bans),
        red: split(regionPool(mode.red, roster), bans),
      };
    default:
      return { kind: 'shared', pool: split([...roster.keys()], bans) };
  }
}

/**
 * Open champions per region, by membership: a shared champion counts once for each of its regions,
 * so the counts can add up to more than the roster. An empty set counts under `unaffiliated`; no
 * row is not counted.
 */
export function regionOpenCounts(roster: ChampionTable, fearlessBans: Bans): Map<RegionId, number> {
  const bans = toSet(fearlessBans);
  const counts = new Map<RegionId, number>();
  const add = (region: RegionId) => counts.set(region, (counts.get(region) ?? 0) + 1);
  for (const [id, facts] of roster) {
    if (facts.region === null || bans.has(id)) continue;
    const regions = new Set(facts.region.filter((region) => region !== UNAFFILIATED));
    if (regions.size === 0) add(UNAFFILIATED);
    for (const region of regions) add(region);
  }
  return counts;
}

/** Open champions per region, as sets of keys (membership, bans removed, no `unaffiliated`). */
function regionOpenSets(roster: ChampionTable, bans: ReadonlySet<number>): Map<RegionId, Set<number>> {
  const sets = new Map<RegionId, Set<number>>();
  for (const [id, facts] of roster) {
    if (facts.region === null || bans.has(id)) continue;
    for (const region of facts.region) {
      if (region === UNAFFILIATED) continue;
      const set = sets.get(region) ?? new Set<number>();
      set.add(id);
      sets.set(region, set);
    }
  }
  return sets;
}

/** M20 D2 on precomputed open sets. */
function pairPasses(a: ReadonlySet<number> | undefined, b: ReadonlySet<number> | undefined): boolean {
  const min = config.modes.regionMinOpen;
  if (a === undefined || b === undefined || a.size < min || b.size < min) return false;
  let shared = 0;
  for (const id of a) if (b.has(id)) shared += 1;
  return a.size + b.size - shared >= 2 * min;
}

/**
 * A pair test bound to one roster and one set of bans, so a draw over many pairs builds the open
 * sets once. Internal: callers use `pairDrawable`, `rulePlayable` or `drawRegions`.
 */
export function pairTester(
  roster: ChampionTable,
  fearlessBans: Bans,
): (blue: RegionId, red: RegionId) => boolean {
  const sets = regionOpenSets(roster, toSet(fearlessBans));
  return (blue, red) =>
    blue !== red &&
    blue !== UNAFFILIATED &&
    red !== UNAFFILIATED &&
    pairPasses(sets.get(blue), sets.get(red));
}

/**
 * Whether region wars may put `blue` against `red` (M20 D2): with `fearlessBans` removed, each has
 * at least `config.modes.regionMinOpen` (8) open **and** the two together have at least twice that
 * (16) different open champions, so each side keeps 8 of its own even if the other side takes every
 * champion they share. Never the same region twice, never `unaffiliated`. Symmetric in the sides.
 */
export function pairDrawable(
  blue: RegionId,
  red: RegionId,
  roster: ChampionTable,
  fearlessBans: Bans,
): boolean {
  return pairTester(roster, fearlessBans)(blue, red);
}

/** The regions region wars may draw: not `unaffiliated`, at least `config.modes.regionMinOpen` open. Sorted. */
export function drawableRegions(
  openCounts: ReadonlyMap<RegionId, number>,
  regions?: Iterable<RegionId>,
): RegionId[] {
  const candidates = new Set(regions ?? openCounts.keys());
  return [...candidates]
    .filter(
      (region) => region !== UNAFFILIATED && (openCounts.get(region) ?? 0) >= config.modes.regionMinOpen,
    )
    .sort();
}

/**
 * Whether a rule can be picked or spun right now (D7). A class needs `classMinOpen` open; region
 * wars needs at least one pair passing `pairDrawable` (M20 D2); mirror match is always playable. A rule already picked stays
 * picked if its pool shrinks later: this gates the choice, not the game.
 */
export function rulePlayable(rule: RuleOption, roster: ChampionTable, fearlessBans: Bans): boolean {
  switch (rule.id) {
    case 'class': {
      const bans = toSet(fearlessBans);
      return classPool(rule.tag, roster).filter((id) => !bans.has(id)).length >= config.modes.classMinOpen;
    }
    case 'region': {
      const passes = pairTester(roster, fearlessBans);
      const regions = drawableRegions(regionOpenCounts(roster, fearlessBans));
      return regions.some((blue) => regions.some((red) => passes(blue, red)));
    }
    case 'mirror':
      return true;
  }
}
