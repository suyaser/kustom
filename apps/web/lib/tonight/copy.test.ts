import { evenness } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { awardLine } from '../discord/embeds';
import { WORKED_ROSTER } from '../testing/workedExample';
import {
  EVENNESS_PERFECT,
  evennessLine,
  TAPE_NO_RESULT,
  TAPE_TITLE,
  TAPE_WINS,
  tapeGameLabel,
  tapeRatedNote,
  tapeSatOut,
  webAwardLine,
} from './copy';

describe('webAwardLine (M11.3)', () => {
  it("is the result post's `awardLine`, byte for byte, for every name in the worked example", () => {
    for (const mvp of WORKED_ROSTER) {
      for (const ace of WORKED_ROSTER) {
        const award = { mvp: mvp.name, ace: ace.name };
        expect(webAwardLine(award)).toBe(awardLine(award));
      }
    }
    expect(webAwardLine({ mvp: 'Lena', ace: 'Rami' })).toBe('MVP Lena · ACE Rami');
  });

  it('keeps `Someone` and the 32-character cut, and leaves no Discord escape on the page', () => {
    expect(webAwardLine({ mvp: null, ace: 'Rami' })).toBe(awardLine({ mvp: null, ace: 'Rami' }));
    const long = 'a'.repeat(40);
    expect(webAwardLine({ mvp: long, ace: 'Rami' })).toBe(awardLine({ mvp: long, ace: 'Rami' }));
    // The one difference, on purpose: a backslash before `_` is right in a channel and wrong in a `<p>`.
    expect(awardLine({ mvp: 'lena_x', ace: 'Rami' })).toBe('MVP lena\\_x · ACE Rami');
    expect(webAwardLine({ mvp: 'lena_x', ace: 'Rami' })).toBe('MVP lena_x · ACE Rami');
  });
});

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

describe('the night tape copy (M11.2)', () => {
  it("pins product's words", () => {
    expect(TAPE_TITLE).toBe('Earlier tonight');
    expect(tapeGameLabel(2)).toBe('GAME 2');
    expect(TAPE_WINS).toBe('WINS');
    expect(TAPE_NO_RESULT).toBe('NO RESULT');
  });

  it('says ARAM · not rated on ARAM, not rated on a remake, and nothing on a rated game', () => {
    expect(tapeRatedNote({ aram: true, rated: false })).toBe('ARAM · not rated');
    expect(tapeRatedNote({ aram: false, rated: false })).toBe('not rated');
    expect(tapeRatedNote({ aram: false, rated: true })).toBeNull();
  });

  it('names the sitters in the order given, with Someone for a name we lack', () => {
    expect(tapeSatOut(['Yuki', 'Omar'])).toBe('Sat out: Yuki, Omar.');
    expect(tapeSatOut(['Yuki', null])).toBe('Sat out: Yuki, Someone.');
    expect(tapeSatOut([])).toBeNull();
  });
});
