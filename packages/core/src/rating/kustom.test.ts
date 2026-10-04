import { describe, expect, it } from 'vitest';
import { config, KUSTOM_START } from '../config';
import type { Side } from '../types';
import {
  displayKustom,
  explainKustomDelta,
  KustomInputError,
  type KustomPlayer,
  type KustomRow,
  kFor,
  printedChange,
  rateGameKustom,
  shareFor,
  shareRanks,
  winProbability,
} from './kustom';

/** Mulberry32: a seeded PRNG so the property runs are the same run every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLUE = ['b1', 'b2', 'b3', 'b4', 'b5'];
const RED = ['r1', 'r2', 'r3', 'r4', 'r5'];

/** Ten players; score descending in seat order (b1/r1 best), so rank = seat. */
function lobby(over: Partial<Omit<KustomPlayer, 'puuid' | 'side'>> = {}): KustomPlayer[] {
  return [
    ...BLUE.map((puuid, i) => ({ puuid, side: 100 as const, r: 1200, n: 10, score: 5 - i, ...over })),
    ...RED.map((puuid, i) => ({ puuid, side: 200 as const, r: 1200, n: 10, score: 5 - i, ...over })),
  ];
}

const row = (rows: readonly KustomRow[], puuid: string): KustomRow => {
  const found = rows.find((x) => x.puuid === puuid);
  if (found === undefined) throw new Error(`no row ${puuid}`);
  return found;
};

const sideSum = (rows: readonly KustomRow[], side: Side, f: (x: KustomRow) => number): number =>
  rows.filter((x) => x.side === side).reduce((a, x) => a + f(x), 0);

describe('config and constants', () => {
  it('pins the Kustom constants in one place', () => {
    expect(KUSTOM_START).toBe(1200);
    expect(config.kustom).toEqual({
      start: 1200,
      kNew: 32,
      kSettled: 16,
      kSettleGames: 10,
      oddsScale: 400,
      winnerShares: [1.2, 1.1, 1.0, 0.9, 0.8],
    });
  });
});

describe('kFor', () => {
  it('the K table at n = 0, 1, 5, 9, 10, 11, 500', () => {
    expect(kFor(0)).toBe(32);
    expect(kFor(1)).toBeCloseTo(30.4, 12);
    expect(kFor(5)).toBe(24);
    expect(kFor(9)).toBeCloseTo(17.6, 12);
    expect(kFor(10)).toBe(16);
    expect(kFor(11)).toBe(16);
    expect(kFor(500)).toBe(16);
  });

  it('throws a typed error on a negative or non-integer n', () => {
    expect(() => kFor(-1)).toThrow(KustomInputError);
    expect(() => kFor(1.5)).toThrow(KustomInputError);
    expect(() => kFor(Number.NaN)).toThrow(KustomInputError);
    expect(() => kFor(Number.POSITIVE_INFINITY)).toThrow(KustomInputError);
  });
});

