import { describe, expect, it } from 'vitest';
import {
  applyMvpAceBonus,
  config,
  type MvpAce,
  mvpAce,
  type PerformanceBucket,
  type PerformancePlayer,
  performanceScores,
  type Rating,
  type RatingChange,
  ROLES,
  type Role,
  rateGame,
} from '../index';

/**
 * The ten named players of the worked example in `docs/00-product.md`, on the sides and the
 * roles the balancer put them on. Blue wins, which makes the MVP a blue player and the ACE a
 * red one.
 *
 * Every stat is a clean binary fraction of that component's game-wide maximum (1, 3/4, 1/2,
 * 1/4 or 0), so the expected score below is exact in floating point and a wrong weight fails
 * on its own row rather than in the fifteenth decimal.
 *
 * | component | maximum | held by |
 * |---|---|---|
 * | KDA | 8 | Bilal (6 + 2 kills/assists, no deaths, so `max(1, deaths)` divides by one) |
 * | damage to champions | 40000 | Bilal |
 * | gold | 16000 | Bilal |
 * | vision score | 80 | Hana |
 * | damage self-mitigated | 48000 | Rami |
 * | CS | 320 | Bilal |
 * | damage to objectives | 20000 | Rami (M7.14) |
 */
const GAME: PerformancePlayer[] = [
  // blue
  {
    puuid: 'hana',
    side: 100,
    role: 'top',
    kills: 1,
    deaths: 2,
    assists: 3,
    damageToChamps: 10000,
    gold: 8000,
    visionScore: 80,
    damageSelfMitigated: 36000,
    cs: 80,
    damageToObjectives: 5000,
  },
  {
    puuid: 'iris',
    side: 100,
    role: 'jungle',
    kills: 5,
    deaths: 2,
    assists: 3,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
    damageToObjectives: 15000,
  },
  {
    puuid: 'karim',
    side: 100,
    role: 'mid',
    kills: 1,
    deaths: 2,
    assists: 3,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 80,
    damageToObjectives: 0,
  },
  {
    puuid: 'bilal',
    side: 100,
    role: 'adc',
    kills: 6,
    deaths: 0,
    assists: 2,
    damageToChamps: 40000,
    gold: 16000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 320,
    damageToObjectives: 5000,
  },
  {
    puuid: 'theo',
    side: 100,
    role: 'support',
    kills: 0,
    deaths: 2,
    assists: 4,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 60,
    damageSelfMitigated: 24000,
    cs: 80,
    damageToObjectives: 0,
  },
  // red
  {
    puuid: 'omar',
    side: 200,
    role: 'top',
    kills: 4,
    deaths: 2,
    assists: 4,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 80,
    damageToObjectives: 5000,
  },
  {
    puuid: 'rami',
    side: 200,
    role: 'jungle',
    kills: 2,
    deaths: 2,
    assists: 2,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 48000,
    cs: 160,
    damageToObjectives: 20000,
  },
  {
    puuid: 'nadia',
    side: 200,
    role: 'mid',
    kills: 3,
    deaths: 2,
    assists: 5,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
    damageToObjectives: 5000,
  },
  {
    puuid: 'lena',
    side: 200,
    role: 'adc',
    kills: 7,
    deaths: 2,
    assists: 5,
    damageToChamps: 30000,
    gold: 12000,
    visionScore: 20,
    damageSelfMitigated: 24000,
    cs: 240,
    damageToObjectives: 10000,
  },
  {
    puuid: 'yuki',
    side: 200,
    role: 'support',
    kills: 0,
    deaths: 7,
    assists: 0,
    damageToChamps: 0,
    gold: 0,
    visionScore: 0,
    damageSelfMitigated: 0,
    cs: 0,
    damageToObjectives: 0,
  },
];

/** The six components M7.8 and M7.13 read, without M7.14's seventh. */
interface SixFractions {
  kda: number;
  damageToChamps: number;
  gold: number;
  visionScore: number;
  damageSelfMitigated: number;
  cs: number;
}

/** The seven components the scorer reads today (M7.14 added `damageToObjectives`). */
interface Fractions extends SixFractions {
  damageToObjectives: number;
}

/**
 * The three weight vectors of the M7.13 brief as M7.14 reweighted them, written out a second
 * time as literals so the expected scores below do not read the numbers they are meant to pin.
 * A tune of `config.rating.performance` must fail here first.
 *
 * Only the jungle row moved: 0.05 each off gold, CS and KDA to pay for the seventh component.
 * `carry` and `support` carry it at 0.00 and are otherwise untouched.
 */
const BRIEF_WEIGHTS: Record<PerformanceBucket, Fractions> = {
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
};

/**
 * M7.13's six-component vectors, kept in the test and nowhere else, so the tests that have to
 * show what M7.14 changed — and what it did not — can say what the previous formula answered.
 * There is no six-component scorer in `packages/core` any more and this must never become one.
 */
const M7_13_SIX: Record<PerformanceBucket, SixFractions> = {
  carry: {
    kda: 0.15,
    damageToChamps: 0.3,
    gold: 0.2,
    visionScore: 0.05,
    damageSelfMitigated: 0.1,
    cs: 0.2,
  },
  jungle: {
    kda: 0.25,
    damageToChamps: 0.2,
    gold: 0.15,
    visionScore: 0.15,
    damageSelfMitigated: 0.1,
    cs: 0.15,
  },
  support: {
    kda: 0.25,
    damageToChamps: 0.05,
    gold: 0.05,
    visionScore: 0.4,
    damageSelfMitigated: 0.15,
    cs: 0.1,
  },
};

/** The bucket each of the five roles is scored on, written out a second time (M7.13). */
const BRIEF_BUCKETS: Record<Role, PerformanceBucket> = {
  top: 'carry',
  mid: 'carry',
  adc: 'carry',
  jungle: 'jungle',
  support: 'support',
};

/**
 * The score, from the literal weights of that player's bucket, in the documented component
 * order, over their fraction of each component's game-wide maximum. Same arithmetic, same
 * order, so `toBe` is the right assertion: this is a pin on the weights and on the
 * normalisation, not a restatement of the implementation.
 */
function expectedScore(bucket: PerformanceBucket, f: Fractions): number {
  const w = BRIEF_WEIGHTS[bucket];
  return (
    w.kda * f.kda +
    w.damageToChamps * f.damageToChamps +
    w.gold * f.gold +
    w.visionScore * f.visionScore +
    w.damageSelfMitigated * f.damageSelfMitigated +
    w.cs * f.cs +
    w.damageToObjectives * f.damageToObjectives
  );
}

/** The same arithmetic under M7.13's six components, for the tests that compare the two. */
function sixComponentScore(bucket: PerformanceBucket, f: SixFractions): number {
  const w = M7_13_SIX[bucket];
  return (
    w.kda * f.kda +
    w.damageToChamps * f.damageToChamps +
    w.gold * f.gold +
    w.visionScore * f.visionScore +
    w.damageSelfMitigated * f.damageSelfMitigated +
    w.cs * f.cs
  );
}

