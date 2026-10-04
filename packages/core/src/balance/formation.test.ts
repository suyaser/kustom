/**
 * M18.13 (owner-approved 2026-10-04): the two phase-1 team-formation terms of
 * `redesign/research/team-formation.md` §5 and the per-term score parts a split stores.
 *
 * - (A) A fill cost that does not depend on rating: strength on a role is `r − roleDrop[tier]`,
 *   not `r × multiplier`, so a 1400 player and a 1100 player lose the same points when filled
 *   and the cheapest fill is no longer "whoever is weakest".
 * - (B) Teammate variety: `min(100, 25 × repeated teammate pairs)` added to the split score, the
 *   pairs computed by the caller from the night's previous game (core stays pure). M18.14: only
 *   the pairs beyond the fewest any split of the lobby must keep are charged.
 * - `scoreParts`: every term of the score, so `splits.score_parts` can be stored and the
 *   receipt's `whyLower` can name the term that cost the runner-up its place.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type BalancePlayer,
  balance,
  config,
  type Duo,
  ROLES,
  type Role,
  type ScoreParts,
  type Split,
  type WhyLower,
  type WhyLowerScored,
  whyLower,
  winProbability,
} from '../index';

function player(name: string, r: number, mainRole: Role | null, secondaryRole: Role | null): BalancePlayer {
  return { puuid: `puuid-${name.toLowerCase()}`, name, r, n: 20, mainRole, secondaryRole };
}

const id = (name: string): string => `puuid-${name.toLowerCase()}`;

/** The worked example of `docs/00-product.md`, as `index.test.ts` has it. */
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

const nameOf = (puuid: string): string => ROSTER.find((p) => p.puuid === puuid)?.name ?? puuid;
const names = (side: readonly { puuid: string }[]): string[] => side.map((a) => nameOf(a.puuid)).sort();
const sumR = (side: readonly { puuid: string }[], roster: readonly BalancePlayer[]): number =>
  side.reduce((s, a) => s + (roster.find((p) => p.puuid === a.puuid)?.r ?? Number.NaN), 0);

/** Every unordered pair of a team, as `Duo`s. */
function pairsOf(team: readonly string[]): Duo[] {
  const out: Duo[] = [];
  for (let i = 0; i < team.length; i += 1)
    for (let j = i + 1; j < team.length; j += 1) out.push([team[i] as string, team[j] as string]);
  return out;
}

const partsOf = (split: Split | undefined): ScoreParts => {
  if (split?.scoreParts === undefined) throw new Error('missing scoreParts');
  return split.scoreParts;
};

describe('config.balance (M18.13)', () => {
  it('pins the flat role drop and the variety constants', () => {
    // Re-derived on the Kustom scale at its anchor: 0.07 and 0.15 of 1200, what the old
    // multipliers took from a 1200 player, now taken from everybody.
    expect(config.balance.roleDrop).toEqual({ main: 0, secondary: 84, fill: 180 });
    expect(config.balance.varietyPerPair).toBe(25);
    expect(config.balance.varietyCap).toBe(100);
    expect(config.balance.varietyWindowGames).toBe(1);
    expect('roleMultiplier' in config.balance).toBe(false);
  });
});

