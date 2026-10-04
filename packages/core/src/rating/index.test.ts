import { describe, expect, it } from 'vitest';
import {
  balanceScore,
  config,
  displayRating,
  evenness,
  ordinal,
  predictWin,
  provisionalSeed,
  type Rating,
  rateGame,
  seedFromRank,
} from '../index';

const RANKED_SIGMA = 8.33;

function team(rating: Rating, n = 5): Rating[] {
  return Array.from({ length: n }, () => ({ ...rating }));
}

/**
 * The M1.3 brief's convergence setup: P0 seeded Iron IV (mu 14, sigma 8.33), ten settled
 * Gold IVs (mu 23, sigma 3.5). In game k (0-indexed) P0's team is P0 plus players
 * 1 + (k % 10) .. 1 + ((k + 3) % 10). The brief says "the remaining five are the opponents",
 * but P0 plus ten others is eleven people, so the opponents are the next five in the same
 * rotation and the tenth sits that game. P0's side wins every time.
 *
 * Returns P0's rating after each game, index 0 being after game 1.
 */
function convergeMisSeeded(games: number): Rating[] {
  const ratings: Rating[] = [
    { mu: 14, sigma: 8.33 },
    ...Array.from({ length: 10 }, () => ({ mu: 23, sigma: 3.5 })),
  ];
  const at = (i: number): Rating => {
    const r = ratings[i];
    if (r === undefined) throw new Error(`missing player ${i}`);
    return r;
  };
  const history: Rating[] = [];
  for (let k = 0; k < games; k += 1) {
    const ownIds = [0, ...[0, 1, 2, 3].map((o) => 1 + ((k + o) % 10))];
    const oppIds = [4, 5, 6, 7, 8].map((o) => 1 + ((k + o) % 10));
    const { blue, red } = rateGame(ownIds.map(at), oppIds.map(at), 100);
    ownIds.forEach((id, i) => {
      ratings[id] = blue[i] ?? at(id);
    });
    oppIds.forEach((id, i) => {
      ratings[id] = red[i] ?? at(id);
    });
    history.push(at(0));
  }
  return history;
}

