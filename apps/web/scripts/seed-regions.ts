import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DDRAGON_VERSION } from '../lib/champs/ddragonPin.ts';

/**
 * `pnpm --filter web seed-regions [--meraki <champions.json>] [--check-universe]` (M15.9).
 *
 * Seeds `lib/champs/regions.ts`, the champion -> region table region wars reads. Run **once**,
 * offline, by hand; the app never loads region data at runtime and nothing under `app/`,
 * `components/` or `lib/` imports this script (`lib/champs/regions.test.ts` checks both).
 *
 * Source: Meraki Analytics' lolstaticdata (https://github.com/meraki-analytics/lolstaticdata,
 * MIT licence, Copyright (c) Meraki Analytics), whose champion data is scraped from the League of
 * Legends Wiki (https://wiki.leagueoflegends.com). We read one field per champion, `faction`,
 * from the published build:
 *
 *   https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json
 *
 * Seeded 2026-10-04 from the build served then: `Last-Modified: Fri, 01 Aug 2025 08:37:37 GMT`,
 * `ETag: "688c7cd1-c81b46"` (13,114,182 bytes, 171 champions); lolstaticdata's repository head
 * was df17d37 (2025-11-12). Only `faction` is read: no lore, title, art or crest leaves the file.
 * The table credits Meraki and the Wiki in `REGION_CREDIT`, which the region panel shows.
 *
 * Meraki's `faction` values are already lowercase hyphenated slugs (`shadow-isles`,
 * `mount-targon`, `bandle-city`, `unaffiliated`); they are normalised anyway and must be one of
 * `REGIONS` below. `unaffiliated` is a real answer (a champion with no home region), distinct from
 * no row at all.
 *
 * `OVERRIDES` covers Data Dragon champions newer than the Meraki build, read off Riot's Universe
 * site by hand (each row says when). Every Data Dragon key at the pin must end up with a row, or
 * the script exits 1.
 *
 * `--check-universe` also reads Universe's champion index
 * (https://universe-meeps.leagueoflegends.com/v1/en_us/search/index.json, field
 * `associated-faction-slug`) and prints every champion where it disagrees with the table. It was
 * run on 2026-10-04 and agreed on all 173 champions at 16.19.1.
 */

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(WEB, 'lib', 'champs', 'fixtures', `ddragon-${DDRAGON_VERSION}-champion.json`);
const OUT = join(WEB, 'lib', 'champs', 'regions.ts');
const MERAKI_URL = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json';
const UNIVERSE_URL = 'https://universe-meeps.leagueoflegends.com/v1/en_us/search/index.json';

/** Slug -> display name, plain words (05-design 8.10). Order is the table's order. */
const REGIONS: readonly (readonly [string, string])[] = [
  ['bandle-city', 'Bandle City'],
  ['bilgewater', 'Bilgewater'],
  ['demacia', 'Demacia'],
  ['freljord', 'Freljord'],
  ['ionia', 'Ionia'],
  ['ixtal', 'Ixtal'],
  ['mount-targon', 'Targon'],
  ['noxus', 'Noxus'],
  ['piltover', 'Piltover'],
  ['shadow-isles', 'Shadow Isles'],
  ['shurima', 'Shurima'],
  ['void', 'The Void'],
  ['zaun', 'Zaun'],
  ['unaffiliated', 'Unaffiliated'],
];

/** Champions newer than the Meraki build (805 Locke, 904 Zaahen): key -> slug, where and when it was read. */
const OVERRIDES: Readonly<Record<number, { region: string; note: string }>> = {
  805: { region: 'demacia', note: 'Universe, 2026-10-04' },
  904: { region: 'unaffiliated', note: 'Universe, 2026-10-04' },
};

interface FixtureChampion {
  id: string;
  key: string;
  name: string;
}

function fail(message: string): never {
  console.error(`seed-regions: ${message}`);
  process.exit(1);
}