describe('balance: flat fill cost (M18.13 A)', () => {
  /**
   * Blue is locked by a duo chain (one partition only), with two top mains whose backup is mid
   * and no mid main: one of Hana and Omar must play mid. Under `r × 0.93` the weaker of the two
   * always went; under a flat drop the two choices are worth the same, so the choice no longer
   * follows the Ratings at all.
   */
  function lockedBlue(hanaR: number, omarR: number): Split {
    const players = ROSTER.map((p) => {
      if (p.name === 'Hana') return { ...p, r: hanaR };
      if (p.name === 'Omar') return { ...p, r: omarR, secondaryRole: 'mid' as const };
      if (p.name === 'Karim') return { ...p, mainRole: 'support' as const };
      return p;
    });
    const chain = ['Bilal', 'Hana', 'Iris', 'Omar', 'Theo'].map(id);
    const duos: Duo[] = chain.slice(1).map((p, i) => [chain[i] as string, p]);
    const [first] = balance({ players, duos }).splits;
    if (first === undefined) throw new Error('missing split');
    return first;
  }

  it('who fills inside a team does not depend on who is rated higher', () => {
    const midOf = (s: Split) => nameOf(s.blue.find((a) => a.role === 'mid')?.puuid ?? '');
    expect(midOf(lockedBlue(1300, 1500))).toBe(midOf(lockedBlue(1500, 1300)));
    expect(midOf(lockedBlue(1100, 1400))).toBe(midOf(lockedBlue(1400, 1100)));
  });

  it('a secondary seat costs 84 in the gap and a fill seat 180, whatever the Rating', () => {
    // Ten 1500s and ten 1100s, the same roles: every top main has no backup, so eight fills.
    // The gaps are the same, because a flat drop does not scale with r.
    for (const r of [1100, 1500]) {
      const tops = ROSTER.map((p) => ({ ...p, r, mainRole: 'top' as const, secondaryRole: null }));
      const [first] = balance({ players: tops }).splits;
      expect(first?.gap).toBe(0);
      expect(first?.offRoleCount).toBe(8);
      expect(partsOf(first)).toEqual({ gap: 0, offRole: 960, repeat: 0, variety: 0, repeatedPairs: 0 });
    }
    // One side with one secondary seat more than the other: the gap moves by exactly 84.
    const mixed = ROSTER.map((p) => ({ ...p, r: 1300 }));
    for (const split of balance({ players: mixed }).splits) {
      const drop = (side: Split['blue']) =>
        side.reduce((s, a) => {
          const p = mixed.find((x) => x.puuid === a.puuid) as BalancePlayer;
          if (p.mainRole === a.role) return s;
          return s + (p.secondaryRole === a.role ? 84 : 180);
        }, 0);
      expect(partsOf(split).gap).toBeCloseTo(Math.abs(drop(split.blue) - drop(split.red)), 9);
    }
  });

  /**
   * A fixed sweep of 1,000 lobbies on the real Kustom spread (1100 to 1400, the 10+ board is
   * 1112 to 1400), random mains and backups from a seeded generator, counting split 1's
   * off-role seats by each player's rating third inside their lobby. Under `r × multiplier`
   * the bottom third took 2.5 times the top third’s fills (1,000 lobbies: 1,019 to 401; 400
   * lobbies: 410 to 176), because a fill cost them fewer points. Under the flat drop the
   * thirds are within a tenth of each other; the small lean toward the top third is the gap
   * term (a fill on the stronger team narrows it), not the price of the seat.
   */
  it('fills no longer land on the weakest third: the shares by rating third are even', () => {
    let seed = 20261004;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = (): Role => ROLES[Math.floor(rand() * ROLES.length)] as Role;
    let bottom = 0;
    let top = 0;
    for (let lobby = 0; lobby < 1000; lobby += 1) {
      const players: BalancePlayer[] = [];
      for (let i = 0; i < 10; i += 1) {
        const main = pick();
        let secondary = pick();
        while (secondary === main) secondary = pick();
        players.push({
          puuid: `p${lobby}-${String(i).padStart(2, '0')}`,
          name: `P${i}`,
          r: Math.round(1100 + rand() * 300),
          n: 20,
          mainRole: main,
          secondaryRole: secondary,
        });
      }
      const byR = [...players].sort((a, b) => a.r - b.r || (a.puuid < b.puuid ? -1 : 1));
      const third = (puuid: string): 'bottom' | 'middle' | 'top' => {
        const rank = byR.findIndex((p) => p.puuid === puuid);
        return rank < 3 ? 'bottom' : rank >= 7 ? 'top' : 'middle';
      };
      const [first] = balance({ players }).splits;
      for (const a of [...(first?.blue ?? []), ...(first?.red ?? [])]) {
        const p = players.find((x) => x.puuid === a.puuid) as BalancePlayer;
        if (p.mainRole === a.role) continue;
        const t = third(a.puuid);
        if (t === 'bottom') bottom += 1;
        if (t === 'top') top += 1;
      }
    }
    // Pinned so a tuning change shows up here; the ratio is the acceptance.
    expect({ bottom, top }).toEqual({ bottom: 689, top: 770 });
    expect(bottom / top).toBeLessThan(1.25);
    expect(bottom / top).toBeGreaterThan(0.8);
  });
});

