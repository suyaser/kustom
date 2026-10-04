import { describe, expect, it } from 'vitest';
import { classSentence } from './ruleCopy';

/** M15.19: one shape per class, with the article each word takes. */
describe('classSentence', () => {
  const lead = (sentence: string) => sentence.split('. ')[0];

  it.each([
    ['Tank', 'Everyone picks a tank this game: any champion Riot lists as a Tank'],
    ['Marksman', 'Everyone picks a marksman this game: any champion Riot lists as a Marksman'],
    ['Mage', 'Everyone picks a mage this game: any champion Riot lists as a Mage'],
    ['Assassin', 'Everyone picks an assassin this game: any champion Riot lists as an Assassin'],
    ['Support', 'Everyone picks a support this game: any champion Riot lists as a Support'],
  ] as const)('%s', (tag, expected) => {
    expect(lead(classSentence(tag, false))).toBe(expected);
  });

  it('keeps the shared sentences after it, rated or not', () => {
    expect(classSentence('Tank', true)).toBe(
      'Everyone picks a tank this game: any champion Riot lists as a Tank. Nobody is stopped in champ select; the result post says which side kept the rule. Rated: Ratings move as usual.',
    );
    expect(classSentence('Tank', false)).toMatch(/Not rated: Ratings don't move\.$/);
  });
});
