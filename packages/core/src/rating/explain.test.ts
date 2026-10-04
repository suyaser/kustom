import { describe, expect, it } from 'vitest';
import { config, SETTLING_GAMES } from '../config';
import type { Rating, Side } from '../types';
import { type DeltaBreakdown, explainDelta, explainLegacyDelta, foldWinProbability } from './explain';
import { displayRating, isSettling, predictWin, provisionalSeed, rateGame } from './index';
import { applyMvpAceBonus } from './performance';

const team = (r: Rating, n = 5): Rating[] => Array.from({ length: n }, () => ({ ...r }));

/** A breakdown with nothing interesting in it; each test overrides what it is about. */
function row(over: Partial<DeltaBreakdown> = {}): DeltaBreakdown {
  return {
    result: 'won',
    side: 100,
    sideWinProb: 0.5,
    sigmaBefore: 5,
    muBefore: 20,
    baseMuAfter: 20.5,
    muAfter: 20.5,
    award: 'none',
    ...over,
  };
}

/** M1.3's reference lobby: a seed newcomer among nine settled Gold IVs, losing then winning in turn. */
function referenceSigmaBefore(game: number): number {
  const settled = { mu: 23, sigma: 3.5 };
  let me = provisionalSeed();
  for (let g = 1; g < game; g += 1) {
    me = rateGame([me, ...team(settled, 4)], team(settled), g % 2 === 0 ? 100 : 200).blue[0] as Rating;
  }
  return me.sigma;
}

describe('explainDelta: odds stance', () => {
  it('favourite won: a 62% side that won', () => {
    const r = explainDelta(row({ sideWinProb: 0.62, result: 'won' }));
    expect(r.odds).toEqual({ pct: 62, stance: 'favourite' });
    expect(r.result).toBe('won');
  });

  it('favourite lost', () => {
    const r = explainDelta(row({ sideWinProb: 0.62, result: 'lost', baseMuAfter: 19.5, muAfter: 19.5 }));
    expect(r.odds).toEqual({ pct: 62, stance: 'favourite' });
    expect(r.result).toBe('lost');
    expect(r.points).toBe(-30);
  });

  it('underdog won, on red', () => {
    const r = explainDelta(row({ side: 200, sideWinProb: 0.38, result: 'won' }));
    expect(r.odds).toEqual({ pct: 38, stance: 'underdog' });
  });

  it('underdog lost', () => {
    const r = explainDelta(row({ sideWinProb: 0.38, result: 'lost', baseMuAfter: 19.5, muAfter: 19.5 }));
    expect(r.odds).toEqual({ pct: 38, stance: 'underdog' });
  });

  it('even is 48% to 52% inclusive, on the receipt rounding', () => {
    expect(explainDelta(row({ sideWinProb: 0.5 })).odds).toEqual({ pct: 50, stance: 'even' });
    expect(explainDelta(row({ sideWinProb: 0.48 })).odds).toEqual({ pct: 48, stance: 'even' });
    expect(explainDelta(row({ sideWinProb: 0.52 })).odds).toEqual({ pct: 52, stance: 'even' });
    expect(explainDelta(row({ sideWinProb: 0.524 })).odds).toEqual({ pct: 52, stance: 'even' });
    expect(explainDelta(row({ sideWinProb: 0.53 })).odds).toEqual({ pct: 53, stance: 'favourite' });
    expect(explainDelta(row({ sideWinProb: 0.47 })).odds).toEqual({ pct: 47, stance: 'underdog' });
    expect(explainDelta(row({ side: 200, sideWinProb: 0.47 })).odds).toEqual({ pct: 47, stance: 'underdog' });
  });

  it("a red row's percent is 100 minus the receipt's blue percent, never a second rounding", () => {
    // Blue 0.625 prints `Blue 63%` on the receipt, so red is 37 here, not round(37.5) = 38.
    const r = explainDelta(
      row({ side: 200, sideWinProb: 0.375, result: 'lost', baseMuAfter: 19.5, muAfter: 19.5 }),
    );
    expect(r.odds).toEqual({ pct: 37, stance: 'underdog' });
    expect(explainDelta(row({ side: 100, sideWinProb: 0.625 })).odds).toEqual({
      pct: 63,
      stance: 'favourite',
    });
  });
});

