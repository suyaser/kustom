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

/** Every champion whose region row is `region`. */
export function regionPool(region: RegionId, roster: ChampionTable): number[] {
  const ids: number[] = [];
  if (region === UNAFFILIATED) return ids;
  for (const [id, facts] of roster) if (facts.region === region) ids.push(id);
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

/** Open champions per region (every region row, `unaffiliated` included; no row, not counted). */
export function regionOpenCounts(roster: ChampionTable, fearlessBans: Bans): Map<RegionId, number> {
  const bans = toSet(fearlessBans);
  const counts = new Map<RegionId, number>();
  for (const [id, facts] of roster) {
    if (facts.region === null || bans.has(id)) continue;
    counts.set(facts.region, (counts.get(facts.region) ?? 0) + 1);
  }
  return counts;
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
 * wars needs two drawable regions; mirror match is always playable. A rule already picked stays
 * picked if its pool shrinks later: this gates the choice, not the game.
 */
export function rulePlayable(rule: RuleOption, roster: ChampionTable, fearlessBans: Bans): boolean {
  switch (rule.id) {
    case 'class': {
      const bans = toSet(fearlessBans);
      return classPool(rule.tag, roster).filter((id) => !bans.has(id)).length >= config.modes.classMinOpen;
    }
    case 'region':
      return drawableRegions(regionOpenCounts(roster, fearlessBans)).length >= 2;
    case 'mirror':
      return true;
  }
}