describe('winProbability', () => {
  it('the odds table: gap 0 / 50 / 100 / 200 / 400 is 50 / 53 / 56 / 62 / 73 percent', () => {
    const pct = (gap: number) => Math.round(winProbability(6000 + gap, 6000) * 100);
    expect([0, 50, 100, 200, 400].map(pct)).toEqual([50, 53, 56, 62, 73]);
    expect(winProbability(6000, 6000)).toBe(0.5);
  });

  it('is symmetric: p(gap) + p(-gap) = 1', () => {
    for (const gap of [0, 1, 37, 100, 250, 999]) {
      expect(winProbability(6000 + gap, 6000) + winProbability(6000, 6000 + gap)).toBeCloseTo(1, 12);
    }
  });

  it('is the plain formula 1 / (1 + exp(-gap / 400))', () => {
    expect(winProbability(6150, 6000)).toBe(1 / (1 + Math.exp(-150 / 400)));
  });

  it('calib (0, 1) equals the plain formula', () => {
    for (const gap of [-300, -10, 0, 75, 400]) {
      expect(winProbability(6000 + gap, 6000, { a: 0, b: 1 })).toBe(winProbability(6000 + gap, 6000));
    }
  });

  it('calib b = 0.5 halves the logit, and a shifts it', () => {
    const logit = (p: number) => Math.log(p / (1 - p));
    const plain = logit(winProbability(6200, 6000));
    expect(logit(winProbability(6200, 6000, { a: 0, b: 0.5 }))).toBeCloseTo(plain / 2, 12);
    expect(winProbability(6200, 6000, { a: 0, b: 0.5 })).toBeCloseTo(winProbability(6100, 6000), 12);
    expect(logit(winProbability(6000, 6000, { a: 0.3, b: 1 }))).toBeCloseTo(0.3, 12);
  });

  it('is monotone in the gap', () => {
    let last = 0;
    for (let gap = -1000; gap <= 1000; gap += 25) {
      const p = winProbability(6000 + gap, 6000);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  it('throws a typed error on a non-finite total or calibration', () => {
    expect(() => winProbability(Number.NaN, 6000)).toThrow(KustomInputError);
    expect(() => winProbability(6000, Number.POSITIVE_INFINITY)).toThrow(KustomInputError);
    expect(() => winProbability(6000, 6000, { a: Number.NaN, b: 1 })).toThrow(KustomInputError);
    expect(() => winProbability(6000, 6000, { a: 0, b: Number.NaN })).toThrow(KustomInputError);
  });
});

describe('shareRanks and shareFor', () => {
  it('ranks best first', () => {
    const scores = new Map([
      ['a', 0.1],
      ['b', 0.9],
      ['c', 0.5],
      ['d', 0.7],
      ['e', 0.3],
    ]);
    expect(shareRanks(['a', 'b', 'c', 'd', 'e'], scores)).toEqual(['b', 'd', 'c', 'e', 'a']);
  });

  it('ties broken by PUUID ascending, whatever the input order', () => {
    const scores = new Map([
      ['zed', 1],
      ['amy', 1],
      ['kai', 2],
      ['bob', 1],
      ['eve', 0],
    ]);
    const expected = ['kai', 'amy', 'bob', 'zed', 'eve'];
    expect(shareRanks(['zed', 'amy', 'kai', 'bob', 'eve'], scores)).toEqual(expected);
    expect(shareRanks(['eve', 'bob', 'kai', 'amy', 'zed'], scores)).toEqual(expected);
  });

  it('returns null when any of the five has no score', () => {
    const scores = new Map<string, number | null>([
      ['a', 1],
      ['b', 2],
      ['c', null],
      ['d', 4],
      ['e', 5],
    ]);
    expect(shareRanks(['a', 'b', 'c', 'd', 'e'], scores)).toBeNull();
    scores.delete('c');
    expect(shareRanks(['a', 'b', 'c', 'd', 'e'], scores)).toBeNull();
  });

  it('rejects anything but five distinct players and finite scores', () => {
    const scores = new Map([['a', 1]]);
    expect(() => shareRanks(['a', 'b', 'c', 'd'], scores)).toThrow(KustomInputError);
    expect(() => shareRanks(['a', 'a', 'c', 'd', 'e'], scores)).toThrow(KustomInputError);
    const bad = new Map([
      ['a', 1],
      ['b', Number.NaN],
      ['c', 1],
      ['d', 1],
      ['e', 1],
    ]);
    expect(() => shareRanks(['a', 'b', 'c', 'd', 'e'], bad)).toThrow(KustomInputError);
  });

  it('winners 1.2 / 1.1 / 1.0 / 0.9 / 0.8, losers the reverse', () => {
    expect([1, 2, 3, 4, 5].map((r) => shareFor(r, true))).toEqual([1.2, 1.1, 1.0, 0.9, 0.8]);
    expect([1, 2, 3, 4, 5].map((r) => shareFor(r, false))).toEqual([0.8, 0.9, 1.0, 1.1, 1.2]);
  });

  it('shares sum to 5 per side', () => {
    for (const won of [true, false]) {
      const sum = [1, 2, 3, 4, 5].reduce((a, r) => a + shareFor(r, won), 0);
      expect(sum).toBeCloseTo(5, 12);
    }
  });

  it('throws on a rank outside 1..5', () => {
    expect(() => shareFor(0, true)).toThrow(KustomInputError);
    expect(() => shareFor(6, false)).toThrow(KustomInputError);
    expect(() => shareFor(2.5, true)).toThrow(KustomInputError);
  });
});

describe('rateGameKustom: the numbers a friend will see', () => {
  it('settled, even game, middle share: +8 and -8', () => {
    const rows = rateGameKustom({ players: lobby(), winningSide: 100 });
    expect(row(rows, 'b3').rAfter - 1200).toBe(8);
    expect(row(rows, 'r3').rAfter - 1200).toBe(-8);
    expect(row(rows, 'b3').share).toBe(1.0);
  });

  it('MVP of an even win (settled): +9.6', () => {
    const rows = rateGameKustom({ players: lobby(), winningSide: 100 });
    const mvp = row(rows, 'b1');
    expect(mvp.award).toBe('mvp');
    expect(mvp.rAfter - mvp.rBefore).toBeCloseTo(9.6, 12);
    expect(printedChange(mvp.rBefore, mvp.rAfter)).toBe(10);
  });

  it('ACE of an even loss (settled): -6.4', () => {
    const rows = rateGameKustom({ players: lobby(), winningSide: 100 });
    const ace = row(rows, 'r1');
    expect(ace.award).toBe('ace');
    expect(ace.rAfter - ace.rBefore).toBeCloseTo(-6.4, 12);
    expect(printedChange(ace.rBefore, ace.rAfter)).toBe(-6);
    expect(rows.filter((x) => x.award !== 'none').map((x) => x.puuid)).toEqual(['b1', 'r1']);
  });

  it('settled, any game: at most 19.2, printed at most 20 (seeded run)', () => {
    const rand = rng(18_1);
    for (let g = 0; g < 2000; g++) {
      const players = lobby().map((p) => ({
        ...p,
        r: 900 + rand() * 700,
        n: 10 + Math.floor(rand() * 200),
        score: rand(),
      }));
      for (const x of rateGameKustom({ players, winningSide: rand() < 0.5 ? 100 : 200 })) {
        expect(Math.abs(x.rAfter - x.rBefore)).toBeLessThanOrEqual(19.2);
        expect(Math.abs(printedChange(x.rBefore, x.rAfter))).toBeLessThanOrEqual(20);
      }
    }
  });

  it("a newcomer's first game: at most 32 x 1.2 = 38.4", () => {
    // The biggest possible: a huge underdog wins as MVP on game one.
    const players = lobby().map((p) => (p.side === 100 ? { ...p, r: 200 } : { ...p, r: 3000 }));
    const first = { ...(players[0] as KustomPlayer), n: 0 };
    const rows = rateGameKustom({ players: [first, ...players.slice(1)], winningSide: 100 });
    const d = row(rows, 'b1').rAfter - row(rows, 'b1').rBefore;
    expect(row(rows, 'b1').k).toBe(32);
    expect(d).toBeLessThanOrEqual(38.4);
    expect(d).toBeGreaterThan(38.3);
  });

  it('the weekly case: all ten at 1200 with n 0 gives expected 0.5 and +-16 x share', () => {
    const rows = rateGameKustom({ players: lobby({ n: 0 }), winningSide: 200 });
    for (const x of rows) {
      expect(x.expected).toBe(0.5);
      expect(x.k).toBe(32);
      const sign = x.side === 200 ? 1 : -1;
      expect(x.base).toBe(sign * 16);
      expect(x.rAfter - 1200).toBeCloseTo(sign * 16 * x.share, 12);
    }
    expect(row(rows, 'r1').rAfter).toBeCloseTo(1200 + 19.2, 12);
    expect(row(rows, 'b5').rAfter).toBeCloseTo(1200 - 16 * 1.2, 12);
  });
});

describe('rateGameKustom: properties', () => {
  it('sign safety over 10 000 seeded random games: no win lowers, no loss raises', () => {
    const rand = rng(10_000);
    for (let g = 0; g < 10_000; g++) {
      const scored = rand() < 0.8;
      const players = lobby().map((p) => ({
        ...p,
        r: 600 + rand() * 1400,
        n: Math.floor(rand() * 40),
        score: scored ? Math.floor(rand() * 4) : null,
      }));
      const winningSide: Side = rand() < 0.5 ? 100 : 200;
      for (const x of rateGameKustom({ players, winningSide })) {
        if (x.won) expect(x.rAfter).toBeGreaterThanOrEqual(x.rBefore);
        else expect(x.rAfter).toBeLessThanOrEqual(x.rBefore);
      }
    }
  });

  it('monotone in the gap: the bigger the underdog, the more a win pays and the less a loss costs', () => {
    let lastWin = 0;
    let lastLoss = Number.NEGATIVE_INFINITY;
    for (let blueR = 1500; blueR >= 900; blueR -= 50) {
      const players = lobby().map((p) => (p.side === 100 ? { ...p, r: blueR } : p));
      const win = row(rateGameKustom({ players, winningSide: 100 }), 'b3');
      const loss = row(rateGameKustom({ players, winningSide: 200 }), 'b3');
      expect(win.rAfter - win.rBefore).toBeGreaterThan(lastWin);
      expect(loss.rAfter - loss.rBefore).toBeGreaterThan(lastLoss);
      lastWin = win.rAfter - win.rBefore;
      lastLoss = loss.rAfter - loss.rBefore;
    }
  });

  it('zero-sum to 1e-9 when all ten have n >= 10 and shares exist', () => {
    const rand = rng(42);
    for (let g = 0; g < 500; g++) {
      const players = lobby().map((p) => ({
        ...p,
        r: 800 + rand() * 900,
        n: 10 + Math.floor(rand() * 90),
        score: rand(),
      }));
      const rows = rateGameKustom({ players, winningSide: rand() < 0.5 ? 100 : 200 });
      expect(Math.abs(rows.reduce((a, x) => a + (x.rAfter - x.rBefore), 0))).toBeLessThan(1e-9);
    }
  });

  it('zero-sum is not promised when someone is in their first ten', () => {
    const players = lobby();
    players[0] = { ...(players[0] as KustomPlayer), n: 0 };
    const rows = rateGameKustom({ players, winningSide: 100 });
    expect(rows.reduce((a, x) => a + (x.rAfter - x.rBefore), 0)).toBeGreaterThan(1);
  });

  it('equal teammates with equal share get equal change', () => {
    // No scores: every share is 1.0. Two blue teammates at different Ratings, both settled.
    const players = lobby({ score: null }).map((p) => (p.puuid === 'b2' ? { ...p, r: 1450 } : p));
    const rows = rateGameKustom({ players, winningSide: 100 });
    const changes = rows.filter((x) => x.side === 100).map((x) => x.rAfter - x.rBefore);
    for (const c of changes) expect(c).toBe(changes[0]);
    const rowsWithShares = rateGameKustom({ players: lobby(), winningSide: 200 });
    expect(row(rowsWithShares, 'b3').base).toBe(row(rowsWithShares, 'b1').base);
  });

  it('shares sum to 5 per side in a rated game', () => {
    const rows = rateGameKustom({ players: lobby(), winningSide: 100 });
    expect(sideSum(rows, 100, (x) => x.share)).toBeCloseTo(5, 12);
    expect(sideSum(rows, 200, (x) => x.share)).toBeCloseTo(5, 12);
    expect(rows.map((x) => x.shareRank)).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
  });

  it('ties broken by PUUID inside rateGameKustom', () => {
    const rows = rateGameKustom({ players: lobby({ score: 1 }), winningSide: 100 });
    expect(rows.map((x) => x.shareRank)).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
    expect(row(rows, 'b1').award).toBe('mvp');
    expect(row(rows, 'r1').award).toBe('ace');
  });

  it('null scores give share 1.0 and award none for all ten', () => {
    const players = lobby();
    players[7] = { ...(players[7] as KustomPlayer), score: null };
    const rows = rateGameKustom({ players, winningSide: 100 });
    for (const x of rows) {
      expect(x.share).toBe(1);
      expect(x.shareRank).toBeNull();
      expect(x.award).toBe('none');
    }
  });

  it('returns rows in input order with the inputs echoed', () => {
    const players = lobby().reverse();
    const rows = rateGameKustom({ players, winningSide: 100 });
    expect(rows.map((x) => x.puuid)).toEqual(players.map((p) => p.puuid));
    expect(row(rows, 'b2')).toEqual({
      puuid: 'b2',
      side: 100,
      won: true,
      rBefore: 1200,
      rAfter: 1200 + 8 * 1.1,
      k: 16,
      expected: 0.5,
      shareRank: 2,
      share: 1.1,
      base: 8,
      award: 'none',
    });
  });

  it('passes calib through to the expected score', () => {
    const players = lobby().map((p) => (p.side === 100 ? { ...p, r: 1240 } : p));
    const rows = rateGameKustom({ players, winningSide: 100 }, { a: 0, b: 0.5 });
    expect(row(rows, 'b1').expected).toBeCloseTo(winProbability(6100, 6000), 12);
    expect(row(rows, 'r1').expected).toBeCloseTo(1 - winProbability(6100, 6000), 12);
  });

  it('is deterministic: same input, same output', () => {
    const players = lobby().map((p, i) => ({ ...p, r: 1100 + i * 17.3, score: (i * 7) % 4 }));
    expect(rateGameKustom({ players, winningSide: 200 })).toEqual(
      rateGameKustom({ players, winningSide: 200 }),
    );
  });
});

describe('rateGameKustom: rejects a bug, not data', () => {
  it('anything but exactly five a side', () => {
    const players = lobby();
    expect(() => rateGameKustom({ players: players.slice(1), winningSide: 100 })).toThrow(KustomInputError);
    const sixBlue = players.map((p) => (p.puuid === 'r1' ? { ...p, side: 100 as const } : p));
    expect(() => rateGameKustom({ players: sixBlue, winningSide: 100 })).toThrow(KustomInputError);
    const eleven = [...players, { ...(players[0] as KustomPlayer), puuid: 'x' }];
    expect(() => rateGameKustom({ players: eleven, winningSide: 100 })).toThrow(KustomInputError);
  });

  it('a side value that is not 100 or 200', () => {
    const players = lobby();
    players[0] = { ...(players[0] as KustomPlayer), side: 300 as unknown as Side };
    expect(() => rateGameKustom({ players, winningSide: 100 })).toThrow(KustomInputError);
  });

  it('the same PUUID twice', () => {
    const players = lobby();
    players[9] = { ...(players[9] as KustomPlayer), puuid: 'r1' };
    expect(() => rateGameKustom({ players, winningSide: 100 })).toThrow(KustomInputError);
  });

  it('a non-finite r', () => {
    for (const r of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const players = lobby();
      players[3] = { ...(players[3] as KustomPlayer), r };
      expect(() => rateGameKustom({ players, winningSide: 100 })).toThrow(KustomInputError);
    }
  });

  it('a bad n', () => {
    const players = lobby();
    players[3] = { ...(players[3] as KustomPlayer), n: -1 };
    expect(() => rateGameKustom({ players, winningSide: 100 })).toThrow(KustomInputError);
  });

  it('a winningSide that is not 100 or 200', () => {
    expect(() => rateGameKustom({ players: lobby(), winningSide: 0 as unknown as Side })).toThrow(
      KustomInputError,
    );
  });

  it('the error is a typed, named error', () => {
    try {
      rateGameKustom({ players: lobby(), winningSide: 1 as unknown as Side });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(KustomInputError);
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('KustomInputError');
    }
  });
});

describe('displayKustom and printedChange', () => {
  it('display is Math.round', () => {
    expect(displayKustom(1200)).toBe(1200);
    expect(displayKustom(1207.5)).toBe(1208);
    expect(displayKustom(1207.49)).toBe(1207);
  });

  it('printedChange is round(after) - round(before)', () => {
    expect(printedChange(1200, 1209.6)).toBe(10);
    expect(printedChange(1200.4, 1200.6)).toBe(1);
    expect(printedChange(1209.6, 1203.2)).toBe(-7);
  });

  it('printedChange adds up across a chain', () => {
    const rand = rng(7);
    let r = KUSTOM_START;
    const first = r;
    let printed = 0;
    for (let n = 0; n < 200; n++) {
      const players = lobby({ score: rand() }).map((p) =>
        p.puuid === 'b1' ? { ...p, r, n } : { ...p, r: 1100 + rand() * 200 },
      );
      const me = row(rateGameKustom({ players, winningSide: rand() < 0.5 ? 100 : 200 }), 'b1');
      printed += printedChange(me.rBefore, me.rAfter);
      r = me.rAfter;
    }
    expect(r).not.toBe(first);
    expect(printed).toBe(displayKustom(r) - displayKustom(first));
  });
});

describe('explainKustomDelta', () => {
  it('an even settled MVP win: parts, not copy', () => {
    const rows = rateGameKustom({ players: lobby(), winningSide: 100 });
    expect(explainKustomDelta(row(rows, 'b1'))).toEqual({
      side: 100,
      result: 'win',
      expectedPct: 50,
      k: 16,
      firstTenGames: false,
      shareRank: 1,
      share: 1.2,
      award: 'mvp',
      points: 10,
    });
  });

  it("a red newcomer's ACE loss as favourite", () => {
    const players = lobby().map((p) => (p.side === 200 ? { ...p, r: 1300 } : p));
    players[5] = { ...(players[5] as KustomPlayer), n: 2 };
    const rows = rateGameKustom({ players, winningSide: 100 });
    const parts = explainKustomDelta(row(rows, 'r1'));
    expect(parts).toEqual({
      side: 200,
      result: 'loss',
      expectedPct: 78,
      k: kFor(2),
      firstTenGames: true,
      shareRank: 1,
      share: 0.8,
      award: 'ace',
      points: printedChange(1300, row(rows, 'r1').rAfter),
    });
  });

  it("the two sides' percents add to 100, using the receipt's blue rounding", () => {
    // Blue at exactly 50.5% would round both sides up; red reads 100 minus blue.
    const gap = 400 * Math.log(0.505 / 0.495);
    const players = lobby().map((p) => (p.side === 100 ? { ...p, r: 1200 + gap / 5 } : p));
    const rows = rateGameKustom({ players, winningSide: 200 });
    const blue = explainKustomDelta(row(rows, 'b1')).expectedPct;
    const red = explainKustomDelta(row(rows, 'r1')).expectedPct;
    expect(blue + red).toBe(100);
  });

  it('no score: no rank, no award', () => {
    const rows = rateGameKustom({ players: lobby({ score: null }), winningSide: 200 });
    const parts = explainKustomDelta(row(rows, 'b4'));
    expect(parts.shareRank).toBeNull();
    expect(parts.award).toBe('none');
    expect(parts.share).toBe(1);
    expect(parts.points).toBe(-8);
  });

  it('never speaks of sigma or certainty', () => {
    const rows = rateGameKustom({ players: lobby({ n: 3 }), winningSide: 100 });
    const keys = Object.keys(explainKustomDelta(row(rows, 'b2')));
    expect(keys.join(' ')).not.toMatch(/sigma|certain|settl|uncertain/i);
  });
});
