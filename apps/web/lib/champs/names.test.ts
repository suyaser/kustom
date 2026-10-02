import { describe, expect, it } from 'vitest';
import { championIconUrl, championLabel, championName, isRosterChampion, NO_BAN } from './names';

describe('championIconUrl', () => {
  it('is the Community Dragon icon by numeric id for a champion the table names', () => {
    expect(championIconUrl(1)).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/1.png',
    );
    expect(championIconUrl(62)).toMatch(/\/62\.png$/);
  });

  it('is null for an id the table does not know', () => {
    expect(championIconUrl(12_345)).toBeNull();
    expect(championIconUrl(NO_BAN)).toBeNull();
    expect(championIconUrl(0)).toBeNull();
    expect(championIconUrl(1.5)).toBeNull();
  });

  it('draws an id the table does not know when the client named it, and never a blank name', () => {
    expect(championIconUrl(12_345, 'Newchamp')).toMatch(/\/12345\.png$/);
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
