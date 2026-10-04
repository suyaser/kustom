import { describe, expect, it } from 'vitest';
import { openSkillPair } from './openSkillPair';

describe('openSkillPair (M18.4)', () => {
  it('returns the pair of an OpenSkill row', () => {
    expect(openSkillPair({ mu: 21.5, sigma: 7.8 })).toEqual({ mu: 21.5, sigma: 7.8 });
  });

  it('returns null for a Kustom-only row, or a half pair', () => {
    expect(openSkillPair({ mu: null, sigma: null })).toBeNull();
    expect(openSkillPair({ mu: 20, sigma: null })).toBeNull();
    expect(openSkillPair({ mu: null, sigma: 8 })).toBeNull();
  });
});
