import { describe, expect, it } from 'vitest';
import { DDRAGON_VERSION } from './ddragon';
import fixture from './fixtures/ddragon-16.19.1-champion.json';
import { listChampions } from './names';
import {
  CHAMPION_CLASS_TAGS,
  type ChampionClassTag,
  championAttackRange,
  championTags,
  taggedChampionIds,
} from './tags';

/**
 * M15.4: Data Dragon tags and attack range at the M14.8 pin. Reads the checked-in fixture only;
 * no test touches the network.
 */

interface FixtureChampion {
  id: string;
  key: string;
  name: string;
  tags: string[];
  stats: { attackrange: number };
}

const champions = Object.values(fixture.data as Record<string, FixtureChampion>);

describe('the tag table', () => {
  it('is the pinned version and agrees with the fixture for every champion', () => {
    expect(fixture.version).toBe(DDRAGON_VERSION);
    expect(taggedChampionIds()).toEqual(champions.map((c) => Number(c.key)).sort((a, b) => a - b));
    for (const champion of champions) {
      expect(championTags(Number(champion.key)), champion.id).toEqual(champion.tags);
      expect(championAttackRange(Number(champion.key)), champion.id).toBe(champion.stats.attackrange);
    }
  });

  it('gives every champion in names.ts at least one known class tag', () => {
    for (const { id, name } of listChampions()) {
      const tags = championTags(id);
      expect(tags, name).not.toBeNull();
      expect(tags?.length, name).toBeGreaterThan(0);
      for (const tag of tags ?? []) expect(CHAMPION_CLASS_TAGS, name).toContain(tag);
      expect(championAttackRange(id), name).toBeGreaterThan(0);
    }
  });

  it('pins the any-tag counts at 16.19.1 (decision R8), every class wars class at least ten', () => {
    const count = (tag: ChampionClassTag) =>
      taggedChampionIds().filter((id) => championTags(id)?.includes(tag)).length;
    expect({
      Tank: count('Tank'),
      Marksman: count('Marksman'),
      Mage: count('Mage'),
      Assassin: count('Assassin'),
      Support: count('Support'),
    }).toEqual({ Tank: 46, Marksman: 33, Mage: 75, Assassin: 46, Support: 43 });
    for (const tag of ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'] as const) {
      expect(count(tag), tag).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps the primary tag first and the ranges Data Dragon ships', () => {
    expect(championTags(103)).toEqual(['Mage', 'Assassin']); // Ahri
    expect(championTags(12)).toEqual(['Tank', 'Support']); // Alistar
    expect(championAttackRange(266)).toBe(175); // Aatrox, melee
    expect(championAttackRange(51)).toBe(650); // Caitlyn
  });

  it('answers null (unknown) for a key the pin does not ship', () => {
    expect(championTags(12_345)).toBeNull();
    expect(championTags(1.5)).toBeNull();
    expect(championTags(-1)).toBeNull();
    expect(championAttackRange(12_345)).toBeNull();
  });
});
