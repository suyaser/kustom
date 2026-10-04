import { describe, expect, it } from 'vitest';
import {
  type Assignment,
  type BalancePlayer,
  balance,
  calibration,
  config,
  describeSwap,
  explain,
  favoredSide,
  isSettling,
  type OddsBand,
  oddsBand,
  preGameOdds,
  type Role,
  SETTLING_GAMES,
  type Split,
  whyLower,
  winProbability,
} from '../index';

/** The worked example from docs/00-product.md, the same ten as `balance/index.test.ts`. */
function player(name: string, r: number, mainRole: Role, secondaryRole: Role): BalancePlayer {
  return { puuid: `puuid-${name.toLowerCase()}`, name, r, n: 20, mainRole, secondaryRole };
}

const ROSTER: readonly BalancePlayer[] = [
  player('Bilal', 1713, 'adc', 'mid'),
  player('Hana', 1434, 'top', 'mid'),
  player('Iris', 1578, 'jungle', 'top'),
  player('Karim', 1551, 'mid', 'adc'),
  player('Lena', 2088, 'adc', 'jungle'),
  player('Nadia', 1266, 'mid', 'support'),
  player('Omar', 1469.4, 'top', 'support'),
  player('Rami', 1638, 'jungle', 'mid'),
  player('Theo', 1419, 'support', 'adc'),
  player('Yuki', 1134, 'support', 'top'),
];

const id = (name: string): string => `puuid-${name.toLowerCase()}`;

/** A side written as five `Name:role` pairs, so a fixture reads like a team card. */
function side(...seats: string[]): Assignment[] {
  return seats.map((seat) => {
    const [name, role] = seat.split(':') as [string, Role];
    return { puuid: id(name), role };
  });
}

const WORKED = balance({ players: ROSTER });
const [S1, S2, S3] = WORKED.splits as [Split, Split, Split];

describe('describeSwap', () => {
  it('reads the worked example: split 1 to split 2 swaps the top players, Hana and Omar', () => {
    expect(describeSwap(S1, S2)).toEqual({
      kind: 'one-for-one',
      a: { puuid: id('Hana'), role: 'top' },
      b: { puuid: id('Omar'), role: 'top' },
      sameLane: true,
    });
  });

  it('reads the worked example: split 2 to split 3 moves four players (two swaps)', () => {
    expect(describeSwap(S2, S3)).toEqual({ kind: 'reshuffle', moved: 4 });
  });

  it('agrees with the sentence on every pair of the worked example', () => {
    // The sentence is built from describeSwap, so this is the "can never disagree" guard.
    expect(WORKED.explanations[0]).toContain('Next best: swap Hana and Omar,');
    expect(WORKED.explanations[1]).toContain('Next best: 2 swaps,');
  });

  it('puts the chosen split’s blue player in `a` and gives both their lanes in the chosen split', () => {
    const chosen = {
      blue: side('Hana:top', 'Iris:jungle', 'Karim:mid', 'Bilal:adc', 'Theo:support'),
      red: side('Omar:top', 'Rami:jungle', 'Nadia:mid', 'Lena:adc', 'Yuki:support'),
    };
    // Karim (mid, blue) and Lena (adc, red) trade sides; in `next` both take new lanes.
    const next = {
      blue: side('Hana:top', 'Iris:jungle', 'Bilal:mid', 'Lena:adc', 'Theo:support'),
      red: side('Omar:top', 'Rami:jungle', 'Nadia:mid', 'Karim:adc', 'Yuki:support'),
    };
    expect(describeSwap(chosen, next)).toEqual({
      kind: 'one-for-one',
      a: { puuid: id('Karim'), role: 'mid' },
      b: { puuid: id('Lena'), role: 'adc' },
      sameLane: false,
    });
  });

  it('aligns by overlap, so a next split stored with its colours swapped reads the same', () => {
    const mirrored = { blue: S2.red, red: S2.blue };
    expect(describeSwap(S1, mirrored)).toEqual(describeSwap(S1, S2));
    expect(describeSwap(S2, { blue: S3.red, red: S3.blue })).toEqual(describeSwap(S2, S3));
  });

  it('calls the same ten teams identical, including up to a side swap and a role reshuffle', () => {
    expect(describeSwap(S1, S1)).toEqual({ kind: 'identical' });
    expect(describeSwap(S1, { blue: S1.red, red: S1.blue })).toEqual({ kind: 'identical' });
    const reRoled = {
      blue: S1.blue.map((a, i, all) => ({ ...a, role: all[(i + 1) % 5]?.role as Role })),
      red: S1.red,
    };
    expect(describeSwap(S1, reRoled)).toEqual({ kind: 'identical' });
  });

  it('aligns to the fewest moves: three-for-three one way is two-for-two the other', () => {
    const chosen = {
      blue: side('Hana:top', 'Iris:jungle', 'Karim:mid', 'Bilal:adc', 'Theo:support'),
      red: side('Omar:top', 'Rami:jungle', 'Nadia:mid', 'Lena:adc', 'Yuki:support'),
    };
    const next = {
      blue: side('Omar:top', 'Rami:jungle', 'Nadia:mid', 'Bilal:adc', 'Theo:support'),
      red: side('Hana:top', 'Iris:jungle', 'Karim:mid', 'Lena:adc', 'Yuki:support'),
    };
    // Bilal and Theo trading with Lena and Yuki is the same two teams, so 4 players move, not 6.
    expect(describeSwap(chosen, next)).toEqual({ kind: 'reshuffle', moved: 4 });
  });

  it('refuses two splits that are not the same ten players', () => {
    const other = {
      blue: S1.blue,
      red: [...S1.red.slice(0, 4), { puuid: 'puuid-zoe', role: 'support' as Role }],
    };
    expect(() => describeSwap(S1, other)).toThrow(
      'describeSwap: the two splits are not the same ten players',
    );
    const short = { blue: S1.blue.slice(0, 4), red: S1.red };
    expect(() => describeSwap(short, S1)).toThrow(
      'describeSwap: the two splits are not the same ten players',
    );
    const doubled = { blue: S1.blue, red: [...S1.red.slice(0, 4), S1.blue[0] as Assignment] };
    expect(() => describeSwap(doubled, doubled)).toThrow(
      'describeSwap: the two splits are not the same ten players',
    );
  });
});