/**
 * The retired M7.8 flat vector, kept in the test and nowhere else, so the one test that has to
 * show the change doing its job can say what the old formula would have answered. There is no
 * flat scorer in `packages/core` any more and this must never become one.
 */
const M7_8_FLAT: SixFractions = {
  kda: 0.1,
  damageToChamps: 0.2,
  gold: 0.2,
  visionScore: 0.25,
  damageSelfMitigated: 0.15,
  cs: 0.1,
};

/** Every player's fraction of the game-wide maximum, component by component. */
function fractionsOf(players: readonly PerformancePlayer[]): Map<string, Fractions> {
  const raw = players.map((p) => ({
    puuid: p.puuid,
    kda: ((p.kills as number) + (p.assists as number)) / Math.max(1, p.deaths as number),
    damageToChamps: p.damageToChamps as number,
    gold: p.gold as number,
    visionScore: p.visionScore as number,
    damageSelfMitigated: p.damageSelfMitigated as number,
    cs: p.cs as number,
    damageToObjectives: p.damageToObjectives as number,
  }));
  const keys = [
    'kda',
    'damageToChamps',
    'gold',
    'visionScore',
    'damageSelfMitigated',
    'cs',
    'damageToObjectives',
  ] as const;
  const max = {} as Fractions;
  for (const k of keys) max[k] = Math.max(0, ...raw.map((r) => r[k]));
  return new Map(
    raw.map((r) => {
      const f = {} as Fractions;
      for (const k of keys) f[k] = max[k] <= 0 ? 0 : r[k] / max[k];
      return [r.puuid, f];
    }),
  );
}

/** What M7.8's single flat vector would have scored this game. Test-only, see `M7_8_FLAT`. */
function flatScores(players: readonly PerformancePlayer[]): Map<string, number> {
  const fractions = fractionsOf(players);
  return new Map(
    players.map((p) => {
      const f = fractions.get(p.puuid) as Fractions;
      return [
        p.puuid,
        M7_8_FLAT.kda * f.kda +
          M7_8_FLAT.damageToChamps * f.damageToChamps +
          M7_8_FLAT.gold * f.gold +
          M7_8_FLAT.visionScore * f.visionScore +
          M7_8_FLAT.damageSelfMitigated * f.damageSelfMitigated +
          M7_8_FLAT.cs * f.cs,
      ];
    }),
  );
}

/** Each player's fraction of the maximum, component by component, in the same order. */
const FRACTIONS: Record<string, Fractions> = {
  bilal: {
    kda: 1,
    damageToChamps: 1,
    gold: 1,
    visionScore: 0.25,
    damageSelfMitigated: 0.25,
    cs: 1,
    damageToObjectives: 0.25,
  },
  hana: {
    kda: 0.25,
    damageToChamps: 0.25,
    gold: 0.5,
    visionScore: 1,
    damageSelfMitigated: 0.75,
    cs: 0.25,
    damageToObjectives: 0.25,
  },
  iris: {
    kda: 0.5,
    damageToChamps: 0.5,
    gold: 0.5,
    visionScore: 0.5,
    damageSelfMitigated: 0.5,
    cs: 0.5,
    damageToObjectives: 0.75,
  },
  karim: {
    kda: 0.25,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.25,
    damageSelfMitigated: 0.25,
    cs: 0.25,
    damageToObjectives: 0,
  },
  theo: {
    kda: 0.25,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.75,
    damageSelfMitigated: 0.5,
    cs: 0.25,
    damageToObjectives: 0,
  },
  lena: {
    kda: 0.75,
    damageToChamps: 0.75,
    gold: 0.75,
    visionScore: 0.25,
    damageSelfMitigated: 0.5,
    cs: 0.75,
    damageToObjectives: 0.5,
  },
  rami: {
    kda: 0.25,
    damageToChamps: 0.5,
    gold: 0.5,
    visionScore: 0.5,
    damageSelfMitigated: 1,
    cs: 0.5,
    damageToObjectives: 1,
  },
  nadia: {
    kda: 0.5,
    damageToChamps: 0.5,
    gold: 0.5,
    visionScore: 0.5,
    damageSelfMitigated: 0.5,
    cs: 0.5,
    damageToObjectives: 0.25,
  },
  omar: {
    kda: 0.5,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.25,
    damageSelfMitigated: 0.25,
    cs: 0.25,
    damageToObjectives: 0.25,
  },
  yuki: {
    kda: 0,
    damageToChamps: 0,
    gold: 0,
    visionScore: 0,
    damageSelfMitigated: 0,
    cs: 0,
    damageToObjectives: 0,
  },
};

/** The bucket each of the worked example's ten is scored on, from the roles above. */
const BUCKETS: Record<string, PerformanceBucket> = {
  hana: 'carry',
  iris: 'jungle',
  karim: 'carry',
  bilal: 'carry',
  theo: 'support',
  omar: 'carry',
  rami: 'jungle',
  nadia: 'carry',
  lena: 'carry',
  yuki: 'support',
};

/**
 * The worked example's scores under the three vectors, to four decimals, for the doc and for a
 * human. Bilal the adc is still the MVP and Lena the adc still the ACE — this game has no
 * support who ran the map, so the buckets reorder the middle and not the top.
 *
 * M7.14 moved the two junglers and nobody else: Rami, who holds the game's objective damage,
 * goes 0.4875 -> 0.5750, and Iris 0.5000 -> 0.5375. The other eight are what M7.13 printed.
 */
const READABLE: Record<string, number> = {
  bilal: 0.8875,
  hana: 0.3875,
  iris: 0.5375,
  karim: 0.25,
  theo: 0.4875,
  lena: 0.7,
  rami: 0.575,
  nadia: 0.5,
  omar: 0.2875,
  yuki: 0,
};

function scoreOf(scores: readonly { puuid: string; score: number }[], puuid: string): number {
  const found = scores.find((s) => s.puuid === puuid);
  if (found === undefined) throw new Error(`no score for ${puuid}`);
  return found.score;
}

function expectedFor(puuid: string, override?: Partial<Fractions>): number {
  const f = FRACTIONS[puuid];
  const bucket = BUCKETS[puuid];
  if (f === undefined || bucket === undefined) throw new Error(`no fractions for ${puuid}`);
  return expectedScore(bucket, { ...f, ...override });
}

/** Ten players, same roles, all with the same stat line: every component normalises to 1. */
function allTheSame(): PerformancePlayer[] {
  return GAME.map((p) => ({
    puuid: p.puuid,
    side: p.side,
    role: p.role,
    kills: 5,
    deaths: 2,
    assists: 3,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
    damageToObjectives: 12000,
  }));
}

/** Deterministic, non-random reordering, to prove nothing depends on insertion order. */
function reversed<T>(xs: readonly T[]): T[] {
  return [...xs].reverse();
}

