import { describe, expect, it } from 'vitest';
import {
  applyMvpAceBonus,
  config,
  type MvpAce,
  mvpAce,
  type PerformancePlayer,
  performanceScores,
  type Rating,
  type RatingChange,
  rateGame,
} from '../index';

/**
 * The ten named players of the worked example in `docs/00-product.md`, on the sides the
 * balancer put them on. Blue wins, which makes the MVP a blue player and the ACE a red one.
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
 */
const GAME: PerformancePlayer[] = [
  // blue
  {
    puuid: 'hana',
    side: 100,
    kills: 1,
    deaths: 2,
    assists: 3,
    damageToChamps: 10000,
    gold: 8000,
    visionScore: 80,
    damageSelfMitigated: 36000,
    cs: 80,
  },
  {
    puuid: 'iris',
    side: 100,
    kills: 5,
    deaths: 2,
    assists: 3,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
  },
  {
    puuid: 'karim',
    side: 100,
    kills: 1,
    deaths: 2,
    assists: 3,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 80,
  },
  {
    puuid: 'bilal',
    side: 100,
    kills: 6,
    deaths: 0,
    assists: 2,
    damageToChamps: 40000,
    gold: 16000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 320,
  },
  {
    puuid: 'theo',
    side: 100,
    kills: 0,
    deaths: 2,
    assists: 4,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 60,
    damageSelfMitigated: 24000,
    cs: 80,
  },
  // red
  {
    puuid: 'omar',
    side: 200,
    kills: 4,
    deaths: 2,
    assists: 4,
    damageToChamps: 10000,
    gold: 4000,
    visionScore: 20,
    damageSelfMitigated: 12000,
    cs: 80,
  },
  {
    puuid: 'rami',
    side: 200,
    kills: 2,
    deaths: 2,
    assists: 2,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 48000,
    cs: 160,
  },
  {
    puuid: 'nadia',
    side: 200,
    kills: 3,
    deaths: 2,
    assists: 5,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
  },
  {
    puuid: 'lena',
    side: 200,
    kills: 7,
    deaths: 2,
    assists: 5,
    damageToChamps: 30000,
    gold: 12000,
    visionScore: 20,
    damageSelfMitigated: 24000,
    cs: 240,
  },
  {
    puuid: 'yuki',
    side: 200,
    kills: 0,
    deaths: 7,
    assists: 0,
    damageToChamps: 0,
    gold: 0,
    visionScore: 0,
    damageSelfMitigated: 0,
    cs: 0,
  },
];

/**
 * The score, written out a second time from the six literal weights, in the documented order,
 * over each player's fraction of that component's maximum. Same arithmetic, same order, so
 * `toBe` is the right assertion: this is a pin on the weights and on the normalisation, not a
 * restatement of the implementation.
 */
function expectedScore(f: {
  kda: number;
  damageToChamps: number;
  gold: number;
  visionScore: number;
  damageSelfMitigated: number;
  cs: number;
}): number {
  return (
    0.1 * f.kda +
    0.2 * f.damageToChamps +
    0.2 * f.gold +
    0.25 * f.visionScore +
    0.15 * f.damageSelfMitigated +
    0.1 * f.cs
  );
}

/** Each player's fraction of the maximum, component by component, in the same order. */
const FRACTIONS: Record<string, Parameters<typeof expectedScore>[0]> = {
  bilal: { kda: 1, damageToChamps: 1, gold: 1, visionScore: 0.25, damageSelfMitigated: 0.25, cs: 1 },
  hana: { kda: 0.25, damageToChamps: 0.25, gold: 0.5, visionScore: 1, damageSelfMitigated: 0.75, cs: 0.25 },
  iris: { kda: 0.5, damageToChamps: 0.5, gold: 0.5, visionScore: 0.5, damageSelfMitigated: 0.5, cs: 0.5 },
  karim: {
    kda: 0.25,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.25,
    damageSelfMitigated: 0.25,
    cs: 0.25,
  },
  theo: {
    kda: 0.25,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.75,
    damageSelfMitigated: 0.5,
    cs: 0.25,
  },
  lena: {
    kda: 0.75,
    damageToChamps: 0.75,
    gold: 0.75,
    visionScore: 0.25,
    damageSelfMitigated: 0.5,
    cs: 0.75,
  },
  rami: { kda: 0.25, damageToChamps: 0.5, gold: 0.5, visionScore: 0.5, damageSelfMitigated: 1, cs: 0.5 },
  nadia: { kda: 0.5, damageToChamps: 0.5, gold: 0.5, visionScore: 0.5, damageSelfMitigated: 0.5, cs: 0.5 },
  omar: {
    kda: 0.5,
    damageToChamps: 0.25,
    gold: 0.25,
    visionScore: 0.25,
    damageSelfMitigated: 0.25,
    cs: 0.25,
  },
  yuki: { kda: 0, damageToChamps: 0, gold: 0, visionScore: 0, damageSelfMitigated: 0, cs: 0 },
};

