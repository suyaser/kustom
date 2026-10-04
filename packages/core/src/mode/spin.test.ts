import { describe, expect, it } from 'vitest';
import { RULE_FAMILIES, RULE_OPTIONS, type RuleOption, ruleKey } from './model';
import { drawRegions, drawSpin, SPIN_FAMILIES } from './spin';
import { seeded, sequence } from './testRoster';

const all = () => true;

describe('drawSpin: family first, then option', () => {
  it('Spin draws class, region and mirror (M17.17); every family is a rule family', () => {
    expect(SPIN_FAMILIES).toEqual(['class', 'region', 'mirror']);
    for (const family of SPIN_FAMILIES) expect(RULE_FAMILIES).toContain(family);
    expect(RULE_FAMILIES).toContain('mirror');
    expect(RULE_OPTIONS).toContainEqual({ id: 'mirror' });
  });

  it('rng picks the family from the families that have a playable option, then the option', () => {
    // 3 families: [0, 1/3) class, [1/3, 2/3) region, [2/3, 1) mirror. Then 5 classes.
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0, 0))).toEqual({ id: 'class', tag: 'Tank' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.1, 0.99))).toEqual({ id: 'class', tag: 'Support' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.32, 0))).toEqual({ id: 'class', tag: 'Tank' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.34, 0))).toEqual({ id: 'region' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.66, 0))).toEqual({ id: 'region' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.67, 0))).toEqual({ id: 'mirror' });
    expect(drawSpin(RULE_OPTIONS, null, all, sequence(0.99, 0))).toEqual({ id: 'mirror' });
  });

  it('weights by family: a seeded run of 30,000 lands each family about a third of the time, mirror included', () => {
    const rng = seeded(15);
    const counts = new Map<string, number>();
    const n = 30000;
    for (let i = 0; i < n; i += 1) {
      const rule = drawSpin(RULE_OPTIONS, null, all, rng) as RuleOption;
      counts.set(ruleKey(rule), (counts.get(ruleKey(rule)) ?? 0) + 1);
    }
    const share = (key: string) => (counts.get(key) ?? 0) / n;
    expect(Math.abs(share('region') - 1 / 3)).toBeLessThan(0.01);
    expect(Math.abs(share('mirror') - 1 / 3)).toBeLessThan(0.01);
    for (const tag of ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support']) {
      expect(Math.abs(share(`class:${tag}`) - 1 / 15)).toBeLessThan(0.01);
    }
  });

  it('never returns the previous rule of tonight (as an option or as the locked mode)', () => {
    const rng = seeded(7);
    for (let i = 0; i < 2000; i += 1) {
      expect(drawSpin(RULE_OPTIONS, { id: 'class', tag: 'Tank' }, all, rng)).not.toEqual({
        id: 'class',
        tag: 'Tank',
      });
      expect(drawSpin(RULE_OPTIONS, { id: 'region', blue: 'ionia', red: 'noxus' }, all, rng)).not.toEqual({
        id: 'region',
      });
    }
  });

  it('a family emptied by the exclusion is not drawn: previous region wars leaves class and mirror', () => {
    // Two families left: [0, 1/2) class, [1/2, 1) mirror.
    expect(drawSpin(RULE_OPTIONS, { id: 'region' }, all, sequence(0.49, 0))).toEqual({
      id: 'class',
      tag: 'Tank',
    });
    expect(drawSpin(RULE_OPTIONS, { id: 'region' }, all, sequence(0.5, 0.99))).toEqual({ id: 'mirror' });
  });

  it('the previous rule being mirror takes mirror out of the draw', () => {
    const rng = seeded(11);
    for (let i = 0; i < 500; i += 1) {
      expect(drawSpin(RULE_OPTIONS, { id: 'mirror' }, all, rng)).not.toEqual({ id: 'mirror' });
    }
  });

  it('a previous standing mode excludes nothing', () => {
    expect(drawSpin(RULE_OPTIONS, { id: 'fearless' }, all, sequence(0, 0))).toEqual({
      id: 'class',
      tag: 'Tank',
    });
  });

  it('never returns an unplayable option', () => {
    const playable = (rule: RuleOption) => !(rule.id === 'class' && rule.tag !== 'Mage');
    const rng = seeded(3);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1)
      seen.add(ruleKey(drawSpin(RULE_OPTIONS, null, playable, rng) as RuleOption));
    expect([...seen].sort()).toEqual(['class:Mage', 'mirror', 'region']);
  });

  it('never returns a standing mode, even if one is passed in the options; mirror is a result', () => {
    const sneaky = [{ id: 'normal' }, { id: 'fearless' }] as unknown as RuleOption[];
    const rng = seeded(1);
    for (let i = 0; i < 200; i += 1) expect(drawSpin(sneaky, null, all, rng)).toBeNull();
    const withRegion = [...sneaky, { id: 'region' } as RuleOption];
    for (let i = 0; i < 200; i += 1) expect(drawSpin(withRegion, null, all, rng)).toEqual({ id: 'region' });
  });

  it('M17.17: mirror is drawn when it is the only playable rule', () => {
    expect(drawSpin(RULE_OPTIONS, null, (rule) => rule.id === 'mirror', seeded(1))).toEqual({ id: 'mirror' });
  });

  it('returns null when nothing is left', () => {
    expect(drawSpin(RULE_OPTIONS, null, () => false, seeded(1))).toBeNull();
    expect(drawSpin([{ id: 'region' }], { id: 'region' }, all, seeded(1))).toBeNull();
  });

  it('does not depend on the order of the options', () => {
    const reversed = [...RULE_OPTIONS].reverse();
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      expect(drawSpin(reversed, null, all, sequence(r, r))).toEqual(
        drawSpin(RULE_OPTIONS, null, all, sequence(r, r)),
      );
    }
  });

  it('rejects an RNG value outside [0, 1)', () => {
    expect(() => drawSpin(RULE_OPTIONS, null, all, () => 1)).toThrow(RangeError);
    expect(() => drawSpin(RULE_OPTIONS, null, all, () => -0.1)).toThrow(RangeError);
    expect(() => drawSpin(RULE_OPTIONS, null, all, () => Number.NaN)).toThrow(RangeError);
  });
});

