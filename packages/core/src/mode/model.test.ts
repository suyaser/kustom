import { describe, expect, it } from 'vitest';
import { config } from '../config';
import {
  CLASS_TAGS,
  MODE_IDS,
  type Mode,
  modeFamily,
  modeRatedDefault,
  RULE_FAMILIES,
  RULE_OPTIONS,
  type RuleOption,
  ruleKey,
  ruleOf,
  STANDING_MODES,
  sameRule,
  UNAFFILIATED,
} from './model';

describe('mode ids and families', () => {
  it('has five mode ids, two standing, three rule families', () => {
    expect(MODE_IDS).toEqual(['normal', 'fearless', 'class', 'region', 'mirror']);
    expect(STANDING_MODES).toEqual(['normal', 'fearless']);
    expect(RULE_FAMILIES).toEqual(['class', 'region', 'mirror']);
  });

  it('maps every id to its family', () => {
    expect(MODE_IDS.map(modeFamily)).toEqual(['standing', 'standing', 'class', 'region', 'mirror']);
  });

  it('class wars has five classes and no Fighters', () => {
    expect(CLASS_TAGS).toEqual(['Tank', 'Marksman', 'Mage', 'Assassin', 'Support']);
    expect(CLASS_TAGS as readonly string[]).not.toContain('Fighter');
  });

  it('lists seven rule options: five classes, region wars, mirror match; never a standing mode', () => {
    expect(RULE_OPTIONS.map(ruleKey)).toEqual([
      'class:Tank',
      'class:Marksman',
      'class:Mage',
      'class:Assassin',
      'class:Support',
      'region',
      'mirror',
    ]);
  });

  it('the unaffiliated slug is a constant', () => {
    expect(UNAFFILIATED).toBe('unaffiliated');
  });
});

describe('ruleOf and sameRule', () => {
  it('a standing mode has no rule', () => {
    expect(ruleOf({ id: 'normal' })).toBeNull();
    expect(ruleOf({ id: 'fearless' })).toBeNull();
  });

  it('a locked region mode is the region wars rule whatever the draw', () => {
    expect(ruleOf({ id: 'region', blue: 'ionia', red: 'noxus' })).toEqual({ id: 'region' });
  });

  it('a class mode keeps its tag; mirror is mirror', () => {
    expect(ruleOf({ id: 'class', tag: 'Tank' })).toEqual({ id: 'class', tag: 'Tank' });
    expect(ruleOf({ id: 'mirror' })).toEqual({ id: 'mirror' });
  });

  it('compares rules by key', () => {
    const tank: RuleOption = { id: 'class', tag: 'Tank' };
    expect(sameRule(tank, { id: 'class', tag: 'Tank' })).toBe(true);
    expect(sameRule(tank, { id: 'class', tag: 'Mage' })).toBe(false);
    expect(sameRule({ id: 'region' }, { id: 'region' })).toBe(true);
    expect(sameRule(tank, null)).toBe(false);
    expect(sameRule(null, null)).toBe(false);
  });
});

describe('modeRatedDefault (D5)', () => {
  it('Normal, Fearless and mirror are rated; every class and region wars are not', () => {
    const modes: Mode[] = [
      { id: 'normal' },
      { id: 'fearless' },
      ...CLASS_TAGS.map((tag): Mode => ({ id: 'class', tag })),
      { id: 'region', blue: 'ionia', red: 'noxus' },
      { id: 'mirror' },
    ];
    expect(modes.map((m) => [m.id, modeRatedDefault(m.id)])).toEqual([
      ['normal', true],
      ['fearless', true],
      ['class', false],
      ['class', false],
      ['class', false],
      ['class', false],
      ['class', false],
      ['region', false],
      ['mirror', true],
    ]);
  });

  it('reads the table from config, so tuning is a one-line diff', () => {
    expect(config.modes.ratedDefault).toEqual({
      normal: true,
      fearless: true,
      class: false,
      region: false,
      mirror: true,
    });
  });
});
