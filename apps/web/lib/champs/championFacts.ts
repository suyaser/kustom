/**
 * What the mode rules know about a champion (M15.4 tags, M15.9 region), in the shape core's
 * `ChampionTable` takes per key: `tags: null` means unknown, `region: null` means no row, and a
 * region is a set (M20.2): today one region from the table, and `'unaffiliated'` is the empty set.
 * M20.3 adds the Kustom home region as a second member. Core's types are not imported here; M15.3 /
 * M15.5 wire it (`new Map(championFactEntries())`). Plain data, no imports beyond the two tables.
 */

import { championRegion, type RegionId, regionChampionIds } from './regions';
import { championTags, taggedChampionIds } from './tags';

export interface ChampionFacts {
  tags: readonly string[] | null;
  region: readonly RegionId[] | null;
}

/** The table's one region as a set: no row is `null`, `unaffiliated` is empty. */
function regionSet(region: RegionId | null): readonly RegionId[] | null {
  if (region === null) return null;
  return region === 'unaffiliated' ? [] : [region];
}

export function championFacts(id: number): ChampionFacts {
  return { tags: championTags(id), region: regionSet(championRegion(id)) };
}

/** One entry per key either table has, ascending. */
export function championFactEntries(): [number, ChampionFacts][] {
  const ids = [...new Set([...taggedChampionIds(), ...regionChampionIds()])].sort((a, b) => a - b);
  return ids.map((id) => [id, championFacts(id)]);
}