describe('balance: teammate variety (M18.13 B)', () => {
  const base = balance({ players: ROSTER });

  it('absent, empty or all-ignored recent pairs change nothing', () => {
    expect(balance({ players: ROSTER, recentTeammates: [] })).toEqual(base);
    expect(balance({ players: ROSTER, recentTeammates: null })).toEqual(base);
    // Someone not in tonight's ten, the same player twice: ignored, never an error.
    const ignored: Duo[] = [
      [id('Hana'), 'puuid-sitting-out'],
      [id('Hana'), id('Hana')],
    ];
    expect(balance({ players: ROSTER, recentTeammates: ignored })).toEqual(base);
    for (const split of base.splits) {
      expect(partsOf(split).variety).toBe(0);
      expect(partsOf(split).repeatedPairs).toBe(0);
    }
  });

  it('adds 25 per repeated pair: Hana and Iris together again costs split 1 exactly 25', () => {
    const { splits, explanations } = balance({
      players: ROSTER,
      recentTeammates: [[id('Hana'), id('Iris')]],
    });
    expect(splits.map((s) => s.gap)).toEqual([100, 170, 220]);
    expect(splits[0]?.score).toBeCloseTo(124.6, 9);
    expect(partsOf(splits[0])).toEqual({
      gap: partsOf(base.splits[0]).gap,
      offRole: 0,
      repeat: 0,
      variety: 25,
      repeatedPairs: 1,
    });
    // Split 2 moves Hana to red, away from Iris; split 3 too. Neither pays anything.
    expect(partsOf(splits[1]).variety).toBe(0);
    expect(partsOf(splits[2]).variety).toBe(0);
    // The odds and the sentence never mention variety.
    expect(splits.map((s) => s.blueWinProb)).toEqual(base.splits.map((s) => s.blueWinProb));
    expect(explanations).toEqual(base.explanations);
  });

  it('caps at 100: five repeated pairs cost what four do, and split 2 takes first place', () => {
    const four: Duo[] = ['Iris', 'Karim', 'Bilal', 'Theo'].map((n) => [id('Hana'), id(n)]);
    const five: Duo[] = [...four, [id('Iris'), id('Karim')]];
    const withFour = balance({ players: ROSTER, recentTeammates: four });
    const withFive = balance({ players: ROSTER, recentTeammates: five });
    // Split 2 (Hana and Omar swapped) breaks every one of those pairs; split 1 pays the cap.
    expect(names(withFour.splits[0]?.blue ?? [])).toEqual(['Bilal', 'Iris', 'Karim', 'Omar', 'Theo']);
    expect(withFour.splits[0]?.score).toBeCloseTo(170.4, 9);
    expect(names(withFour.splits[1]?.blue ?? [])).toEqual(['Bilal', 'Hana', 'Iris', 'Karim', 'Theo']);
    expect(partsOf(withFour.splits[1])).toMatchObject({ variety: 100, repeatedPairs: 4 });
    expect(withFour.splits[1]?.score).toBeCloseTo(199.6, 9);
    expect(partsOf(withFive.splits.find((s) => names(s.blue).includes('Hana')))).toMatchObject({
      variety: 100,
      repeatedPairs: 5,
    });
    // At most 100: the fairness price of variety is bounded.
    for (const split of withFive.splits) expect(partsOf(split).variety).toBeLessThanOrEqual(100);
  });

  it('counts a pair once, in either order, and on either side', () => {
    const once = balance({ players: ROSTER, recentTeammates: [[id('Hana'), id('Iris')]] });
    const repeated = balance({
      players: ROSTER,
      recentTeammates: [
        [id('Iris'), id('Hana')],
        [id('Hana'), id('Iris')],
      ],
    });
    expect(repeated).toEqual(once);
    // Lena and Yuki are on red in split 1: a red pair counts the same as a blue one.
    const red = balance({ players: ROSTER, recentTeammates: [[id('Lena'), id('Yuki')]] });
    const split1 = red.splits.find((s) => names(s.blue).join() === 'Bilal,Hana,Iris,Karim,Theo');
    expect(partsOf(split1)).toMatchObject({ variety: 25, repeatedPairs: 1 });
  });

  it('never counts a pair the lobby locked together as a duo', () => {
    const duos: Duo[] = [[id('Hana'), id('Lena')]];
    const plain = balance({ players: ROSTER, duos });
    const withPair = balance({ players: ROSTER, duos, recentTeammates: [[id('Lena'), id('Hana')]] });
    expect(withPair).toEqual(plain);
  });

  it('is deterministic: the order of the recent pairs does not matter', () => {
    const pairs = pairsOf(['Hana', 'Iris', 'Karim', 'Rami'].map(id));
    const a = balance({ players: ROSTER, recentTeammates: pairs });
    const b = balance({ players: [...ROSTER].reverse(), recentTeammates: [...pairs].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('keeps blueWinProb on the plain Rating totals, whatever variety does to the order', () => {
    const { splits } = balance({
      players: ROSTER,
      recentTeammates: pairsOf(['Hana', 'Iris', 'Karim'].map(id)),
    });
    for (const split of splits) {
      expect(split.blueWinProb).toBe(winProbability(sumR(split.blue, ROSTER), sumR(split.red, ROSTER)));
    }
  });
});

/**
 * M18.14: variety charges the pairs a split keeps **beyond the fewest any valid split of this
 * lobby must keep**. A brute-force reference over all 126 partitions, written independently of
 * core: duo blocks respected, recent pairs filtered as core documents (outside the ten, the same
 * player twice, inside one duo block: ignored).
 */
function referenceFloor(input: Parameters<typeof balance>[0]): number {
  const ps = input.players.map((p) => p.puuid).sort();
  const duos = input.duos ?? [];
  // Duo blocks by repeated merging.
  let blocks: Set<string>[] = duos.map(([a, b]) => new Set([a, b]));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < blocks.length; i += 1)
      for (let j = i + 1; j < blocks.length; j += 1) {
        const bi = blocks[i] as Set<string>;
        const bj = blocks[j] as Set<string>;
        if ([...bi].some((x) => bj.has(x))) {
          blocks = [...blocks.filter((_, k) => k !== i && k !== j), new Set([...bi, ...bj])];
          merged = true;
          break outer;
        }
      }
  }
  const sameBlock = (a: string, b: string) => blocks.some((bl) => bl.has(a) && bl.has(b));
  const pairs = (input.recentTeammates ?? []).filter(
    ([a, b]) => a !== b && ps.includes(a) && ps.includes(b) && !sameBlock(a, b),
  );
  const unique = new Set(pairs.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  let floor = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 1 << 10; mask += 1) {
    let bits = 0;
    for (let k = 0; k < 10; k += 1) bits += (mask >> k) & 1;
    if (bits !== 5 || (mask & 1) === 0) continue;
    const blue = new Set(ps.filter((_, k) => (mask >> k) & 1));
    if (blocks.some((bl) => [...bl].some((x) => blue.has(x)) && [...bl].some((x) => !blue.has(x)))) continue;
    let kept = 0;
    for (const key of unique) {
      const [a, b] = key.split('|') as [string, string];
      if (blue.has(a) === blue.has(b)) kept += 1;
    }
    floor = Math.min(floor, kept);
  }
  return floor;
}

/**
 * A lobby built so the composition of a split is the only thing that moves the score: last game's
 * blue one of each main, last game's red the same five roles, so swapping two players of the same
 * main keeps everyone on main. `d` is how much each last-blue player out-rates their red
 * counterpart, by role. Any cross-role swap costs two fills (240 at least) and never wins.
 */
function sameTenLobby(d: readonly number[]): { players: BalancePlayer[]; lastBlue: string[]; pairs: Duo[] } {
  const players: BalancePlayer[] = [];
  for (const [k, role] of ROLES.entries()) {
    players.push(player(`A${k}`, 1300 + (d[k] as number), role, null));
    players.push(player(`B${k}`, 1300, role, null));
  }
  const lastBlue = ROLES.map((_, k) => id(`A${k}`));
  const lastRed = ROLES.map((_, k) => id(`B${k}`));
  return { players, lastBlue, pairs: [...pairsOf(lastBlue), ...pairsOf(lastRed)] };
}

/** How many of last game's blue five are on this split's blue side (5-0, 4-1, 3-2 by symmetry). */
const keptOfBlue = (split: Split, lastBlue: readonly string[]): number => {
  const k = split.blue.filter((a) => lastBlue.includes(a.puuid)).length;
  return Math.max(k, 5 - k);
};

describe('balance: teammate variety beyond the floor (M18.14)', () => {
  it('same ten: a 3-2 reshuffle is free, a 4-1 pays 4 pairs over the floor of 8', () => {
    // d chosen so the 4-1 (swap the supports) is even and the best 3-2 is 200 off: the 4-1 still
    // wins, and both shapes are on the list.
    const { players, lastBlue, pairs } = sameTenLobby([100, 100, 100, 100, 400]);
    const input = { players, recentTeammates: pairs };
    expect(referenceFloor(input)).toBe(8);
    const { splits } = balance(input);
    expect(splits.map((s) => keptOfBlue(s, lastBlue))).toEqual([4, 3, 3]);
    expect(splits.map((s) => s.gap)).toEqual([0, 200, 200]);
    expect(partsOf(splits[0])).toEqual({ gap: 0, offRole: 0, repeat: 0, variety: 100, repeatedPairs: 12 });
    expect(partsOf(splits[1])).toEqual({ gap: 200, offRole: 0, repeat: 0, variety: 0, repeatedPairs: 8 });
    expect(partsOf(splits[2])).toEqual({ gap: 200, offRole: 0, repeat: 0, variety: 0, repeatedPairs: 8 });
  });

  it('same ten: variety now changes the order, a 3-2 forty off beats an even 4-1', () => {
    const { players, lastBlue, pairs } = sameTenLobby([20, 20, 20, 20, 80]);
    const plain = balance({ players });
    // Without variety the even 4-1 is first.
    expect(keptOfBlue(plain.splits[0] as Split, lastBlue)).toBe(4);
    expect(plain.splits[0]?.gap).toBe(0);
    const { splits } = balance({ players, recentTeammates: pairs });
    expect(keptOfBlue(splits[0] as Split, lastBlue)).toBe(3);
    expect(partsOf(splits[0])).toEqual({ gap: 40, offRole: 0, repeat: 0, variety: 0, repeatedPairs: 8 });
    // Under the M18.13 rule every split here paid the cap (8 pairs is already 200), so the 4-1
    // at 0 + 100 beat the 3-2 at 40 + 100. Now the 4-1 sits at 100, behind every 40-off 3-2.
    const fourOne = splits.find((s) => keptOfBlue(s, lastBlue) === 4);
    expect(fourOne).toBeUndefined();
    expect(splits.every((s) => partsOf(s).variety === 0)).toBe(true);
  });

  it('caps at 100 over the floor: eight pairs over pays what four do', () => {
    // Two duo blocks of four leave two partitions; the pairs inside a block are ignored, so the
    // floor is 0 (the 4-1) and the 5-0 keeps eight: 200 uncapped, 100 charged.
    const chain = (ns: string[]): Duo[] => ns.slice(1).map((n, i) => [id(ns[i] as string), id(n)]);
    const { players, lastBlue, pairs } = sameTenLobby([0, 0, 0, 0, 0]);
    const duos = [...chain(['A0', 'A1', 'A2', 'A3']), ...chain(['B0', 'B1', 'B2', 'B3'])];
    const input = { players, duos, recentTeammates: pairs };
    expect(referenceFloor(input)).toBe(0);
    const { splits } = balance(input);
    expect(splits).toHaveLength(2);
    const fiveOh = splits.find((s) => keptOfBlue(s, lastBlue) === 5);
    const fourOne = splits.find((s) => keptOfBlue(s, lastBlue) === 4);
    expect(partsOf(fiveOh)).toMatchObject({ variety: 100, repeatedPairs: 8 });
    expect(partsOf(fourOne)).toMatchObject({ variety: 0, repeatedPairs: 0 });
  });

  it('rotating roster with a floor of 0: exactly the M18.13 rule, min(100, 25 x pairs)', () => {
    // Last game had two of tonight's on each side with strangers: a split can break every pair.
    const pairs: Duo[] = [
      [id('Hana'), id('Iris')],
      [id('Karim'), id('Nadia')],
      [id('Hana'), 'puuid-stranger-1'],
      [id('Karim'), 'puuid-stranger-2'],
    ];
    const input = { players: ROSTER, recentTeammates: pairs };
    expect(referenceFloor(input)).toBe(0);
    for (const split of balance(input).splits) {
      const p = partsOf(split);
      expect(p.variety).toBe(Math.min(100, 25 * p.repeatedPairs));
    }
  });

  it('matches the brute-force reference on generated lobbies, duo locks included', () => {
    let seed = 1814;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let positiveFloors = 0;
    for (let trial = 0; trial < 60; trial += 1) {
      const players = ROSTER.map((p) => ({ ...p, r: 1100 + Math.round(rand() * 400) }));
      const shuffled = [...players].sort(() => rand() - 0.5).map((p) => p.puuid);
      // Last game: a random number of tonight's ten on each side, the rest strangers.
      const k = 2 + Math.floor(rand() * 4);
      const pairs = [...pairsOf(shuffled.slice(0, k)), ...pairsOf(shuffled.slice(k, k + 5))];
      const duos: Duo[] = rand() < 0.4 ? [[shuffled[0] as string, shuffled[7] as string]] : [];
      const input = { players, duos, recentTeammates: pairs };
      const floor = referenceFloor(input);
      if (floor > 0) positiveFloors += 1;
      for (const split of balance(input).splits) {
        const p = partsOf(split);
        expect(p.repeatedPairs).toBeGreaterThanOrEqual(floor);
        expect(p.variety).toBe(Math.min(100, 25 * (p.repeatedPairs - floor)));
      }
    }
    expect(positiveFloors).toBeGreaterThan(10);
  });
});

describe('balance: score parts (M18.13)', () => {
  const cases: Record<string, Parameters<typeof balance>[0]> = {
    worked: { players: ROSTER },
    repeat: { players: ROSTER, lastSplit: ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id) },
    fills: {
      players: ROSTER.map((p) => ({
        ...p,
        mainRole: 'top' as const,
        secondaryRole: null,
        gamesSinceLastFill: 0,
      })),
    },
    variety: { players: ROSTER, recentTeammates: pairsOf(['Hana', 'Iris', 'Karim', 'Nadia'].map(id)) },
  };

  it('the variety case has a floor of 2, the others 0', () => {
    expect(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, referenceFloor(v)]))).toEqual({
      worked: 0,
      repeat: 0,
      fills: 0,
      variety: 2,
    });
  });

  it.each(Object.keys(cases))(
    '%s: the score is exactly its parts, and the gap is the rounded gap part',
    (key) => {
      const input = cases[key] as Parameters<typeof balance>[0];
      const floor = referenceFloor(input);
      for (const split of balance(input).splits) {
        const p = partsOf(split);
        expect(split.score).toBe(p.gap + p.offRole + p.repeat + p.variety);
        expect(split.gap).toBe(Math.round(p.gap));
        // M18.14: charged beyond the lobby's floor (2 for the variety case: four of last game's
        // teammates can be split two and two, never further).
        expect(p.variety).toBe(Math.min(100, 25 * (p.repeatedPairs - floor)));
        expect([0, 200]).toContain(p.repeat);
      }
    },
  );

  it('the repeated split carries repeat 200, the other none', () => {
    // Two duo blocks of four leave exactly two partitions: Theo or Yuki joins blue's four.
    const chain = (ns: string[]): Duo[] => ns.slice(1).map((n, i) => [id(ns[i] as string), id(n)]);
    const duos = [...chain(['Bilal', 'Hana', 'Iris', 'Karim']), ...chain(['Lena', 'Nadia', 'Omar', 'Rami'])];
    const last = ['Hana', 'Iris', 'Karim', 'Bilal', 'Theo'].map(id);
    const { splits } = balance({ players: ROSTER, duos, lastSplit: last });
    expect(splits).toHaveLength(2);
    const withTheo = splits.find((s) => names(s.blue).includes('Theo'));
    const withYuki = splits.find((s) => names(s.blue).includes('Yuki'));
    expect(partsOf(withTheo)).toMatchObject({ repeat: 200, variety: 0 });
    expect(partsOf(withYuki)).toMatchObject({ repeat: 0, variety: 0 });
  });

  it('fill protection shows up in offRole: 240 per seat for somebody filled last game', () => {
    const { splits } = balance(cases.fills as Parameters<typeof balance>[0]);
    // Ten top mains with no backup: eight fills, every one filled last game, 8 × 240.
    expect(partsOf(splits[0])).toMatchObject({ offRole: 1920, repeat: 0, variety: 0, repeatedPairs: 0 });
  });
});