describe('explainDelta: certainty', () => {
  it('reads sigma_before against the two config constants', () => {
    const { newSigmaAbove, settledSigmaAtOrBelow } = config.rating.explain;
    expect(explainDelta(row({ sigmaBefore: 12 })).certainty).toBe('new');
    expect(explainDelta(row({ sigmaBefore: newSigmaAbove + 0.01 })).certainty).toBe('new');
    expect(explainDelta(row({ sigmaBefore: newSigmaAbove })).certainty).toBe('settling');
    expect(explainDelta(row({ sigmaBefore: settledSigmaAtOrBelow + 0.01 })).certainty).toBe('settling');
    expect(explainDelta(row({ sigmaBefore: settledSigmaAtOrBelow })).certainty).toBe('settled');
    expect(explainDelta(row({ sigmaBefore: 3.5 })).certainty).toBe('settled');
  });

  it('puts a seed player in M1.3 reference lobby on new for games 1-3, settling 4-9, settled from game 10', () => {
    const band = (game: number) => explainDelta(row({ sigmaBefore: referenceSigmaBefore(game) })).certainty;
    expect([1, 2, 3].map(band)).toEqual(['new', 'new', 'new']);
    expect([4, 5, 6, 7, 8, 9].map(band)).toEqual(Array(6).fill('settling'));
    expect([10, 11, 12].map(band)).toEqual(['settled', 'settled', 'settled']);
    // Pinned so a change to rateGame or the seed shows up here before it reaches a sentence.
    expect(referenceSigmaBefore(3)).toBeCloseTo(10.8477, 4);
    expect(referenceSigmaBefore(4)).toBeCloseTo(10.3551, 4);
    expect(referenceSigmaBefore(9)).toBeCloseTo(8.5586, 4);
    expect(referenceSigmaBefore(10)).toBeCloseTo(8.2861, 4);
  });

  it('with a rated-game count, the count decides, so it never contradicts the settling chip', () => {
    const at = (ratedGamesBefore: number, sigmaBefore = 11) =>
      explainDelta(row({ ratedGamesBefore, sigmaBefore })).certainty;
    expect(at(0, 3)).toBe('new');
    expect(at(config.rating.explain.newGames - 1, 3)).toBe('new');
    expect(at(config.rating.explain.newGames, 12)).toBe('settling');
    // The tenth game (nine before it) is the first settled one, though sigma still reads 11.
    expect(at(SETTLING_GAMES - 2)).toBe('settling');
    expect(at(SETTLING_GAMES - 1)).toBe('settled');
    expect(at(40)).toBe('settled');
    // After the tenth game the board ranks them: the same line.
    expect(isSettling(SETTLING_GAMES - 1 + 1)).toBe(false);
    expect(explainDelta(row({ ratedGamesBefore: null, sigmaBefore: 12 })).certainty).toBe('new');
  });

  it('rejects a count that is not a whole number', () => {
    expect(() => explainDelta(row({ ratedGamesBefore: -1 }))).toThrow(/ratedGamesBefore/);
    expect(() => explainDelta(row({ ratedGamesBefore: 2.5 }))).toThrow(/ratedGamesBefore/);
  });
});

