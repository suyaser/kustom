import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { KustomInputError, winProbability } from './kustom';
import { fitOddsPair, type OddsFitGame, shouldAdoptOddsPair } from './oddsFit';

const F = config.oddsFit;
const DAY = 24 * 60 * 60 * 1000;

/** Mulberry32: a seeded PRNG so every synthetic group is the same group every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` games whose true odds are `winProbability(gap, 0, { a, b })`, gaps uniform in
 * `[-spread, spread]`, outcomes drawn from those odds with a seeded PRNG.
 */
function synth(n: number, truth: { a: number; b: number }, spread: number, seed: number): OddsFitGame[] {
  const next = rng(seed);
  const games: OddsFitGame[] = [];
  for (let i = 0; i < n; i++) {
    const gap = (next() * 2 - 1) * spread;
    games.push({ gap, blueWon: next() < winProbability(gap, 0, truth) });
  }
  return games;
}

describe('config.oddsFit', () => {
  it('pins the owner-approved thresholds and the fit constants', () => {
    expect(F).toEqual({
      minGames: 200,
      adoptBelowB: 0.8,
      minDaysBetween: 30,
      ridge: 4,
      maxIterations: 50,
      tolerance: 1e-10,
    });
  });
});

describe('fitOddsPair', () => {
  it('returns exactly (0, 1) with no games: the prior is all there is', () => {
    expect(fitOddsPair([])).toEqual({ a: 0, b: 1, games: 0, iterations: 0, converged: true });
  });

  it('recovers a known stretch: b within 0.05 at 2 000 games, on every seed', () => {
    // Gaps up to ±1 600 summed Rating points (x = gap / 400 up to ±4): b needs spread gaps to be
    // identified at all, see the "balanced games" test below.
    for (const seed of [1, 2, 3, 4, 5]) {
      const fit = fitOddsPair(synth(2000, { a: 0.1, b: 0.6 }, 1600, seed));
      expect(fit.converged).toBe(true);
      expect(Math.abs(fit.b - 0.6)).toBeLessThan(0.05);
      expect(Math.abs(fit.a - 0.1)).toBeLessThan(0.15);
    }
  });

  it('recovers b = 1 when the plain odds are already honest', () => {
    const fit = fitOddsPair(synth(2000, { a: 0, b: 1 }, 1600, 11));
    expect(Math.abs(fit.b - 1)).toBeLessThan(0.05);
  });

  it('pins one exact fit so a change to the solver or the ridge shows up as a diff', () => {
    const fit = fitOddsPair(synth(2000, { a: 0.1, b: 0.6 }, 1600, 1));
    expect(fit.a).toBeCloseTo(PINNED_A, 10);
    expect(fit.b).toBeCloseTo(PINNED_B, 10);
    expect(fit.games).toBe(2000);
  });

  it('shrinks toward (0, 1) at small n: 20 games of the same group sit nearer the plain odds', () => {
    const truth = { a: 0.1, b: 0.6 };
    const big = fitOddsPair(synth(2000, truth, 1600, 3));
    const small = fitOddsPair(synth(20, truth, 1600, 3));
    const dist = (p: { a: number; b: number }) => Math.hypot(p.a, p.b - 1);
    expect(dist(small)).toBeLessThan(dist(big));
  });

  it('shrinks harder with a bigger ridge, and ridge 0 is the plain maximum-likelihood fit', () => {
    const games = synth(60, { a: 0, b: 0.4 }, 800, 7);
    const none = fitOddsPair(games, { ridge: 0 });
    const def = fitOddsPair(games);
    const heavy = fitOddsPair(games, { ridge: 100 });
    expect(none.b).toBeLessThan(def.b);
    expect(def.b).toBeLessThan(heavy.b);
    expect(heavy.b).toBeLessThan(1);
    expect(Math.abs(heavy.b - 1)).toBeLessThan(Math.abs(none.b - 1));
  });

  it('barely moves off b = 1 on balanced games: small gaps carry almost no evidence about b', () => {
    // 300 bot-balanced games (gaps within ±60), every result a coin flip (true b = 0). The fit
    // cannot tell, so the ridge keeps it near the plain odds and the guard does not fire.
    const next = rng(5);
    const games: OddsFitGame[] = Array.from({ length: 300 }, () => ({
      gap: (next() * 2 - 1) * 60,
      blueWon: next() < 0.5,
    }));
    const fit = fitOddsPair(games);
    expect(fit.b).toBeGreaterThan(F.adoptBelowB);
  });

  it('is the same fit in any game order (games are sorted by a stable key first)', () => {
    const games = synth(500, { a: 0.2, b: 0.7 }, 1200, 9);
    const reversed = [...games].reverse();
    const shuffled = [...games].sort((x, y) =>
      x.blueWon === y.blueWon ? y.gap - x.gap : x.blueWon ? 1 : -1,
    );
    const f = fitOddsPair(games);
    expect(fitOddsPair(reversed)).toEqual(f);
    expect(fitOddsPair(shuffled)).toEqual(f);
  });

  it('a side bias shows up in a: blue winning more than its gap says gives a > 0', () => {
    const fit = fitOddsPair(synth(2000, { a: 0.5, b: 1 }, 1600, 13));
    expect(fit.a).toBeGreaterThan(0.35);
    expect(fit.a).toBeLessThan(0.65);
  });

  it('stays finite on separable data (every favourite won): the ridge bounds it', () => {
    const games: OddsFitGame[] = [];
    for (let i = 1; i <= 50; i++) {
      games.push({ gap: i * 10, blueWon: true }, { gap: -i * 10, blueWon: false });
    }
    const fit = fitOddsPair(games);
    expect(fit.converged).toBe(true);
    expect(Number.isFinite(fit.b)).toBe(true);
    expect(fit.b).toBeGreaterThan(1);
  });

  it('throws on a non-finite gap or a negative / non-finite ridge', () => {
    expect(() => fitOddsPair([{ gap: Number.NaN, blueWon: true }])).toThrow(KustomInputError);
    expect(() => fitOddsPair([{ gap: Number.POSITIVE_INFINITY, blueWon: true }])).toThrow(KustomInputError);
    expect(() => fitOddsPair([], { ridge: -1 })).toThrow(KustomInputError);
    expect(() => fitOddsPair([], { ridge: Number.NaN })).toThrow(KustomInputError);
  });
});

