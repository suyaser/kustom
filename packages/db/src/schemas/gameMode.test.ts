import { describe, expect, it } from 'vitest';
import { ARAM_GAME_MODE_PATTERN, gameModeKind, isAramGameMode, isRiftGameMode } from './gameMode';

describe('game mode words (owner bug 2026-10-05)', () => {
  it('the ARAM family is every map 12 mode the client lists, and nothing else', () => {
    for (const mode of ['ARAM', 'aram', ' KIWI ', 'KIWI_JADE', 'KINGPORO']) expect(isAramGameMode(mode)).toBe(true);
    for (const mode of [null, undefined, '', 'CLASSIC', 'URF', 'ARURF', 'CHERRY', 'KIWIX', 'NEXUSBLITZ']) {
      expect(isAramGameMode(mode)).toBe(false);
    }
  });

  it('Rift is CLASSIC or a missing mode', () => {
    for (const mode of [null, undefined, '', ' classic ']) expect(isRiftGameMode(mode)).toBe(true);
    for (const mode of ['ARAM', 'KIWI', 'URF']) expect(isRiftGameMode(mode)).toBe(false);
  });

  it('the SQL pattern agrees with the helper', () => {
    const pattern = new RegExp(ARAM_GAME_MODE_PATTERN.replaceAll('[[:space:]]', '\\s'), 'i');
    for (const mode of ['ARAM', ' aram ', 'KIWI', 'kiwi_jade', 'KINGPORO', 'CLASSIC', 'URF', 'KIWIX', '']) {
      expect(pattern.test(mode)).toBe(isAramGameMode(mode));
    }
  });

  it('a kind: rift, aram, the word itself, or null when unknown', () => {
    expect(gameModeKind('CLASSIC')).toBe('rift');
    expect(gameModeKind('')).toBe('rift');
    expect(gameModeKind('KIWI')).toBe('aram');
    expect(gameModeKind('ARAM')).toBe('aram');
    expect(gameModeKind('urf')).toBe('URF');
    expect(gameModeKind(null)).toBeNull();
    expect(gameModeKind(undefined)).toBeNull();
  });
});
