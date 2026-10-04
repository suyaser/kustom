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
    /**
     * **The starting uncertainty of a customs history that does not exist yet** (2026-09-16), and
     * the `sigma` half of `provisionalSeed` — the one seed every player's first stored rating
     * begins at, on both tracks. `mu` is `unrankedMu`.
     *
     * A third number, not a reuse of the two above, because it answers a third question.
     * `rankedSigma` and `unrankedSigma` say "how sure are we of what a *League rank* implies";
     * this says "how sure are we of somebody we have never watched play a custom", and the honest
     * answer is: less. It is deliberately the only place that starting uncertainty is written, so
     * it can move without touching what `seedFromRank` hands the balancer.
     *
     * **Why a bigger number makes a new player settle sooner, with no special case anywhere.**
     * OpenSkill moves a player's `mu` in proportion to their own `sigma^2` over the whole lobby's
     * `sigma^2` — so a seed with a larger `sigma` takes a larger share of each result, and
     * `sigma` itself shrinks fastest while it is large. "Swings hard at first, then settles" falls
     * out of one number; there is no phase, no branch, no per-match tuning, and a lobby mixing a
     * newcomer with nine veterans is rated by exactly the same call as any other.
     *
     * **Why 12 and not 25.** Bigger is not better, and the measurement says where it turns. A
     * simulated newcomer of known true skill (14 to 35, the group's real range) plays nine settled
     * opponents, wins at the rate their true skill implies, and we ask how far their `mu` is from
     * the truth after five games — worst case over the skill range, averaged over 800 to 1500
     * seeded runs each (`rating/index.test.ts` keeps the guard; `04-decisions.md` keeps the full
     * table):
     *
     * | starting `sigma` | 8.33 | 10 | 11 | 12 | 13 | 14 | 16 | 20 |
     * |---|---|---|---|---|---|---|---|---|
     * | worst `\|error\|` at game 5, settled lobby (`sigma` 3.5) | 7.92 | 6.08 | **5.17** | 5.59 | 6.17 | 6.68 | 7.69 | 9.60 |
     * | the same in a lobby that is itself unsettled (`sigma` 6) | 10.61 | 9.85 | 9.07 | 8.30 | 7.66 | 7.53 | **7.29** | — |
     *
     * The curve has a bottom: past it, the extra step size is spent on win/loss noise rather than
     * on travel, and the newcomer's number gets *worse* — at 25 it is worse than never having
     * raised it at all. The optimum is 11 against a settled lobby and 13 or so against a loose
     * one, and 12 is the round number between them, within 0.5 mu of the best of both. Every game
     * is about a third of a result of information, and no seeding choice buys past that.
     */
    provisionalSigma: 12,
    /** Leaderboard ordinal is `mu - ordinalSigmaWeight * sigma`. */
    ordinalSigmaWeight: 2,
    /**
     * Rated games before a player is ranked on the board (M14.4, STRATEGY §5). Under this they
     * sit in the unnumbered `Still settling` section with a `settling · n/10` chip. Ten because
     * `00-product.md` says a Rating settles in about ten nightly games; read it as
     * `SETTLING_GAMES`, below, never as a literal 10 in a page.
     */
    settlingGames: 10,
    /** Display rating is `round(mu * displayMultiplier)`. Also the unit the balancer scores in. */
    displayMultiplier: 60,
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
    /**
     * "Why this many points" (M14.58): the bands `explainDelta` reads. Words only; sigma is never
     * printed.
     *
     * **Odds stance.** The side's percent is `favoredSide`'s rounding (the receipt's), so a red
     * row is 100 minus the receipt's blue percent. `even` is `evenPct.low` to `evenPct.high`
     * inclusive (the brief's 48-52); above is `favourite`, below is `underdog`. It is wider than
     * `oddsBand`'s `even` (exactly 50) on purpose: the sentence is about whether the odds changed
     * the size of the swing, and at 52% they barely did.
     *
     * **Certainty.** With the player's rated-game count before this game, the count decides and
     * nothing else, so the sentence can never contradict the `settling · n/10` chip: games
     * 1 to `newGames` are `new`, then `settling`, and game `SETTLING_GAMES` (ten; nine before it)
     * is the first `settled` one.
     *
     * Without a count, `sigma_before` decides: above `newSigmaAbove` is `new`, at or below
     * `settledSigmaAtOrBelow` is `settled`, `settling` between. The two numbers are fitted to
     * M1.3's reference lobby (a `provisionalSeed` newcomer among nine settled Gold IVs, mu 23
     * sigma 3.5, losing and winning in turn), where `sigma_before` is:
     *
     * | game | 1 | 2 | 3 | **4** | ... | 9 | **10** | 11 |
     * |---|---|---|---|---|---|---|---|---|
     * | `sigma_before` | 12.000 | 11.378 | 10.848 | 10.355 | ... | 8.559 | 8.286 | 8.039 |
     *
     * 10.6 sits between games 3 and 4, 8.4 between games 9 and 10, so that newcomer reads new
     * for three games, settling for six, and settled from the tenth, the same line the chip draws
     * (`rating/explain.test.ts` pins it). A streak or a looser lobby shifts sigma by a game or
     * two either way; a group whose whole history starts from seeds together keeps sigma above 10
     * for weeks, which is why the count wins whenever the caller has it.
     */
    explain: {
      evenPct: { low: 48, high: 52 },
      newGames: 3,
      newSigmaAbove: 10.6,
      settledSigmaAtOrBelow: 8.4,
    },
  },
  balance: {
    /**
     * Effective strength on a role is `r * multiplier`, `r` the all-time Kustom Rating (M18.2).
     * `main` is the player's main (or tonight's override, or any role for a flexible player),
     * `secondary` their backup, `fill` anything else.
     */
    roleMultiplier: { main: 1.0, secondary: 0.93, fill: 0.85 },
    /**
     * Rating points added to a split's score per player not on a main role, before fill
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
    /** Rating points added once when a split puts the same five together as `lastSplit`. */
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
  /**
   * The Kustom rating (M18.1, not yet wired; `rating/kustom.ts`, `docs/01-architecture.md`
   * "Kustom rating"). `change = K × (result − expected) × share` on the Rating scale, where
   * `expected` is `winProbability` of the two sides' summed Ratings over `oddsScale`, and
   * `K = kSettled + (kNew − kSettled) × max(0, kSettleGames − n) / kSettleGames` for a player
   * with `n` rated games on that track before this one (32 at game one, 16 from game eleven).
   * `winnerShares` is the winning side's share by performance rank, best first; the losing side
   * reads it reversed, so each side's shares sum to 5 and the game creates no points.
   * Everyone starts at `start`; nothing decays.
   */
  kustom: {
    start: 1200,
    kNew: 32,
    kSettled: 16,
    kSettleGames: 10,
    oddsScale: 400,
    winnerShares: [1.2, 1.1, 1.0, 0.9, 0.8],
  },
  modes: {
    /**
     * Whether a game is rated when nobody flips the switch (M15, brief D5). Normal, Fearless and
     * mirror match are ordinary League; class wars and region wars play off-meta pools that must
     * not move a rating or teach a role. An admin may flip it for the next game in any mode.
     */
    ratedDefault: { normal: true, fearless: true, class: false, region: false, mirror: true },
    /** A class with fewer open champions than this (Fearless bans counted) cannot be picked or spun (D7). */
    classMinOpen: 10,
    /**
     * A region needs at least this many open champions to be drawn for region wars (R8): five leaves
     * the last picker no choice and often no support.
     */
    regionMinOpen: 8,
  },
} as const;

export type Config = typeof config;

/** The one settling threshold (STRATEGY §5): `config.rating.settlingGames` under its board name. */
export const SETTLING_GAMES: number = config.rating.settlingGames;

/** Where every Kustom Rating starts, on both tracks (M18.1): `config.kustom.start`. */
export const KUSTOM_START: number = config.kustom.start;