describe('config.rating.performance / performanceBucket / mvp', () => {
  it('carries the three weight vectors from the M7.13 brief as M7.14 reweighted them, and nothing else', () => {
    expect(config.rating.performance).toEqual(BRIEF_WEIGHTS);
  });

  it.each(['carry', 'jungle', 'support'] as const)('the %s vector sums to 1.00', (bucket) => {
    const w = config.rating.performance[bucket];
    const sum =
      w.kda + w.damageToChamps + w.gold + w.visionScore + w.damageSelfMitigated + w.cs + w.damageToObjectives;
    expect(sum).toBeCloseTo(1, 12);
  });

  it.each(['carry', 'jungle', 'support'] as const)('the %s vector has exactly seven entries', (bucket) => {
    expect(Object.keys(config.rating.performance[bucket]).sort()).toEqual([
      'cs',
      'damageSelfMitigated',
      'damageToChamps',
      'damageToObjectives',
      'gold',
      'kda',
      'visionScore',
    ]);
  });

  it('scores damage to objectives for the jungler and for nobody else (M7.14)', () => {
    expect(config.rating.performance.jungle.damageToObjectives).toBe(0.15);
    expect(config.rating.performance.carry.damageToObjectives).toBe(0);
    expect(config.rating.performance.support.damageToObjectives).toBe(0);
  });

  it('paid for the jungle row out of gold, CS and KDA, 0.05 each, and touched no other row', () => {
    // The seventh weight is not free: the brief says exactly where it came from.
    expect(M7_13_SIX.jungle.kda - config.rating.performance.jungle.kda).toBeCloseTo(0.05, 12);
    expect(M7_13_SIX.jungle.gold - config.rating.performance.jungle.gold).toBeCloseTo(0.05, 12);
    expect(M7_13_SIX.jungle.cs - config.rating.performance.jungle.cs).toBeCloseTo(0.05, 12);
    expect(config.rating.performance.jungle.damageToChamps).toBe(M7_13_SIX.jungle.damageToChamps);
    expect(config.rating.performance.jungle.visionScore).toBe(M7_13_SIX.jungle.visionScore);
    expect(config.rating.performance.jungle.damageSelfMitigated).toBe(M7_13_SIX.jungle.damageSelfMitigated);
    for (const bucket of ['carry', 'support'] as const) {
      const { damageToObjectives, ...six } = config.rating.performance[bucket];
      expect(damageToObjectives).toBe(0);
      expect(six).toEqual(M7_13_SIX[bucket]);
    }
  });

  it('has exactly one vector per bucket, and no bucket without a vector', () => {
    expect(Object.keys(config.rating.performance).sort()).toEqual(['carry', 'jungle', 'support']);
  });

  it('names the role-to-bucket map in exactly one place, covering all five roles', () => {
    expect(config.rating.performanceBucket).toEqual(BRIEF_BUCKETS);
    // Every role the rest of core knows about has a bucket, and every bucket has a vector.
    for (const role of ROLES) {
      const bucket = config.rating.performanceBucket[role];
      expect(config.rating.performance[bucket]).toBeDefined();
    }
    expect(Object.keys(config.rating.performanceBucket).sort()).toEqual([...ROLES].sort());
  });

  it('lumps top, mid and adc into carry, because nothing tells top from mid (M7.12)', () => {
    expect(config.rating.performanceBucket.top).toBe('carry');
    expect(config.rating.performanceBucket.mid).toBe('carry');
    expect(config.rating.performanceBucket.adc).toBe('carry');
    expect(config.rating.performanceBucket.jungle).toBe('jungle');
    expect(config.rating.performanceBucket.support).toBe('support');
  });

  it('weights vision far higher for a support than for a carry, and damage the other way', () => {
    // The one sentence the whole task exists for, as an assertion.
    expect(config.rating.performance.support.visionScore).toBeGreaterThan(
      config.rating.performance.carry.visionScore,
    );
    expect(config.rating.performance.carry.damageToChamps).toBeGreaterThan(
      config.rating.performance.support.damageToChamps,
    );
  });

  it('carries the two fractions', () => {
    expect(config.rating.mvp).toEqual({ bonusFraction: 0.25, aceReliefFraction: 0.2 });
  });

  it('turns into exactly 1.25 and 0.80', () => {
    expect(1 + config.rating.mvp.bonusFraction).toBe(1.25);
    expect(1 - config.rating.mvp.aceReliefFraction).toBe(0.8);
  });
});

describe('performanceScores', () => {
  it('scores the worked example, exactly, each player on their own role vector', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    for (const p of GAME) expect(scoreOf(scores, p.puuid)).toBe(expectedFor(p.puuid));
  });

  it('scores the worked example to the numbers in the architecture doc', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    for (const [puuid, readable] of Object.entries(READABLE)) {
      expect(scoreOf(scores, puuid)).toBeCloseTo(readable, 12);
    }
  });

  it('returns one score per player, in input order', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    expect(scores.map((s) => s.puuid)).toEqual(GAME.map((p) => p.puuid));
  });

  it('keeps every score inside [0, 1]', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it('gives the player who is best at everything exactly the sum of their own vector', () => {
    const scores = performanceScores(allTheSame());
    if (scores === null) throw new Error('expected scores');
    for (const p of allTheSame()) {
      const bucket = BUCKETS[p.puuid] as PerformanceBucket;
      const w = config.rating.performance[bucket];
      const all =
        w.kda +
        w.damageToChamps +
        w.gold +
        w.visionScore +
        w.damageSelfMitigated +
        w.cs +
        w.damageToObjectives;
      expect(scoreOf(scores, p.puuid)).toBe(all);
    }
  });

  it('normalises against the whole ten, not against the players in the same bucket', () => {
    // Bilal (carry) holds the CS maximum; Iris (jungle) is scored on 160/320, not on the best
    // CS among junglers, which would be her own and would make her fraction 1.
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'iris')).toBe(expectedScore('jungle', FRACTIONS.iris as Fractions));
    expect(FRACTIONS.iris?.cs).toBe(0.5);
  });

  it('gives a player with nothing exactly zero', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'yuki')).toBe(0);
  });

  it('divides by max(1, deaths), so a deathless player is not an infinity', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    // Bilal has zero deaths and 6 + 2 = 8, which is the game's best KDA, not Infinity.
    expect(Number.isFinite(scoreOf(scores, 'bilal'))).toBe(true);
    expect(scoreOf(scores, 'bilal')).toBe(expectedFor('bilal'));
  });

  it('gives a component with a game-wide maximum of zero to nobody, rather than dividing by zero', () => {
    const noVision = GAME.map((p) => ({ ...p, visionScore: 0 }));
    const scores = performanceScores(noVision);
    if (scores === null) throw new Error('expected scores');
    for (const p of GAME) {
      expect(scoreOf(scores, p.puuid)).toBe(expectedFor(p.puuid, { visionScore: 0 }));
      expect(Number.isNaN(scoreOf(scores, p.puuid))).toBe(false);
    }
  });

  it('is the same on the same input, twice', () => {
    expect(performanceScores(GAME)).toEqual(performanceScores(GAME));
  });

  it.each([
    'kills',
    'deaths',
    'assists',
    'damageToChamps',
    'gold',
    'visionScore',
    'damageSelfMitigated',
    'cs',
    'damageToObjectives',
  ] as const)('returns null when %s is null for one player', (field) => {
    const missing = GAME.map((p, i) => (i === 6 ? { ...p, [field]: null } : p));
    expect(performanceScores(missing)).toBeNull();
  });

  it.each(['undefined', 'NaN'] as const)('treats %s as missing too', (kind) => {
    const bad = kind === 'undefined' ? undefined : Number.NaN;
    const missing = GAME.map((p, i) => (i === 2 ? { ...p, visionScore: bad } : p));
    expect(performanceScores(missing)).toBeNull();
  });

  it('throws on an empty game rather than inventing a maximum', () => {
    expect(() => performanceScores([])).toThrow(/at least one/);
  });
});

