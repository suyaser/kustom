import { provisionalSeed, type Rating } from '@customs/core';

/**
 * Where a player's history starts (M5.7).
 *
 * A rating is a fold, and a fold needs a first value. That value used to be recomputed from
 * `players.rank_tier` every time anybody asked — by the live fold when it created somebody's
 * `ratings` row, and again from scratch by every `rebuild-ratings`. The two agree only while
 * nobody's rank moves: the day a friend climbs, the next rebuild re-seeds their whole history
 * from the new rank and every number on their page shifts with nothing able to say why.
 *
 * So the seed is **stored, once, by the fold that first rated the player** (`0012`:
 * `ratings.seed_mu`, `seed_sigma`, `seed_rank_tier`, `seed_rank_division`) and nothing ever
 * rewrites it. This file is that rule: how the columns are read, how they are written, and what
 * a fold uses when they are empty.
 *
 * It is deliberately not in `packages/core` — core knows `seedFromRank` and nothing about a
 * `ratings` row — and deliberately not in `fold.ts`, which takes no database shape at all.
 */

/** The seed a fold started from, with the rank it was read from. */
export interface StoredSeed {
  rating: Rating;
  /** `players.rank_tier` as it was when the seed was taken. Null is unranked, a real answer. */
  rankTier: string | null;
  rankDivision: string | null;
}

/**
 * The four seed columns of a `ratings` row, exactly as PostgREST returns and accepts them.
 *
 * `seed_mu` being null is what "no seed stored" means; the database's `ratings_seed_pair` check
 * keeps mu and sigma both-or-neither so that reading one of them is enough.
 */
export interface SeedColumns {
  seed_mu: number | null;
  seed_sigma: number | null;
  seed_rank_tier: string | null;
  seed_rank_division: string | null;
}

/** The stored seed of a row, or null when it has none (a row written before `0012`). */
export function readSeed(row: SeedColumns): StoredSeed | null {
  if (row.seed_mu === null || row.seed_sigma === null) return null;
  return {
    rating: { mu: row.seed_mu, sigma: row.seed_sigma },
    rankTier: row.seed_rank_tier,
    rankDivision: row.seed_rank_division,
  };
}

/** The same, the other way round: what to send in an insert or an upsert. */
export function seedColumns(seed: StoredSeed | null): SeedColumns {
  if (seed === null) {
    return { seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null };
  }
  return {
    seed_mu: seed.rating.mu,
    seed_sigma: seed.rating.sigma,
    seed_rank_tier: seed.rankTier,
    seed_rank_division: seed.rankDivision,
  };
}

/**
 * What a fold starts this player from: **the stored seed if there is one**, and **the neutral
 * seed if there is not**.
 *
 * The preference for the stored pair is the whole of M5.7. A rank read from the client last
 * night says where somebody is now; it does not say where the fold that produced their stored
 * history began, and once a game has been rated only the second question matters.
 *
 * The fallback is 2026-09-16's decision, and it is core's `provisionalSeed()` — `{ mu: 20,
 * sigma: 12 }`, the same for everybody. It used to be `seedFromRank(rankTier, rankDivision)`, so
 * a first rated game started a Challenger at mu 35 and an Iron at mu 14 — a 1,260-point gap on
 * the board between two people who had played the same zero customs. **Nothing persisted is
 * seeded from a League rank any more**, and the customs decide the rest. The weekly track folds
 * from this same rule (M7.3), which is the sharper half of the argument: a board that measures
 * one week must not leak a solo-queue rank into it.
 *
 * The `sigma` is 12 and not the 10 an unranked player used to get, and that is the second half of
 * the decision rather than a detail: a rating moves in proportion to its own `sigma^2`, so a
 * larger starting uncertainty is what makes a newcomer's first few games move their number hard
 * and their tenth move it normally, with no phase and no special case anywhere in this file.
 * `config.rating.provisionalSigma` holds the measurement that picked it.
 *
 * `rankTier` / `rankDivision` are still carried onto the returned seed and still stored, because
 * they are the record of what the client said about this player the night their history started.
 * They are informational from here on and drive no number.
 *
 * `seedFromRank` is untouched and still reads a real rank: `lib/ingest/balance.ts` uses it as
 * tonight's team-forming guess for somebody with no customs games at all, which is a live
 * estimate that is thrown away at the end of the night and never stored.
 */
export function seedFor(
  stored: StoredSeed | null,
  rankTier: string | null,
  rankDivision: string | null,
): StoredSeed {
  if (stored !== null) return stored;
  return { rating: provisionalSeed(), rankTier, rankDivision };
}

/**
 * Do two seeds say the same thing? Used to decide whether a write would change anything.
 *
 * Exact equality on the numbers, with none of `RATING_EPSILON`'s tolerance, and that is safe
 * rather than lucky: the only comparison anybody makes is between a row's stored seed and the
 * seed a fold is about to write back for it, and {@link seedFor} hands back the stored object
 * untouched when there is one. A seed is never recomputed and compared to its round-tripped
 * self, which is the case the tolerance in `rebuild.ts` exists for.
 */
export function sameSeed(a: StoredSeed | null, b: StoredSeed | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.rating.mu === b.rating.mu &&
    a.rating.sigma === b.rating.sigma &&
    a.rankTier === b.rankTier &&
    a.rankDivision === b.rankDivision
  );
}
