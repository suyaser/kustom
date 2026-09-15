import { describe, expect, it } from 'vitest';
import { gamesHref, gamesQuery } from './href';
import {
  GAMES_QUEUE,
  gameModeFromRaw,
  isRatedGameMode,
  mapIdFromRaw,
  matchesQueue,
  parseQueue,
} from './queue';

describe('parseQueue', () => {
  it("treats a missing parameter as Summoner's Rift", () => {
    expect(parseQueue(undefined, GAMES_QUEUE)).toBe('sr');
  });

  it('keeps the two maps', () => {
    expect(parseQueue('sr', GAMES_QUEUE)).toBe('sr');
    expect(parseQueue('aram', GAMES_QUEUE)).toBe('aram');
  });

  it('refuses an unknown value and a repeated parameter', () => {
    expect(parseQueue('kiwi', GAMES_QUEUE)).toBeNull();
    expect(parseQueue('CLASSIC', GAMES_QUEUE)).toBeNull();
    expect(parseQueue(['sr', 'aram'], GAMES_QUEUE)).toBeNull();
  });
});

describe('gameModeFromRaw', () => {
  it("reads the client's gameMode and uppercases it", () => {
    expect(gameModeFromRaw({ gameMode: 'CLASSIC' })).toBe('CLASSIC');
    expect(gameModeFromRaw({ gameMode: 'aram' })).toBe('ARAM');
  });

  it('returns null when the block never named one', () => {
    expect(gameModeFromRaw(null)).toBeNull();
    expect(gameModeFromRaw({})).toBeNull();
    expect(gameModeFromRaw({ gameMode: '' })).toBeNull();
    expect(gameModeFromRaw({ gameMode: 12 })).toBeNull();
  });
});

describe('mapIdFromRaw', () => {
  it('reads an integer mapId', () => {
    expect(mapIdFromRaw({ mapId: 12 })).toBe(12);
    expect(mapIdFromRaw({ mapId: 11 })).toBe(11);
  });

  it('returns null when the block never named one', () => {
    expect(mapIdFromRaw(null)).toBeNull();
    expect(mapIdFromRaw({})).toBeNull();
    expect(mapIdFromRaw({ mapId: '12' })).toBeNull();
  });
});

describe('matchesQueue', () => {
  it('puts CLASSIC and a missing mode on Rift', () => {
    expect(matchesQueue('CLASSIC', 'sr')).toBe(true);
    expect(matchesQueue(null, 'sr')).toBe(true);
    expect(matchesQueue(undefined, 'sr')).toBe(true);
    expect(matchesQueue('ARAM', 'sr')).toBe(false);
    expect(matchesQueue('KIWI', 'sr')).toBe(false);
  });

  it('puts Howling Abyss customs on ARAM, including KIWI', () => {
    expect(matchesQueue('ARAM', 'aram')).toBe(true);
    expect(matchesQueue('aram', 'aram')).toBe(true);
    expect(matchesQueue('KIWI', 'aram')).toBe(true);
    expect(matchesQueue('CLASSIC', 'aram')).toBe(false);
    expect(matchesQueue(null, 'aram')).toBe(false);
  });

  it('lets mapId win over a missing or mismatched mode', () => {
    expect(matchesQueue('CLASSIC', 'aram', 12)).toBe(true);
    expect(matchesQueue('KIWI', 'sr', 11)).toBe(true);
    expect(matchesQueue(null, 'aram', 12)).toBe(true);
    expect(matchesQueue(null, 'sr', 11)).toBe(true);
  });
});

describe('isRatedGameMode', () => {
  it('rates CLASSIC and a missing mode, and nothing else', () => {
    expect(isRatedGameMode('CLASSIC')).toBe(true);
    expect(isRatedGameMode(null)).toBe(true);
    expect(isRatedGameMode(undefined)).toBe(true);
    expect(isRatedGameMode('ARAM')).toBe(false);
    expect(isRatedGameMode('KIWI')).toBe(false);
    expect(isRatedGameMode('CLASSIC', 12)).toBe(false);
    expect(isRatedGameMode(null, 11)).toBe(true);
  });
});

describe('gamesQuery', () => {
  it('omits the default queue so a Rift URL stays short', () => {
    expect(gamesQuery({ queue: 'sr' })).toEqual({});
    expect(gamesQuery({ focusPuuid: 'u-lena', queue: 'sr' })).toEqual({ p: 'u-lena' });
  });

  it('keeps ARAM and a focus across the picker', () => {
    expect(gamesQuery({ queue: 'aram' })).toEqual({ queue: 'aram' });
    expect(gamesQuery({ focusPuuid: 'u-lena', queue: 'aram' })).toEqual({
      p: 'u-lena',
      queue: 'aram',
    });
  });

  it('builds the Everyone link without the person', () => {
    expect(gamesHref('this-week', { queue: 'sr' })).toBe('/games?window=this-week');
    expect(gamesHref('this-week', { queue: 'aram' })).toBe('/games?window=this-week&queue=aram');
  });
});