/**
 * Role is an input like the other eight numbers and declines the same way (M7.13): per game,
 * never per player, and never by picking a vector for somebody. Pinned beside the missing-stat
 * tests above, because they are the same rule.
 */
describe('a game with no role', () => {
  const noRole = [null, undefined, 'bottom' as Role, '' as Role] as const;
  const labels = ['null', 'undefined', 'a role outside the five', 'an empty string'] as const;

  it.each(noRole.map((role, i) => [labels[i], role] as const))(
    'returns null from performanceScores when one of the ten has %s',
    (_label, role) => {
      const missing = GAME.map((p, i) => (i === 4 ? { ...p, role } : p));
      expect(performanceScores(missing)).toBeNull();
    },
  );

  it.each(noRole.map((role, i) => [labels[i], role] as const))(
    'returns null from mvpAce when one of the ten has %s',
    (_label, role) => {
      const missing = GAME.map((p, i) => (i === 7 ? { ...p, role } : p));
      expect(mvpAce(missing, 100)).toBeNull();
    },
  );

  it('gives a backfilled game — all ten role null — no MVP and no ACE', () => {
    const backfilled = GAME.map((p) => ({ ...p, role: null }));
    expect(performanceScores(backfilled)).toBeNull();
    expect(mvpAce(backfilled, 100)).toBeNull();
  });

  it('never falls back to carry for an unknown role, even when the stats are perfect', () => {
    // Yuki is bottom of the game on every component, so a silent `carry` default would still
    // name Bilal the MVP and the bug would be invisible. Move the unknown role onto Bilal.
    const unknown = GAME.map((p) => (p.puuid === 'bilal' ? { ...p, role: 'BOTTOM' as Role } : p));
    expect(performanceScores(unknown)).toBeNull();
    expect(mvpAce(unknown, 100)).toBeNull();
  });

  it('still throws, not returns null, when the game is not five a side', () => {
    // The shape guard comes first: a nine-player game is a caller bug, a role-less one is data.
    const nine = GAME.slice(0, 9).map((p) => ({ ...p, role: null }));
    expect(() => mvpAce(nine, 100)).toThrow(/five/);
  });

  it('hands applyMvpAceBonus an untouched copy of the fold, the same as a missing stat does', () => {
    const blueIds = GAME.filter((p) => p.side === 100).map((p) => p.puuid);
    const redIds = GAME.filter((p) => p.side === 200).map((p) => p.puuid);
    const seed: Rating = { mu: 25, sigma: 8.33 };
    const after = rateGame(
      blueIds.map(() => seed),
      redIds.map(() => seed),
      100,
    );
    const base: RatingChange[] = [
      ...blueIds.map((puuid, i) => ({ puuid, before: seed, after: after.blue[i] as Rating })),
      ...redIds.map((puuid, i) => ({ puuid, before: seed, after: after.red[i] as Rating })),
    ];

    const noRoleGame = GAME.map((p, i) => (i === 3 ? { ...p, role: null } : p));
    const noStatGame = GAME.map((p, i) => (i === 3 ? { ...p, visionScore: null } : p));

    // The same three answers, from the same three functions, for both kinds of missing input.
    expect(performanceScores(noRoleGame)).toBeNull();
    expect(performanceScores(noStatGame)).toBeNull();
    expect(mvpAce(noRoleGame, 100)).toBeNull();
    expect(mvpAce(noStatGame, 100)).toBeNull();
    expect(applyMvpAceBonus(base, mvpAce(noRoleGame, 100))).toEqual(base);
    expect(applyMvpAceBonus(base, mvpAce(noStatGame, 100))).toEqual(base);
  });
});

/**
 * M7.14's missing-input rule: **universal, and not scoped to where the weight is above zero**.
 *
 * A null objectives number on a *carry* — whose weight on that component is `0.00` — still takes
 * the MVP off the whole game. The component is normalised against the best of the ten, so a
 * player who drops out of that maximum changes the jungler's share; and a weight-scoped rule
 * would let a `config.ts` nudge change which past games are scorable at all. One rule.
 */
describe('a missing objectives number (M7.14, acceptance 5)', () => {
  const carries = ['hana', 'karim', 'bilal', 'omar', 'nadia', 'lena'] as const;
  const supports = ['theo', 'yuki'] as const;
  const junglers = ['iris', 'rami'] as const;

  it.each([null, undefined, Number.NaN] as const)(
    'takes the MVP off the game when a carry has %s objectives, though their weight on it is 0.00',
    (value) => {
      // Karim is a mid, so `carry`, whose objectives weight is exactly zero. The weight-scoped
      // rule this test exists to refuse would score this game happily.
      expect(config.rating.performance.carry.damageToObjectives).toBe(0);
      const missing = GAME.map((p) => (p.puuid === 'karim' ? { ...p, damageToObjectives: value } : p));
      expect(performanceScores(missing)).toBeNull();
      expect(mvpAce(missing, 100)).toBeNull();
    },
  );

  it.each([...carries, ...supports, ...junglers])(
    'takes the MVP off the game when %s is missing it, whatever their bucket',
    (puuid) => {
      const missing = GAME.map((p) => (p.puuid === puuid ? { ...p, damageToObjectives: null } : p));
      expect(performanceScores(missing)).toBeNull();
      expect(mvpAce(missing, 100)).toBeNull();
    },
  );

  it('hands applyMvpAceBonus an untouched copy of the fold, like every other missing input', () => {
    const blueIds = GAME.filter((p) => p.side === 100).map((p) => p.puuid);
    const redIds = GAME.filter((p) => p.side === 200).map((p) => p.puuid);
    const seed: Rating = { mu: 25, sigma: 8.33 };
    const after = rateGame(
      blueIds.map(() => seed),
      redIds.map(() => seed),
      100,
    );
    const base: RatingChange[] = [
      ...blueIds.map((puuid, i) => ({ puuid, before: seed, after: after.blue[i] as Rating })),
      ...redIds.map((puuid, i) => ({ puuid, before: seed, after: after.red[i] as Rating })),
    ];
    // The carry again, not the jungler: the case a weight-scoped rule would get wrong.
    const missing = GAME.map((p) => (p.puuid === 'bilal' ? { ...p, damageToObjectives: null } : p));
    expect(applyMvpAceBonus(base, mvpAce(missing, 100))).toEqual(base);
  });

  it('still scores a game where everybody has the number, including a zero', () => {
    // `0` is a fact — a jungler who never contested a dragon — and is not missing.
    const zeroes = GAME.map((p) => ({ ...p, damageToObjectives: 0 }));
    const scores = performanceScores(zeroes);
    if (scores === null) throw new Error('expected scores');
    expect(scores).toHaveLength(10);
  });

  it('gives a game where all ten did zero objective damage that component to nobody', () => {
    // The `best <= 0` branch, for the seventh component: the jungle row's other six then sum to
    // 0.85 for everybody in that bucket, and nothing is renormalised.
    const zeroes = GAME.map((p) => ({ ...p, damageToObjectives: 0 }));
    const scores = performanceScores(zeroes);
    if (scores === null) throw new Error('expected scores');
    for (const p of GAME) {
      expect(scoreOf(scores, p.puuid)).toBe(expectedFor(p.puuid, { damageToObjectives: 0 }));
      expect(Number.isNaN(scoreOf(scores, p.puuid))).toBe(false);
    }
    const w = config.rating.performance.jungle;
    expect(w.kda + w.damageToChamps + w.gold + w.visionScore + w.damageSelfMitigated + w.cs).toBeCloseTo(
      0.85,
      12,
    );
  });
});

