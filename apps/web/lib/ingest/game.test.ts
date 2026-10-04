import { describe, expect, it } from 'vitest';
import { eogPayload, testPuuids } from '../testing/fixtures';
import {
  CUSTOM_GAME_TYPE,
  findDuplicateParticipant,
  isCustomGame,
  isParticipant,
  recordedKind,
} from './game';

/**
 * The three guards the game route runs before it writes anything. All pure: no database, no
 * token, just the block the companion posted.
 */

const puuids = testPuuids('guards');

describe('isCustomGame', () => {
  it('accepts CUSTOM_GAME', () => {
    expect(isCustomGame(eogPayload({ gameId: 1, puuids }))).toBe(true);
    expect(CUSTOM_GAME_TYPE).toBe('CUSTOM_GAME');
  });

  it.each(['MATCHED_GAME', 'PRACTICETOOL', 'custom_game', ''])('refuses %j', (gameType) => {
    expect(isCustomGame(eogPayload({ gameId: 1, puuids, gameType }))).toBe(false);
  });

  it('refuses a block that does not say what it is', () => {
    // A missing gameType is not a custom game: the companion reads it straight off the block,
    // so its absence means we are looking at something we do not understand.
    expect(isCustomGame(eogPayload({ gameId: 1, puuids, gameType: null }))).toBe(false);
  });
});

describe('isParticipant', () => {
  it('is true for every PUUID on the scoreboard', () => {
    const payload = eogPayload({ gameId: 1, puuids });

    for (const puuid of puuids) {
      expect(isParticipant(payload, puuid)).toBe(true);
    }
  });

  it('is false for a player who was not in the game', () => {
    const payload = eogPayload({ gameId: 1, puuids });

    expect(isParticipant(payload, 'someone-else')).toBe(false);
    // No prefix or substring matching: identity is the whole PUUID.
    expect(isParticipant(payload, `${puuids[0]}-extra`)).toBe(false);
    expect(isParticipant(payload, '')).toBe(false);
  });
});

describe('findDuplicateParticipant', () => {
  it('is null for ten distinct players', () => {
    expect(findDuplicateParticipant(eogPayload({ gameId: 1, puuids }))).toBeNull();
  });

  it('names the PUUID that appears twice', () => {
    const doubled = [...puuids.slice(0, 9), puuids[0] ?? ''];

    expect(findDuplicateParticipant(eogPayload({ gameId: 1, puuids: doubled }))).toBe(puuids[0]);
  });
});

describe('recordedKind (M15.3)', () => {
  it('is the rating gates read as the mode lifecycle sees them', () => {
    expect(recordedKind({ raw: { gameMode: 'CLASSIC' }, durationS: 1_800 })).toBe('rift');
    expect(recordedKind({ raw: {}, durationS: 1_800 })).toBe('rift');
    expect(recordedKind({ raw: { gameMode: 'CLASSIC' }, durationS: 300 })).toBe('remake');
    expect(recordedKind({ raw: { gameMode: 'ARAM' }, durationS: 1_800 })).toBe('aram');
    expect(recordedKind({ raw: { gameMode: 'ARAM' }, durationS: 120 })).toBe('aram');
  });
});
