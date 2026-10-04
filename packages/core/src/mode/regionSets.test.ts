/**
 * M20.2: a champion's regions are a set (M20 D1), and a region pair is drawn only when each side
 * could have 8 open champions of its own even if the other side took every shared one (M20 D2).
 */
import { describe, expect, it } from 'vitest';
import { checkMode } from './check';
import { type ChampionTable, type RegionPair, UNAFFILIATED } from './model';
import { modePool, pairDrawable, regionOpenCounts, regionPool, rulePlayable } from './pool';
import { drawRegions } from './spin';
import { AHRI, GAREN, JINX, ROSTER, RYZE, SMOLDER, seeded, sequence, setRoster, VI } from './testRoster';

const NONE = new Set<number>();
/** Two `setRoster`s as one table, renumbered from 1 (their own ids overlap). */
const join = (...tables: ChampionTable[]): ChampionTable =>
  new Map(tables.flatMap((t) => [...t.values()]).map((facts, i) => [i + 1, facts]));
const WITH_VI: ChampionTable = new Map([
  ...ROSTER,
  [VI, { tags: ['Fighter', 'Assassin'], region: ['piltover', 'zaun'] }],
]);

describe('a two-region champion (Vi: Piltover and Zaun)', () => {
  it('is in both pools', () => {
    expect(regionPool('piltover', WITH_VI)).toEqual([VI]);
    expect(regionPool('zaun', WITH_VI)).toEqual([JINX, VI].sort((a, b) => a - b));
    expect(modePool({ id: 'region', blue: 'piltover', red: 'zaun' }, WITH_VI, NONE)).toEqual({
      kind: 'sides',
      blue: { open: [VI], banned: [] },
      red: { open: [JINX, VI].sort((a, b) => a - b), banned: [] },
    });
  });

  it('is counted once for each of its regions, and a Fearless ban takes it out of both', () => {
    const open = regionOpenCounts(WITH_VI, NONE);
    expect(open.get('piltover')).toBe(1);
    expect(open.get('zaun')).toBe(2);
    const banned = regionOpenCounts(WITH_VI, new Set([VI]));
    expect(banned.get('piltover')).toBeUndefined();
    expect(banned.get('zaun')).toBe(1);
    expect(modePool({ id: 'region', blue: 'piltover', red: 'zaun' }, WITH_VI, [VI])).toEqual({
      kind: 'sides',
      blue: { open: [], banned: [VI] },
      red: { open: [JINX], banned: [VI] },
    });
  });

  it('is kept on either side; outside both of its regions it is broke', () => {
    const seats = [
      { side: 100 as const, championId: VI, position: 'jungle' as const },
      { side: 200 as const, championId: VI, position: 'jungle' as const },
    ];
    expect(checkMode({ id: 'region', blue: 'piltover', red: 'zaun' }, seats, WITH_VI)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'kept', broke: [], unknown: [] },
    });
    expect(checkMode({ id: 'region', blue: 'zaun', red: 'piltover' }, seats, WITH_VI)).toMatchObject({
      blue: { verdict: 'kept' },
      red: { verdict: 'kept' },
    });
    expect(checkMode({ id: 'region', blue: 'demacia', red: 'zaun' }, seats, WITH_VI)).toMatchObject({
      blue: { verdict: 'broke', broke: [VI] },
      red: { verdict: 'kept' },
    });
  });
});