/**
 * Acceptance 7 of the M7.14 brief: `carry` and `support` scores are what they were before this
 * task, to the last bit. Their seventh weight is `0.00` and it multiplies out to nothing.
 */
describe('carries and supports are untouched by the seventh component (M7.14, acceptance 7)', () => {
  const nonJungle = GAME.filter((p) => p.role !== 'jungle');

  /** The same ten with a different objectives number on every one of them. */
  function withObjectives(values: Record<string, number>): PerformancePlayer[] {
    return GAME.map((p) => ({ ...p, damageToObjectives: values[p.puuid] ?? 0 }));
  }

  const A = withObjectives({
    hana: 5000,
    iris: 15000,
    karim: 0,
    bilal: 5000,
    theo: 0,
    omar: 5000,
    rami: 20000,
    nadia: 5000,
    lena: 10000,
    yuki: 0,
  });
  const B = withObjectives({
    hana: 19000,
    iris: 1,
    karim: 44444,
    bilal: 1200,
    theo: 90000,
    omar: 3,
    rami: 7,
    nadia: 61000,
    lena: 0,
    yuki: 31000,
  });

  it('scores every non-jungle player identically under two wildly different objectives columns', () => {
    const a = performanceScores(A);
    const b = performanceScores(B);
    if (a === null || b === null) throw new Error('expected scores');
    for (const p of nonJungle) expect(scoreOf(b, p.puuid)).toBe(scoreOf(a, p.puuid));
  });

  it('moves the junglers, so the test above is not passing for the wrong reason', () => {
    const a = performanceScores(A);
    const b = performanceScores(B);
    if (a === null || b === null) throw new Error('expected scores');
    expect(scoreOf(b, 'rami')).not.toBe(scoreOf(a, 'rami'));
    expect(scoreOf(b, 'iris')).not.toBe(scoreOf(a, 'iris'));
  });

  it("gives every non-jungle player exactly M7.13's six-component score", () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    const f = fractionsOf(GAME);
    for (const p of nonJungle) {
      const bucket = BUCKETS[p.puuid] as PerformanceBucket;
      expect(scoreOf(scores, p.puuid)).toBe(sixComponentScore(bucket, f.get(p.puuid) as Fractions));
    }
  });

  it('moves both junglers off their six-component score, and Rami the furthest', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    const f = fractionsOf(GAME);
    // Rami holds the game's objective damage, so he gains the most; Iris is at three quarters.
    expect(scoreOf(scores, 'rami')).toBeGreaterThan(sixComponentScore('jungle', f.get('rami') as Fractions));
    expect(scoreOf(scores, 'rami')).toBeCloseTo(0.575, 12);
    expect(sixComponentScore('jungle', f.get('rami') as Fractions)).toBeCloseTo(0.4875, 12);
    expect(scoreOf(scores, 'iris')).toBeCloseTo(0.5375, 12);
    expect(sixComponentScore('jungle', f.get('iris') as Fractions)).toBeCloseTo(0.5, 12);
  });
});

/**
 * Acceptance 8 of the M7.14 brief: the change doing its one job, pinned so a later tune cannot
 * silently undo it.
 *
 * A hand-built ten. Blue's jungler took the map — the game's best objective damage — and is
 * exactly mid-table on all six of the other components (every fraction 0.5). Blue's adc is
 * ahead of him on damage. Under M7.13's six components the adc is the MVP; under the seven the
 * jungler is, and he never had to out-farm or out-damage anybody to get there.
 */