/** The worked example's scores, to two and a half decimals, for the doc and for a human. */
const READABLE: Record<string, number> = {
  bilal: 0.7,
  hana: 0.5625,
  iris: 0.5,
  karim: 0.25,
  theo: 0.4125,
  lena: 0.5875,
  rami: 0.55,
  nadia: 0.5,
  omar: 0.275,
  yuki: 0,
};

function scoreOf(scores: readonly { puuid: string; score: number }[], puuid: string): number {
  const found = scores.find((s) => s.puuid === puuid);
  if (found === undefined) throw new Error(`no score for ${puuid}`);
  return found.score;
}

/** Ten players, all with the same stat line: every component normalises to 1 for everybody. */
function allTheSame(): PerformancePlayer[] {
  return GAME.map((p) => ({
    puuid: p.puuid,
    side: p.side,
    kills: 5,
    deaths: 2,
    assists: 3,
    damageToChamps: 20000,
    gold: 8000,
    visionScore: 40,
    damageSelfMitigated: 24000,
    cs: 160,
  }));
}

/** Deterministic, non-random reordering, to prove nothing depends on insertion order. */
function reversed<T>(xs: readonly T[]): T[] {
  return [...xs].reverse();
}

describe('config.rating.performance / config.rating.mvp', () => {
  it('carries the six weights from the M7.8 brief, and nothing else', () => {
    expect(config.rating.performance).toEqual({
      kda: 0.1,
      damageToChamps: 0.2,
      gold: 0.2,
      visionScore: 0.25,
      damageSelfMitigated: 0.15,
      cs: 0.1,
    });
  });

  it('weights sum to 1.00', () => {
    const w = config.rating.performance;
    const sum = w.kda + w.damageToChamps + w.gold + w.visionScore + w.damageSelfMitigated + w.cs;
    expect(sum).toBeCloseTo(1, 12);
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
  it('scores the worked example, exactly', () => {
    const scores = performanceScores(GAME);
    if (scores === null) throw new Error('expected scores');
    for (const p of GAME) {
      const fractions = FRACTIONS[p.puuid];
      if (fractions === undefined) throw new Error(`no fractions for ${p.puuid}`);
      expect(scoreOf(scores, p.puuid)).toBe(expectedScore(fractions));
    }
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

  it('gives the player who is best at everything exactly the sum of the weights', () => {
    const scores = performanceScores(allTheSame());
    if (scores === null) throw new Error('expected scores');
    const w = config.rating.performance;
    const all = w.kda + w.damageToChamps + w.gold + w.visionScore + w.damageSelfMitigated + w.cs;
    for (const s of scores) expect(s.score).toBe(all);
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
    expect(scoreOf(scores, 'bilal')).toBe(expectedScore(FRACTIONS.bilal as never));
  });

  it('gives a component with a game-wide maximum of zero to nobody, rather than dividing by zero', () => {
    const noVision = GAME.map((p) => ({ ...p, visionScore: 0 }));
    const scores = performanceScores(noVision);
    if (scores === null) throw new Error('expected scores');
    for (const p of GAME) {
      const f = FRACTIONS[p.puuid];
      if (f === undefined) throw new Error(`no fractions for ${p.puuid}`);
      expect(scoreOf(scores, p.puuid)).toBe(expectedScore({ ...f, visionScore: 0 }));
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

  it('lets a support with vision beat a fed carry', () => {
    // Hana keeps the best vision (0.25) and best mitigation (0.15) and is behind Bilal on the
    // other four; four tenths of the score is enough.
    const withVision = GAME.map((p) =>
      p.puuid === 'hana'
        ? {
            ...p,
            kills: 5,
            deaths: 2,
            assists: 3,
            damageToChamps: 20000,
            gold: 12000,
            damageSelfMitigated: 48000,
          }
        : p,
    );
    const scores = performanceScores(withVision);
    if (scores === null) throw new Error('expected scores');
    expect(scoreOf(scores, 'hana')).toBeGreaterThan(scoreOf(scores, 'bilal'));
    expect(mvpAce(withVision, 100)).toEqual({ mvp: 'hana', ace: 'lena' });
  });

  it('breaks a tie by puuid ascending, not by position', () => {
    const tied = allTheSame();
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
