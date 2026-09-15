/**
 * Every tuning constant in `packages/core`, in one place, so a tuning change is a one-line
 * diff plus a test update. Values come from `docs/01-architecture.md` ("Rating model",
 * "Balancer") and the M1.3 / M1.4 briefs in `docs/02-milestones.md`.
 *
 * Do not change a number here without updating the tests and the architecture doc in the
 * same change.
 */

import type { Role } from './types';

/** The ranked tiers the League client reports, uppercase as the client sends them. */
export type RankTier =
  | 'IRON'
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'EMERALD'
  | 'DIAMOND'
  | 'MASTER'
  | 'GRANDMASTER'
  | 'CHALLENGER';

/** Division within a tier. IV is the tier base. Master and above have none. */
export type RankDivision = 'I' | 'II' | 'III' | 'IV';

/**
 * Which of the three performance weight vectors a player is scored on (M7.13).
 *
 * Three, not five. `carry` lumps top, mid and adc together **because M7.12 measured that
 * nothing in the end-of-game block separates top from mid** — a bucket that never has to tell
 * them apart cannot be wrong about it. What the same measurement did pin, 46 of 46 sides with
 * an independent Smite check, is jungle and support, which are exactly the two roles the flat
 * M7.8 vector misread. The split is drawn where the evidence is and nowhere else.
 */
export type PerformanceBucket = 'carry' | 'jungle' | 'support';