describe('whyLower with stored score parts (M18.13)', () => {
  const parts = (p: Partial<ScoreParts>): ScoreParts => ({
    gap: 100,
    offRole: 0,
    repeat: 0,
    variety: 0,
    repeatedPairs: 0,
    ...p,
  });
  const row = (gap: number, offRoleCount: number, p: Partial<ScoreParts> | null) => ({
    gap,
    offRoleCount,
    scoreParts: p === null ? null : parts({ gap, ...p }),
  });

  it('keeps off-role and gap first, exactly as the column-only answer', () => {
    expect(whyLower(row(100, 0, {}), row(40, 2, { variety: 100, repeatedPairs: 4 }))).toEqual({
      kind: 'off-role',
      k: 2,
    });
    expect(whyLower(row(100, 0, {}), row(170, 0, { variety: 50, repeatedPairs: 2 }))).toEqual({
      kind: 'gap',
      chosenGap: 100,
      nextGap: 170,
    });
  });

  it('names teammate variety with both pair counts', () => {
    expect(
      whyLower(
        row(100, 0, { variety: 25, repeatedPairs: 1 }),
        row(90, 0, { variety: 100, repeatedPairs: 4 }),
      ),
    ).toEqual({ kind: 'variety', chosenPairs: 1, nextPairs: 4 });
  });

  it('names the repeat of the last teams', () => {
    expect(whyLower(row(100, 0, {}), row(60, 0, { repeat: 200 }))).toEqual({ kind: 'repeat' });
  });

  it('names recent fills when the same number of fills cost more', () => {
    expect(whyLower(row(100, 1, { offRole: 120 }), row(60, 1, { offRole: 240 }))).toEqual({
      kind: 'recent-fills',
    });
  });

  it('names the term with the biggest difference, ties in the order repeat, variety, recent fills', () => {
    expect(
      whyLower(row(100, 1, { offRole: 120 }), row(60, 1, { offRole: 240, variety: 50, repeatedPairs: 2 })),
    ).toEqual({ kind: 'recent-fills' });
    expect(
      whyLower(row(100, 1, { offRole: 120 }), row(60, 1, { offRole: 220, variety: 100, repeatedPairs: 4 })),
    ).toEqual({ kind: 'variety', chosenPairs: 0, nextPairs: 4 });
    expect(whyLower(row(100, 0, {}), row(60, 0, { repeat: 200, variety: 200, repeatedPairs: 8 }))).toEqual({
      kind: 'repeat',
    });
  });

  it('a row type without scoreParts keeps the pre-M18.13 answer type, so a page that never reads score_parts compiles unchanged', () => {
    const columns = { gap: 100, offRoleCount: 0 };
    expectTypeOf(whyLower(columns, columns)).toEqualTypeOf<WhyLower>();
    expectTypeOf(whyLower(row(100, 0, {}), row(60, 0, null))).toEqualTypeOf<WhyLowerScored>();
    const [split] = balance({ players: ROSTER }).splits;
    if (split === undefined) throw new Error('missing split');
    expectTypeOf(whyLower(split, split)).toEqualTypeOf<WhyLowerScored>();
    expect(whyLower(columns, { gap: 100, offRoleCount: 0 })).toEqual({ kind: 'role-costs' });
  });

  it('falls back to role-costs when a row has no stored parts or no term is bigger', () => {
    expect(whyLower(row(100, 0, null), row(60, 0, { variety: 100, repeatedPairs: 4 }))).toEqual({
      kind: 'role-costs',
    });
    expect(whyLower(row(100, 0, { variety: 100, repeatedPairs: 4 }), row(100, 0, null))).toEqual({
      kind: 'role-costs',
    });
    // Same rounded gap, the raw one a hair bigger: rounding, which the parts cannot name either.
    expect(whyLower(row(100, 0, {}), row(100, 0, {}))).toEqual({ kind: 'role-costs' });
  });

  it('from a real run: four repeated pairs push split 1 to second, and whyLower says so', () => {
    const four: Duo[] = ['Iris', 'Karim', 'Bilal', 'Theo'].map((n) => [id('Hana'), id(n)]);
    const { splits } = balance({ players: ROSTER, recentTeammates: four });
    const [chosen, next] = splits;
    if (chosen?.scoreParts === undefined || next?.scoreParts === undefined) throw new Error('missing');
    expect(
      whyLower(
        { gap: chosen.gap, offRoleCount: chosen.offRoleCount, scoreParts: chosen.scoreParts },
        { gap: next.gap, offRoleCount: next.offRoleCount, scoreParts: next.scoreParts },
      ),
    ).toEqual({ kind: 'variety', chosenPairs: 0, nextPairs: 4 });
  });
});
