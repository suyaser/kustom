import type { ChampionTable, RegionId } from '@customs/core';
import { championFactEntries } from '../champs/championFacts';
import { REGION_IDS } from '../champs/regions';

/**
 * The web's champion facts as core's `ChampionTable` (M15.3): Data Dragon tags (M15.4) and the
 * region table (M15.9), keyed by champion key. Built once per process: both tables are static
 * data in the bundle, never fetched at runtime.
 *
 * Spin's playability, the region draw at Roll and the post-game check all read this one table, so
 * the three cannot disagree about a champion.
 */
let table: ChampionTable | null = null;

export function championTable(): ChampionTable {
  table ??= new Map(championFactEntries());
  return table;
}

/** Every region slug the table knows, `unaffiliated` included (core's draw leaves it out). */
export function regionIds(): readonly RegionId[] {
  return REGION_IDS;
}