export const config = {
  rating: {
    /** Seed `mu` for division IV of each tier. Master and above share 35 and ignore division. */
    tierMu: {
      IRON: 14,
      BRONZE: 17,
      SILVER: 20,
      GOLD: 23,
      PLATINUM: 26,
      EMERALD: 29,
      DIAMOND: 32,
      MASTER: 35,
      GRANDMASTER: 35,
      CHALLENGER: 35,
    } satisfies Record<RankTier, number>,
    /** Tiers whose divisions are ignored when seeding. */
    tiersWithoutDivisions: ['MASTER', 'GRANDMASTER', 'CHALLENGER'] satisfies RankTier[],
    /** Added to `tierMu` per division above IV: III +1, II +2, I +3 steps. */
    divisionStep: 0.75,
    /** Number of steps above the tier base for each division. */
    divisionSteps: { IV: 0, III: 1, II: 2, I: 3 } satisfies Record<RankDivision, number>,
    /** Seed `sigma` for any recognised ranked tier (OpenSkill's default 25/3, rounded). */
    rankedSigma: 8.33,
    /** Seed for unranked, or any tier string we do not recognise. */
    unrankedMu: 20,
    unrankedSigma: 10,
    /** Leaderboard ordinal is `mu - ordinalSigmaWeight * sigma`. */
    ordinalSigmaWeight: 2,
    /** Display rating is `round(mu * displayMultiplier)`. Also the unit the balancer scores in. */
    displayMultiplier: 60,
    /**
     * The weekly track (M7.2): `rateGameWeekly`'s OpenSkill options, and the only place they
     * live. Read by nothing else — the all-time channel (`rateGame`) passes no options at all
     * and must keep producing the numbers already stored on `game_players`.
     *
     * Measured (see `rating/index.test.ts` and `01-architecture.md`): one game moves a fresh
     * Sunday seed about 79 display points and a settled player about 32, against 77 and 29 on
     * the all-time channel, and on M1.3's convergence setup `sigma` drops below 5.00 in game
     * 30 against the all-time channel's 36. The week is worth having because it *moves* — the
     * Sunday reseed (M7.3) is most of that — not because it settles sooner.
     */
    weekly: {
      /**
       * How much luck OpenSkill assumes in one game. Its default is `25 / 6` (about 4.17);
       * the week halves it, so a result carries about twice the information and a week's
       * games move the number sooner. Below about 2.00 the curve flattens: a player's `mu`
       * step is `sigma^2 * (1 - p) / c` with `c = sqrt(sum of the ten sigmas squared +
       * 2 * beta^2)`, so beta accounts for roughly 35 of a `c^2` near 214 and the ten
       * players' sigmas dominate it. Nothing left to buy below here, and swing to pay for it.
       */
      beta: 2,
      /**
       * Uncertainty added back before each game, so the Thursday games still move a number
       * the Sunday and Monday games have already tightened. OpenSkill's default is `25 / 300`
       * (0.083). A knee, not a ceiling: `sigma` still reaches 5.00 at 0.35 (game 34), 0.40
       * (game 39) and 0.45 (game 59), and stops reaching it at all from about 0.46 up
       * (measured to 500 games). The weekly board sorts on `ordinal = mu - 2 * sigma`, so a
       * sigma that never converges is a Proven column that never means anything; 0.30 keeps
       * the week responsive and still settles.
       */
      tau: 0.3,
    },
    /**
     * Which weight vector each role is scored on (M7.13). **This map is named here and
     * nowhere else**: a second copy is how top quietly stops being a carry.
     *
     * A role outside these five, or no role at all, is not in this map, and the game gets no
     * MVP rather than a silent fall back to `carry` — see `rating/performance.ts`.
     */
    performanceBucket: {
      top: 'carry',
      mid: 'carry',
      adc: 'carry',
      jungle: 'jungle',
      support: 'support',
    } satisfies Record<Role, PerformanceBucket>,
    /**
     * The performance score (M7.8, revised in place by M7.13 and again by M7.14): seven weights
     * that sum to 1.00, over components each normalised inside the game (a player's value
     * divided by the best of the ten), so every term is in `[0, 1]` and gold cannot swamp KDA by
     * being a four-digit number. KDA is `(kills + assists) / max(1, deaths)`. A component whose
     * game-wide maximum is zero contributes zero to everybody instead of dividing by zero.
     *
     * **Three vectors, not one** (M7.13), keyed by the bucket `performanceBucket` puts the
     * player's role in. M7.8 scored a support and an adc on the same weights, which asked each of
     * them to win MVP on the other's terms. Only *which* vector multiplies a player's normalised
     * components changed; the components, the normalisation and the bonus did not.
     *
     * | component | `carry` | `jungle` | `support` |
     * |---|---|---|---|
     * | KDA | 0.15 | 0.20 | 0.25 |
     * | damage to champions | 0.30 | 0.20 | 0.05 |
     * | gold | 0.20 | 0.10 | 0.05 |
     * | vision score | 0.05 | 0.15 | 0.40 |
     * | damage self-mitigated | 0.10 | 0.10 | 0.15 |
     * | CS | 0.20 | 0.10 | 0.10 |
     * | damage to objectives | 0.00 | 0.15 | 0.00 |
     *
     * **`damageToObjectives` is M7.14's seventh component** and the jungle row is the only row
     * that moved for it: the 0.15 comes off gold, CS and KDA, 0.05 each — gold and CS because
     * objective damage is a second reading of the same farming clock, KDA by one notch because a
     * jungler taking objectives is doing the thing ganks were a proxy for. `carry` and `support`
     * carry it at `0.00`, so their scores are bit-for-bit what M7.13 produced. A `0.00` weight
     * does **not** make the number optional for those players: the missing-input rule in
     * `rating/performance.ts` is per game and universal, because the normalisation denominator is
     * the whole ten and because a weight nudge must never change which past games are scorable.
     *
     * op.gg's own formula is proprietary and unpublished; these are hand-reasoned from what
     * each role is actually for, fitted to nothing, and are tunables like every other number
     * here, not gospel.
     */
    performance: {
      carry: {
        kda: 0.15,
        damageToChamps: 0.3,
        gold: 0.2,
        visionScore: 0.05,
        damageSelfMitigated: 0.1,
        cs: 0.2,
        damageToObjectives: 0,
      },
      jungle: {
        kda: 0.2,
        damageToChamps: 0.2,
        gold: 0.1,
        visionScore: 0.15,
        damageSelfMitigated: 0.1,
        cs: 0.1,
        damageToObjectives: 0.15,
      },
      support: {
        kda: 0.25,
        damageToChamps: 0.05,
        gold: 0.05,
        visionScore: 0.4,
        damageSelfMitigated: 0.15,
        cs: 0.1,
        damageToObjectives: 0,
      },
    },
    /**
     * The MVP / ACE adjustment (M7.8), applied after `rateGame` and never inside it. The MVP
     * (best score on the winning side) keeps `1 + bonusFraction` of their `mu` delta, the ACE
     * (best score on the losing side) `1 - aceReliefFraction` of theirs. Both factors are
     * positive, so a winner always gains and a loser always loses; `sigma` is never touched.
     */
    mvp: {
      bonusFraction: 0.25,
      aceReliefFraction: 0.2,
    },
  },
  balance: {
    /**
     * Effective skill on a role is `mu * multiplier * rating.displayMultiplier`.
     * `main` is the player's main (or tonight's override, or any role for a flexible player),
     * `secondary` their backup, `fill` anything else.
     */
    roleMultiplier: { main: 1.0, secondary: 0.93, fill: 0.85 },
    /**
     * Display points added to a split's score per player not on a main role, before fill
     * protection scales it: the price of one off-role seat for somebody with no fill history.
     */
    offRolePenalty: 120,
    /**
     * Fill protection (M7.5). One off-role seat costs
     * `offRolePenalty * (1 + fillProtectionFactor / (gamesSinceLastFill + 1))`, so a player
     * filled in their last game costs 240, one game later 180, three games later 150, nine
     * games later 132, decaying to the flat 120. A `gamesSinceLastFill` of `null` — never
     * filled, or no history to read — is the flat 120 exactly.
     *
     * At 1.0 a fresh fill is worth twice a stale one, which is the whole rule in one sentence:
     * "we just filled you, so somebody else goes first tonight". Two things bound it: the most
     * protection ever adds to one seat is `offRolePenalty` itself, and a split-level tie still
     * falls through to the lower `offRoleCount` in `compareSplits`. It does **not** follow that
     * protection can only change who is filled and never how many are — splits differ in raw
     * gap as well as in fill cost, and roughly 1% of random ten-player lobbies (1.35% and 1.07%
     * in two sweeps of 4,000) land on a split with a different `offRoleCount` once somebody is
     * protected, in both directions. Raising the factor buys more of that; 0 turns the feature
     * off without removing the input.
     */
    fillProtectionFactor: 1.0,
    /** Display points added once when a split puts the same five together as `lastSplit`. */
    repeatSplitPenalty: 200,
    /** How many splits `balance` returns at most, best first. Reroll walks this list. */
    splitsReturned: 3,
  },
  roles: {
    /**
     * `inferRoles` (M5.16) reads a player's main and backup off their most recent games that
     * count: this many, newest first. Twenty is about two weeks for a regular and a month for
     * somebody who plays half the nights: one odd evening does not move a main, a real change
     * shows inside a fortnight.
     */
    inferenceWindow: 20,
    /** Fewer counted games than this and the player is flexible (`main: null`). Three is not one lucky fill. */
    minGames: 3,
  },
} as const;

export type Config = typeof config;
