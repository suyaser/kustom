import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairDrawable, regionOpenCounts } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { championTable } from '../mode/champions';
import { championFactEntries, championFacts } from './championFacts';
import { HOME_REGIONS, homeRegions } from './homeRegions';
import { listChampions } from './names';
import { championRegion, REGION_IDS, type RegionId } from './regions';

/**
 * M20.3: the Kustom home list (M20.1, decision row M20 D1 and its Fizz note) and the region sets
 * `championFacts` builds from it. No test touches the network.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DRAWABLE = REGION_IDS.filter((region) => region !== 'unaffiliated');

/** What is wrong with a home list against the Universe table and `names.ts`; empty when nothing is. */
function homeListProblems(list: Readonly<Record<number, readonly RegionId[]>>): string[] {
  const known = new Set(listChampions().map((champion) => champion.id));
  const problems: string[] = [];
  for (const [key, homes] of Object.entries(list)) {
    const id = Number(key);
    const universe = championRegion(id);
    if (!known.has(id)) problems.push(`${id}: not in names.ts`);
    if (universe === null) problems.push(`${id}: no Universe row`);
    if (homes.length === 0) problems.push(`${id}: an empty home list`);
    if (new Set(homes).size !== homes.length) problems.push(`${id}: a home twice`);
    for (const home of homes) {
      if (home === 'unaffiliated') problems.push(`${id}: names unaffiliated`);
      if (home === universe) problems.push(`${id}: repeats the Universe region ${home}`);
    }
    const total = (universe === null || universe === 'unaffiliated' ? 0 : 1) + homes.length;
    if (total > 2) problems.push(`${id}: ${total} regions`);
  }
  return problems;
}

describe('the home list', () => {
  it('is exactly M20.1: 31 champions, 32 additions', () => {
    const entries = Object.entries(HOME_REGIONS);
    expect(entries).toHaveLength(31);
    expect(entries.reduce((sum, [, homes]) => sum + homes.length, 0)).toBe(32);
    const byRegion: Partial<Record<RegionId, string[]>> = {};
    const names = new Map(listChampions().map((c) => [c.id, c.name]));
    for (const [key, homes] of entries)
      for (const home of homes) byRegion[home] = [...(byRegion[home] ?? []), names.get(Number(key)) ?? key];
    for (const list of Object.values(byRegion)) list.sort();
    expect(byRegion).toEqual({
      'bandle-city': ['Fizz', 'Gnar', 'Heimerdinger', 'Kennen', 'Kled', 'Poppy', 'Vex', 'Ziggs'],
      bilgewater: ['Fizz', 'Tahm Kench'],
      demacia: ['Taric'],
      freljord: ['Brand'],
      ionia: ['Sona', 'Xin Zhao'],
      noxus: ['Annie', 'Elise', 'Karthus', 'Kayn', 'Urgot'],
      piltover: ['Mel', 'Singed'],
      shurima: ['Aatrox', 'Jax', "Kai'Sa", 'Kassadin', 'Malzahar', "Rek'Sai", 'Samira', 'Zaahen'],
      'mount-targon': ['Kayle', 'Morgana'],
      zaun: ['Vi'],
    });
  });

  it('never repeats the Universe region, names unaffiliated, makes a third region or keys an unknown champion', () => {
    expect(homeListProblems(HOME_REGIONS)).toEqual([]);
    // The check itself catches each case.
    expect(homeListProblems({ 86: ['demacia'] })).toEqual(['86: repeats the Universe region demacia']);
    expect(homeListProblems({ 86: ['unaffiliated'] })).toEqual(['86: names unaffiliated']);
    expect(homeListProblems({ 254: ['zaun', 'noxus'] })).toEqual(['254: 3 regions']);
    expect(homeListProblems({ 12345: ['ionia'] })).toEqual([
      '12345: not in names.ts',
      '12345: no Universe row',
    ]);
  });

  it('answers empty for a champion with no home', () => {
    expect(homeRegions(86)).toEqual([]);
    expect(homeRegions(12_345)).toEqual([]);
  });

  it('is hand-kept: no fetch, no URL, and the seeding script never writes it', () => {
    const source = readFileSync(join(HERE, 'homeRegions.ts'), 'utf8');
    expect(source).not.toMatch(/fetch|http/i);
    expect(source.match(/^import\b.*$/gm)).toEqual(["import type { RegionId } from './regions';"]);
    const script = readFileSync(join(HERE, '..', '..', 'scripts', 'seed-regions.ts'), 'utf8');
    // Its one write is OUT, and OUT is regions.ts.
    expect(script.match(/writeFileSync\([^,]+,/g)).toEqual(['writeFileSync(OUT,']);
    expect(script).toMatch(/const OUT = join\(WEB, 'lib', 'champs', 'regions\.ts'\);/);
  });
});

describe('the region sets (Universe first, then the home)', () => {
  it('Vi reads Piltover and Zaun, Fizz Bilgewater and Bandle City', () => {
    expect(championFacts(254).region).toEqual(['piltover', 'zaun']);
    expect(championFacts(105).region).toEqual(['bilgewater', 'bandle-city']);
    expect(championFacts(1).region).toEqual(['noxus']); // Annie: no Universe region, a home
    expect(championFacts(432).region).toEqual([]); // Bard: unaffiliated, no home
    expect(championFacts(12_345).region).toBeNull();
  });

  it("reads Bandle City for every champion in M20.1's Bandle City paragraph", () => {
    const yordles = {
      74: 'Heimerdinger',
      78: 'Poppy',
      85: 'Kennen',
      105: 'Fizz',
      115: 'Ziggs',
      150: 'Gnar',
      240: 'Kled',
      711: 'Vex',
      17: 'Teemo',
      18: 'Tristana',
      42: 'Corki',
      45: 'Veigar',
      68: 'Rumble',
      117: 'Lulu',
      350: 'Yuumi',
    };
    const names = new Map(listChampions().map((c) => [c.id, c.name]));
    for (const [id, name] of Object.entries(yordles)) {
      expect(names.get(Number(id)), id).toBe(name);
      expect(championFacts(Number(id)).region, name).toContain('bandle-city');
    }
  });

  it('pins the champions per region at 16.19.1, with the homes (M20.1)', () => {
    // The Universe column alone is pinned in regions.test.ts (7 Bandle City, 21 unaffiliated).
    expect(Object.fromEntries(regionOpenCounts(championTable(), []))).toEqual({
      'bandle-city': 15,
      bilgewater: 10,
      demacia: 16,
      freljord: 16,
      ionia: 25,
      ixtal: 8,
      'mount-targon': 9,
      noxus: 22,
      piltover: 10,
      'shadow-isles': 10,
      shurima: 19,
      void: 9,
      zaun: 15,
      unaffiliated: 14,
    });
    // No champion has more than two regions.
    for (const [id, facts] of championFactEntries()) expect(facts.region?.length, String(id)).toBeLessThan(3);
  });

  it('every region has 8 with no bans, and all 78 region pairs pass pairDrawable', () => {
    const table = championTable();
    const open = regionOpenCounts(table, []);
    for (const region of DRAWABLE) expect(open.get(region), region).toBeGreaterThanOrEqual(8);
    const failing: string[] = [];
    let pairs = 0;
    for (const [i, blue] of DRAWABLE.entries())
      for (const red of DRAWABLE.slice(i + 1)) {
        pairs += 1;
        if (!pairDrawable(blue, red, table, []) || !pairDrawable(red, blue, table, []))
          failing.push(`${blue} vs ${red}`);
      }
    expect(pairs).toBe(78);
    expect(failing).toEqual([]);
  });
});
