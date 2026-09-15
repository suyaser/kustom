import { evenness } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { EVENNESS_PERFECT, evennessLine } from './copy';

/**
 * The tonight page's composed sentences. Constants need no test — they are product's words and
 * a test would only retype them — so what is here is the copy that has a branch in it.
 */

describe('evennessLine (M3.31)', () => {
  it('is core `evenness` in a sentence, and nothing of its own', () => {
    for (const prob of [0.54, 0.7, 0.9, 0.06, 0, 1]) {
      expect(evennessLine(prob)).toBe(`Teams are ${evenness(prob)}% even.`);
    }
    expect(evennessLine(0.54)).toBe('Teams are 92% even.');
    expect(evennessLine(0.7)).toBe('Teams are 60% even.');
  });

  it('never prints `100% even`: the top of the scale has its own words', () => {
    expect(evennessLine(0.5)).toBe(EVENNESS_PERFECT);
    expect(EVENNESS_PERFECT).toBe('Teams are as even as they get.');
    // And everything that rounds to 100 goes with it — the page must not print one sentence
    // at 0.5 and `100% even.` a thousandth away from it.
    expect(evennessLine(0.5025)).toBe(EVENNESS_PERFECT);
    expect(evennessLine(0.4975)).toBe(EVENNESS_PERFECT);
    expect(evennessLine(0.503)).toBe('Teams are 99% even.');
  });

  it('says the same thing either way round: the score is the gap, not the side', () => {
    for (const prob of [0.54, 0.6, 0.83, 1]) {
      expect(evennessLine(prob)).toBe(evennessLine(1 - prob));
    }
  });

  /**
   * No stored probability is **no line**, not `—` and not `unknown` (product, 2026-09-15). And
   * it returns rather than throwing the way `evenness` does: a value that crossed a wire and
   * lost its type must cost one line, not the page twenty people are reading in the dark.
   */
  it('has nothing to say without a stored probability, and never throws over one', () => {
    expect(evennessLine(null)).toBeNull();
    expect(evennessLine(undefined)).toBeNull();
    expect(evennessLine(Number.NaN)).toBeNull();
    expect(evennessLine(Number.POSITIVE_INFINITY)).toBeNull();
    expect(evennessLine(-0.0001)).toBeNull();
    expect(evennessLine(1.0001)).toBeNull();
  });
});