describe('seedFromRank', () => {
  // Every cell of the brief's table, spelled out so a wrong constant fails on its own row.
  it.each([
    ['IRON', 'IV', 14.0],
    ['IRON', 'III', 14.75],
    ['IRON', 'II', 15.5],
    ['IRON', 'I', 16.25],
    ['BRONZE', 'IV', 17.0],
    ['BRONZE', 'III', 17.75],
    ['BRONZE', 'II', 18.5],
    ['BRONZE', 'I', 19.25],
    ['SILVER', 'IV', 20.0],
    ['SILVER', 'III', 20.75],
    ['SILVER', 'II', 21.5],
    ['SILVER', 'I', 22.25],
    ['GOLD', 'IV', 23.0],
    ['GOLD', 'III', 23.75],
    ['GOLD', 'II', 24.5],
    ['GOLD', 'I', 25.25],
    ['PLATINUM', 'IV', 26.0],
    ['PLATINUM', 'III', 26.75],
    ['PLATINUM', 'II', 27.5],
    ['PLATINUM', 'I', 28.25],
    ['EMERALD', 'IV', 29.0],
    ['EMERALD', 'III', 29.75],
    ['EMERALD', 'II', 30.5],
    ['EMERALD', 'I', 31.25],
    ['DIAMOND', 'IV', 32.0],
    ['DIAMOND', 'III', 32.75],
    ['DIAMOND', 'II', 33.5],
    ['DIAMOND', 'I', 34.25],
  ] as const)('%s %s seeds mu %d with sigma 8.33', (tier, division, mu) => {
    expect(seedFromRank(tier, division)).toEqual({ mu, sigma: RANKED_SIGMA });
  });

  it.each(['MASTER', 'GRANDMASTER', 'CHALLENGER'] as const)(
    '%s is 35.00 and ignores any division',
    (tier) => {
      expect(seedFromRank(tier, 'I')).toEqual({ mu: 35, sigma: RANKED_SIGMA });
      expect(seedFromRank(tier, 'IV')).toEqual({ mu: 35, sigma: RANKED_SIGMA });
      expect(seedFromRank(tier, null)).toEqual({ mu: 35, sigma: RANKED_SIGMA });
    },
  );

  it('seeds unranked at 20.00 with sigma 10.00', () => {
    expect(seedFromRank('UNRANKED', null)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('NONE', 'NA')).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank(null, null)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank(undefined, undefined)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('', '')).toEqual({ mu: 20, sigma: 10 });
  });

  it('is the unranked pair when it is asked about no rank at all', () => {
    expect(seedFromRank(null, null)).toEqual({
      mu: config.rating.unrankedMu,
      sigma: config.rating.unrankedSigma,
    });
  });

  it('treats a garbage tier string as unranked', () => {
    expect(seedFromRank('WOOD', 'II')).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('GOLDEN', 'I')).toEqual({ mu: 20, sigma: 10 });
  });

  it('matches tier and division case-insensitively', () => {
    expect(seedFromRank('gold', 'ii')).toEqual({ mu: 24.5, sigma: RANKED_SIGMA });
    expect(seedFromRank('Gold', 'Ii')).toEqual({ mu: 24.5, sigma: RANKED_SIGMA });
  });

  it('treats a missing or unrecognised division on a ranked tier as the tier base (IV)', () => {
    expect(seedFromRank('GOLD', null)).toEqual({ mu: 23, sigma: RANKED_SIGMA });
    expect(seedFromRank('GOLD', 'NA')).toEqual({ mu: 23, sigma: RANKED_SIGMA });
    expect(seedFromRank('GOLD', 'V')).toEqual({ mu: 23, sigma: RANKED_SIGMA });
  });

  it('returns a fresh object each call', () => {
    const a = seedFromRank('GOLD', 'IV');
    const b = seedFromRank('GOLD', 'IV');
    expect(a).not.toBe(b);
    a.mu = 0;
    expect(seedFromRank('GOLD', 'IV').mu).toBe(23);
  });

  it('is driven by the exported config so tuning is a one-line diff', () => {
    expect(config.rating.tierMu).toEqual({
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
    });
    expect(config.rating.divisionStep).toBe(0.75);
    expect(config.rating.rankedSigma).toBe(8.33);
    expect(config.rating.unrankedMu).toBe(20);
    expect(config.rating.unrankedSigma).toBe(10);
    expect(config.rating.ordinalSigmaWeight).toBe(2);
    expect(config.rating.displayMultiplier).toBe(60);
  });
});

/**
 * **Where every stored rating starts** (2026-09-16): one value, no arguments, both tracks.
 *
 * Two claims are tested here and they are separate. The first is the decision — `mu` says
 * nothing about you and the `sigma` is deliberately larger than anything a rank would give — and
 * is a matter of constants. The second is the engineering: that the larger `sigma` is what makes
 * a new player's number find its level in a handful of games, and that **12 is a measured choice
 * rather than a bigger-is-better one**.
 */
