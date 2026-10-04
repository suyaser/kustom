import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { championFactEntries, championFacts } from './championFacts';
import fixture from './fixtures/ddragon-16.19.1-champion.json';
import {
  championRegion,
  REGION_CREDIT,
  REGION_IDS,
  REGION_NAMES,
  type RegionId,
  regionChampionIds,
  regionName,
} from './regions';

/** M15.9: the region table, seeded once from lolstaticdata. No test touches the network. */

const shipped = Object.values(fixture.data as Record<string, { id: string; key: string; name: string }>);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = join(HERE, '..', '..');

describe('the region table', () => {
  it('has a row for every Data Dragon key at the pin, and only those', () => {
    expect(regionChampionIds()).toEqual(shipped.map((c) => Number(c.key)).sort((a, b) => a - b));
    for (const c of shipped) expect(REGION_IDS, c.name).toContain(championRegion(Number(c.key)));
  });

  it('pins the champions per region at 16.19.1', () => {
    const counts: Partial<Record<RegionId, number>> = {};
    for (const id of regionChampionIds()) {
      const region = championRegion(id) as RegionId;
      counts[region] = (counts[region] ?? 0) + 1;
    }
    expect(counts).toEqual({
      'bandle-city': 7,
      bilgewater: 8,
      demacia: 15,
      freljord: 15,
      ionia: 23,
      ixtal: 8,
      'mount-targon': 7,
      noxus: 17,
      piltover: 8,
      'shadow-isles': 10,
      shurima: 11,
      void: 9,
      zaun: 14,
      unaffiliated: 21,
    });
  });

  it('agrees with the Universe spot check (2026-10-04)', () => {
    const spot: Record<number, RegionId> = {
      86: 'demacia', // Garen
      99: 'demacia', // Lux
      805: 'demacia', // Locke, newer than the Meraki build
      103: 'ionia', // Ahri
      157: 'ionia', // Yasuo
      122: 'noxus', // Darius
      50: 'noxus', // Swain
      22: 'freljord', // Ashe
      113: 'freljord', // Sejuani
      412: 'shadow-isles', // Thresh
      222: 'zaun', // Jinx
      254: 'piltover', // Vi
      41: 'bilgewater', // Gangplank
      268: 'shurima', // Azir
      121: 'void', // Kha'Zix
      518: 'ixtal', // Neeko
      89: 'mount-targon', // Leona
      17: 'bandle-city', // Teemo
      432: 'unaffiliated', // Bard
      904: 'unaffiliated', // Zaahen, newer than the Meraki build
    };
    for (const [id, region] of Object.entries(spot)) expect(championRegion(Number(id)), id).toBe(region);
  });

  it('names regions in plain words', () => {
    expect(regionName('shadow-isles')).toBe('Shadow Isles');
    expect(regionName('bandle-city')).toBe('Bandle City');
    expect(regionName('mount-targon')).toBe('Targon');
    expect(regionName('void')).toBe('The Void');
    for (const region of REGION_IDS) expect(REGION_NAMES[region]).toMatch(/^[A-Z][A-Za-z ]+$/);
  });

  it('answers null (no row) for a key the table does not have, distinct from unaffiliated', () => {
    expect(championRegion(12_345)).toBeNull();
    expect(championRegion(1.5)).toBeNull();
    expect(championRegion(432)).toBe('unaffiliated');
  });

  it('exports the credit line the region panel shows', () => {
    expect(REGION_CREDIT).toBe("Regions from Meraki's lolstaticdata and the League of Legends Wiki.");
  });
});

describe('never loaded at runtime', () => {
  it('regions.ts and tags.ts have no fetch, no URL and no imports', () => {
    for (const file of ['regions.ts', 'tags.ts']) {
      const source = readFileSync(join(HERE, file), 'utf8');
      expect(source, file).not.toMatch(/fetch|http/i);
      expect(source, file).not.toMatch(/^\s*import\b/m);
    }
  });

  it('no app, component or lib module imports the seeding scripts', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = readFileSync(full, 'utf8');
          if (/from\s+['"][^'"]*scripts\/|import\(\s*['"][^'"]*scripts\//.test(source)) offenders.push(full);
        }
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(join(WEB, dir));
    expect(offenders).toEqual([]);
  });
});

describe('championFacts (the shape core takes per key)', () => {
  it('pairs tags and region; null for unknown', () => {
    expect(championFacts(103)).toEqual({ tags: ['Mage', 'Assassin'], region: 'ionia' });
    expect(championFacts(432)?.region).toBe('unaffiliated');
    expect(championFacts(12_345)).toEqual({ tags: null, region: null });
  });

  it('has one entry per shipped champion, each fully known', () => {
    const entries = championFactEntries();
    expect(entries).toHaveLength(shipped.length);
    for (const [id, facts] of entries) {
      expect(facts.tags, String(id)).not.toBeNull();
      expect(facts.region, String(id)).not.toBeNull();
    }
  });
});
