import { describe, expect, it } from 'vitest';
import {
  availableFearless,
  fearlessExact,
  fearlessLanes,
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

describe('fearlessLanes', () => {
  it('puts who is still open after that lane, and skips a lane with neither', () => {
    expect(
      fearlessLanes(
        [{ id: 103, name: 'Ahri', role: 'mid' }],
        [
          { id: 1, name: 'Annie', role: 'mid' },
          { id: 86, name: 'Garen', role: 'top' },
        ],
      ).map((lane) => [lane.role, lane.banned.map((row) => row.name), lane.open.map((row) => row.name)]),
    ).toEqual([
      ['top', [], ['Garen']],
      ['mid', ['Ahri'], ['Annie']],
    ]);
  });

  it('keeps a role-less ban under other and does not invent an open list there', () => {
    expect(
      fearlessLanes([{ id: 31, name: "Cho'Gath", role: null }], []).map((lane) => [
        lane.role,
        lane.banned.map((row) => row.name),
        lane.open,
      ]),
    ).toEqual([[null, ["Cho'Gath"], []]]);
  });
});

describe('availableFearless', () => {
  it('drops a locked id from the lane it is filed under', () => {
    const open = availableFearless([{ id: 103 }]);
    expect(open.find((champion) => champion.name === 'Ahri')).toBeUndefined();
    expect(open.find((champion) => champion.name === 'Garen')).toMatchObject({ role: 'top' });
    expect(open.find((champion) => champion.name === 'Annie')).toMatchObject({ role: 'mid' });
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