function slug(faction: string): string {
  return faction
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

const KNOWN = new Set(REGIONS.map(([s]) => s));

async function readJson(path: string | undefined, url: string): Promise<unknown> {
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  const response = await fetch(url);
  if (!response.ok) fail(`${url} answered ${response.status}`);
  return response.json();
}

function merakiFactions(raw: unknown): Map<number, string> {
  if (!raw || typeof raw !== 'object') fail('Meraki champions.json is not an object');
  const out = new Map<number, string>();
  for (const champion of Object.values(raw as Record<string, { id?: unknown; faction?: unknown }>)) {
    if (typeof champion.id !== 'number' || typeof champion.faction !== 'string') continue;
    const region = slug(champion.faction);
    if (!KNOWN.has(region))
      fail(`Meraki region "${champion.faction}" (champion ${champion.id}) is not in REGIONS`);
    out.set(champion.id, region);
  }
  return out;
}

function quote(s: string): string {
  return /^[a-z]+$/.test(s) ? s : `'${s}'`;
}

function render(rows: { key: number; id: string; region: string; override?: string | undefined }[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.region, (counts.get(row.region) ?? 0) + 1);
  const union = REGIONS.map(([s]) => `  | '${s}'`).join('\n');
  const names = REGIONS.map(([s, n]) => `  ${quote(s)}: '${n}',`).join('\n');
  const ids = REGIONS.map(([s]) => `  '${s}',`).join('\n');
  const table = rows
    .map((r) => `  ${r.key}: '${r.region}', // ${r.id}${r.override ? ` (${r.override})` : ''}`)
    .join('\n');
  const tallies = REGIONS.map(([s]) => `${s} ${counts.get(s) ?? 0}`);
  const tally = [0, 5, 10].map((i) => ` *   ${tallies.slice(i, i + 5).join(', ')}`).join('\n');
  return `/**
 * Champion -> region, at Data Dragon ${DDRAGON_VERSION} (M15.9). Region wars reads it (M15.10).
 *
 * Seeded once, offline, by \`scripts/seed-regions.ts\` from Meraki Analytics' lolstaticdata (MIT),
 * which takes it from the League of Legends Wiki; spot-checked against Riot's Universe site. The
 * script's header names the exact build. Do not edit by hand and never load this data at runtime:
 * a pin bump adds the new champions through the script.
 *
 * Words only: no crest, art or lore text (M15's rule, 05-design 8.10). Plain data with no imports,
 * so client panels may read it.
 *
 * Keyed by the numeric champion key (\`game_players.champion_id\`). \`unaffiliated\` is a real
 * region slug, a champion with no home region (never drawn, breaks any region rule); a key with no
 * row answers \`null\` (couldn't check). Champions per region at ${DDRAGON_VERSION}:
${tally}
 */

export type RegionId =
${union};

/** Every region slug, \`unaffiliated\` last. */
export const REGION_IDS: readonly RegionId[] = [
${ids}
];

/** A region's display name: plain words. */
export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
${names}
};

/** The credit line the region panel shows (M15.10, brief section 4). */
export const REGION_CREDIT = "Regions from Meraki's lolstaticdata and the League of Legends Wiki.";

const CHAMPION_REGIONS: Readonly<Record<number, RegionId>> = {
${table}
};

/** A champion's region slug; \`null\` for a key with no row (a champion newer than the table). */
export function championRegion(id: number): RegionId | null {
  return Object.hasOwn(CHAMPION_REGIONS, id) ? (CHAMPION_REGIONS[id] ?? null) : null;
}

/** A region's display name, e.g. \`Shadow Isles\`. */
export function regionName(region: RegionId): string {
  return REGION_NAMES[region];
}

/** Every key the table has, ascending. */
export function regionChampionIds(): number[] {
  return Object.keys(CHAMPION_REGIONS)
    .map(Number)
    .sort((a, b) => a - b);
}
`;
}

async function checkUniverse(
  rows: { key: number; id: string; name: string; region: string }[],
): Promise<void> {
  const raw = (await readJson(undefined, UNIVERSE_URL)) as {
    champions?: { name: string; slug: string; 'associated-faction-slug': string }[];
  };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const universe = new Map<string, string>();
  for (const c of raw.champions ?? []) {
    universe.set(norm(c.name), c['associated-faction-slug']);
    universe.set(c.slug, c['associated-faction-slug']);
  }
  let disagreements = 0;
  for (const row of rows) {
    const theirs = universe.get(norm(row.name)) ?? universe.get(row.id.toLowerCase());
    if (theirs !== row.region) {
      disagreements += 1;
      console.log(`  ${row.key} ${row.name}: table ${row.region}, Universe ${theirs ?? 'missing'}`);
    }
  }
  console.log(`seed-regions: Universe disagrees on ${disagreements} of ${rows.length}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const merakiIndex = args.indexOf('--meraki');
  const merakiPath = merakiIndex >= 0 ? args[merakiIndex + 1] : undefined;
  if (merakiIndex >= 0 && !merakiPath) fail('--meraki needs a path');

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    version: string;
    data: Record<string, FixtureChampion>;
  };
  if (fixture.version !== DDRAGON_VERSION)
    fail(`fixture is ${fixture.version}, the pin is ${DDRAGON_VERSION}`);
  const meraki = merakiFactions(await readJson(merakiPath, MERAKI_URL));

  const rows = Object.values(fixture.data)
    .map((c) => {
      const key = Number(c.key);
      const override = OVERRIDES[key];
      const region = override?.region ?? meraki.get(key);
      if (!region) fail(`no region for ${c.name} (${key}): add it to OVERRIDES from Universe`);
      if (!KNOWN.has(region)) fail(`override region "${region}" for ${c.name} is not in REGIONS`);
      return { key, id: c.id, name: c.name, region, override: override?.note };
    })
    .sort((a, b) => a.key - b.key);

  writeFileSync(OUT, render(rows));
  console.log(`seed-regions: ${rows.length} champions at ${fixture.version} -> ${OUT}`);
  if (args.includes('--check-universe')) await checkUniverse(rows);
}

await main();