describe('an empty set is unaffiliated; no row is unknown', () => {
  it('an empty set is in no pool and is not counted for any region; it is tallied as unaffiliated', () => {
    expect(regionPool(UNAFFILIATED, ROSTER)).toEqual([]);
    for (const region of ['ionia', 'demacia', 'zaun', 'noxus']) {
      expect(regionPool(region, ROSTER)).not.toContain(RYZE);
      expect(regionPool(region, ROSTER)).not.toContain(SMOLDER);
    }
    const open = regionOpenCounts(new Map([[RYZE, { tags: [], region: [] }]]), NONE);
    expect(Object.fromEntries(open)).toEqual({ unaffiliated: 1 });
    expect(regionOpenCounts(new Map([[SMOLDER, { tags: [], region: null }]]), NONE).size).toBe(0);
  });

  it('an empty set is broke on either side; a champion with no row is unknown on either side', () => {
    const seats = [
      { side: 100 as const, championId: RYZE, position: 'mid' as const },
      { side: 100 as const, championId: SMOLDER, position: 'adc' as const },
      { side: 200 as const, championId: RYZE, position: 'mid' as const },
      { side: 200 as const, championId: SMOLDER, position: 'adc' as const },
    ];
    expect(checkMode({ id: 'region', blue: 'ionia', red: 'demacia' }, seats, ROSTER)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'broke', broke: [RYZE], unknown: [SMOLDER] },
      red: { side: 200, verdict: 'broke', broke: [RYZE], unknown: [SMOLDER] },
    });
  });

  it('a set that names unaffiliated is still in no pool', () => {
    const odd = new Map([[1, { tags: [], region: [UNAFFILIATED] }]]);
    expect(regionPool(UNAFFILIATED, odd)).toEqual([]);
  });
});

describe('pairDrawable: 8 open each and 16 different open between them (M20 D2)', () => {
  // 7 + 7 of their own and 1 shared: 8 + 8 open, 15 between them.
  const tight = setRoster([
    [['ionia'], 7],
    [['noxus'], 7],
    [['ionia', 'noxus'], 1],
  ]);
  // 7 + 8 of their own and 1 shared: 8 + 9 open, 16 between them.
  const enough = setRoster([
    [['ionia'], 7],
    [['noxus'], 8],
    [['ionia', 'noxus'], 1],
  ]);

  it('a pair at 8 + 8 with 1 shared is refused; 8 + 9 with 1 shared passes; the order of the sides does not matter', () => {
    expect(pairDrawable('ionia', 'noxus', tight, NONE)).toBe(false);
    expect(pairDrawable('noxus', 'ionia', tight, NONE)).toBe(false);
    expect(pairDrawable('ionia', 'noxus', enough, NONE)).toBe(true);
    expect(pairDrawable('noxus', 'ionia', enough, NONE)).toBe(true);
  });

  it('8 + 8 with nothing shared passes; 7 + 9 does not, whatever the union', () => {
    expect(
      pairDrawable(
        'ionia',
        'noxus',
        setRoster([
          [['ionia'], 8],
          [['noxus'], 8],
        ]),
        NONE,
      ),
    ).toBe(true);
    expect(
      pairDrawable(
        'ionia',
        'noxus',
        setRoster([
          [['ionia'], 7],
          [['noxus'], 20],
        ]),
        NONE,
      ),
    ).toBe(false);
  });

  it('counts after the Fearless bans: banning the shared champion takes it from both sides', () => {
    const shared = [...enough].find(([, f]) => f.region?.length === 2)?.[0] as number;
    const noxusOnly = [...enough].find(([, f]) => f.region?.[0] === 'noxus')?.[0] as number;
    expect(pairDrawable('ionia', 'noxus', enough, [shared])).toBe(false);
    expect(pairDrawable('ionia', 'noxus', enough, new Set([noxusOnly]))).toBe(false);
  });

  it('never the same region on both sides, never unaffiliated', () => {
    const big = setRoster([
      [['ionia'], 20],
      [[], 20],
    ]);
    expect(pairDrawable('ionia', 'ionia', big, NONE)).toBe(false);
    expect(pairDrawable('ionia', UNAFFILIATED, big, NONE)).toBe(false);
    expect(pairDrawable(UNAFFILIATED, 'ionia', big, NONE)).toBe(false);
  });

  it('rulePlayable: region wars is playable when at least one pair passes', () => {
    expect(rulePlayable({ id: 'region' }, tight, NONE)).toBe(false);
    expect(rulePlayable({ id: 'region' }, enough, NONE)).toBe(true);
    const withThird = join(tight, setRoster([[['demacia'], 8]]));
    expect(rulePlayable({ id: 'region' }, withThird, NONE)).toBe(true);
  });

  it('a pair failing only on the union is never drawn (seeded, 1,000 draws); the other pairs are', () => {
    // Ionia and Noxus fail only on the union; Demacia passes with either.
    const roster = join(tight, setRoster([[['demacia'], 8]]));
    const regions = ['demacia', 'ionia', 'noxus', 'unaffiliated'];
    const rng = seeded(2020);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const pair = drawRegions(regions, { roster, bans: NONE }, rng) as RegionPair;
      expect(pair).not.toBeNull();
      expect([pair.blue, pair.red].sort()).not.toEqual(['ionia', 'noxus']);
      expect(pairDrawable(pair.blue, pair.red, roster, NONE)).toBe(true);
      seen.add(`${pair.blue}-${pair.red}`);
    }
    expect([...seen].sort()).toEqual(['demacia-ionia', 'demacia-noxus', 'ionia-demacia', 'noxus-demacia']);
  });

  it('the draw is null when the only pair fails the union, and draws it once it passes', () => {
    expect(drawRegions(['ionia', 'noxus'], { roster: tight, bans: NONE }, seeded(1))).toBeNull();
    expect(drawRegions(['ionia', 'noxus'], { roster: enough, bans: NONE }, sequence(0, 0))).toEqual({
      blue: 'ionia',
      red: 'noxus',
    });
    expect(drawRegions(['noxus', 'ionia'], { roster: enough, bans: NONE }, sequence(0.99, 0))).toEqual({
      blue: 'noxus',
      red: 'ionia',
    });
  });

  it('a draw from the roster counts the bans it is given', () => {
    const shared = [...enough].find(([, f]) => f.region?.length === 2)?.[0] as number;
    expect(drawRegions(['ionia', 'noxus'], { roster: enough, bans: [shared] }, seeded(1))).toBeNull();
  });

  it('blue is only a region with a passing partner, so the draw never dead-ends on red', () => {
    // Ionia passes with Demacia; Noxus fails with Ionia on the union, and Demacia is not a candidate.
    const roster = join(tight, setRoster([[['demacia'], 8]]));
    const rng = seeded(9);
    for (let i = 0; i < 500; i += 1) {
      expect(drawRegions(['ionia', 'noxus'], { roster, bans: NONE }, rng)).toBeNull();
      expect(drawRegions(['ionia', 'noxus', 'demacia'], { roster, bans: NONE }, rng)).not.toBeNull();
    }
  });
});