describe('shouldAdoptOddsPair', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const low = { a: 0.05, b: 0.7 };

  it('adopts a low b with enough games and no earlier adoption', () => {
    expect(shouldAdoptOddsPair({ fit: low, games: 200, lastAdoptedAt: null, now })).toEqual({
      adopt: true,
      pair: { a: 0.05, b: 0.7 },
    });
  });

  it('needs 200 games: 199 is too few', () => {
    expect(shouldAdoptOddsPair({ fit: low, games: 199, lastAdoptedAt: null, now })).toEqual({
      adopt: false,
      reason: 'too_few_games',
    });
  });

  it('needs b strictly below 0.8: 0.8 itself is not adopted', () => {
    expect(shouldAdoptOddsPair({ fit: { a: 0, b: 0.8 }, games: 500, lastAdoptedAt: null, now })).toEqual({
      adopt: false,
      reason: 'b_not_low',
    });
    expect(
      shouldAdoptOddsPair({ fit: { a: 0, b: 0.7999 }, games: 500, lastAdoptedAt: null, now }).adopt,
    ).toBe(true);
  });

  it('never adopts b <= 0: that would make the favourite the underdog or every game a coin flip', () => {
    for (const b of [0, -0.2]) {
      expect(shouldAdoptOddsPair({ fit: { a: 0, b }, games: 500, lastAdoptedAt: null, now })).toEqual({
        adopt: false,
        reason: 'b_not_positive',
      });
    }
  });

  it('at most once a month: 30 days after the last adoption is allowed, a millisecond less is not', () => {
    const exactly = new Date(now.getTime() - F.minDaysBetween * DAY);
    const justUnder = new Date(now.getTime() - F.minDaysBetween * DAY + 1);
    expect(shouldAdoptOddsPair({ fit: low, games: 500, lastAdoptedAt: exactly, now }).adopt).toBe(true);
    expect(shouldAdoptOddsPair({ fit: low, games: 500, lastAdoptedAt: justUnder, now })).toEqual({
      adopt: false,
      reason: 'too_soon',
    });
  });

  it('reports the first failing check in a fixed order: games, then month, then b', () => {
    const yesterday = new Date(now.getTime() - DAY);
    expect(shouldAdoptOddsPair({ fit: { a: 0, b: 1 }, games: 10, lastAdoptedAt: yesterday, now })).toEqual({
      adopt: false,
      reason: 'too_few_games',
    });
    expect(shouldAdoptOddsPair({ fit: { a: 0, b: 1 }, games: 500, lastAdoptedAt: yesterday, now })).toEqual({
      adopt: false,
      reason: 'too_soon',
    });
  });

  it('throws on a non-finite pair, a bad game count or an invalid date', () => {
    expect(() =>
      shouldAdoptOddsPair({ fit: { a: Number.NaN, b: 0.5 }, games: 500, lastAdoptedAt: null, now }),
    ).toThrow(KustomInputError);
    expect(() => shouldAdoptOddsPair({ fit: low, games: -1, lastAdoptedAt: null, now })).toThrow(
      KustomInputError,
    );
    expect(() => shouldAdoptOddsPair({ fit: low, games: 2.5, lastAdoptedAt: null, now })).toThrow(
      KustomInputError,
    );
    expect(() =>
      shouldAdoptOddsPair({ fit: low, games: 500, lastAdoptedAt: null, now: new Date(Number.NaN) }),
    ).toThrow(KustomInputError);
  });

  it('the adopted pair fed to winProbability is the receipt percentage', () => {
    const decision = shouldAdoptOddsPair({ fit: low, games: 500, lastAdoptedAt: null, now });
    if (!decision.adopt) throw new Error('expected adoption');
    // Gap 100 at (0.05, 0.7): logistic(0.05 + 0.7 × 0.25) = logistic(0.225).
    expect(winProbability(6100, 6000, decision.pair)).toBeCloseTo(1 / (1 + Math.exp(-0.225)), 12);
  });
});

// The solver's exact output on seed 1 (6 Newton steps). A change here is a change to the fit.
const PINNED_A = 0.07161276260216969;
const PINNED_B = 0.6108825012364679;
