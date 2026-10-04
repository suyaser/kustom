/**
 * What the mode rules know about a champion (M15.4 tags, M15.9 region), in the shape core's
 * `ChampionTable` takes per key: `tags: null` means unknown, `region: null` means no row, and a
 * region is a set (M20.2, M20 D1): the Riot Universe region from `regions.ts` first (none when it
 * is `unaffiliated`), then the Kustom home region(s) from `homeRegions.ts`. The empty set is
 * unaffiliated. Core's types are not imported here; M15.3 / M15.5 wire it
 * (`new Map(championFactEntries())`). Plain data, no imports beyond the three tables.
 */

import { homeRegions } from './homeRegions';
import { championRegion, type RegionId, regionChampionIds } from './regions';
import { championTags, taggedChampionIds } from './tags';

export interface ChampionFacts {
  tags: readonly string[] | null;
  region: readonly RegionId[] | null;
}

/** A champion's region set: no Universe row is `null`; Universe first, then the home(s). */
function regionSet(id: number): readonly RegionId[] | null {
  const universe = championRegion(id);
  if (universe === null) return null;
  return [...(universe === 'unaffiliated' ? [] : [universe]), ...homeRegions(id)];
}

export function championFacts(id: number): ChampionFacts {
  return { tags: championTags(id), region: regionSet(id) };
}

/** One entry per key either table has, ascending. */
export function championFactEntries(): [number, ChampionFacts][] {
  const ids = [...new Set([...taggedChampionIds(), ...regionChampionIds()])].sort((a, b) => a - b);
  return ids.map((id) => [id, championFacts(id)]);
}
