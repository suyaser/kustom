/**
 * What the mode rules know about a champion (M15.4 tags, M15.9 region), in the shape core's
 * `ChampionTable` takes per key: `tags: null` means unknown, `region: null` means no row, and
 * `'unaffiliated'` is a real region. Core's types are not imported here; M15.3 / M15.5 wire it
 * (`new Map(championFactEntries())`). Plain data, no imports beyond the two tables.
 */

import { championRegion, type RegionId, regionChampionIds } from './regions';
import { championTags, taggedChampionIds } from './tags';

export interface ChampionFacts {
  tags: readonly string[] | null;
  region: RegionId | null;
}

export function championFacts(id: number): ChampionFacts {
  return { tags: championTags(id), region: championRegion(id) };
}

/** One entry per key either table has, ascending. */
export function championFactEntries(): [number, ChampionFacts][] {
  const ids = [...new Set([...taggedChampionIds(), ...regionChampionIds()])].sort((a, b) => a - b);
  return ids.map((id) => [id, championFacts(id)]);
}
