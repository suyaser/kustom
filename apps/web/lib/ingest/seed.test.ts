import { provisionalSeed, seedFromRank } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { readSeed, type StoredSeed, sameSeed, seedColumns, seedFor } from './seed';

/**
 * The seed rule (M5.7), on its own: read the four columns, write the four columns, and prefer a
 * stored seed to whatever the player's rank says today.
 *
 * The folds that use it are exercised against the database in `rebuild.integration.test.ts`;
 * this file is the part that has no database in it.
 */

const GOLD_II: StoredSeed = { rating: seedFromRank('GOLD', 'II'), rankTier: 'GOLD', rankDivision: 'II' };

describe('readSeed', () => {
  it('reads a stored seed with the rank it was taken from', () => {
    expect(
      readSeed({
        seed_mu: 24.5,
        seed_sigma: 8.33,
        seed_rank_tier: 'GOLD',
        seed_rank_division: 'II',
      }),
    ).toEqual(GOLD_II);
  });

  it('is null when the row has no seed: a row written before 0012', () => {
    expect(
      readSeed({ seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null }),
    ).toBeNull();
  });

  it('reads an unranked seed, which has a rating and no rank at all', () => {
    const unranked = readSeed({
      seed_mu: 20,
      seed_sigma: 10,
      seed_rank_tier: null,
      seed_rank_division: null,
    });
    // Null tier is a real answer, not a missing seed — which is why `seed_mu` is what "is there
    // a seed" is read off, and why the database keeps the pair both-or-neither.
    expect(unranked).toEqual({ rating: seedFromRank(null, null), rankTier: null, rankDivision: null });
  });
});

describe('seedColumns', () => {
  it('round-trips a seed through the columns unchanged', () => {
    expect(readSeed(seedColumns(GOLD_II))).toEqual(GOLD_II);
  });

  it('writes four nulls for no seed, so an upsert payload can carry the same keys for everyone', () => {
    expect(seedColumns(null)).toEqual({
      seed_mu: null,
      seed_sigma: null,
      seed_rank_tier: null,
      seed_rank_division: null,
    });
  });
});

describe('seedFor', () => {
  it('prefers the stored seed to the rank the player wears today', () => {
    // The whole of M5.7: this player was Gold when their history started and is Diamond now.
    const seed = seedFor(GOLD_II, 'DIAMOND', 'I');
    expect(seed).toBe(GOLD_II);
    expect(seed.rating).toEqual(seedFromRank('GOLD', 'II'));
  });

  it('starts a player who has never been rated at the provisional seed, whatever their rank says', () => {
    expect(seedFor(null, 'SILVER', 'III')).toEqual({
      rating: provisionalSeed(),
      rankTier: 'SILVER',
      rankDivision: 'III',
    });
  });

  it('gives the challenger and the iron player the same first number (2026-09-16)', () => {
    const first = { mu: 20, sigma: 12 };
    expect(seedFor(null, 'CHALLENGER', 'I').rating).toEqual(first);
    expect(seedFor(null, 'IRON', 'IV').rating).toEqual(first);
    expect(seedFor(null, null, null).rating).toEqual(first);
    // Ranked or not, the rating is one number; the rank strings ride along as the record of what
    // the client said that night and drive nothing.
    expect(seedFor(null, 'CHALLENGER', 'I')).toEqual({
      rating: first,
      rankTier: 'CHALLENGER',
      rankDivision: 'I',
    });
  });

  it('is the seed a null `ratings` row recomputes to, which is what a retroactive reset relies on', () => {
    // "Never rated" and "seed columns nulled out" are the same input to this function, so
    // nulling every stored seed and re-running `rebuild-ratings` re-seeds the whole season here
    // and needs no second code path to do it.
    expect(
      seedFor(
        readSeed({ seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null }),
        'MASTER',
        null,
      ),
    ).toEqual({
      rating: provisionalSeed(),
      rankTier: 'MASTER',
      rankDivision: null,
    });
  });

  it('hands the stored object back untouched, which is what makes sameSeed exact', () => {
    expect(seedFor(GOLD_II, null, null)).toBe(GOLD_II);
  });
});

describe('sameSeed', () => {
  it('is true for the same pair and the same rank', () => {
    expect(sameSeed(GOLD_II, { ...GOLD_II })).toBe(true);
  });

  it('is true for two absent seeds and false when only one is absent', () => {
    expect(sameSeed(null, null)).toBe(true);
    expect(sameSeed(null, GOLD_II)).toBe(false);
    expect(sameSeed(GOLD_II, null)).toBe(false);
  });

  it('notices a different rating and a different rank', () => {
    expect(sameSeed(GOLD_II, { ...GOLD_II, rating: seedFromRank('GOLD', 'I') })).toBe(false);
    expect(sameSeed(GOLD_II, { ...GOLD_II, rankDivision: 'I' })).toBe(false);
  });
});