describe('the jungler who took the map (M7.14, acceptance 8)', () => {
  const HAND_BUILT: PerformancePlayer[] = [
    // blue, and blue wins
    {
      puuid: 'b-top',
      side: 100,
      role: 'top',
      kills: 2,
      deaths: 4,
      assists: 2,
      damageToChamps: 10000,
      gold: 8000,
      visionScore: 20,
      damageSelfMitigated: 24000,
      cs: 160,
      damageToObjectives: 5000,
    },
    {
      // Mid-table on all six — every fraction is exactly 0.5 — and the game's objective damage.
      puuid: 'b-jungle',
      side: 100,
      role: 'jungle',
      kills: 3,
      deaths: 2,
      assists: 1,
      damageToChamps: 20000,
      gold: 8000,
      visionScore: 40,
      damageSelfMitigated: 24000,
      cs: 160,
      damageToObjectives: 20000,
    },
    {
      puuid: 'b-mid',
      side: 100,
      role: 'mid',
      kills: 2,
      deaths: 4,
      assists: 2,
      damageToChamps: 10000,
      gold: 8000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 160,
      damageToObjectives: 2500,
    },
    {
      // Three quarters of the game's damage to champions: the six-component MVP.
      puuid: 'b-adc',
      side: 100,
      role: 'adc',
      kills: 3,
      deaths: 2,
      assists: 1,
      damageToChamps: 30000,
      gold: 8000,
      visionScore: 20,
      damageSelfMitigated: 24000,
      cs: 160,
      damageToObjectives: 5000,
    },
    {
      puuid: 'b-support',
      side: 100,
      role: 'support',
      kills: 0,
      deaths: 4,
      assists: 6,
      damageToChamps: 5000,
      gold: 4000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 40,
      damageToObjectives: 0,
    },
    // red loses, and holds most of the maxima so blue's two contenders do not hold them all
    {
      puuid: 'r-top',
      side: 200,
      role: 'top',
      kills: 2,
      deaths: 2,
      assists: 2,
      damageToChamps: 20000,
      gold: 16000,
      visionScore: 20,
      damageSelfMitigated: 48000,
      cs: 320,
      damageToObjectives: 5000,
    },
    {
      puuid: 'r-jungle',
      side: 200,
      role: 'jungle',
      kills: 2,
      deaths: 4,
      assists: 2,
      damageToChamps: 10000,
      gold: 8000,
      visionScore: 40,
      damageSelfMitigated: 24000,
      cs: 160,
      damageToObjectives: 10000,
    },
    {
      puuid: 'r-mid',
      side: 200,
      role: 'mid',
      kills: 4,
      deaths: 2,
      assists: 4,
      damageToChamps: 20000,
      gold: 12000,
      visionScore: 40,
      damageSelfMitigated: 24000,
      cs: 240,
      damageToObjectives: 2500,
    },
    {
      puuid: 'r-adc',
      side: 200,
      role: 'adc',
      kills: 6,
      deaths: 2,
      assists: 2,
      damageToChamps: 40000,
      gold: 12000,
      visionScore: 20,
      damageSelfMitigated: 24000,
      cs: 240,
      damageToObjectives: 5000,
    },
    {
      puuid: 'r-support',
      side: 200,
      role: 'support',
      kills: 0,
      deaths: 4,
      assists: 8,
      damageToChamps: 5000,
      gold: 4000,
      visionScore: 80,
      damageSelfMitigated: 12000,
      cs: 40,
      damageToObjectives: 0,
    },
  ];

  /** What M7.13's six components would have scored this game. Test-only, see `M7_13_SIX`. */
  function sixScores(players: readonly PerformancePlayer[]): Map<string, number> {
    const fractions = fractionsOf(players);
    return new Map(
      players.map((p) => [
        p.puuid,
        sixComponentScore(
          config.rating.performanceBucket[p.role as Role],
          fractions.get(p.puuid) as Fractions,
        ),
      ]),
    );
  }

  it("gives the jungler the game's best objective damage and the middle of everything else", () => {
    const f = fractionsOf(HAND_BUILT).get('b-jungle') as Fractions;
    expect(f.damageToObjectives).toBe(1);
    expect(f.kda).toBe(0.5);
    expect(f.damageToChamps).toBe(0.5);
    expect(f.gold).toBe(0.5);
    expect(f.visionScore).toBe(0.5);
    expect(f.damageSelfMitigated).toBe(0.5);
    expect(f.cs).toBe(0.5);
    const best = [...HAND_BUILT].sort(
      (a, b) => (b.damageToObjectives as number) - (a.damageToObjectives as number),
    )[0];
    expect(best?.puuid).toBe('b-jungle');
  });

  it("under M7.13's six components the adc was the MVP", () => {
    const six = sixScores(HAND_BUILT);
    expect(six.get('b-adc') as number).toBeGreaterThan(six.get('b-jungle') as number);
    expect(six.get('b-adc')).toBeCloseTo(0.5625, 12);
    expect(six.get('b-jungle')).toBeCloseTo(0.5, 12);
    const blueBest = [...six].filter(([id]) => id.startsWith('b-')).sort((a, b) => b[1] - a[1])[0];
    expect(blueBest?.[0]).toBe('b-adc');
  });

  it('under the seven the jungler is the MVP', () => {
    const scores = performanceScores(HAND_BUILT);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'b-jungle')).toBeGreaterThan(scoreOf(scores, 'b-adc'));
    expect(scoreOf(scores, 'b-jungle')).toBeCloseTo(0.575, 12);
    expect(scoreOf(scores, 'b-adc')).toBeCloseTo(0.5625, 12);
    expect(mvpAce(HAND_BUILT, 100)?.mvp).toBe('b-jungle');
  });

  it('changed nothing for the four other blue players, or for red', () => {
    const scores = performanceScores(HAND_BUILT);
    if (scores === null) throw new Error('expected scores');
    const six = sixScores(HAND_BUILT);
    for (const p of HAND_BUILT.filter((q) => q.role !== 'jungle')) {
      expect(scoreOf(scores, p.puuid)).toBe(six.get(p.puuid) as number);
    }
    // And the ACE, who is a carry, is the same player under both.
    expect(mvpAce(HAND_BUILT, 100)?.ace).toBe('r-adc');
  });

  it('does not depend on insertion order', () => {
    expect(mvpAce(reversed(HAND_BUILT), 100)?.mvp).toBe('b-jungle');
  });
});

/**
 * Acceptance 5 of the M7.13 brief: the change doing its one job, pinned so a later tune cannot
 * silently undo it.
 *
 * A hand-built ten. Blue's support ran the map — the game's best vision score, the game's worst
 * damage to champions, nothing else — and Blue's adc is fed. Under M7.8's single flat vector
 * the adc wins MVP; under the three vectors the support does, and nobody had to out-damage
 * anybody to get there.
 */