describe('explainDelta: award and points', () => {
  it('none: base and final are the same and there is no award effect', () => {
    const r = explainDelta(row());
    expect(r.award).toBe('none');
    expect(r.points).toBe(30);
    expect(r.basePoints).toBe(30);
    expect(r.basis).toBe('stored');
  });

  it('MVP on a win: 1230 would have been +30, the bonus makes it +38 (1237.5 rounds up)', () => {
    const r = explainDelta(row({ award: 'mvp', baseMuAfter: 20.5, muAfter: 20.625 }));
    expect(r.basePoints).toBe(30);
    expect(r.points).toBe(38);
    expect(r.award).toEqual({ kind: 'mvp', effect: 8, fraction: 0.25 });
  });

  it('ACE on a loss: -30 softened to -24', () => {
    const r = explainDelta(row({ result: 'lost', award: 'ace', baseMuAfter: 19.5, muAfter: 19.6 }));
    expect(r.basePoints).toBe(-30);
    expect(r.points).toBe(-24);
    expect(r.award).toEqual({ kind: 'ace', effect: 6, fraction: 0.2 });
  });

  it('every number is a difference of displayed Ratings, so points = basePoints + effect always', () => {
    // before 1200.4 shows 1200; base 1230.4 shows 1230; MVP 1237.9 shows 1238.
    const r = explainDelta(
      row({ award: 'mvp', muBefore: 1200.4 / 60, baseMuAfter: 1230.4 / 60, muAfter: 1237.9 / 60 }),
    );
    expect([r.basePoints, r.points]).toEqual([30, 38]);
    expect(r.award).toEqual({ kind: 'mvp', effect: 8, fraction: 0.25 });
  });

  it('a bonus worth under one point can print as 0 or 1, never as a fraction', () => {
    // +0.6 → +0.75 raw: both print +1, so the MVP added nothing visible.
    const zero = explainDelta(
      row({ award: 'mvp', muBefore: 20, baseMuAfter: 1200.6 / 60, muAfter: 1200.75 / 60 }),
    );
    expect([zero.basePoints, zero.points]).toEqual([1, 1]);
    expect(zero.award).toEqual({ kind: 'mvp', effect: 0, fraction: 0.25 });
    // +1.4 → +1.75 raw: +1 becomes +2.
    const one = explainDelta(
      row({ award: 'mvp', muBefore: 20, baseMuAfter: 1201.4 / 60, muAfter: 1201.75 / 60 }),
    );
    expect([one.basePoints, one.points]).toEqual([1, 2]);
    expect(one.award).toEqual({ kind: 'mvp', effect: 1, fraction: 0.25 });
  });

  it('refuses a breakdown that cannot have come out of the fold', () => {
    expect(() =>
      explainDelta(row({ award: 'mvp', result: 'lost', baseMuAfter: 19.5, muAfter: 19.375 })),
    ).toThrow(/mvp/);
    expect(() => explainDelta(row({ award: 'ace', result: 'won' }))).toThrow(/ace/);
    expect(() => explainDelta(row({ award: 'none', muAfter: 20.625 }))).toThrow(/none/);
    expect(() => explainDelta(row({ sideWinProb: 1.2 }))).toThrow(/sideWinProb/);
    expect(() => explainDelta(row({ sideWinProb: Number.NaN }))).toThrow(/sideWinProb/);
    expect(() => explainDelta(row({ sigmaBefore: 0 }))).toThrow(/sigmaBefore/);
    expect(() => explainDelta(row({ muAfter: Number.POSITIVE_INFINITY }))).toThrow(/muAfter/);
  });
});

/** Ten befores, Lena-heavy blue, one newcomer on red; blue wins. */
const BLUE: Rating[] = [
  { mu: 27, sigma: 4.1 },
  { mu: 24, sigma: 3.9 },
  { mu: 22, sigma: 5.2 },
  { mu: 21, sigma: 4.4 },
  { mu: 19, sigma: 6 },
];
const RED: Rating[] = [
  { mu: 23, sigma: 4.6 },
  { mu: 22.5, sigma: 3.8 },
  { mu: 21, sigma: 5 },
  { mu: 20, sigma: 12 },
  { mu: 18, sigma: 4.2 },
];

