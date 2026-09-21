import { describe, expect, it } from 'vitest';
import {
  fearlessExact,
  fearlessMatches,
  groupFearless,
  normalizeFearlessQuery,
  presentFearless,
} from './present';
import type { FearlessChampion } from './types';

const NAMES: Record<number, string> = {
  1: 'Annie',
  22: 'Ashe',
  103: 'Ahri',
  222: 'Jinx',
  31: "Cho'Gath",
};

function nameOf(id: number): string {
  return NAMES[id] ?? `Champion ${id}`;
}

describe('presentFearless', () => {
  it('sorts by lane, then A-Z inside the lane', () => {
    const presented = presentFearless(
      [
        { id: 222, role: 'adc' },
        { id: 103, role: 'mid' },
        { id: 22, role: 'adc' },
        { id: 1, role: 'mid' },
        { id: 31, role: null },
      ],
      nameOf,
    );
    expect(presented.map((champion) => [champion.name, champion.role])).toEqual([
      ['Ahri', 'mid'],
      ['Annie', 'mid'],
      ['Ashe', 'adc'],
      ['Jinx', 'adc'],
      ["Cho'Gath", null],
    ]);
  });
});

describe('groupFearless', () => {
  it('prints only lanes that have a champ, other last', () => {
    const champions: FearlessChampion[] = [
      { id: 1, name: 'Annie', role: 'mid' },
      { id: 103, name: 'Ahri', role: 'mid' },
      { id: 222, name: 'Jinx', role: 'adc' },
      { id: 31, name: "Cho'Gath", role: null },
    ];
    expect(
      groupFearless(champions).map((group) => [group.role, group.champions.map((row) => row.name)]),
    ).toEqual([
      ['mid', ['Ahri', 'Annie']],
      ['adc', ['Jinx']],
      [null, ["Cho'Gath"]],
    ]);
  });
});

describe('fearless search', () => {
  it('matches a name ignoring punctuation and case', () => {
    expect(normalizeFearlessQuery("Cho'Gath")).toBe('chogath');
    expect(fearlessMatches("Cho'Gath", 'cho')).toBe(true);
    expect(fearlessMatches("Cho'Gath", 'gath')).toBe(true);
    expect(fearlessMatches('Ahri', 'jinx')).toBe(false);
    expect(fearlessExact("Cho'Gath", 'chogath')).toBe(true);
    expect(fearlessExact('Ahri', 'ahr')).toBe(false);
  });
});