describe('the support who ran the map (acceptance 5)', () => {
  const HAND_BUILT: PerformancePlayer[] = [
    // blue: three unremarkable players, one fed adc, one support with the map
    {
      puuid: 'b-top',
      side: 100,
      role: 'top',
      kills: 1,
      deaths: 2,
      assists: 3,
      damageToChamps: 10000,
      gold: 4000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 80,
      damageToObjectives: 3000,
    },
    {
      puuid: 'b-jungle',
      side: 100,
      role: 'jungle',
      kills: 1,
      deaths: 2,
      assists: 3,
      damageToChamps: 10000,
      gold: 4000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 80,
      damageToObjectives: 12000,
    },
    {
      puuid: 'b-mid',
      side: 100,
      role: 'mid',
      kills: 1,
      deaths: 2,
      assists: 3,
      damageToChamps: 10000,
      gold: 4000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 80,
      damageToObjectives: 1500,
    },
    {
      // The game's best damage, three quarters of the gold and the CS: a fed adc.
      puuid: 'b-adc',
      side: 100,
      role: 'adc',
      kills: 3,
      deaths: 2,
      assists: 1,
      damageToChamps: 40000,
      gold: 12000,
      visionScore: 20,
      damageSelfMitigated: 12000,
      cs: 240,
      damageToObjectives: 6000,
    },
    {
      // The game's best KDA and best vision, and the game's worst damage: zero.
      puuid: 'b-support',
      side: 100,
      role: 'support',
      kills: 0,
      deaths: 1,
      assists: 8,
      damageToChamps: 0,
      gold: 4000,
      visionScore: 80,
      damageSelfMitigated: 24000,
      cs: 80,
      damageToObjectives: 0,
    },
    // red: loses, and holds the gold, CS and mitigation maxima so blue's adc does not hold all six
    {
      puuid: 'r-top',
      side: 200,
      role: 'top',
      kills: 2,
      deaths: 2,
      assists: 2,
      damageToChamps: 20000,
      gold: 16000,
      visionScore: 20,
      damageSelfMitigated: 24000,
      cs: 320,
      damageToObjectives: 4000,
    },
    {
      puuid: 'r-jungle',
      side: 200,
      role: 'jungle',
      kills: 2,
      deaths: 2,
      assists: 2,
      damageToChamps: 20000,
      gold: 8000,
      visionScore: 40,
      damageSelfMitigated: 48000,
      cs: 160,
      damageToObjectives: 9000,
    },
    {
      puuid: 'r-mid',
      side: 200,
      role: 'mid',
      kills: 3,
      deaths: 2,
      assists: 5,
      damageToChamps: 20000,
      gold: 8000,
      visionScore: 40,
      damageSelfMitigated: 24000,
      cs: 160,
      damageToObjectives: 1500,
    },
    {
      puuid: 'r-adc',
      side: 200,
      role: 'adc',
      kills: 7,
      deaths: 2,
      assists: 5,
      damageToChamps: 30000,
      gold: 12000,
      visionScore: 20,
      damageSelfMitigated: 24000,
      cs: 240,
      damageToObjectives: 6000,
    },
    {
      puuid: 'r-support',
      side: 200,
      role: 'support',
      kills: 0,
      deaths: 7,
      assists: 1,
      damageToChamps: 1000,
      gold: 1000,
      visionScore: 5,
      damageSelfMitigated: 1000,
      cs: 10,
      damageToObjectives: 0,
    },
  ];

  it('gives the support the best vision and the worst damage of the ten', () => {
    const best = (pick: (p: PerformancePlayer) => number): string =>
      [...HAND_BUILT].sort((a, b) => pick(b) - pick(a))[0]?.puuid as string;
    const worst = (pick: (p: PerformancePlayer) => number): string =>
      [...HAND_BUILT].sort((a, b) => pick(a) - pick(b))[0]?.puuid as string;
    expect(best((p) => p.visionScore as number)).toBe('b-support');
    expect(worst((p) => p.damageToChamps as number)).toBe('b-support');
  });

  it("under M7.8's flat vector the fed adc was the MVP", () => {
    const flat = flatScores(HAND_BUILT);
    expect(flat.get('b-adc') as number).toBeGreaterThan(flat.get('b-support') as number);
    const blueBest = [...flat].filter(([id]) => id.startsWith('b-')).sort((a, b) => b[1] - a[1])[0];
    expect(blueBest?.[0]).toBe('b-adc');
  });

  it('under the three vectors the support is the MVP', () => {
    const scores = performanceScores(HAND_BUILT);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'b-support')).toBeGreaterThan(scoreOf(scores, 'b-adc'));
    expect(mvpAce(HAND_BUILT, 100)?.mvp).toBe('b-support');
  });

  it('scores both of them exactly, on their own vectors', () => {
    const scores = performanceScores(HAND_BUILT);
    if (scores === null) throw new Error('expected scores');
    const f = fractionsOf(HAND_BUILT);
    expect(scoreOf(scores, 'b-support')).toBe(expectedScore('support', f.get('b-support') as Fractions));
    expect(scoreOf(scores, 'b-adc')).toBe(expectedScore('carry', f.get('b-adc') as Fractions));
    expect(scoreOf(scores, 'b-support')).toBeCloseTo(0.7625, 12);
    expect(scoreOf(scores, 'b-adc')).toBeCloseTo(0.675, 12);
  });

  it('does not depend on insertion order', () => {
    expect(mvpAce(reversed(HAND_BUILT), 100)?.mvp).toBe('b-support');
  });

  it('is scored as it comes when a side holds two supports and no top', () => {
    // M7.12 saw zero of these in 230 rows; the buckets are read per player and nothing here
    // requires a side to hold five distinct roles.
    const twoSupports = HAND_BUILT.map((p) => (p.puuid === 'b-top' ? { ...p, role: 'support' as Role } : p));
    const scores = performanceScores(twoSupports);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'b-top')).toBe(
      expectedScore('support', fractionsOf(twoSupports).get('b-top') as Fractions),
    );
    expect(mvpAce(twoSupports, 100)?.mvp).toBe('b-support');
  });
});

describe('mvpAce', () => {
  it('names the best winner MVP and the best loser ACE', () => {
    expect(mvpAce(GAME, 100)).toEqual({ mvp: 'bilal', ace: 'lena' });
  });

  it('follows the winning side, not the array', () => {
    // Same ten, same numbers: if red wins, the same two best players swap titles.
    expect(mvpAce(GAME, 200)).toEqual({ mvp: 'lena', ace: 'bilal' });
  });

  it('does not depend on insertion order', () => {
    expect(mvpAce(reversed(GAME), 100)).toEqual({ mvp: 'bilal', ace: 'lena' });
  });

  it('breaks a tie by puuid ascending, not by position', () => {
    const tied = allTheSame();
    // Every player scores the sum of their own vector, which is 1.00 for all three buckets, so
    // the whole game ties and only the puuid decides.
    expect(mvpAce(tied, 100)).toEqual({ mvp: 'bilal', ace: 'lena' });
    expect(mvpAce(reversed(tied), 100)).toEqual({ mvp: 'bilal', ace: 'lena' });
  });

  it('can name a player with zero on every component the ACE, if the other four are zero too', () => {
    const stomp = GAME.map((p) =>
      p.side === 200
        ? {
            ...p,
            kills: 0,
            deaths: 9,
            assists: 0,
            damageToChamps: 0,
            gold: 0,
            visionScore: 0,
            damageSelfMitigated: 0,
            cs: 0,
            damageToObjectives: 0,
          }
        : p,
    );
    // Blue's numbers still set every maximum, so all five losers score exactly zero.
    const scores = performanceScores(stomp);
    if (scores === null) throw new Error('expected scores');
    for (const p of stomp.filter((q) => q.side === 200)) expect(scoreOf(scores, p.puuid)).toBe(0);
    expect(mvpAce(stomp, 100)).toEqual({ mvp: 'bilal', ace: 'lena' });
  });

  it('returns null when one component is missing for one player', () => {
    const missing = GAME.map((p) => (p.puuid === 'rami' ? { ...p, visionScore: null } : p));
    expect(mvpAce(missing, 100)).toBeNull();
  });

  it('throws on anything that is not five a side', () => {
    expect(() => mvpAce(GAME.slice(0, 9), 100)).toThrow(/five/);
    expect(() =>
      mvpAce(
        [...GAME.slice(0, 6), ...GAME.slice(7)].map((p) => ({ ...p, side: 100 as const })),
        100,
      ),
    ).toThrow(/five/);
  });

  it('throws when the same puuid appears twice, because the tie-break key would not be a key', () => {
    const twice = GAME.map((p, i) => (i === 9 ? { ...p, puuid: 'bilal' } : p));
    expect(() => mvpAce(twice, 100)).toThrow(/twice/);
  });
});