describe('provisionalSeed', () => {
  it('is mu 20, sigma 12, from the config and nowhere else', () => {
    expect(provisionalSeed()).toEqual({ mu: 20, sigma: 12 });
    expect(provisionalSeed()).toEqual({
      mu: config.rating.unrankedMu,
      sigma: config.rating.provisionalSigma,
    });
  });

  it('is more uncertain than any rank-derived seed, which is the whole point of the third number', () => {
    // A rank is a claim about a player; this is the absence of one. If these ever line up,
    // somebody has quietly gone back to seeding a customs history from solo queue.
    expect(config.rating.provisionalSigma).toBeGreaterThan(config.rating.rankedSigma);
    expect(config.rating.provisionalSigma).toBeGreaterThan(config.rating.unrankedSigma);
  });

  it('returns a fresh object each call', () => {
    const a = provisionalSeed();
    expect(a).not.toBe(provisionalSeed());
    a.mu = 0;
    expect(provisionalSeed().mu).toBe(20);
  });

  it('takes no argument: nothing about a player may change where they start', () => {
    expect(provisionalSeed.length).toBe(0);
  });

  /**
   * **"Swings hard, then settles" is one number and no branching.** `sigma` shrinks on its own
   * with every game, and OpenSkill's step is proportional to `sigma^2`, so the same untuned
   * `rateGame` gives a newcomer a big first move and a smaller tenth one. Pinned against a
   * settled field alternating loss / win, so the walk is about `sigma` and not about a streak.
   */
  it('shrinks its own sigma fast at first and slower later, with no phase anywhere', () => {
    const settled = { mu: 23, sigma: 3.5 };
    let me = provisionalSeed();
    const sigmaAt: number[] = [];
    for (let game = 1; game <= 12; game += 1) {
      const { blue } = rateGame([me, ...team(settled, 4)], team(settled), game % 2 === 0 ? 100 : 200);
      me = blue[0] as Rating;
      sigmaAt.push(me.sigma);
    }
    expect(sigmaAt[0]).toBeCloseTo(11.378, 3);
    expect(sigmaAt[4]).toBeCloseTo(9.529, 3);
    expect(sigmaAt[9]).toBeCloseTo(8.039, 3);
    // The first five games take 2.47 sigma out; the next five take 1.49 — a ratio of 1.66, the
    // decay that makes a rating provisional and then settled without anything saying so.
    const early = 12 - (sigmaAt[4] as number);
    const late = (sigmaAt[4] as number) - (sigmaAt[9] as number);
    expect(early / late).toBeGreaterThan(1.5);
  });

  /**
   * **The measurement that chose 12** (2026-09-16), kept as a guard rather than as a comment.
   *
   * A newcomer of known true skill plays nine settled opponents (`mu` 23, `sigma` 3.5) and wins
   * at the rate their true skill implies — `predictWin`'s own probability for a side with them on
   * it — with a seeded LCG so the whole thing is deterministic. The score is the **worst** mean
   * `|mu - true mu|` after five games across the group's real skill range (Iron to Master), which
   * is the fairest single question to ask of a seed: how badly can we still be misjudging
   * somebody after their first night, whoever they turned out to be.
   *
   * Measured **at this guard's own 200 runs per skill** (400 runs moves these by under 0.05).
   * `config.ts` and `04-decisions.md` print the fuller sweep — eight starting sigmas, two lobby
   * shapes, 800 to 1500 runs per skill — whose figures sit within 0.5 of these; the four below
   * are the ones this test re-measures every time it runs, which is why they are quoted here and
   * not copied from there:
   *
   * | starting `sigma` | 8.33 (the old rank seed) | 10 | **12** | 20 |
   * |---|---|---|---|---|
   * | worst mean error at game 5 | 7.96 | 6.14 | **5.60** | 9.56 |
   *
   * Both bounds matter. The ceiling says the seed does its job; the margin over 8.33 says the
   * decision bought something real. And 20 being *worse than doing nothing* is why this is a
   * measured constant: past the knee the extra step size is spent on win/loss noise, not on
   * getting the number right.
   */
  it('puts a newcomer of any skill inside 6.00 mu of their true rating by game 5, beating the old rank seed by 1.5', () => {
    const lcg = (seed: number): (() => number) => {
      let s = seed >>> 0;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    };
    const settled = { mu: 23, sigma: 3.5 };
    const RUNS = 200;

    /** Worst mean `|error|` after five games, over the skill range, for one starting sigma. */
    const worstErrorAtGame5 = (startSigma: number): number => {
      let worst = 0;
      for (const trueMu of [14, 17, 20, 23, 26, 29, 32, 35]) {
        const p = predictWin([{ mu: trueMu, sigma: settled.sigma }, ...team(settled, 4)], team(settled));
        let total = 0;
        for (let run = 0; run < RUNS; run += 1) {
          const roll = lcg(1000 + run * 7919 + trueMu);
          let me: Rating = { mu: config.rating.unrankedMu, sigma: startSigma };
          for (let game = 0; game < 5; game += 1) {
            const { blue } = rateGame([me, ...team(settled, 4)], team(settled), roll() < p ? 100 : 200);
            me = blue[0] as Rating;
          }
          total += Math.abs(me.mu - trueMu);
        }
        worst = Math.max(worst, total / RUNS);
      }
      return worst;
    };

    const provisional = worstErrorAtGame5(config.rating.provisionalSigma);
    const oldRankSeed = worstErrorAtGame5(config.rating.rankedSigma);

    expect(provisional).toBeLessThan(6);
    expect(oldRankSeed - provisional).toBeGreaterThan(1.5);
    // And the other direction, so nobody "improves" this by making the seed wilder: at 20 the
    // newcomer is further from the truth after five games than they were under the old seed.
    expect(worstErrorAtGame5(20)).toBeGreaterThan(oldRankSeed);
  });
});