describe('the counts form of drawRegions is unchanged for disjoint regions', () => {
  it('reads like the roster form when no champion is shared', () => {
    const roster = setRoster([
      [['ionia'], 9],
      [['noxus'], 8],
      [['demacia'], 8],
      [['targon'], 7],
    ]);
    const regions = ['demacia', 'ionia', 'noxus', 'targon'];
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(drawRegions(regions, { roster, bans: NONE }, sequence(r, r))).toEqual(
        drawRegions(regions, regionOpenCounts(roster, NONE), sequence(r, r)),
      );
    }
  });
});

describe('core imports no fixture (M20.2 acceptance 5)', () => {
  it('every mode source imports only from inside packages/core', () => {
    const sources = (
      import.meta as unknown as {
        glob: (pattern: string, options: object) => Record<string, string>;
      }
    ).glob('./*.ts', { query: '?raw', import: 'default', eager: true });
    const files = Object.keys(sources).filter((file) => !file.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      const imports = [...(sources[file] as string).matchAll(/from '([^']+)'/g)].map((m) => m[1] as string);
      for (const path of imports) {
        expect(path, `${file} imports ${path}`).toMatch(/^\.\.?\//);
        expect(path, `${file} imports ${path}`).not.toMatch(/fixture|apps\/|champs/);
      }
    }
  });

  it('the shared roster used here is test data: Ahri and Garen keep their one region', () => {
    expect(WITH_VI.get(AHRI)?.region).toEqual(['ionia']);
    expect(WITH_VI.get(GAREN)?.region).toEqual(['demacia']);
  });
});