describe('applyMvpAceBonus', () => {
  const before: Record<string, Rating> = {
    hana: { mu: 23.9, sigma: 4.2 },
    iris: { mu: 26.3, sigma: 3.8 },
    karim: { mu: 25.85, sigma: 5.1 },
    bilal: { mu: 28.55, sigma: 3.3 },
    theo: { mu: 23.65, sigma: 6.4 },
    omar: { mu: 24.5, sigma: 4.9 },
    rami: { mu: 27.3, sigma: 3.6 },
    nadia: { mu: 21.1, sigma: 7.2 },
    lena: { mu: 34.8, sigma: 3.1 },
    yuki: { mu: 18.9, sigma: 8.33 },
  };

  const blueIds = GAME.filter((p) => p.side === 100).map((p) => p.puuid);
  const redIds = GAME.filter((p) => p.side === 200).map((p) => p.puuid);

  function at(puuid: string): Rating {
    const r = before[puuid];
    if (r === undefined) throw new Error(`no rating for ${puuid}`);
    return r;
  }

  /** The untouched `rateGame` result for the worked example, blue winning, as ten changes. */
  function changes(winningSide: 100 | 200 = 100): RatingChange[] {
    const after = rateGame(blueIds.map(at), redIds.map(at), winningSide);
    return [
      ...blueIds.map((puuid, i) => ({ puuid, before: at(puuid), after: after.blue[i] as Rating })),
      ...redIds.map((puuid, i) => ({ puuid, before: at(puuid), after: after.red[i] as Rating })),
    ];
  }

  function find(cs: readonly RatingChange[], puuid: string): RatingChange {
    const c = cs.find((x) => x.puuid === puuid);
    if (c === undefined) throw new Error(`no change for ${puuid}`);
    return c;
  }

  const award: MvpAce = { mvp: 'bilal', ace: 'lena' };

  it("multiplies the MVP's delta by exactly 1.25 and the ACE's by exactly 0.80", () => {
    const base = changes();
    const out = applyMvpAceBonus(base, award);

    const mvpIn = find(base, 'bilal');
    const mvpOut = find(out, 'bilal');
    expect(mvpOut.after.mu).toBe(mvpIn.before.mu + (mvpIn.after.mu - mvpIn.before.mu) * 1.25);

    const aceIn = find(base, 'lena');
    const aceOut = find(out, 'lena');
    expect(aceOut.after.mu).toBe(aceIn.before.mu + (aceIn.after.mu - aceIn.before.mu) * 0.8);

    // Read back the way a page reads it — `mu_after - mu_before`, both stored as `mu` — the
    // factor is 1.25 to about 1e-15 and not to the bit, because `before.mu + x` rounds once
    // and subtracting `before.mu` again cannot undo that rounding. The exact statement above
    // is the one the model makes; this is the one arithmetic allows. (Decision, 2026-09-15.)
    expect(mvpOut.after.mu - mvpOut.before.mu).toBeCloseTo((mvpIn.after.mu - mvpIn.before.mu) * 1.25, 12);
    expect(aceOut.after.mu - aceOut.before.mu).toBeCloseTo((aceIn.after.mu - aceIn.before.mu) * 0.8, 12);
  });

  it('amplifies a win and shrinks a loss, and never flips a sign', () => {
    const base = changes();
    const out = applyMvpAceBonus(base, award);

    const mvpDelta = find(base, 'bilal').after.mu - find(base, 'bilal').before.mu;
    const mvpDeltaOut = find(out, 'bilal').after.mu - find(out, 'bilal').before.mu;
    expect(mvpDelta).toBeGreaterThan(0);
    expect(mvpDeltaOut).toBeGreaterThan(mvpDelta);
    expect(mvpDeltaOut / mvpDelta).toBeCloseTo(1.25, 12);

    const aceDelta = find(base, 'lena').after.mu - find(base, 'lena').before.mu;
    const aceDeltaOut = find(out, 'lena').after.mu - find(out, 'lena').before.mu;
    expect(aceDelta).toBeLessThan(0);
    expect(aceDeltaOut).toBeLessThan(0);
    expect(aceDeltaOut).toBeGreaterThan(aceDelta);
    expect(aceDeltaOut / aceDelta).toBeCloseTo(0.8, 12);
  });

  it('leaves sigma exactly as it was for all ten, always', () => {
    const base = changes();
    const out = applyMvpAceBonus(base, award);
    for (const c of base) expect(find(out, c.puuid).after.sigma).toBe(c.after.sigma);
    // And with the other side winning, where the MVP and the ACE swap.
    const other = changes(200);
    const swapped = applyMvpAceBonus(other, { mvp: 'lena', ace: 'bilal' });
    for (const c of other) expect(find(swapped, c.puuid).after.sigma).toBe(c.after.sigma);
  });

  it('touches nobody else', () => {
    const base = changes();
    const out = applyMvpAceBonus(base, award);
    for (const c of base) {
      if (c.puuid === 'bilal' || c.puuid === 'lena') continue;
      expect(find(out, c.puuid).after).toEqual(c.after);
      expect(find(out, c.puuid).before).toEqual(c.before);
    }
  });

  it('returns the untouched rateGame result when there is no MVP and no ACE', () => {
    const base = changes();
    expect(applyMvpAceBonus(base, null)).toEqual(base);
  });

  it('keeps the input in order and does not mutate it', () => {
    const base = changes();
    const snapshot = JSON.parse(JSON.stringify(base));
    const out = applyMvpAceBonus(base, award);
    expect(out.map((c) => c.puuid)).toEqual(base.map((c) => c.puuid));
    expect(base).toEqual(snapshot);
  });

  it('throws when the award names somebody who is not in the game', () => {
    expect(() => applyMvpAceBonus(changes(), { mvp: 'nobody', ace: 'lena' })).toThrow(/nobody/);
    expect(() => applyMvpAceBonus(changes(), { mvp: 'bilal', ace: 'ghost' })).toThrow(/ghost/);
  });

  it('is the same on the same input, twice', () => {
    expect(applyMvpAceBonus(changes(), award)).toEqual(applyMvpAceBonus(changes(), award));
  });
});

describe('the three functions together, over a sequence of games', () => {
  /**
   * The MVP bonus must ride on top of `rateGame`, not replace it: over a run of games the
   * bonus can only ever move a player further in the direction the base fold already moved
   * them. Folded ten games with blue winning every time, the same MVP and ACE each game.
   */
  it('never sends a winner down or a loser up', () => {
    const blueIds = GAME.filter((p) => p.side === 100).map((p) => p.puuid);
    const redIds = GAME.filter((p) => p.side === 200).map((p) => p.puuid);
    const ratings = new Map<string, Rating>(GAME.map((p) => [p.puuid, { mu: 25, sigma: 8.33 } as Rating]));
    const at = (puuid: string): Rating => {
      const r = ratings.get(puuid);
      if (r === undefined) throw new Error(`no rating for ${puuid}`);
      return r;
    };

    const award = mvpAce(GAME, 100);
    expect(award).toEqual({ mvp: 'bilal', ace: 'lena' });

    for (let game = 0; game < 10; game += 1) {
      const startMu = new Map([...ratings].map(([id, r]) => [id, r.mu]));
      const after = rateGame(blueIds.map(at), redIds.map(at), 100);
      const base: RatingChange[] = [
        ...blueIds.map((puuid, i) => ({ puuid, before: at(puuid), after: after.blue[i] as Rating })),
        ...redIds.map((puuid, i) => ({ puuid, before: at(puuid), after: after.red[i] as Rating })),
      ];
      for (const c of applyMvpAceBonus(base, award)) ratings.set(c.puuid, c.after);
      for (const id of blueIds) expect(at(id).mu).toBeGreaterThan(startMu.get(id) as number);
      for (const id of redIds) expect(at(id).mu).toBeLessThan(startMu.get(id) as number);
    }

    // Ten wins later, the MVP is above every other winner he started level with.
    for (const id of blueIds.filter((i) => i !== 'bilal')) {
      expect(at('bilal').mu).toBeGreaterThan(at(id).mu);
    }
    // And the ACE has lost less than every other loser she started level with.
    for (const id of redIds.filter((i) => i !== 'lena')) {
      expect(at('lena').mu).toBeGreaterThan(at(id).mu);
    }
  });
});