describe('whyLower', () => {
  it('says off-role first, with how many more', () => {
    expect(whyLower({ gap: 100, offRoleCount: 0 }, { gap: 40, offRoleCount: 2 })).toEqual({
      kind: 'off-role',
      k: 2,
    });
  });

  it('says off-role even when the gap is also bigger', () => {
    expect(whyLower({ gap: 100, offRoleCount: 1 }, { gap: 300, offRoleCount: 2 })).toEqual({
      kind: 'off-role',
      k: 1,
    });
  });

  it('says gap when the off-role count is not higher, with both gaps', () => {
    expect(whyLower(S1, S2)).toEqual({ kind: 'gap', chosenGap: 100, nextGap: 170 });
    // Fewer off-role on the runner-up still falls through to the gap.
    expect(whyLower({ gap: 100, offRoleCount: 2 }, { gap: 101, offRoleCount: 0 })).toEqual({
      kind: 'gap',
      chosenGap: 100,
      nextGap: 101,
    });
  });

  it('says role costs when neither column explains it', () => {
    expect(whyLower({ gap: 100, offRoleCount: 1 }, { gap: 100, offRoleCount: 1 })).toEqual({
      kind: 'role-costs',
    });
    expect(whyLower({ gap: 100, offRoleCount: 1 }, { gap: 60, offRoleCount: 0 })).toEqual({
      kind: 'role-costs',
    });
  });
});

describe('oddsBand', () => {
  const table: [number, OddsBand][] = [
    [0.5, 'even'],
    [0.504, 'even'],
    [0.51, 'coin-flip'],
    [0.53, 'coin-flip'],
    [0.54, 'slight'],
    [0.57, 'slight'],
    [0.58, 'favored'],
    [0.62, 'favored'],
    [0.63, 'clear'],
    [1, 'clear'],
  ];

  it.each(table)('blue %s is %s', (p, band) => {
    expect(oddsBand(p)).toBe(band);
  });

  it.each(table)('red favored at blue 1 - %s is %s', (p, band) => {
    // Written as an integer percentage so 1 - 0.57 is exactly 43%, not 0.43000000000000005.
    expect(oddsBand((100 - Math.round(p * 1000) / 10) / 100)).toBe(band);
  });

  it('bands on the same rounded percentage the sentence prints', () => {
    // 0.505 rounds to 51% ("Blue favored 51%."); 0.495 rounds to 50% ("Even 50%."), and
    // 0.494 to 49% ("Red favored 51%.").
    expect(oddsBand(0.505)).toBe('coin-flip');
    expect(oddsBand(0.495)).toBe('even');
    expect(oddsBand(0.494)).toBe('coin-flip');
    expect(oddsBand(0.535)).toBe('slight');
    expect(oddsBand(0.534)).toBe('coin-flip');
    expect(oddsBand(0)).toBe('clear');
    // M18.2: the worked split is 56% now (was 54%), still 'slight'.
    expect(oddsBand(S1.blueWinProb)).toBe('slight');
  });

  it('throws outside [0, 1] and on NaN', () => {
    expect(() => oddsBand(-0.01)).toThrow('oddsBand: blueWinProb must be in [0, 1], got -0.01');
    expect(() => oddsBand(1.01)).toThrow('oddsBand: blueWinProb must be in [0, 1], got 1.01');
    expect(() => oddsBand(Number.NaN)).toThrow('oddsBand: blueWinProb must be in [0, 1], got NaN');
  });
});