describe('ordinal', () => {
  it('is mu - 2 * sigma', () => {
    expect(ordinal({ mu: 25, sigma: 8.33 })).toBeCloseTo(8.34, 10);
    expect(ordinal({ mu: 30, sigma: 3.5 })).toBe(23);
    expect(ordinal({ mu: 14, sigma: 10 })).toBe(-6);
  });
});

describe('displayRating', () => {
  it('is round(mu * 60)', () => {
    expect(displayRating(25)).toBe(1500);
    expect(displayRating(23.75)).toBe(1425);
    expect(displayRating(14)).toBe(840);
    expect(displayRating(35)).toBe(2100);
    expect(displayRating(20.004)).toBe(1200);
    expect(displayRating(20.009)).toBe(1201);
  });
});

describe('predictWin', () => {
  const settled = { mu: 25, sigma: 5 };

  it('returns 0.5 for two identical teams', () => {
    expect(predictWin(team(settled), team(settled))).toBe(0.5);
  });

  it('returns the blue side probability, not the red', () => {
    const strong = team({ mu: 30, sigma: 5 });
    const weak = team({ mu: 20, sigma: 5 });
    const blueStrong = predictWin(strong, weak);
    const blueWeak = predictWin(weak, strong);
    expect(blueStrong).toBeGreaterThan(0.5);
    expect(blueWeak).toBeLessThan(0.5);
    expect(blueStrong + blueWeak).toBeCloseTo(1, 12);
  });

  it('is pinned for a known matchup', () => {
    // Blue has one player 5 mu above the rest: a small, real edge.
    const blue = [...team(settled, 4), { mu: 30, sigma: 5 }];
    expect(predictWin(blue, team(settled))).toBeCloseTo(0.6165, 4);
  });

  it('stays in [0, 1] at the extremes', () => {
    const p = predictWin(team({ mu: 60, sigma: 1 }), team({ mu: 0, sigma: 1 }));
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('rateGame', () => {
  const settled = { mu: 25, sigma: 5 };

  it('moves the winners up and the losers down, for either winning side', () => {
    const blue = team(settled);
    const red = team(settled);

    const blueWins = rateGame(blue, red, 100);
    for (const r of blueWins.blue) expect(r.mu).toBeGreaterThan(25);
    for (const r of blueWins.red) expect(r.mu).toBeLessThan(25);

    const redWins = rateGame(blue, red, 200);
    for (const r of redWins.blue) expect(r.mu).toBeLessThan(25);
    for (const r of redWins.red) expect(r.mu).toBeGreaterThan(25);
  });

  it('is symmetric in side colour', () => {
    const a = [...team(settled, 4), { mu: 18.5, sigma: 8.33 }];
    const b = [...team(settled, 3), { mu: 35, sigma: 3.5 }, { mu: 22, sigma: 6 }];
    const aOnBlue = rateGame(a, b, 100);
    const aOnRed = rateGame(b, a, 200);
    expect(aOnBlue.blue).toEqual(aOnRed.red);
    expect(aOnBlue.red).toEqual(aOnRed.blue);
  });

  it('keeps input order and returns plain { mu, sigma } objects', () => {
    const blue = [
      { mu: 20, sigma: 8.33 },
      { mu: 22, sigma: 7 },
      { mu: 24, sigma: 6 },
      { mu: 26, sigma: 5 },
      { mu: 28, sigma: 4 },
    ];
    const red = team(settled);
    const { blue: after } = rateGame(blue, red, 100);
    expect(after).toHaveLength(5);
    // Every winner's mu rises by an amount proportional to their own sigma^2, so the
    // deltas shrink down the list exactly when order is preserved.
    const deltas = after.map((r, i) => r.mu - (blue[i]?.mu ?? Number.NaN));
    for (let i = 1; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1] ?? Number.NaN);
    }
    for (const r of after) expect(Object.keys(r).sort()).toEqual(['mu', 'sigma']);
  });

  it('does not mutate its inputs and is deterministic', () => {
    const blue = team({ mu: 18.5, sigma: 8.33 });
    const red = team(settled);
    const snapshotBlue = structuredClone(blue);
    const snapshotRed = structuredClone(red);
    const first = rateGame(blue, red, 100);
    const second = rateGame(blue, red, 100);
    expect(blue).toEqual(snapshotBlue);
    expect(red).toEqual(snapshotRed);
    expect(first).toEqual(second);
  });

  it('throws unless both teams have exactly five ratings', () => {
    expect(() => rateGame(team(settled, 4), team(settled), 100)).toThrow(/five/);
    expect(() => rateGame(team(settled), team(settled, 6), 100)).toThrow(/five/);
    expect(() => rateGame([], [], 100)).toThrow(/five/);
  });

  it('a Bronze on the winning side gains more than a Master beside them', () => {
    // Pinned per the M1.3 brief: OpenSkill moves mu by sigma^2, so the fresh Bronze must
    // out-gain the settled Master. Equal sigmas would gain identically; do not "fix" that.
    const bronze = { mu: 18.5, sigma: 8.33 };
    const master = { mu: 35, sigma: 3.5 };
    const blue = [bronze, master, ...team(settled, 3)];
    const red = team(settled);

    const after = rateGame(blue, red, 100);
    const bronzeAfter = after.blue[0];
    const masterAfter = after.blue[1];
    if (bronzeAfter === undefined || masterAfter === undefined) throw new Error('missing rating');

    const bronzeGain = bronzeAfter.mu - bronze.mu;
    const masterGain = masterAfter.mu - master.mu;
    expect(bronzeGain).toBeGreaterThan(0);
    expect(masterGain).toBeGreaterThan(0);
    expect(bronzeGain).toBeGreaterThan(masterGain);

    // Exact values, so an openskill upgrade that changes the maths fails loudly.
    expect(bronzeAfter.mu).toBeCloseTo(20.2593, 4);
    expect(bronzeAfter.sigma).toBeCloseTo(8.1697, 4);
    expect(masterAfter.mu).toBeCloseTo(35.3107, 4);
    expect(masterAfter.sigma).toBeCloseTo(3.4892, 4);
  });

  /**
   * Every stored `mu_after` in the database must stay a number the fold reproduces. These are
   * the exact doubles `rateGame` has always returned, to full precision — not `toBeCloseTo`,
   * on purpose. (Pinned in M7.2 against the weekly track, which M14.57 retired.)
   */
  it('is byte-identical to the all-time numbers it produced before M7.2', () => {
    const blue = [{ mu: 18.5, sigma: 8.33 }, { mu: 35, sigma: 3.5 }, ...team(settled, 3)];
    const after = rateGame(blue, team(settled), 100);

    expect(after.blue).toEqual([
      { mu: 20.259304125033786, sigma: 8.169721515273643 },
      { mu: 35.31073464260074, sigma: 3.4891587353177975 },
      { mu: 25.63396909235426, sigma: 4.966149215751575 },
      { mu: 25.63396909235426, sigma: 4.966149215751575 },
      { mu: 25.63396909235426, sigma: 4.966149215751575 },
    ]);
    expect(after.red).toEqual(team({ mu: 24.36603090764574, sigma: 4.969845202214524 }));
  });

  it('a sequence of wins keeps moving the same way (rank direction is not inverted)', () => {
    let a = team(settled);
    let b = team(settled);
    let lastProb = 0.5;
    for (let i = 0; i < 3; i += 1) {
      ({ blue: a, red: b } = rateGame(a, b, 100));
      const p = predictWin(a, b);
      expect(p).toBeGreaterThan(lastProb);
      lastProb = p;
    }
    // Now let the same team win from the red side; the trend must continue.
    ({ blue: b, red: a } = rateGame(b, a, 200));
    expect(predictWin(a, b)).toBeGreaterThan(lastProb);
  });

  it('ten games converge a mis-seeded player: mu rises and sigma falls every game', () => {
    const history = convergeMisSeeded(10);
    let prev: Rating = { mu: 14, sigma: 8.33 };
    for (const r of history) {
      expect(r.mu).toBeGreaterThan(prev.mu);
      expect(r.sigma).toBeLessThan(prev.sigma);
      prev = r;
    }
  });

  it('ten games converge a mis-seeded player: mu is above the Gold IV seed after game 10', () => {
    const history = convergeMisSeeded(10);
    const last = history[9];
    if (last === undefined) throw new Error('missing game 10');
    expect(last.mu).toBeGreaterThan(23);
    // Pinned: mu first passes 23.00 in game 4 (23.6639) and reaches 34.0930 after game 10.
    expect(history[3]?.mu).toBeCloseTo(23.6639, 4);
    expect(last.mu).toBeCloseTo(34.093, 3);
    expect(last.sigma).toBeCloseTo(6.4704, 4);
  });

  // The brief asked for sigma below 5.00 after ten games; the real model (openskill 5.0.1, default tau) is at 6.47 then, because team games shrink sigma slowly, so the lead pinned the true number: game 36.
  it('sigma of the mis-seeded player drops below 5.00 in game 36', () => {
    const history = convergeMisSeeded(36);
    expect(history[34]?.sigma).toBeGreaterThanOrEqual(5);
    expect(history[35]?.sigma).toBeLessThan(5);
  });
});

/**
 * M3.31: how even the teams are, as a percentage. A display transform of `predictWin` and
 * never a second opinion about the same split — every number below is arithmetic on a
 * probability, so the line under the teams cannot disagree with the line above it.
 */
describe('evenness (M3.31)', () => {
  const settled = { mu: 25, sigma: 5 };

  it('is pinned at the brief’s four points', () => {
    expect(evenness(0.5)).toBe(100);
    expect(evenness(0.54)).toBe(92);
    expect(evenness(0.7)).toBe(60);
    expect(evenness(1)).toBe(0);
  });

  it('is 0 at a certain loss as well as at a certain win', () => {
    expect(evenness(0)).toBe(0);
  });

  it('is about the gap, not about which side: evenness(p) === evenness(1 - p)', () => {
    const table = [0, 0.01, 0.1, 0.2, 0.25, 0.3, 0.33, 0.4, 0.45, 0.46, 0.49, 0.499, 0.5];
    for (const p of table) {
      expect(evenness(p)).toBe(evenness(1 - p));
    }
  });

  it('returns an integer in [0, 100] across the whole range', () => {
    for (let i = 0; i <= 1000; i += 1) {
      const score = evenness(i / 1000);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('never rises as blue’s probability walks away from a coin flip', () => {
    let last = 101;
    for (let i = 500; i <= 1000; i += 1) {
      const score = evenness(i / 1000);
      expect(score).toBeLessThanOrEqual(last);
      last = score;
    }
    expect(last).toBe(0);
  });

  it('rounds half up, so 99.5 reads as 100', () => {
    // |p - 0.5| * 200 is 0.5 exactly at 0.5025.
    expect(evenness(0.5025)).toBe(100);
    expect(evenness(0.4975)).toBe(100);
    // ...and a little further out is not 100 any more.
    expect(evenness(0.503)).toBe(99);
  });

  it('throws outside [0, 1], and on NaN', () => {
    expect(() => evenness(-0.000001)).toThrow(/must be in \[0, 1\]/);
    expect(() => evenness(1.000001)).toThrow(/must be in \[0, 1\]/);
    expect(() => evenness(Number.NaN)).toThrow(/must be in \[0, 1\]/);
    expect(() => evenness(Number.POSITIVE_INFINITY)).toThrow(/must be in \[0, 1\]/);
  });

  it('is the same number the page would get from the stored probability', () => {
    const blue = [{ mu: 30, sigma: 5 }, ...team(settled, 4)];
    const red = team(settled);
    // The tonight page calls `evenness(splits.blue_win_prob)`; a caller holding ratings calls
    // `balanceScore`. They are the same function of the same probability.
    expect(evenness(predictWin(blue, red))).toBe(balanceScore(blue, red));
  });
});

describe('balanceScore (M3.31)', () => {
  const settled = { mu: 25, sigma: 5 };

  it('scores two identical teams 100', () => {
    expect(balanceScore(team(settled), team(settled))).toBe(100);
  });

  it('is exactly evenness(predictWin(blue, red)) and not a second model', () => {
    const blue = [{ mu: 28, sigma: 4 }, { mu: 21, sigma: 6 }, ...team(settled, 3)];
    const red = [{ mu: 26, sigma: 3.5 }, ...team(settled, 4)];
    expect(balanceScore(blue, red)).toBe(evenness(predictWin(blue, red)));
  });

  it('does not care which side is the stronger one', () => {
    const strong = team({ mu: 30, sigma: 5 });
    const weak = team({ mu: 20, sigma: 5 });
    expect(balanceScore(strong, weak)).toBe(balanceScore(weak, strong));
  });

  it('never rises as one side’s mu sum grows step by step', () => {
    // One lobby, ten settled players, blue's first seat climbing one mu at a time.
    const scores: number[] = [];
    for (let bump = 0; bump <= 20; bump += 1) {
      const blue = [{ mu: 25 + bump, sigma: 5 }, ...team(settled, 4)];
      scores.push(balanceScore(blue, team(settled)));
    }
    expect(scores[0]).toBe(100);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i] as number).toBeLessThanOrEqual(scores[i - 1] as number);
    }
    expect(scores.at(-1) as number).toBeLessThan(scores[0] as number);
  });

  it('is not five-and-five bound: a 4v4 scores', () => {
    const four = team(settled, 4);
    expect(balanceScore(four, four)).toBe(100);
    expect(balanceScore([{ mu: 32, sigma: 4 }, ...team(settled, 3)], four)).toBeLessThan(100);
    // ...and so do a 1v1 and a lopsided 3v5.
    expect(balanceScore([settled], [settled])).toBe(100);
    expect(balanceScore(team(settled, 3), team(settled, 5))).toBeLessThan(100);
  });

  it('throws on an empty team, naming the side', () => {
    expect(() => balanceScore([], team(settled))).toThrow(/blue must not be empty/);
    expect(() => balanceScore(team(settled), [])).toThrow(/red must not be empty/);
    expect(() => balanceScore([], [])).toThrow(/blue must not be empty/);
  });

  it('is pure: the same call twice is the same number and the inputs are untouched', () => {
    const blue = [{ mu: 27, sigma: 4.5 }, ...team(settled, 4)];
    const red = team(settled);
    const snapshot = JSON.stringify([blue, red]);
    expect(balanceScore(blue, red)).toBe(balanceScore(blue, red));
    expect(JSON.stringify([blue, red])).toBe(snapshot);
  });
});