describe('foldWinProbability: the number the fold stores (M14.59 option (a))', () => {
  it('is predictWin over the exact before-ratings handed to rateGame: one function, not two', () => {
    expect(foldWinProbability(BLUE, RED, 100)).toBe(predictWin(BLUE, RED));
    expect(foldWinProbability(BLUE, RED, 200)).toBe(1 - predictWin(BLUE, RED));
  });

  it('ignores extra fields a caller carries and throws on anything but five and five, like rateGame', () => {
    const noisy = BLUE.map((r) => ({ ...r, puuid: 'x' }));
    expect(foldWinProbability(noisy, RED, 100)).toBe(foldWinProbability(BLUE, RED, 100));
    expect(() => foldWinProbability(BLUE.slice(0, 4), RED, 100)).toThrow(/five/);
    expect(() => rateGame(BLUE.slice(0, 4), RED, 100)).toThrow(/five/);
  });

  /**
   * rateGame's update for a two-team game is `sigma'^2 / c * (1 - p)` for the winners and
   * `-sigma'^2 / c * p` for the losers, where `p` is the Plackett-Luce share OpenSkill computes
   * inside `rate`. So `gain on a win < loss on a defeat` exactly when rateGame treats the side
   * as the favourite. The copy says "a win pays less / a loss costs more" for a favourite: this
   * pins that the side foldWinProbability calls the favourite is the side rateGame does.
   */
  it('names the same favourite as rateGame on every lobby, by what rateGame actually pays', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const lobby = (): Rating[] =>
      Array.from({ length: 5 }, () => ({ mu: 14 + rnd() * 21, sigma: 3 + rnd() * 9 }));
    for (let i = 0; i < 200; i += 1) {
      const blue = lobby();
      const red = lobby();
      const p = foldWinProbability(blue, red, 100);
      const gain = (rateGame(blue, red, 100).blue[0] as Rating).mu - (blue[0] as Rating).mu;
      const loss = (blue[0] as Rating).mu - (rateGame(blue, red, 200).blue[0] as Rating).mu;
      expect(gain > 0 && loss > 0).toBe(true);
      expect(gain < loss).toBe(p > 0.5);
    }
  });

  it("recovers rateGame's own share from its output and agrees in direction, not in digits", () => {
    const tau = 25 / 300;
    const beta = 25 / 6;
    const inflated = [...BLUE, ...RED].map((r) => r.sigma ** 2 + tau ** 2);
    const c = Math.sqrt(inflated.reduce((a, b) => a + b, 0) + 2 * beta ** 2);
    const after = rateGame(BLUE, RED, 100);
    const shareBlue =
      1 - (((after.blue[0] as Rating).mu - (BLUE[0] as Rating).mu) * c) / (inflated[0] as number);
    const muBlue = BLUE.reduce((a, r) => a + r.mu, 0);
    const muRed = RED.reduce((a, r) => a + r.mu, 0);
    expect(shareBlue).toBeCloseTo(1 / (1 + Math.exp((muRed - muBlue) / c)), 12);
    // Both above a half: blue is the favourite either way. The stored and printed number is the
    // balancer's (M14.59: the receipt and the explanation must be one function).
    expect(shareBlue).toBeGreaterThan(0.5);
    expect(foldWinProbability(BLUE, RED, 100)).toBeGreaterThan(0.5);
  });
});

describe('explainDelta over a real fold', () => {
  it('turns rateGame + applyMvpAceBonus into the reason the fold would store', () => {
    const after = rateGame(BLUE, RED, 100);
    const ids = ['b0', 'b1', 'b2', 'b3', 'b4', 'r0', 'r1', 'r2', 'r3', 'r4'];
    const befores = [...BLUE, ...RED];
    const afters = [...after.blue, ...after.red];
    const changes = ids.map((puuid, i) => ({
      puuid,
      before: befores[i] as Rating,
      after: afters[i] as Rating,
    }));
    const bonused = applyMvpAceBonus(changes, { mvp: 'b2', ace: 'r3' });
    const breakdown = (i: number, side: Side, award: DeltaBreakdown['award']): DeltaBreakdown => ({
      result: side === 100 ? 'won' : 'lost',
      side,
      sideWinProb: foldWinProbability(BLUE, RED, side),
      sigmaBefore: (befores[i] as Rating).sigma,
      muBefore: (befores[i] as Rating).mu,
      baseMuAfter: (afters[i] as Rating).mu,
      muAfter: (bonused[i] as (typeof bonused)[number]).after.mu,
      award,
    });

    const mvp = explainDelta(breakdown(2, 100, 'mvp'));
    const ace = explainDelta(breakdown(8, 200, 'ace'));
    const plain = explainDelta(breakdown(0, 100, 'none'));

    for (const [i, r] of [
      [2, mvp],
      [8, ace],
      [0, plain],
    ] as const) {
      expect(r.points).toBe(
        displayRating((bonused[i] as (typeof bonused)[number]).after.mu) -
          displayRating((befores[i] as Rating).mu),
      );
      expect(r.basePoints).toBe(
        displayRating((afters[i] as Rating).mu) - displayRating((befores[i] as Rating).mu),
      );
    }
    expect(mvp).toEqual(EXPECTED_MVP);
    expect(ace).toEqual(EXPECTED_ACE);
    expect(plain).toEqual(EXPECTED_PLAIN);
  });
});

