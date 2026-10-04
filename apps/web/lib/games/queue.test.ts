import { describe, expect, it } from 'vitest';
import { GAMES_QUEUE, gameModeFromRaw, matchesQueue, parseQueue } from './queue';

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

describe('matchesQueue', () => {
  it('puts CLASSIC and a missing mode on Rift', () => {
    expect(matchesQueue('CLASSIC', 'sr')).toBe(true);
    expect(matchesQueue(null, 'sr')).toBe(true);
    expect(matchesQueue(undefined, 'sr')).toBe(true);
    expect(matchesQueue('ARAM', 'sr')).toBe(false);
    expect(matchesQueue('KIWI', 'sr')).toBe(false);
  });

  it('puts only ARAM on the ARAM list', () => {
    expect(matchesQueue('ARAM', 'aram')).toBe(true);
    expect(matchesQueue('aram', 'aram')).toBe(true);
    expect(matchesQueue('CLASSIC', 'aram')).toBe(false);
    expect(matchesQueue(null, 'aram')).toBe(false);
    expect(matchesQueue('KIWI', 'aram')).toBe(false);
  });
});
