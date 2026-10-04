/**
 * The Kustom home regions (M20.3, decision row M20 D1 and its Fizz note): our own call on where a
 * champion is also from, beside the Riot Universe region in `regions.ts`. Region wars counts a
 * champion for its Universe region and its home, so every one of the 13 regions can be drawn.
 *
 * **Hand-kept, committed, never generated.** `scripts/seed-regions.ts` writes `regions.ts` (the
 * Universe column) and must never write this file; `--check-universe` checks `regions.ts` only.
 * The list is product's M20.1 brief (from the region audit's `C adds:` rows): 31 champions, 32
 * additions. Change it only through a decision row.
 *
 * Rules a test holds (`homeRegions.test.ts`): a home never repeats the Universe region, never names
 * `unaffiliated`, every key is in `names.ts`, and no champion ends up with more than two regions.
 * Only Fizz, who has no Universe region, has two homes (Bilgewater first, then Bandle City).
 *
 * Plain data, words only, nothing loaded at runtime; a type-only import, so client panels may read it.
 */

import type { RegionId } from './regions';

/** Champion key -> its Kustom home region(s), in the order a chip names them. */
export const HOME_REGIONS: Readonly<Record<number, readonly RegionId[]>> = {
  1: ['noxus'], // Annie (unaffiliated)
  5: ['ionia'], // Xin Zhao (Demacia)
  6: ['noxus'], // Urgot (Zaun)
  10: ['mount-targon'], // Kayle (Demacia)
  24: ['shurima'], // Jax (unaffiliated)
  25: ['mount-targon'], // Morgana (Demacia)
  27: ['piltover'], // Singed (Zaun)
  30: ['noxus'], // Karthus (Shadow Isles)
  37: ['ionia'], // Sona (Demacia)
  38: ['shurima'], // Kassadin (The Void)
  44: ['demacia'], // Taric (Targon)
  60: ['noxus'], // Elise (Shadow Isles)
  63: ['freljord'], // Brand (unaffiliated)
  74: ['bandle-city'], // Heimerdinger (Piltover)
  78: ['bandle-city'], // Poppy (Demacia)
  85: ['bandle-city'], // Kennen (Ionia)
  90: ['shurima'], // Malzahar (The Void)
  105: ['bilgewater', 'bandle-city'], // Fizz (unaffiliated)
  115: ['bandle-city'], // Ziggs (Zaun)
  141: ['noxus'], // Kayn (Ionia)
  145: ['shurima'], // Kai'Sa (The Void)
  150: ['bandle-city'], // Gnar (Freljord)
  223: ['bilgewater'], // Tahm Kench (unaffiliated)
  240: ['bandle-city'], // Kled (Noxus)
  254: ['zaun'], // Vi (Piltover)
  266: ['shurima'], // Aatrox (unaffiliated)
  360: ['shurima'], // Samira (Noxus)
  421: ['shurima'], // Rek'Sai (The Void)
  711: ['bandle-city'], // Vex (Shadow Isles)
  800: ['piltover'], // Mel (Noxus)
  904: ['shurima'], // Zaahen (unaffiliated)
};

/** A champion's home region(s); empty when it has none. */
export function homeRegions(id: number): readonly RegionId[] {
  return Object.hasOwn(HOME_REGIONS, id) ? (HOME_REGIONS[id] ?? []) : [];
}
