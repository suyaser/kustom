import { describe, expect, it } from 'vitest';
import {
  BalanceError,
  type BalancePlayer,
  type BalanceResult,
  balance,
  config,
  explain,
  KUSTOM_START,
  nextSplit,
  ROLES,
  type Role,
  rateGameKustom,
  type Split,
  winProbability,
} from '../index';

/**
 * The worked example from docs/00-product.md and the M1.4 brief in docs/02-milestones.md.
 * Puuids are `puuid-<lowercase name>`, so sorting by puuid is alphabetical and Bilal is
 * index 0, hence always on blue.
 */
function player(
  name: string,
  r: number,
  mainRole: Role | null,
  secondaryRole: Role | null,
  n = 20,
): BalancePlayer {
  return { puuid: `puuid-${name.toLowerCase()}`, name, r, n, mainRole, secondaryRole };
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

/** A side written as `role: Name` in lane order, so a failing assertion reads like the doc table. */
function sideOf(side: readonly { puuid: string; role: Role }[]): Record<Role, string> {
  const out: Partial<Record<Role, string>> = {};
  for (const { puuid, role } of side) {
    const p = ROSTER.find((r) => r.puuid === puuid);
    out[role] = p?.name ?? puuid;
  }
  return out as Record<Role, string>;
}

function names(side: readonly { puuid: string }[]): string[] {
  return side.map(({ puuid }) => ROSTER.find((r) => r.puuid === puuid)?.name ?? puuid).sort();
}

/** Sum of the stored Ratings `r` of one side, as the fold will read them (not role-weighted). */
function totalOf(side: readonly { puuid: string }[], roster: readonly BalancePlayer[] = ROSTER): number {
  return side.reduce((sum, { puuid }) => sum + (roster.find((p) => p.puuid === puuid)?.r ?? Number.NaN), 0);
}

function withRoster(overrides: Partial<Record<string, Partial<BalancePlayer>>>): BalancePlayer[] {
  return ROSTER.map((p) => ({ ...p, ...overrides[p.name] }));
}

/** Split 1 of the worked example, in lane order. */
const SPLIT_1 = {
  blue: { top: 'Hana', jungle: 'Iris', mid: 'Karim', adc: 'Bilal', support: 'Theo' },
  red: { top: 'Omar', jungle: 'Rami', mid: 'Nadia', adc: 'Lena', support: 'Yuki' },
};
/** Split 2: swap Hana and Omar. */
const SPLIT_2 = {
  blue: { top: 'Omar', jungle: 'Iris', mid: 'Karim', adc: 'Bilal', support: 'Theo' },
  red: { top: 'Hana', jungle: 'Rami', mid: 'Nadia', adc: 'Lena', support: 'Yuki' },
};
/** Split 3: split 1 with both the top pair and the jungle pair swapped. */
const SPLIT_3 = {
  blue: { top: 'Hana', jungle: 'Rami', mid: 'Karim', adc: 'Bilal', support: 'Theo' },
  red: { top: 'Omar', jungle: 'Iris', mid: 'Nadia', adc: 'Lena', support: 'Yuki' },
};

function expectSplit(split: Split | undefined, expected: typeof SPLIT_1): void {
  if (split === undefined) throw new Error('missing split');
  expect(sideOf(split.blue)).toEqual(expected.blue);
  expect(sideOf(split.red)).toEqual(expected.red);
}

describe('config.balance', () => {
  it('pins the spec constants so a tuning change is a one-line diff with a test update', () => {
    // M18.13: a flat drop in Rating points replaced the 1.0 / 0.93 / 0.85 multipliers.
    expect(config.balance.roleDrop).toEqual({ main: 0, secondary: 84, fill: 180 });
    expect(config.balance.offRolePenalty).toBe(120);
    expect(config.balance.repeatSplitPenalty).toBe(200);
    expect(config.balance.fillProtectionFactor).toBe(1.0);
    expect(config.rating.displayMultiplier).toBe(60);
  });
});

describe('balance: the worked example', () => {
  const result = balance({ players: ROSTER, duos: [], lastSplit: null });

  it('returns three splits with gaps 100, 170, 220, everyone on a main role', () => {
    expect(result.splits).toHaveLength(3);
    expect(result.splits.map((s) => s.gap)).toEqual([100, 170, 220]);
    expect(result.splits.map((s) => s.offRoleCount)).toEqual([0, 0, 0]);
    // Score is the unrounded value that ordered the list, in Rating points. M18.2: Ratings now
    // arrive on the Rating scale (r = mu * 60 of the old roster), so scores, gaps and splits are unchanged.
    expect(result.splits[0]?.score).toBeCloseTo(99.6, 9);
    expect(result.splits[1]?.score).toBeCloseTo(170.4, 9);
    expect(result.splits[2]?.score).toBeCloseTo(219.6, 9);
  });

  it('has the exact rosters and roles from the tables', () => {
    expectSplit(result.splits[0], SPLIT_1);
    expectSplit(result.splits[1], SPLIT_2);
    expectSplit(result.splits[2], SPLIT_3);
  });

  it('lists each side in lane order, five a side', () => {
    for (const split of result.splits) {
      expect(split.blue.map((a) => a.role)).toEqual([...ROLES]);
      expect(split.red.map((a) => a.role)).toEqual([...ROLES]);
    }
  });

  it('puts the lowest puuid on blue in every split', () => {
    for (const split of result.splits) {
      expect(split.blue.some((a) => a.puuid === id('Bilal'))).toBe(true);
    }
  });

  it('computes blueWinProb with winProbability on the real Ratings (M18.2)', () => {
    // Re-pinned in M18.2: the OpenSkill values (0.5406, 0.5693, 0.5890) are gone; these are the
    // odds table's logistic(gap / 400) at the same three gaps, 99.6, 170.4, 219.6.
    expect(result.splits[0]?.blueWinProb).toBeCloseTo(0.56193, 5);
    expect(result.splits[1]?.blueWinProb).toBeCloseTo(0.604918, 5);
    expect(result.splits[2]?.blueWinProb).toBeCloseTo(0.633904, 5);
    for (const split of result.splits) {
      expect(split.blueWinProb).toBe(winProbability(totalOf(split.blue), totalOf(split.red)));
    }
  });

  it('produces the three explanation strings verbatim', () => {
    // Re-pinned in M18.2: 54/57/59 were OpenSkill's; 56/60/63 are winProbability at the same gaps.
    expect(result.explanations).toEqual([
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
      'Blue favored 60%. Everyone on a main role. Gap 170. Next best: 2 swaps, gap 220.',
      'Blue favored 63%. Everyone on a main role. Gap 220.',
    ]);
  });

  it('returns the same output for the same ten players in any order, field for field', () => {
    // A fixed reorder (no randomness in this package, tests included): reversed, then the
    // middle two swapped, so no player keeps their index.
    const shuffled = [...ROSTER].reverse();
    const a = shuffled[4];
    const b = shuffled[5];
    if (a === undefined || b === undefined) throw new Error('roster too short');
    shuffled[4] = b;
    shuffled[5] = a;
    const again = balance({ players: shuffled, duos: [], lastSplit: null });
    expect(again).toEqual(result);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it('treats absent duos and lastSplit like empty and null', () => {
    expect(balance({ players: ROSTER })).toEqual(result);
  });

  it('does not mutate its input', () => {
    const snapshot = structuredClone(ROSTER);
    balance({ players: ROSTER });
    expect(ROSTER).toEqual(snapshot);
  });
});

/**
 * M18.2: the balancer reads the stored all-time Kustom Rating the fold reads, and every win
 * chance it scores, stores or explains is `winProbability` of the two sides' Rating totals.
 */
describe('balance: Kustom Ratings (M18.2)', () => {
  /** Rosters that exercise main, secondary, fill, flexible, duos and the repeat penalty. */
  const ROSTERS: Record<
    string,
    { players: BalancePlayer[]; extra?: Partial<Parameters<typeof balance>[0]> }
  > = {
    worked: { players: [...ROSTER] },
    override: { players: withRoster({ Yuki: { roleOverride: 'top' } }) },
    flexible: { players: withRoster({ Yuki: { mainRole: null, secondaryRole: null } }) },
    oneJungle: { players: withRoster({ Rami: { mainRole: 'mid' } }) },
    duo: { players: [...ROSTER], extra: { duos: [[id('Hana'), id('Omar')]] } },
    repeat: {
      players: [...ROSTER],
      extra: { lastSplit: ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id) },
    },
  };

  it.each(Object.keys(ROSTERS))(
    '%s: every split’s blueWinProb is winProbability of the Rating totals',
    (key) => {
      const { players, extra } = ROSTERS[key] as (typeof ROSTERS)[string];
      const { splits } = balance({ players, ...extra });
      expect(splits.length).toBeGreaterThan(0);
      for (const split of splits) {
        expect(split.blueWinProb).toBe(
          winProbability(totalOf(split.blue, players), totalOf(split.red, players)),
        );
      }
    },
  );

  it('scores the gap on r − role drop, but the odds on the plain Ratings the fold reads', () => {
    // Yuki on top puts Omar on support at his backup: the role-adjusted gap is 116 (M18.13: 98
    // under 0.93; a flat 84 takes less off Omar's 1469.4 than 7% did), while the plain totals
    // differ by more. The odds must be the plain ones, or they could never equal fold_p.
    const players = withRoster({ Yuki: { roleOverride: 'top' } });
    const [first] = balance({ players }).splits;
    if (first === undefined) throw new Error('missing split');
    const blue = totalOf(first.blue, players);
    const red = totalOf(first.red, players);
    expect(first.gap).toBe(116);
    expect(Math.round(Math.abs(blue - red))).not.toBe(116);
    expect(first.blueWinProb).toBe(winProbability(blue, red));
  });

  it('equals the fold’s blue expected to 1e-9 for the same ten, unchanged since the roll', () => {
    // The fold (M18.5) calls rateGameKustom on the stored all-time r and n; with nobody's Rating
    // moved between the roll and the game, blue's expected is the split's stored chance.
    for (const { players, extra } of Object.values(ROSTERS)) {
      const { splits } = balance({ players, ...extra });
      for (const split of splits) {
        const seat = (side: 100 | 200) => (a: { puuid: string }) => {
          const p = players.find((x) => x.puuid === a.puuid) as BalancePlayer;
          return { puuid: p.puuid, side, r: p.r, n: p.n, score: null };
        };
        for (const winningSide of [100, 200] as const) {
          const rows = rateGameKustom({
            players: [...split.blue.map(seat(100)), ...split.red.map(seat(200))],
            winningSide,
          });
          for (const row of rows) {
            const p = row.side === 100 ? split.blueWinProb : 1 - split.blueWinProb;
            expect(Math.abs(row.expected - p)).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('passes the caller’s calib to winProbability, and calib never changes which splits win', () => {
    const calib = { a: 0, b: 0.5 };
    const plain = balance({ players: ROSTER });
    const tuned = balance({ players: ROSTER, calib });
    expect(tuned.splits.map(({ blueWinProb: _, ...rest }) => rest)).toEqual(
      plain.splits.map(({ blueWinProb: _, ...rest }) => rest),
    );
    for (const split of tuned.splits) {
      expect(split.blueWinProb).toBe(winProbability(totalOf(split.blue), totalOf(split.red), calib));
    }
    // b = 0.5 halves the logit: logistic(0.5 * 99.6 / 400).
    expect(tuned.splits[0]?.blueWinProb).toBeCloseTo(1 / (1 + Math.exp(-0.1245)), 12);
    expect(tuned.explanations[0]).toMatch(/^Blue favored 53%\./);
    // Absent calib is (0, 1), the plain formula.
    expect(balance({ players: ROSTER, calib: { a: 0, b: 1 } })).toEqual(plain);
  });

  it('a zero-game player is 1200, exactly as in the fold, and contributes 1200 to the totals', () => {
    expect(KUSTOM_START).toBe(1200);
    const players = withRoster({ Yuki: { r: KUSTOM_START, n: 0 } });
    const seatR = (a: { puuid: string }) =>
      a.puuid === id('Yuki') ? 1200 : (ROSTER.find((p) => p.puuid === a.puuid)?.r ?? Number.NaN);
    const sum = (side: readonly { puuid: string }[]) => side.reduce((s, a) => s + seatR(a), 0);
    for (const split of balance({ players }).splits) {
      expect(split.blueWinProb).toBe(winProbability(sum(split.blue), sum(split.red)));
    }
  });

  it('refuses a zero-game player at anything but 1200: there is no rank guess any more', () => {
    // A Diamond newcomer seeded from rank is exactly what the owner retired (2026-10-04).
    expect(() => balance({ players: withRoster({ Yuki: { r: 1560, n: 0 } }) })).toThrow(BalanceError);
    expect(() => balance({ players: withRoster({ Yuki: { r: 1560, n: 0 } }) })).toThrow(
      'Yuki has no rated games but a Rating of 1560; everyone starts at 1200.',
    );
    // A rank is not a balancer input at all.
    // @ts-expect-error `rank` is not a field of BalancePlayer (M18.2).
    const ranked: BalancePlayer = { ...player('Zed', 1200, 'mid', null, 0), rank: 'DIAMOND' };
    expect(ranked.r).toBe(1200);
  });

  it('refuses a Rating that is not a finite number and a game count that is not a whole number >= 0', () => {
    for (const r of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => balance({ players: withRoster({ Hana: { r } }) })).toThrow(
        `Hana has no usable Rating (${r}).`,
      );
    }
    for (const n of [-1, 2.5, Number.NaN]) {
      expect(() => balance({ players: withRoster({ Hana: { n } }) })).toThrow(
        `Hana has an unusable rated-game count (${n}).`,
      );
    }
  });
});

describe('balance: duos', () => {
  it('keeps Hana and Lena together in every split, and split 1 becomes the base split 2', () => {
    const { splits } = balance({ players: ROSTER, duos: [[id('Hana'), id('Lena')]] });
    expect(splits.length).toBeGreaterThan(0);
    for (const split of splits) {
      const blue = split.blue.map((a) => a.puuid);
      const hanaBlue = blue.includes(id('Hana'));
      const lenaBlue = blue.includes(id('Lena'));
      expect(hanaBlue).toBe(lenaBlue);
    }
    expectSplit(splits[0], SPLIT_2);
    expect(splits[0]?.gap).toBe(170);
    expect(splits[0]?.offRoleCount).toBe(0);
  });

  it('locking the two top mains together forces someone off-role: gap 32, 2 off-role', () => {
    const { splits } = balance({ players: ROSTER, duos: [[id('Hana'), id('Omar')]] });
    const first = splits[0];
    if (first === undefined) throw new Error('missing split');
    // M18.13: gap 26 -> 32, the same two teams with flat drops instead of 0.93 / 0.85.
    expect(first.gap).toBe(32);
    expect(first.offRoleCount).toBe(2);
    const all = [...first.blue, ...first.red];
    expect(all.find((a) => a.puuid === id('Hana'))?.role).toBe('mid');
    // M18.13: red's top fill is Karim (1551), no longer Nadia (1266). Both are mid mains with no
    // top backup, so under a flat drop the seat costs them the same and the stable order picks;
    // under 0.85 the weaker Nadia was always the cheaper fill.
    expect(all.find((a) => a.puuid === id('Karim'))?.role).toBe('top');
    expect(all.find((a) => a.puuid === id('Nadia'))?.role).toBe('mid');
  });

  it('accepts a duo given in either order and a duo chain as one block', () => {
    const a = balance({ players: ROSTER, duos: [[id('Hana'), id('Lena')]] });
    const b = balance({ players: ROSTER, duos: [[id('Lena'), id('Hana')]] });
    expect(b).toEqual(a);
    const chain = balance({
      players: ROSTER,
      duos: [
        [id('Hana'), id('Lena')],
        [id('Lena'), id('Yuki')],
      ],
    });
    for (const split of chain.splits) {
      const blue = split.blue.map((x) => x.puuid);
      const flags = [id('Hana'), id('Lena'), id('Yuki')].map((p) => blue.includes(p));
      expect(new Set(flags).size).toBe(1);
    }
  });

  it('throws when the duo blocks cannot be packed five and five, naming the blocks', () => {
    // Blocks of 4 (Bilal, Hana, Iris, Karim), 4 (Lena, Nadia, Omar, Rami) and 2 (Theo, Yuki).
    const duos: [string, string][] = [
      [id('Bilal'), id('Hana')],
      [id('Hana'), id('Iris')],
      [id('Iris'), id('Karim')],
      [id('Lena'), id('Nadia')],
      [id('Nadia'), id('Omar')],
      [id('Omar'), id('Rami')],
      [id('Theo'), id('Yuki')],
    ];
    expect(() => balance({ players: ROSTER, duos })).toThrow(BalanceError);
    expect(() => balance({ players: ROSTER, duos })).toThrow(
      'Duo locks cannot fit five and five: Bilal, Hana, Iris, Karim; Lena, Nadia, Omar, Rami; Theo, Yuki.',
    );
  });

  it('throws when a single block is larger than five', () => {
    const six = ['Bilal', 'Hana', 'Iris', 'Karim', 'Lena', 'Nadia'].map(id);
    const duos: [string, string][] = [];
    for (let i = 1; i < six.length; i += 1) {
      const a = six[i - 1];
      const b = six[i];
      if (a !== undefined && b !== undefined) duos.push([a, b]);
    }
    expect(() => balance({ players: ROSTER, duos })).toThrow(
      'Duo locks cannot fit five and five: Bilal, Hana, Iris, Karim, Lena, Nadia.',
    );
  });

  it('returns fewer than three splits when duo locks leave fewer, and drops the next-best clause', () => {
    // Two blocks of five: exactly one legal partition.
    const blue = ['Bilal', 'Hana', 'Iris', 'Karim', 'Theo'].map(id);
    const red = ['Lena', 'Nadia', 'Omar', 'Rami', 'Yuki'].map(id);
    const chain = (ids: string[]): [string, string][] =>
      ids.slice(1).map((p, i) => [ids[i] ?? p, p] as [string, string]);
    const { splits, explanations } = balance({ players: ROSTER, duos: [...chain(blue), ...chain(red)] });
    expect(splits).toHaveLength(1);
    expectSplit(splits[0], SPLIT_1);
    // M18.2: 56%, winProbability at gap 99.6 (was OpenSkill's 54%).
    expect(explanations).toEqual(['Blue favored 56%. Everyone on a main role. Gap 100.']);
  });

  it('throws when a duo names someone not in the lobby or names the same player twice', () => {
    expect(() => balance({ players: ROSTER, duos: [[id('Hana'), 'puuid-zed']] })).toThrow(
      'Duo names someone not in the lobby: puuid-zed.',
    );
    expect(() => balance({ players: ROSTER, duos: [[id('Hana'), id('Hana')]] })).toThrow(BalanceError);
    expect(() => balance({ players: ROSTER, duos: [[id('Hana'), id('Hana')]] })).toThrow(/twice/);
  });
});

describe('balance: repeat-split penalty', () => {
  const lastBlue = ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id);
  const lastRed = ['Omar', 'Rami', 'Nadia', 'Lena', 'Yuki'].map(id);

  it("pushes last night's teams out of first place: split 1 becomes the base split 2", () => {
    const { splits } = balance({ players: ROSTER, lastSplit: lastBlue });
    expectSplit(splits[0], SPLIT_2);
    expect(splits[0]?.gap).toBe(170);
    expectSplit(splits[1], SPLIT_3);
    expect(splits[1]?.gap).toBe(220);
    // Brief: the base split 1 now scores 99.6 + 200 = 299.6 and falls to fourth behind an
    // off-role split scoring 249.6 (M18.13: 244.92 under the multipliers; flat drops, gap 5 -> 10).
    expect(splits[2]?.offRoleCount).toBe(2);
    expect(splits[2]?.score).toBeCloseTo(249.6, 6);
  });

  it('ignores side colour: passing the red five gives the same result', () => {
    const fromBlue = balance({ players: ROSTER, lastSplit: lastBlue });
    const fromRed = balance({ players: ROSTER, lastSplit: lastRed });
    expect(fromRed).toEqual(fromBlue);
    const shuffledLast = [...lastRed].reverse();
    expect(balance({ players: ROSTER, lastSplit: shuffledLast })).toEqual(fromBlue);
  });

  it("adds exactly 200 to the repeated split's score", () => {
    const base = balance({ players: ROSTER });
    const penalised = balance({ players: ROSTER, lastSplit: lastBlue });
    const repeated = penalised.splits.find(
      (s) => names(s.blue).join() === names(base.splits[0]?.blue ?? []).join(),
    );
    // The repeated split is fourth, so it is not returned; the top three must all be others.
    expect(repeated).toBeUndefined();
    const baseSecond = base.splits[1];
    const nowFirst = penalised.splits[0];
    if (baseSecond === undefined || nowFirst === undefined) throw new Error('missing split');
    expect(nowFirst.score).toBe(baseSecond.score);
  });

  it('throws when lastSplit is not five players from the lobby', () => {
    expect(() => balance({ players: ROSTER, lastSplit: lastBlue.slice(0, 4) })).toThrow(BalanceError);
    expect(() => balance({ players: ROSTER, lastSplit: [...lastBlue, id('Omar')] })).toThrow(BalanceError);
    expect(() => balance({ players: ROSTER, lastSplit: [...lastBlue.slice(0, 4), 'puuid-zed'] })).toThrow(
      BalanceError,
    );
    expect(() => balance({ players: ROSTER, lastSplit: [...lastBlue.slice(0, 4), id('Hana')] })).toThrow(
      BalanceError,
    );
  });
});

describe('balance: role edge cases', () => {
  it('roleOverride: Yuki on top makes the override her main and support her backup', () => {
    const { splits, explanations } = balance({
      players: withRoster({ Yuki: { roleOverride: 'top' } }),
    });
    const first = splits[0];
    if (first === undefined) throw new Error('missing split');
    // M18.13: the same split; gap 98 -> 116 (Omar's backup seat drops a flat 84, not 7%).
    expect(first.gap).toBe(116);
    expect(first.offRoleCount).toBe(1);
    expect(sideOf(first.red).top).toBe('Yuki');
    expect(sideOf(first.blue).support).toBe('Omar');
    // M18.2: 62% is winProbability of the plain Rating totals (Omar's backup seat weighs on the
    // gap, not the odds the fold will use); OpenSkill said 58%. M18.13: the next best is the
    // old third split (gap 5 -> 10), which now edges the old second (gap 4 -> 16).
    expect(explanations[0]).toBe(
      'Blue favored 62%. Omar off-role at support. Gap 116. Next best: 2 swaps, gap 10 with 2 off-role.',
    );
  });

  it('roleOverride equal to the existing main is a no-op', () => {
    const base = balance({ players: ROSTER });
    const same = balance({ players: withRoster({ Hana: { roleOverride: 'top' } }) });
    expect(same).toEqual(base);
    const asNull = balance({ players: withRoster({ Hana: { roleOverride: null } }) });
    expect(asNull).toEqual(base);
  });

  it('a player with no main role is flexible: any role, never counted off-role', () => {
    // Nine support mains with no backup and one flexible player. Each team keeps one support
    // on support; the flexible player takes a lane at full strength and is never off-role, so
    // every split is 3 + 4 = 7 off-role. Counting the flexible player would make it 8.
    const players: BalancePlayer[] = ROSTER.map((p) => ({
      ...p,
      mainRole: p.name === 'Yuki' ? null : 'support',
      secondaryRole: null,
    }));
    const { splits, explanations } = balance({ players });
    for (const split of splits) {
      expect(split.offRoleCount).toBe(7);
      const yuki = [...split.blue, ...split.red].find((a) => a.puuid === id('Yuki'));
      expect(yuki?.role).not.toBe('support');
    }
    for (const line of explanations) {
      expect(line).not.toContain('Yuki');
      expect(line).toContain('7 off-role:');
    }
  });

  it('a flexible player is dropped into whichever role a split needs, at full strength', () => {
    // Worked example with Yuki flexible. Every split's offRoleCount must equal a by-hand count
    // that skips Yuki, whatever role Yuki lands in.
    const players = withRoster({ Yuki: { mainRole: null, secondaryRole: null } });
    const { splits } = balance({ players });
    expect(splits).toHaveLength(3);
    for (const split of splits) {
      const byHand = [...split.blue, ...split.red].filter(({ puuid, role }) => {
        if (puuid === id('Yuki')) return false;
        return ROSTER.find((p) => p.puuid === puuid)?.mainRole !== role;
      }).length;
      expect(split.offRoleCount).toBe(byHand);
    }
    // M18.13: all three are the base splits now. The override test's split, with Yuki on top
    // and Omar at his backup, scored 217.5 under 0.93 and beat the base split 3 (219.6); with
    // the flat drop it scores 236.4 and falls to fourth.
    expect(splits.map((sp) => sp.gap)).toEqual([100, 170, 220]);
    expect(splits.map((sp) => sp.offRoleCount)).toEqual([0, 0, 0]);
    expect(sideOf(splits[2]?.red ?? []).support).toBe('Yuki');
  });

  it('a main with no secondary is fill (−180) and off-role everywhere else', () => {
    // Ten identical top mains, Rating 1500, no backups. Each team: one on top at
    // 1500, four fill at 1320; sums are equal, so gap 0 and score = 8 * 120 = 960.
    const tops: BalancePlayer[] = ROSTER.map((p) => ({
      ...p,
      r: 1500,
      mainRole: 'top',
      secondaryRole: null,
    }));
    const all = balance({ players: tops });
    expect(all.splits[0]?.gap).toBe(0);
    expect(all.splits[0]?.offRoleCount).toBe(8);
    expect(all.splits[0]?.score).toBe(960);
    expect(all.explanations[0]?.startsWith('Even 50%. 8 off-role: ')).toBe(true);
    // Give one player a mid backup: they play mid at 1500 − 84 (1416, +96 over fill; M18.13,
    // was 1395 and +120 under 0.93), still off-role, so every split has gap 96 and score 1056.
    const oneBackup = tops.map((p) => (p.name === 'Hana' ? { ...p, secondaryRole: 'mid' as const } : p));
    const some = balance({ players: oneBackup });
    expect(some.splits[0]?.gap).toBe(96);
    expect(some.splits[0]?.offRoleCount).toBe(8);
    expect(some.splits[0]?.score).toBe(1056);
    const hana = [...(some.splits[0]?.blue ?? []), ...(some.splits[0]?.red ?? [])].find(
      (a) => a.puuid === id('Hana'),
    );
    expect(hana?.role).toBe('mid');
  });
});

/**
 * M7.5 fill protection. `cost(player) = offRolePenalty * (1 + fillProtectionFactor /
 * (gamesSinceLastFill + 1))`, factor 1.0: 240 for somebody filled last game, 180 one game
 * later, 150 after three, 132 after nine, decaying to the flat 120. `null` is the baseline
 * every other test in this file pins.
 */
describe('balance: fill protection', () => {
  /** Set `gamesSinceLastFill` by name; everybody unnamed stays `null`. */
  function withFill(
    players: readonly BalancePlayer[],
    fills: Readonly<Record<string, number | null>>,
  ): BalancePlayer[] {
    return players.map((p) => ({ ...p, gamesSinceLastFill: fills[p.name] ?? null }));
  }

  /** Ten identical top mains with no backup: every split is gap 0 with eight fills. */
  const TOPS: BalancePlayer[] = ROSTER.map((p) => ({
    ...p,
    r: 1500,
    mainRole: 'top' as const,
    secondaryRole: null,
  }));

  /**
   * Ten identical players, two mains per role except one mid and three supports. The cheapest
   * splits put one fill on each side (a lone fill would hand the other team a 180-point gap;
   * 225 under the old 0.85, M18.13), so who gets filled is a free choice between equals.
   */
  const FILL_CHOICE: BalancePlayer[] = (
    [
      ['Bilal', 'top'],
      ['Hana', 'top'],
      ['Iris', 'jungle'],
      ['Karim', 'jungle'],
      ['Lena', 'mid'],
      ['Nadia', 'adc'],
      ['Omar', 'adc'],
      ['Rami', 'support'],
      ['Theo', 'support'],
      ['Yuki', 'support'],
    ] satisfies [string, Role][]
  ).map(([name, role]) => player(name, 1500, role, null));

  /**
   * The worked example with Rami moved to mid, so Iris is the only jungle main in the lobby.
   * Both teams need a jungler: Iris covers one and somebody has to be filled into the other,
   * however recently they were filled. A soft cost, never a block.
   */
  const ONE_JUNGLE: BalancePlayer[] = withRoster({ Rami: { mainRole: 'mid' } });

  /** `{ role: Name }` for both sides of a split, so two splits can be compared as rosters. */
  const rosterOf = (split: Split | undefined): unknown => {
    if (split === undefined) throw new Error('missing split');
    return { blue: sideOf(split.blue), red: sideOf(split.red), gap: split.gap, off: split.offRoleCount };
  };

  const offRoleNames = (split: Split | undefined, players: readonly BalancePlayer[]): string[] => {
    if (split === undefined) throw new Error('missing split');
    return [...split.blue, ...split.red]
      .filter(({ puuid, role }) => {
        const p = players.find((x) => x.puuid === puuid);
        return p !== undefined && p.mainRole !== null && p.mainRole !== role;
      })
      .map(({ puuid }) => players.find((x) => x.puuid === puuid)?.name ?? puuid)
      .sort();
  };

  it('acceptance 1: null everywhere is the baseline, and the worked example does not move', () => {
    const base = balance({ players: ROSTER });
    const nulls = balance({ players: withFill(ROSTER, {}) });
    expect(nulls).toEqual(base);
    expect(nulls.splits.map((s) => s.gap)).toEqual([100, 170, 220]);
    expect(nulls.splits.map((s) => s.offRoleCount)).toEqual([0, 0, 0]);
    expect(nulls.splits[0]?.score).toBeCloseTo(99.6, 9);
    expect(nulls.explanations).toEqual([
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
      'Blue favored 60%. Everyone on a main role. Gap 170. Next best: 2 swaps, gap 220.',
      'Blue favored 63%. Everyone on a main role. Gap 220.',
    ]);
    // Nobody is off-role in the worked example, so a filled player there costs nothing either.
    expect(balance({ players: withFill(ROSTER, { Hana: 0, Yuki: 0 }) })).toEqual(base);
  });

  it('acceptance 3: one fill costs 240, then 180, 150, 132, decaying to the flat 120', () => {
    // Ten identical top mains: gap 0, eight fills, so score / 8 is one seat's price.
    const priceAt = (games: number | null): number => {
      const players = TOPS.map((p) => ({ ...p, gamesSinceLastFill: games }));
      const first = balance({ players }).splits[0];
      if (first === undefined) throw new Error('missing split');
      expect(first.gap).toBe(0);
      expect(first.offRoleCount).toBe(8);
      return first.score / 8;
    };
    expect(priceAt(0)).toBeCloseTo(240, 9);
    expect(priceAt(1)).toBeCloseTo(180, 9);
    expect(priceAt(3)).toBeCloseTo(150, 9);
    expect(priceAt(9)).toBeCloseTo(132, 9);
    expect(priceAt(null)).toBe(120);
  });

  it('acceptance 3: at a large gamesSinceLastFill the chosen splits equal the null case', () => {
    const far = balance({ players: TOPS.map((p) => ({ ...p, gamesSinceLastFill: 1_000_000 })) });
    const none = balance({ players: TOPS });
    expect(far.splits.map(rosterOf)).toEqual(none.splits.map(rosterOf));
    expect(far.explanations).toEqual(none.explanations);
    expect(far.splits[0]?.score).toBeCloseTo(960, 2);
  });

  it('acceptance 2: fills the player who was not filled last game, given equal alternatives', () => {
    const base = balance({ players: FILL_CHOICE });
    const first = base.splits[0];
    if (first === undefined) throw new Error('missing split');
    expect(first.gap).toBe(0);
    expect(first.score).toBe(240);
    expect(offRoleNames(first, FILL_CHOICE)).toEqual(['Hana', 'Theo']);

    // Hana was filled last night. Bilal, her equal, takes the seat instead, at the same price.
    const protectedRun = balance({ players: withFill(FILL_CHOICE, { Hana: 0 }) });
    const chosen = protectedRun.splits[0];
    if (chosen === undefined) throw new Error('missing split');
    expect(offRoleNames(chosen, FILL_CHOICE)).toEqual(['Bilal', 'Theo']);
    expect(sideOf(chosen.blue)).toEqual({
      top: 'Hana',
      jungle: 'Iris',
      mid: 'Bilal',
      adc: 'Nadia',
      support: 'Rami',
    });
    expect(sideOf(chosen.red)).toEqual({
      top: 'Theo',
      jungle: 'Karim',
      mid: 'Lena',
      adc: 'Omar',
      support: 'Yuki',
    });
    expect(chosen.gap).toBe(0);
    expect(chosen.offRoleCount).toBe(2);
    expect(chosen.score).toBe(240);
    expect(protectedRun.explanations[0]).toBe(
      'Even 50%. 2 off-role: Bilal at mid, Theo at top. Gap 0. Next best: swap Rami and Theo, gap 0.',
    );
  });

  it('scales both places: the seat price inside a team, not only the split score', () => {
    // Duo locks leave exactly one partition, so the split score cannot choose anything — only
    // `assignRoles` can. Ten identical top mains: one per side plays top, four are filled.
    const chain = (ids: string[]): [string, string][] =>
      ids.slice(1).map((p, i) => [ids[i] ?? p, p] as [string, string]);
    const duos: [string, string][] = [
      ...chain(['Bilal', 'Hana', 'Iris', 'Karim', 'Theo'].map(id)),
      ...chain(['Lena', 'Nadia', 'Omar', 'Rami', 'Yuki'].map(id)),
    ];
    const base = balance({ players: TOPS, duos });
    expect(base.splits).toHaveLength(1);
    expect(sideOf(base.splits[0]?.blue ?? []).top).toBe('Bilal');
    expect(sideOf(base.splits[0]?.red ?? []).top).toBe('Lena');

    // Hana and Nadia were filled last game: each side's one main seat goes to them instead.
    const run = balance({ players: withFill(TOPS, { Hana: 0, Nadia: 0 }), duos });
    expect(run.splits).toHaveLength(1);
    const only = run.splits[0];
    if (only === undefined) throw new Error('missing split');
    expect(sideOf(only.blue).top).toBe('Hana');
    expect(sideOf(only.red).top).toBe('Nadia');
    // Eight fills either way, none of them protected, so the split still scores 8 * 120.
    expect(only.offRoleCount).toBe(8);
    expect(only.score).toBe(960);
    expect(only.gap).toBe(0);
  });

  it('acceptance 4: an unavoidable fill still happens, at maximum protection', () => {
    const allFilled = ONE_JUNGLE.map((p) => ({ ...p, gamesSinceLastFill: 0 }));
    const { splits, explanations } = balance({ players: allFilled });
    expect(splits).toHaveLength(3);
    for (const split of splits) {
      // Iris keeps the jungle seat she mains; the other side's jungler is a fill, and counted.
      const seats = [...split.blue, ...split.red];
      expect(seats.find((a) => a.puuid === id('Iris'))?.role).toBe('jungle');
      const otherJungler = seats.filter((a) => a.role === 'jungle').find((a) => a.puuid !== id('Iris'));
      expect(otherJungler).toBeDefined();
      const filled = offRoleNames(split, ONE_JUNGLE);
      expect(split.offRoleCount).toBe(filled.length);
      expect(split.offRoleCount).toBeGreaterThanOrEqual(1);
      const name = ONE_JUNGLE.find((p) => p.puuid === otherJungler?.puuid)?.name ?? '';
      expect(filled).toContain(name);
    }
    expect(explanations[0]).toMatch(/off-role at jungle\.|off-role: .*at jungle/);
    // Exactly one fill, priced at the maximum: score is the gap plus 240.
    const first = splits[0];
    if (first === undefined) throw new Error('missing split');
    expect(first.offRoleCount).toBe(1);
    expect(Math.abs(first.score - 240 - first.gap)).toBeLessThanOrEqual(0.5);
    // In *this* lobby protecting everybody moves nobody: one fill before, one fill after. That
    // is a fact about these ten and not a guarantee of factor 1.0 — splits differ in raw gap as
    // well as in fill cost, so protection can and does land on a split with a different
    // offRoleCount in about 1.35% of random lobbies. Do not generalise this line.
    expect(first.offRoleCount).toBe(balance({ players: ONE_JUNGLE }).splits[0]?.offRoleCount);
  });

  it('acceptance 5: a flexible player’s gamesSinceLastFill changes nothing', () => {
    const flexible = withRoster({ Yuki: { mainRole: null, secondaryRole: null } });
    const base = balance({ players: flexible });
    for (const games of [0, 1, 7, null]) {
      const run = balance({ players: withFill(flexible, { Yuki: games }) });
      expect(run).toEqual(base);
    }
    // And in a lobby where the flexible player is the one holding the night together.
    const nineSupports: BalancePlayer[] = ROSTER.map((p) => ({
      ...p,
      mainRole: p.name === 'Yuki' ? null : ('support' as const),
      secondaryRole: null,
    }));
    expect(balance({ players: withFill(nineSupports, { Yuki: 0 }) })).toEqual(
      balance({ players: nineSupports }),
    );
  });

  it('acceptance 6: the explanation string keeps its shape and wording', () => {
    const run = balance({ players: withFill(FILL_CHOICE, { Hana: 0 }) });
    for (const line of run.explanations) {
      expect(line).toMatch(/^Even 50%\. 2 off-role: \w+ at \w+, \w+ at \w+\. Gap 0\.( Next best: .+\.)?$/);
    }
    expect(run.explanations[0]).not.toContain('fill');
    expect(run.explanations[0]).not.toContain('protect');
  });

  it('treats a negative gamesSinceLastFill as 0 and an unreadable one as no history', () => {
    const maxProtection = balance({ players: TOPS.map((p) => ({ ...p, gamesSinceLastFill: 0 })) });
    expect(balance({ players: TOPS.map((p) => ({ ...p, gamesSinceLastFill: -5 })) })).toEqual(maxProtection);
    const baseline = balance({ players: TOPS });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(balance({ players: TOPS.map((p) => ({ ...p, gamesSinceLastFill: bad })) })).toEqual(baseline);
    }
  });

  it('stays deterministic: the same ten in another order give identical output', () => {
    const players = withFill(FILL_CHOICE, { Hana: 0, Theo: 2, Yuki: 9 });
    const once = balance({ players });
    const again = balance({ players: [...players].reverse() });
    expect(again).toEqual(once);
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
  });

  it('prices the seat and the split the same way: the score is the sum of its fills', () => {
    // Two fills, one protected at 0 (240) and one with no history (120), so the chosen split
    // scores 360 and never the 240 an unscaled split score would report.
    const run = balance({ players: withFill(FILL_CHOICE, { Hana: 0, Theo: 0, Yuki: 0, Rami: 0 }) });
    const first = run.splits[0];
    if (first === undefined) throw new Error('missing split');
    const filled = offRoleNames(first, FILL_CHOICE);
    const price = (name: string): number => (['Hana', 'Theo', 'Yuki', 'Rami'].includes(name) ? 240 : 120);
    expect(first.score).toBeCloseTo(first.gap + filled.reduce((a, n) => a + price(n), 0), 6);
    expect(filled).toEqual(['Bilal', 'Theo']);
    expect(first.score).toBe(360);
  });
});

describe('balance: ties', () => {
  it('breaks a full tie by the lexicographically smallest sorted blue puuids', () => {
    // Ten identical players: all 126 partitions score the same, so blue is the five lowest
    // puuids, then the next candidate swaps only the largest of them for the next puuid up.
    const same: BalancePlayer[] = ROSTER.map((p) => ({
      ...p,
      r: 1500,
      mainRole: null,
      secondaryRole: null,
    }));
    const { splits } = balance({ players: same });
    expect(splits.map((sp) => names(sp.blue))).toEqual([
      ['Bilal', 'Hana', 'Iris', 'Karim', 'Lena'],
      ['Bilal', 'Hana', 'Iris', 'Karim', 'Nadia'],
      ['Bilal', 'Hana', 'Iris', 'Karim', 'Omar'],
    ]);
    for (const sp of splits) {
      expect(sp.score).toBe(0);
      expect(sp.offRoleCount).toBe(0);
    }
  });

  it('with the two top mains locked together, splits 2 and 3 tie on score and are ordered by blue puuids', () => {
    const { splits } = balance({ players: ROSTER, duos: [[id('Hana'), id('Omar')]] });
    const [, second, third] = splits;
    if (second === undefined || third === undefined) throw new Error('missing split');
    expect(second.score).toBeCloseTo(third.score, 9);
    expect(second.offRoleCount).toBe(third.offRoleCount);
    const key = (sp: Split): string =>
      sp.blue
        .map((a) => a.puuid)
        .sort()
        .join(',');
    expect(key(second) < key(third)).toBe(true);
  });
});

describe('balance: errors', () => {
  it('throws for nine players', () => {
    expect(() => balance({ players: ROSTER.slice(0, 9) })).toThrow(BalanceError);
    expect(() => balance({ players: ROSTER.slice(0, 9) })).toThrow(
      'Balancing needs exactly ten players, got 9.',
    );
  });

  it('throws for eleven players', () => {
    const eleven = [...ROSTER, player('Zed', 1500, 'mid', null)];
    expect(() => balance({ players: eleven })).toThrow('Balancing needs exactly ten players, got 11.');
  });

  it('throws for duplicate puuids', () => {
    const dup = [...ROSTER.slice(0, 9), { ...player('Yuki', 1134, 'support', 'top'), puuid: id('Hana') }];
    expect(() => balance({ players: dup })).toThrow(BalanceError);
    expect(() => balance({ players: dup })).toThrow('Duplicate player: puuid-hana.');
  });

  it('BalanceError is an Error with its own name', () => {
    const err = new BalanceError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BalanceError');
    expect(err.message).toBe('x');
  });
});

describe('nextSplit', () => {
  const { splits } = balance({ players: ROSTER });

  it('walks 0 to 1 to 2 and then throws', () => {
    expect(nextSplit(splits, 0)).toBe(1);
    expect(nextSplit(splits, 1)).toBe(2);
    expect(() => nextSplit(splits, 2)).toThrow(BalanceError);
    expect(() => nextSplit(splits, 2)).toThrow('No more splits. Rebalance or play these.');
  });

  it('is a pure index step: the same call twice gives the same answer', () => {
    expect(nextSplit(splits, 1)).toBe(nextSplit(splits, 1));
    expect(() => nextSplit([], 0)).toThrow(BalanceError);
  });
});

describe('explain', () => {
  const result: BalanceResult = balance({ players: ROSTER });

  it('is the function balance used for its explanations', () => {
    const [s0, s1, s2] = result.splits;
    if (s0 === undefined || s1 === undefined || s2 === undefined) throw new Error('missing split');
    expect(explain(s0, s1, ROSTER)).toBe(result.explanations[0]);
    expect(explain(s1, s2, ROSTER)).toBe(result.explanations[1]);
    expect(explain(s2, null, ROSTER)).toBe(result.explanations[2]);
  });

  it('says Red favored and Even at the boundaries', () => {
    const s0 = result.splits[0];
    if (s0 === undefined) throw new Error('missing split');
    expect(explain({ ...s0, blueWinProb: 0.42 }, null, ROSTER)).toBe(
      'Red favored 58%. Everyone on a main role. Gap 100.',
    );
    expect(explain({ ...s0, blueWinProb: 0.5 }, null, ROSTER)).toBe(
      'Even 50%. Everyone on a main role. Gap 100.',
    );
    expect(explain({ ...s0, blueWinProb: 0.504 }, null, ROSTER)).toBe(
      'Even 50%. Everyone on a main role. Gap 100.',
    );
  });

  it('aligns the next split by the side that overlaps blue more', () => {
    const s0 = result.splits[0];
    const s1 = result.splits[1];
    if (s0 === undefined || s1 === undefined) throw new Error('missing split');
    // The same next split with its colours swapped must read identically.
    const mirrored: Split = { ...s1, blue: s1.red, red: s1.blue };
    expect(explain(s0, mirrored, ROSTER)).toBe(explain(s0, s1, ROSTER));
  });

  it('uses names as given and never deduplicates', () => {
    const twins = withRoster({ Hana: { name: 'Sam' }, Omar: { name: 'Sam' } });
    const { explanations } = balance({ players: twins });
    // M18.2: 56%, the worked example's winProbability (was OpenSkill's 54%).
    expect(explanations[0]).toBe(
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Sam and Sam, gap 170.',
    );
  });
});

describe('performance', () => {
  it('balances ten players in under 100 ms', () => {
    const start = performance.now();
    balance({ players: ROSTER, lastSplit: ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id) });
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('stays under 100 ms with fill protection on all ten', () => {
    const players = ROSTER.map((p, i) => ({ ...p, gamesSinceLastFill: i % 4 }));
    const start = performance.now();
    balance({ players, lastSplit: ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id) });
    expect(performance.now() - start).toBeLessThan(100);
  });
});
