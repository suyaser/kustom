import { describe, expect, it } from 'vitest';
import { ruleRowName, ruleRowNote } from './rowNote';

/** M15.19: the tape's and `/games`' rule note, one test per rule. */
describe('ruleRowNote', () => {
  it('class wars: Tanks only · not rated, and the plural for every class', () => {
    expect(ruleRowNote({ id: 'class', tag: 'Tank' }, false)).toBe('Tanks only · not rated');
    expect(ruleRowNote({ id: 'class', tag: 'Marksman' }, false)).toBe('Marksmen only · not rated');
    expect(ruleRowNote({ id: 'class', tag: 'Assassin' }, true)).toBe('Assassins only');
  });

  it('region wars: Ionia vs Noxus · not rated, blue first', () => {
    expect(ruleRowNote({ id: 'region', blue: 'ionia', red: 'noxus' }, false)).toBe(
      'Ionia vs Noxus · not rated',
    );
  });

  it('mirror match: Mirror match when rated, with not rated when the switch was off', () => {
    expect(ruleRowNote({ id: 'mirror' }, true)).toBe('Mirror match');
    expect(ruleRowNote({ id: 'mirror' }, false)).toBe('Mirror match · not rated');
  });

  it('a standing-mode game, or none, has no rule to name', () => {
    expect(ruleRowNote(null, false)).toBeNull();
    expect(ruleRowNote({ id: 'fearless' }, true)).toBeNull();
    expect(ruleRowName({ id: 'normal' })).toBeNull();
  });

  it('a region the pinned table does not know reads as its id, never blank', () => {
    expect(ruleRowName({ id: 'region', blue: 'ionia', red: 'newland' })).toBe('Ionia vs Newland');
  });

  it('a hyphenated unknown region reads as words', () => {
    expect(ruleRowName({ id: 'region', blue: 'shadow-isles-east', red: 'noxus' })).toBe(
      'Shadow Isles East vs Noxus',
    );
  });
});