describe('drawRegions', () => {
  const regions = ['ionia', 'noxus', 'targon', 'unaffiliated', 'demacia'];
  const open = new Map([
    ['ionia', 23],
    ['noxus', 17],
    ['targon', 7],
    ['unaffiliated', 20],
    ['demacia', 8],
  ]);

  it('draws blue then red from regions with at least 8 open, sorted by id', () => {
    // Eligible: demacia, ionia, noxus. Blue from all three, red from the two left.
    expect(drawRegions(regions, open, sequence(0, 0))).toEqual({ blue: 'demacia', red: 'ionia' });
    expect(drawRegions(regions, open, sequence(0.99, 0.99))).toEqual({ blue: 'noxus', red: 'ionia' });
    expect(drawRegions(regions, open, sequence(0.5, 0.5))).toEqual({ blue: 'ionia', red: 'noxus' });
  });

  it('never a region under 8 open, never unaffiliated, never the same region twice', () => {
    const rng = seeded(42);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i += 1) {
      const pair = drawRegions(regions, open, rng);
      expect(pair).not.toBeNull();
      if (pair === null) continue;
      expect(pair.blue).not.toBe(pair.red);
      seen.add(pair.blue);
      seen.add(pair.red);
    }
    expect([...seen].sort()).toEqual(['demacia', 'ionia', 'noxus']);
  });

  it('a region with no count is not open; duplicates count once; null under two eligible', () => {
    expect(drawRegions(['ionia', 'ionia', 'zaun'], new Map([['ionia', 30]]), seeded(1))).toBeNull();
    expect(drawRegions([], new Map(), seeded(1))).toBeNull();
  });

  it('does not depend on the order of the regions', () => {
    expect(drawRegions([...regions].reverse(), open, sequence(0.5, 0.2))).toEqual(
      drawRegions(regions, open, sequence(0.5, 0.2)),
    );
  });
});
