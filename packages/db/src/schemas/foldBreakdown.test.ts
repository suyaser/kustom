import { describe, expect, it } from 'vitest';
import { FOLD_AWARDS, foldAwardSchema, storedFoldBreakdown } from './index';

describe('the stored fold breakdown (0034)', () => {
  it('names the three award words the column check allows', () => {
    expect(FOLD_AWARDS).toEqual(['mvp', 'ace', 'none']);
    expect(foldAwardSchema.safeParse('gold').success).toBe(false);
  });

  it('is null for a row stored before 0034', () => {
    expect(
      storedFoldBreakdown({ fold_p: null, base_mu_after: null, award: null, rated_games_before: null }),
    ).toBeNull();
  });

  it('reads a whole breakdown, none as a real value', () => {
    expect(
      storedFoldBreakdown({ fold_p: 0.62, base_mu_after: 25.4, award: 'none', rated_games_before: 9 }),
    ).toEqual({ fold_p: 0.62, base_mu_after: 25.4, award: 'none', rated_games_before: 9 });
  });

  it('drops a partial or out-of-range row to null rather than throwing', () => {
    expect(
      storedFoldBreakdown({ fold_p: 0.62, base_mu_after: null, award: 'mvp', rated_games_before: 3 }),
    ).toBeNull();
    expect(
      storedFoldBreakdown({ fold_p: 1.2, base_mu_after: 25, award: 'mvp', rated_games_before: 3 }),
    ).toBeNull();
    expect(
      storedFoldBreakdown({ fold_p: 0.5, base_mu_after: 25, award: 'gold', rated_games_before: 3 }),
    ).toBeNull();
  });
});
