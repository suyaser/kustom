import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { CLASS_TAGS } from './model';
import { classPool, modePool, regionOpenCounts, rulePlayable } from './pool';
import {
  AHRI,
  ASHE,
  BRAUM,
  DARIUS,
  GAREN,
  JINX,
  LEONA,
  LUX,
  MALPHITE,
  ROSTER,
  RYZE,
  SMOLDER,
  SYNDRA,
  syntheticRoster,
  THRESH,
  ZED,
} from './testRoster';

const NONE = new Set<number>();

describe('classPool: any Data Dragon tag counts', () => {
  it('Ashe is a support as well as a marksman; Garen and Darius are tanks by their second tag', () => {
    expect(classPool('Support', ROSTER)).toEqual([ASHE, LEONA, LUX, BRAUM, THRESH].sort((a, b) => a - b));
    expect(classPool('Tank', ROSTER)).toEqual([MALPHITE, GAREN, LEONA, DARIUS, BRAUM].sort((a, b) => a - b));
    expect(classPool('Marksman', ROSTER)).toEqual([ASHE, JINX, SMOLDER].sort((a, b) => a - b));
    expect(classPool('Assassin', ROSTER)).toEqual([AHRI, ZED].sort((a, b) => a - b));
    expect(classPool('Mage', ROSTER)).toEqual(
      [RYZE, MALPHITE, LUX, AHRI, SYNDRA, SMOLDER].sort((a, b) => a - b),
    );
  });

  it('a champion with unknown tags is in no class', () => {
    const table = new Map([[1, { tags: null, region: 'ionia' }]]);
    for (const tag of CLASS_TAGS) expect(classPool(tag, table)).toEqual([]);
  });
});

describe('modePool', () => {
  it('Normal and Fearless: the whole roster, minus the bans passed', () => {
    const all = [...ROSTER.keys()].sort((a, b) => a - b);
    expect(modePool({ id: 'normal' }, ROSTER, NONE)).toEqual({
      kind: 'shared',
      pool: { open: all, banned: [] },
    });
    const fearless = modePool({ id: 'fearless' }, ROSTER, new Set([JINX, 5555]));
    expect(fearless).toEqual({
      kind: 'shared',
      pool: { open: all.filter((id) => id !== JINX), banned: [JINX] },
    });
  });

  it('class: the class pool minus the Fearless bans; bans outside the class are ignored', () => {
    expect(modePool({ id: 'class', tag: 'Tank' }, ROSTER, new Set([LEONA, JINX]))).toEqual({
      kind: 'shared',
      pool: { open: [MALPHITE, GAREN, DARIUS, BRAUM].sort((a, b) => a - b), banned: [LEONA] },
    });
  });

  it('accepts bans as an array too', () => {
    expect(modePool({ id: 'class', tag: 'Assassin' }, ROSTER, [ZED])).toEqual({
      kind: 'shared',
      pool: { open: [AHRI], banned: [ZED] },
    });
  });

  it('region: one pool per side, minus bans; unaffiliated and region-less champions are in neither', () => {
    expect(modePool({ id: 'region', blue: 'ionia', red: 'demacia' }, ROSTER, new Set([ZED]))).toEqual({
      kind: 'sides',
      blue: { open: [AHRI, SYNDRA], banned: [ZED] },
      red: { open: [GAREN, LUX].sort((a, b) => a - b), banned: [] },
    });
  });

  it('mirror: the whole roster minus bans', () => {
    const pool = modePool({ id: 'mirror' }, ROSTER, new Set([AHRI]));
    expect(pool.kind).toBe('shared');
    if (pool.kind === 'shared') {
      expect(pool.pool.banned).toEqual([AHRI]);
      expect(pool.pool.open).toHaveLength(ROSTER.size - 1);
    }
  });
});

describe('regionOpenCounts', () => {
  it('counts open champions per region, unaffiliated included, region-less skipped', () => {
    const counts = regionOpenCounts(ROSTER, new Set([ZED]));
    expect(Object.fromEntries(counts)).toEqual({
      zaun: 1,
      freljord: 2,
      targon: 1,
      demacia: 2,
      ionia: 2,
      ixtal: 1,
      'shadow-isles': 1,
      noxus: 1,
      unaffiliated: 1,
    });
  });
});

describe('rulePlayable: the disabled-in-picker thresholds (D7)', () => {
  it('pins the thresholds in config', () => {
    expect(config.modes.classMinOpen).toBe(10);
    expect(config.modes.regionMinOpen).toBe(8);
  });

  it('a class is playable at 10 open and not at 9, Fearless bans counted', () => {
    const roster = syntheticRoster({ Tank: 11 });
    expect(rulePlayable({ id: 'class', tag: 'Tank' }, roster, NONE)).toBe(true);
    expect(rulePlayable({ id: 'class', tag: 'Tank' }, roster, new Set([10000]))).toBe(true);
    expect(rulePlayable({ id: 'class', tag: 'Tank' }, roster, new Set([10000, 10001]))).toBe(false);
  });

  it('region wars needs two regions (not unaffiliated) with at least 8 open each', () => {
    const roster = syntheticRoster({}, { ionia: 8, noxus: 8, unaffiliated: 20, targon: 7 });
    expect(rulePlayable({ id: 'region' }, roster, NONE)).toBe(true);
    // One Noxus champion banned: Noxus drops to 7, only Ionia is left; unaffiliated never counts.
    const noxusFirst = [...roster.entries()].find(([, f]) => f.region === 'noxus')?.[0] as number;
    expect(rulePlayable({ id: 'region' }, roster, new Set([noxusFirst]))).toBe(false);
  });

  it('mirror is always playable', () => {
    expect(rulePlayable({ id: 'mirror' }, new Map(), NONE)).toBe(true);
  });
});
