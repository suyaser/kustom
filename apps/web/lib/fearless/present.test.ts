import { describe, expect, it } from 'vitest';
import { championName } from '../champs/names';
import { LANE_ORDER } from '../laneOrder';
import {
  availableFearless,
  fearlessExact,
  fearlessIconUrl,
  fearlessLanes,
  fearlessLanesShown,
  fearlessMatches,
  groupFearless,
  normalizeFearlessQuery,
  presentFearless,
  storedChampionNames,
  toggleFearlessLane,
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

/** An end-of-game blob, the shape `rawFactsFromUnknown` reads `championName` from. */
function eog(players: { puuid: string; championName?: string }[]): unknown {
  return { teams: [{ teamId: 100, players: players.map((player) => ({ ...player, stats: {} })) }] };
}

describe('presentFearless, a champion newer than the name table', () => {
  it('prints the client name and draws the pinned Data Dragon icon, instead of Champion 805', () => {
    // Locke ships in the pinned Data Dragon version but is not in the name table yet.
    const [champion] = presentFearless([{ id: 805, role: 'mid' }], championName, new Map([[805, 'Locke']]));
    expect(champion).toMatchObject({ id: 805, name: 'Locke', role: 'mid' });
    expect(champion?.iconUrl).toMatch(/\/cdn\/16\.19\.1\/img\/champion\/Locke\.png$/);
  });

  it('prints the client name with no icon when the pinned Data Dragon version lacks the id', () => {
    const [champion] = presentFearless(
      [{ id: 12_345, role: 'adc' }],
      championName,
      new Map([[12_345, 'Newchamp']]),
    );
    expect(champion).toMatchObject({ id: 12_345, name: 'Newchamp', role: 'adc' });
    expect(champion?.iconUrl).toBeNull();
  });

  it('keeps the table spelling for a roster id even when the client sent a different one', () => {
    const [champion] = presentFearless([{ id: 103, role: 'mid' }], championName, new Map([[103, 'AHRI']]));
    expect(champion?.name).toBe('Ahri');
    expect(champion?.iconUrl).toMatch(/\/img\/champion\/Ahri\.png$/);
  });

  it('falls back to Champion id with no icon when nobody can name it', () => {
    const [champion] = presentFearless([{ id: 12_345, role: null }], championName);
    expect(champion?.name).toBe('Champion 12345');
    expect(champion?.iconUrl).toBeNull();
  });
});

describe('storedChampionNames', () => {
  it('reads the client name per puuid off the end-of-game blob, only for wanted ids', () => {
    const names = storedChampionNames(
      [
        {
          raw: eog([
            { puuid: 'p1', championName: 'Newchamp' },
            { puuid: 'p2', championName: 'Ahri' },
          ]),
          seats: [
            { puuid: 'p1', championId: 12_345 },
            { puuid: 'p2', championId: 103 },
          ],
        },
      ],
      new Set([12_345]),
    );
    expect([...names]).toEqual([[12_345, 'Newchamp']]);
  });

  it('takes the first game that names the id and skips blobs with no name', () => {
    const names = storedChampionNames(
      [
        {
          raw: { participants: [], participantIdentities: [] },
          seats: [{ puuid: 'p1', championId: 12_345 }],
        },
        { raw: eog([{ puuid: 'p1', championName: '  ' }]), seats: [{ puuid: 'p1', championId: 12_345 }] },
        {
          raw: eog([{ puuid: 'p3', championName: 'Newchamp' }]),
          seats: [{ puuid: 'p3', championId: 12_345 }],
        },
        { raw: eog([{ puuid: 'p4', championName: 'Later' }]), seats: [{ puuid: 'p4', championId: 12_345 }] },
      ],
      new Set([12_345]),
    );
    expect(names.get(12_345)).toBe('Newchamp');
  });

  it('asks nothing when nothing is wanted, and survives a seat with no puuid or a malformed blob', () => {
    expect(
      storedChampionNames(
        [{ raw: eog([{ puuid: 'p1', championName: 'X' }]), seats: [{ puuid: 'p1', championId: 1 }] }],
        new Set(),
      ).size,
    ).toBe(0);
    expect(
      storedChampionNames(
        [
          { raw: 'not a blob', seats: [{ puuid: 'p1', championId: 12_345 }] },
          {
            raw: eog([{ puuid: 'p1', championName: 'Newchamp' }]),
            seats: [{ puuid: null, championId: 12_345 }],
          },
        ],
        new Set([12_345]),
      ).size,
    ).toBe(0);
  });
});

describe('fearlessIconUrl', () => {
  it('uses what the loader resolved, including an explicit null, else the id table', () => {
    expect(fearlessIconUrl({ id: 12_345, iconUrl: 'https://example.test/12345.png' })).toBe(
      'https://example.test/12345.png',
    );
    expect(fearlessIconUrl({ id: 103, iconUrl: null })).toBeNull();
    expect(fearlessIconUrl({ id: 103 })).toMatch(/\/img\/champion\/Ahri\.png$/);
    expect(fearlessIconUrl({ id: 12_345 })).toBeNull();
  });
});

describe('the lane filter (2026-10-03)', () => {
  const lanes = [
    { role: 'top' as const },
    { role: 'jungle' as const },
    { role: 'mid' as const },
    { role: 'adc' as const },
    { role: 'support' as const },
    { role: null },
  ];
  const all = new Set(LANE_ORDER);

  it('lists every lane, `other` included, with all five on', () => {
    expect(fearlessLanesShown(lanes, all, '')).toEqual(lanes);
  });

  it('lists only the lanes still on, and drops `other`, when some are off', () => {
    expect(
      fearlessLanesShown(lanes, new Set(['jungle', 'mid'] as const), '').map((lane) => lane.role),
    ).toEqual(['jungle', 'mid']);
  });

  it('ignores the toggles while the find box has text in it', () => {
    expect(fearlessLanesShown(lanes, new Set(['jungle'] as const), 'ahr')).toEqual(lanes);
    expect(fearlessLanesShown(lanes, new Set(['jungle'] as const), '   ').map((lane) => lane.role)).toEqual([
      'jungle',
    ]);
  });

  it('toggles one lane, and turns all five back on instead of none', () => {
    expect([...toggleFearlessLane(all, 'top')]).toEqual(['jungle', 'mid', 'adc', 'support']);
    expect([...toggleFearlessLane(new Set(['mid'] as const), 'top')].sort()).toEqual(['mid', 'top']);
    expect(toggleFearlessLane(new Set(['mid'] as const), 'mid')).toEqual(all);
  });
});
