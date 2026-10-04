import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  championSprite,
  DDRAGON_ORIGIN,
  DDRAGON_SPRITE_SHEETS,
  DDRAGON_VERSION,
  ddragonChampionIconUrl,
  ddragonChampionId,
  ddragonChampionKeys,
  ddragonSpriteSheetUrl,
} from './ddragon';
import fixture from './fixtures/ddragon-16.19.1-champion.json';
import { championIconUrl, listChampions } from './names';

/**
 * M14.8: champion icons come from Data Dragon only, at a pinned version. Everything here reads
 * the checked-in `champion.json` for that version; no test touches the network.
 */

interface FixtureChampion {
  id: string;
  key: string;
  name: string;
  image: { full: string };
}

const champions = Object.values(fixture.data as Record<string, FixtureChampion>);
const byKey = new Map(champions.map((champion) => [Number(champion.key), champion]));

describe('the pinned Data Dragon version', () => {
  it('is the version the fixture was taken from', () => {
    expect(fixture.version).toBe(DDRAGON_VERSION);
    for (const champion of champions) expect(champion.image.full).toBe(`${champion.id}.png`);
  });

  it('maps exactly the keys the fixture ships, to the fixture ids', () => {
    expect(ddragonChampionKeys()).toEqual([...byKey.keys()].sort((a, b) => a - b));
    for (const [key, champion] of byKey) expect(ddragonChampionId(key)).toBe(champion.id);
  });

  it('builds the CDN path with the pinned version, never latest', () => {
    expect(DDRAGON_ORIGIN).toBe('https://ddragon.leagueoflegends.com');
    expect(ddragonChampionIconUrl(103)).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Ahri.png`,
    );
    expect(ddragonChampionIconUrl(12_345)).toBeNull();
    expect(ddragonChampionIconUrl(1.5)).toBeNull();
    expect(ddragonChampionIconUrl(-1)).toBeNull();
  });
});

describe('sprite sheets (M14.30, 05-design.md 8.8)', () => {
  const sprites = fixture.data as Record<
    string,
    FixtureChampion & { image: { sprite: string; x: number; y: number } }
  >;

  it("matches the fixture's image.sprite / x / y for every key, on six 480 x 144 sheets", () => {
    for (const champion of Object.values(sprites)) {
      const cell = championSprite(Number(champion.key));
      expect(cell, champion.id).toEqual({
        sheet: Number(champion.image.sprite.replace(/\D/g, '')),
        x: champion.image.x,
        y: champion.image.y,
      });
      expect(cell?.sheet).toBeLessThan(DDRAGON_SPRITE_SHEETS);
      expect(cell?.x).toBeLessThan(480);
      expect(cell?.y).toBeLessThan(144);
    }
  });

  it('maps every champion in names.ts to a cell; an unknown key to nothing', () => {
    for (const { id, name } of listChampions()) expect(championSprite(id), name).not.toBeNull();
    expect(championSprite(12_345)).toBeNull();
    expect(championSprite(1.5)).toBeNull();
  });

  it('loads the sheets from the pinned version on Data Dragon', () => {
    expect(ddragonSpriteSheetUrl(0)).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/sprite/champion0.png`,
    );
  });
});

describe('every champion in names.ts', () => {
  it('has an image key in the pinned champion.json, under the same name', () => {
    const roster = listChampions();
    expect(roster.length).toBeGreaterThan(150);
    for (const { id, name } of roster) {
      const champion = byKey.get(id);
      expect(champion, `${name} (${id}) is missing from Data Dragon ${DDRAGON_VERSION}`).toBeDefined();
      expect(champion?.name).toBe(name === 'Nunu' ? 'Nunu & Willump' : name);
      expect(championIconUrl(id)).toBe(
        `${DDRAGON_ORIGIN}/cdn/${DDRAGON_VERSION}/img/champion/${champion?.image.full}`,
      );
    }
  });

  it('uses the Data Dragon id, not the display name, for the renamed and punctuated ones', () => {
    const odd: [number, string][] = [
      [62, 'MonkeyKing'], // Wukong
      [20, 'Nunu'], // Nunu & Willump
      [888, 'Renata'], // Renata Glasc
      [145, 'Kaisa'],
      [200, 'Belveth'],
      [7, 'Leblanc'],
      [31, 'Chogath'],
      [121, 'Khazix'],
      [161, 'Velkoz'],
      [96, 'KogMaw'],
      [421, 'RekSai'],
      [897, 'KSante'],
      [36, 'DrMundo'],
      [59, 'JarvanIV'],
      [136, 'AurelionSol'],
      [223, 'TahmKench'],
    ];
    for (const [key, id] of odd) {
      expect(byKey.get(key)?.id).toBe(id);
      expect(championIconUrl(key)).toBe(`${DDRAGON_ORIGIN}/cdn/${DDRAGON_VERSION}/img/champion/${id}.png`);
    }
  });
});

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', '.next', '.turbo', 'coverage', '.claude']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe('only Riot assets the policy allows', () => {
  const files = walk(WEB_ROOT);

  it('leaves no CommunityDragon reference in apps/web outside tests asserting its absence', () => {
    const banned = ['community', 'dragon'].join('');
    const offenders = files
      .filter((path) => /\.(ts|tsx|js|mjs|cjs|css|json|md)$/.test(path))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').toLowerCase().includes(banned))
      .map((path) => path.slice(WEB_ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('ships no Riot or League logo file', () => {
    const offenders = files
      .filter((path) => /\.(png|svg|ico|jpe?g|webp|gif|avif)$/i.test(path))
      .filter((path) => /riot|league|(^|[^a-z])lol([^a-z]|$)|legends/i.test(path.slice(WEB_ROOT.length)))
      .map((path) => path.slice(WEB_ROOT.length));
    expect(offenders).toEqual([]);
  });
});