describe('explainLegacyDelta: games stored before 0034', () => {
  const tenBefores = { blue: BLUE, red: RED };

  it('recomputes the odds from the ten befores and says the award is unknown', () => {
    const r = explainLegacyDelta({
      result: 'lost',
      side: 200,
      muBefore: 20,
      muAfter: 19.2,
      sigmaBefore: 12,
      ...tenBefores,
    });
    expect(r).toEqual({
      basis: 'legacy',
      result: 'lost',
      points: -48,
      odds: explainDelta(row({ side: 200, sideWinProb: foldWinProbability(BLUE, RED, 200) })).odds,
      certainty: 'new',
      award: 'unknown',
    });
  });

  it('gives the same odds and certainty a stored row of the same game gives', () => {
    const legacy = explainLegacyDelta({
      result: 'won',
      side: 100,
      muBefore: 22,
      muAfter: 22.4,
      sigmaBefore: 5.2,
      ratedGamesBefore: 30,
      ...tenBefores,
    });
    const stored = explainDelta(
      row({
        side: 100,
        sideWinProb: foldWinProbability(BLUE, RED, 100),
        sigmaBefore: 5.2,
        ratedGamesBefore: 30,
        muBefore: 22,
        baseMuAfter: 22.4,
        muAfter: 22.4,
      }),
    );
    if (legacy.basis !== 'legacy') throw new Error('expected a legacy reason');
    expect(legacy.odds).toEqual(stored.odds);
    expect(legacy.certainty).toEqual(stored.certainty);
    expect(legacy.points).toBe(stored.points);
  });

  it('a row missing any before says only the lead', () => {
    const red = [...RED.slice(0, 4), { mu: null, sigma: 4 }];
    expect(
      explainLegacyDelta({
        result: 'won',
        side: 100,
        muBefore: 20,
        muAfter: 20.5,
        sigmaBefore: 6,
        blue: BLUE,
        red,
      }),
    ).toEqual({ basis: 'lead-only', result: 'won', points: 30 });
    expect(
      explainLegacyDelta({
        result: 'won',
        side: 100,
        muBefore: 20,
        muAfter: 20.5,
        sigmaBefore: null,
        ...tenBefores,
      }),
    ).toEqual({ basis: 'lead-only', result: 'won', points: 30 });
    expect(
      explainLegacyDelta({
        result: 'won',
        side: 100,
        muBefore: 20,
        muAfter: 20.5,
        sigmaBefore: 6,
        blue: BLUE.slice(0, 4),
        red: RED,
      }),
    ).toEqual({ basis: 'lead-only', result: 'won', points: 30 });
  });

  it('is deterministic: same input, same output', () => {
    const input = {
      result: 'won' as const,
      side: 100 as const,
      muBefore: 20,
      muAfter: 20.5,
      sigmaBefore: 6,
      ...tenBefores,
    };
    expect(explainLegacyDelta(input)).toEqual(explainLegacyDelta(input));
  });
});

// Pinned from the first run of the fixture above; a change here means the fold or the rounding moved.
// Blue is the 67% side (red 33%). The red newcomer (sigma 12) is the ACE: -176 softened to -140.
const EXPECTED_MVP = {
  basis: 'stored',
  result: 'won',
  points: 41,
  basePoints: 33,
  odds: { pct: 67, stance: 'favourite' },
  certainty: 'settled',
  award: { kind: 'mvp', effect: 8, fraction: 0.25 },
};
const EXPECTED_ACE = {
  basis: 'stored',
  result: 'lost',
  points: -140,
  basePoints: -176,
  odds: { pct: 33, stance: 'underdog' },
  certainty: 'new',
  award: { kind: 'ace', effect: 36, fraction: 0.2 },
};
const EXPECTED_PLAIN = {
  basis: 'stored',
  result: 'won',
  points: 20,
  basePoints: 20,
  odds: { pct: 67, stance: 'favourite' },
  certainty: 'settled',
  award: 'none',
};
