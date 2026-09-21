import type { RoleValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import { MIN_RATED_DURATION_S } from '../lobbyState';
import { type FearlessGame, type FearlessSeat, foldFearless } from './fold';

const LANES: readonly RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];

function seat(n: number, side: 100 | 200, championId: number | null, role?: RoleValue | null): FearlessSeat {
  return { puuid: `p${n}`, side, championId, role: role === undefined ? (LANES[n % 5] ?? null) : role };
}

function ten(champions: readonly (number | null)[], extra: Partial<FearlessGame> = {}): FearlessGame {
  if (champions.length !== 10) throw new Error('need ten seats');
  return {
    durationS: 1_800,
    gameMode: 'CLASSIC',
    players: champions.map((championId, index) => seat(index, index < 5 ? 100 : 200, championId)),
    ...extra,
  };
}

describe('foldFearless', () => {
  it('keeps unique champion ids in first-appearance order', () => {
    const first = ten([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const second = ten([1, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(foldFearless([first, second]).map((pick) => pick.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it('keeps the role from the first lock, not a later lane', () => {
    const first = ten([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const laterMid: FearlessGame = {
      durationS: 1_800,
      gameMode: 'CLASSIC',
      players: [
        seat(0, 100, 1, 'mid'),
        seat(1, 100, 2, 'jungle'),
        seat(2, 100, 3, 'top'),
        seat(3, 100, 4, 'adc'),
        seat(4, 100, 5, 'support'),
        seat(5, 200, 6, 'top'),
        seat(6, 200, 7, 'jungle'),
        seat(7, 200, 8, 'mid'),
        seat(8, 200, 9, 'adc'),
        seat(9, 200, 10, 'support'),
      ],
    };
    expect(foldFearless([first, laterMid])[0]).toEqual({ id: 1, role: 'top' });
  });

  it('drops ARAM, remakes and a missing champion id without dropping the game', () => {
    const rift = ten([1, 2, 3, 4, 5, 6, 7, 8, 9, null]);
    const aram = ten([50, 51, 52, 53, 54, 55, 56, 57, 58, 59], { gameMode: 'ARAM' });
    const remake = ten([20, 21, 22, 23, 24, 25, 26, 27, 28, 29], {
      durationS: MIN_RATED_DURATION_S,
    });
    const missingMode = ten([10, 2, 3, 4, 5, 6, 7, 8, 9, 11], { gameMode: null });

    expect(foldFearless([aram, remake, rift, missingMode]).map((pick) => pick.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('treats a missing mode as Rift, the same way every other surface does', () => {
    expect(
      foldFearless([ten([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { gameMode: null })]).map((pick) => pick.id),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns nothing when there is nothing to ban yet', () => {
    expect(foldFearless([])).toEqual([]);
  });
});