describe('preGameOdds', () => {
  // M18.2: Kustom. Reads the stored `r_before` of the ten, through winProbability, and nothing else.
  const blue = ROSTER.slice(0, 5).map(({ r }) => ({ r }));
  const red = ROSTER.slice(5).map(({ r }) => ({ r }));
  const sum = (side: readonly { r: number }[]) => side.reduce((a, x) => a + x.r, 0);

  it('equals winProbability of the two Rating totals', () => {
    // Re-pinned in M18.2: was predictWin's 0.9297; blue 8364 against red 6926.4 is a 1437.6 gap.
    const p = preGameOdds(blue, red);
    expect(p).toBe(winProbability(sum(blue), sum(red)));
    expect(p).toBeCloseTo(1 / (1 + Math.exp(-1437.6 / 400)), 12);
    expect(p).toBeCloseTo(0.9732, 4);
  });

  it('passes the calib through', () => {
    const calib = { a: 0.1, b: 0.5 };
    expect(preGameOdds(blue, red, calib)).toBe(winProbability(sum(blue), sum(red), calib));
  });

  it('reproduces a stored split’s blueWinProb from the ratings going in', () => {
    const rating = (a: Assignment) => ({ r: (ROSTER.find((r) => r.puuid === a.puuid) as BalancePlayer).r });
    expect(preGameOdds(S1.blue.map(rating), S1.red.map(rating))).toBe(S1.blueWinProb);
  });

  it('is null when any of the ten has no finite r', () => {
    expect(preGameOdds([...blue.slice(0, 4), { r: null }], red)).toBeNull();
    expect(preGameOdds(blue, [...red.slice(0, 4), {}])).toBeNull();
    expect(preGameOdds(blue, [...red.slice(0, 4), { r: Number.NaN }])).toBeNull();
    expect(preGameOdds(blue, [...red.slice(0, 4), { r: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it('is null with fewer or more than five a side', () => {
    expect(preGameOdds(blue.slice(0, 4), red)).toBeNull();
    expect(preGameOdds(blue, red.slice(0, 4))).toBeNull();
    expect(preGameOdds([...blue, { r: 1500 }], red)).toBeNull();
    expect(preGameOdds([], [])).toBeNull();
  });
});

describe('calibration', () => {
  it('returns n 0 and no percentages for no games, without dividing by zero', () => {
    expect(calibration([])).toEqual({ n: 0, favoredWon: 0, expectedPct: null, actualPct: null });
  });

  it('skips exactly 0.5 and nothing else', () => {
    expect(calibration([{ blueWinProb: 0.5, blueWon: true }])).toEqual({
      n: 0,
      favoredWon: 0,
      expectedPct: null,
      actualPct: null,
    });
    // 0.502 prints "Even 50%." but the bot still leaned blue, so it counts.
    expect(calibration([{ blueWinProb: 0.502, blueWon: true }]).n).toBe(1);
  });

  it('counts the favored side from either colour and compares to the average favored probability', () => {
    const games = [
      { blueWinProb: 0.6, blueWon: true }, // blue favored, won
      { blueWinProb: 0.4, blueWon: false }, // red favored (60), won
      { blueWinProb: 0.55, blueWon: false }, // blue favored, lost
      { blueWinProb: 0.3, blueWon: true }, // red favored (70), lost
      { blueWinProb: 0.5, blueWon: true }, // skipped
    ];
    // Expected: mean(60, 60, 55, 70) = 61.25 -> 61. Actual: 2 of 4 = 50.
    expect(calibration(games)).toEqual({ n: 4, favoredWon: 2, expectedPct: 61, actualPct: 50 });
  });

  it('rounds both percentages to whole numbers, half up', () => {
    const games = [
      { blueWinProb: 0.6, blueWon: true },
      { blueWinProb: 0.6, blueWon: true },
      { blueWinProb: 0.57, blueWon: false },
      { blueWinProb: 0.57, blueWon: true },
      { blueWinProb: 0.6, blueWon: true },
      { blueWinProb: 0.6, blueWon: false },
      { blueWinProb: 0.6, blueWon: false },
      { blueWinProb: 0.6, blueWon: false },
    ];
    // Expected mean 59.25 -> 59; actual 4 of 8 = 50. Then 1 of 8 = 12.5 -> 13.
    expect(calibration(games)).toEqual({ n: 8, favoredWon: 4, expectedPct: 59, actualPct: 50 });
    const oneOfEight = games.map((g, i) => ({ ...g, blueWon: i === 0 }));
    expect(calibration(oneOfEight).actualPct).toBe(13);
  });

  it('throws on a probability outside [0, 1]', () => {
    expect(() => calibration([{ blueWinProb: 1.2, blueWon: true }])).toThrow(
      'calibration: blueWinProb must be in [0, 1], got 1.2',
    );
  });
});

describe('settling', () => {
  it('is ten games, one constant, read from config', () => {
    expect(SETTLING_GAMES).toBe(10);
    expect(config.rating.settlingGames).toBe(SETTLING_GAMES);
  });

  it('is settling under ten rated games and ranked from ten', () => {
    expect(isSettling(0)).toBe(true);
    expect(isSettling(9)).toBe(true);
    expect(isSettling(10)).toBe(false);
    expect(isSettling(83)).toBe(false);
  });

  it('throws on a count that is not a whole number of games', () => {
    expect(() => isSettling(-1)).toThrow('isSettling: ratedGames must be a whole number >= 0, got -1');
    expect(() => isSettling(2.5)).toThrow('isSettling: ratedGames must be a whole number >= 0, got 2.5');
    expect(() => isSettling(Number.NaN)).toThrow(
      'isSettling: ratedGames must be a whole number >= 0, got NaN',
    );
  });
});

describe('explain, through describeSwap', () => {
  it('keeps the old wording for an identical runner-up: 0 swaps', () => {
    // M18.2: 56% is winProbability at the worked gap 99.6 (was OpenSkill's 54%).
    expect(WORKED.explanations[0]).toBe(
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
    expect(explain(S1, { ...S1, blue: S1.red, red: S1.blue }, ROSTER)).toBe(
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: 0 swaps, gap 100.',
    );
  });

  it('refuses a runner-up from a different ten instead of printing a "?"', () => {
    const other = { ...S2, red: [...S2.red.slice(0, 4), { puuid: 'puuid-zoe', role: 'support' as Role }] };
    expect(() => explain(S1, other, ROSTER)).toThrow(
      'describeSwap: the two splits are not the same ten players',
    );
  });
});

describe('favoredSide', () => {
  // Blue's probability, then what blue's side and red's mirror (1 - p) must read.
  const table: [number, number][] = [
    [0.51, 51],
    [0.53, 53],
    [0.54, 54],
    [0.57, 57],
    [0.58, 58],
    [0.62, 62],
    [0.63, 63],
    [1, 100],
  ];

  it.each(table)('blue %s is Blue %s%%', (p, pct) => {
    expect(favoredSide(p)).toEqual({ side: 'blue', pct });
  });

  it.each(table)('blue 1 - %s is Red %s%%', (p, pct) => {
    expect(favoredSide((100 - Math.round(p * 1000) / 10) / 100)).toEqual({ side: 'red', pct });
  });

  it('is no side at a rounded 50, the sentence\'s "Even 50%."', () => {
    expect(favoredSide(0.5)).toEqual({ side: null, pct: 50 });
    expect(favoredSide(0.504)).toEqual({ side: null, pct: 50 });
    expect(favoredSide(0.495)).toEqual({ side: null, pct: 50 });
    expect(favoredSide(0.494)).toEqual({ side: 'red', pct: 51 });
    expect(favoredSide(0.505)).toEqual({ side: 'blue', pct: 51 });
    expect(favoredSide(0)).toEqual({ side: 'red', pct: 100 });
  });

  it('matches the sentence on the worked example', () => {
    // M18.2: 56%, winProbability at gap 99.6 (was OpenSkill's 54%).
    expect(favoredSide(S1.blueWinProb)).toEqual({ side: 'blue', pct: 56 });
    expect(WORKED.explanations[0]).toMatch(/^Blue favored 56%\./);
  });

  it('throws outside [0, 1] and on NaN', () => {
    expect(() => favoredSide(-0.01)).toThrow('favoredSide: blueWinProb must be in [0, 1], got -0.01');
    expect(() => favoredSide(1.01)).toThrow('favoredSide: blueWinProb must be in [0, 1], got 1.01');
    expect(() => favoredSide(Number.NaN)).toThrow('favoredSide: blueWinProb must be in [0, 1], got NaN');
  });
});
