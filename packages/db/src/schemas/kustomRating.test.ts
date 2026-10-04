import { describe, expect, it } from 'vitest';
import { ODDS_MODELS, oddsModelSchema, storedKustomAllTime, storedKustomWeek } from './index';

const ALL_TIME = {
  r_before: 1200,
  r_after: 1219.2,
  k: 32,
  fold_p: 0.5,
  rated_games_before: 0,
  award: 'mvp',
  share_rank: 1,
};

const WEEK = {
  week_r_before: 1200,
  week_r_after: 1192,
  week_k: 32,
  week_fold_p: 0.5,
  week_games_before: 0,
};

describe('the stored Kustom rating (0036)', () => {
  it('names the two odds models the splits check allows', () => {
    expect(ODDS_MODELS).toEqual(['openskill', 'kustom']);
    expect(oddsModelSchema.safeParse('elo').success).toBe(false);
  });

  it('reads a whole all-time track, a null share rank included', () => {
    expect(storedKustomAllTime(ALL_TIME)).toEqual(ALL_TIME);
    expect(storedKustomAllTime({ ...ALL_TIME, award: 'none', share_rank: null })).toEqual({
      ...ALL_TIME,
      award: 'none',
      share_rank: null,
    });
  });

  it('reads a whole weekly track', () => {
    expect(storedKustomWeek(WEEK)).toEqual(WEEK);
  });

  it('is null for a row not folded under Kustom', () => {
    expect(
      storedKustomAllTime({
        r_before: null,
        r_after: null,
        k: null,
        fold_p: 0.55,
        rated_games_before: 4,
        award: 'mvp',
        share_rank: null,
      }),
    ).toBeNull();
    expect(
      storedKustomWeek({
        week_r_before: null,
        week_r_after: null,
        week_k: null,
        week_fold_p: null,
        week_games_before: null,
      }),
    ).toBeNull();
  });

  it('drops a partial or out-of-range track to null rather than throwing', () => {
    expect(storedKustomAllTime({ ...ALL_TIME, k: null })).toBeNull();
    expect(storedKustomAllTime({ ...ALL_TIME, share_rank: 6 })).toBeNull();
    expect(storedKustomAllTime({ ...ALL_TIME, award: 'gold' })).toBeNull();
    expect(storedKustomWeek({ ...WEEK, week_fold_p: 1.2 })).toBeNull();
    expect(storedKustomWeek({ ...WEEK, week_games_before: null })).toBeNull();
  });
});
