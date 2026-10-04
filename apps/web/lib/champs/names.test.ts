import { describe, expect, it } from 'vitest';
import { DDRAGON_VERSION } from './ddragon';
import fixture from './fixtures/ddragon-16.19.1-champion.json';
import { championLane } from './lanes';
import {
  championIconUrl,
  championLabel,
  championName,
  isRosterChampion,
  listChampions,
  NO_BAN,
} from './names';

describe('every champion the pinned Data Dragon version ships', () => {
  // The other direction (every name is in Data Dragon) lives in ddragon.test.ts, and lanes ==
  // names in lanes.test.ts. This one fails on a pin bump that brings a champion names.ts and
  // lanes.ts do not have yet -- the gap Locke (805) slipped through at 16.19.1.
  const shipped = Object.values(fixture.data as Record<string, { key: string; name: string }>);

  it('has a name and a lane', () => {
    expect(fixture.version).toBe(DDRAGON_VERSION);
    expect(shipped.length).toBeGreaterThan(150);
    const missing = shipped
      .map((champion) => ({ id: Number(champion.key), name: champion.name }))
      .filter(({ id }) => !isRosterChampion(id) || championLane(id) === null)
      .map(({ id, name }) => `${name} (${id})`);
    expect(missing, `add these to names.ts and lanes.ts`).toEqual([]);
    expect(listChampions()).toHaveLength(shipped.length);
  });

  it('includes Locke (805) as a mid laner', () => {
    expect(championName(805)).toBe('Locke');
    expect(championLane(805)).toBe('mid');
  });
});

describe('championIconUrl', () => {
  it('is the Data Dragon icon at the pinned version for a champion the table names', () => {
    expect(championIconUrl(1)).toBe('https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Annie.png');
    expect(championIconUrl(62)).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/MonkeyKing.png',
    );
  });

  it('is null for an id the table does not know', () => {
    expect(championIconUrl(12_345)).toBeNull();
    expect(championIconUrl(NO_BAN)).toBeNull();
    expect(championIconUrl(0)).toBeNull();
    expect(championIconUrl(1.5)).toBeNull();
  });

  it('draws a champion the table names without a stored name, and never on a blank one alone', () => {
    // Locke (805) was the id that shipped in the pinned Data Dragon version before the
    // name table had him; the table names him now, so the stored name is not needed.
    expect(isRosterChampion(805)).toBe(true);
    expect(championIconUrl(805)).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Locke.png',
    );
    expect(championIconUrl(805, '   ')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Locke.png',
    );
  });

  it('draws nothing for a named id the pinned Data Dragon version does not ship', () => {
    expect(championIconUrl(12_345, 'Newchamp')).toBeNull();
    expect(championIconUrl(12_345, '   ')).toBeNull();
    expect(championIconUrl(12_345, null)).toBeNull();
    expect(championIconUrl(NO_BAN, 'Newchamp')).toBeNull();
    expect(championIconUrl(0, 'Newchamp')).toBeNull();
  });
});

describe('isRosterChampion', () => {
  it('is true only for ids the table names', () => {
    expect(isRosterChampion(103)).toBe(true);
    expect(isRosterChampion(804)).toBe(true);
    expect(isRosterChampion(12_345)).toBe(false);
    expect(isRosterChampion(NO_BAN)).toBe(false);
  });
});

describe('championName', () => {
  it('names a stored id', () => {
    expect(championName(35)).toBe('Shaco');
    expect(championName(103)).toBe('Ahri');
  });

  it('prefers the fallback for a skipped ban or a missing id', () => {
    expect(championName(NO_BAN, 'Unknown')).toBe('Unknown');
    expect(championName(null)).toBe('Unknown');
  });

  it('prints the id when the roster table does not have it', () => {
    expect(championName(12_345)).toBe('Champion 12345');
    expect(championName(12_345, 'Mel')).toBe('Mel');
  });
});

describe('championLabel', () => {
  it('is null when the row named nothing', () => {
    expect(championLabel(null)).toBeNull();
    expect(championLabel(NO_BAN)).toBeNull();
  });

  it('prefers the stored end-of-game name, then the id table', () => {
    expect(championLabel(103, 'Ahri')).toBe('Ahri');
    expect(championLabel(35)).toBe('Shaco');
  });
});
