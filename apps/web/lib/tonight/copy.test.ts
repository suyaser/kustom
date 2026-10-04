import { evenness } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { awardLine } from '../discord/embeds';
import { WORKED_ROSTER } from '../testing/workedExample';
import {
  ALL_TEN_IN,
  adminNames,
  asSentence,
  EVENNESS_PERFECT,
  evennessLine,
  IDLE_SENTENCE,
  OVERFULL_LEAD,
  OVERFULL_SENTENCE,
  ROLL_AT_TEN_HINT,
  ROLL_HINT,
  ROLL_REPAIR_HINT,
  rerollMarker,
  rollAdminHint,
  rollerSubLine,
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

/**
 * The roll copy (2026-10-03). Since ingest stopped balancing by itself, teams appear only when an
 * admin presses `Roll teams`, and no sentence on `/` may say or imply they show up on their own.
 * The other half of the premise is still true and has to stay readable beside it: who plays with
 * whom is the bot's call, not the admin's.
 */
describe('the roll, as `/` says it', () => {
  it('names the admin roll in the idle sentence, and keeps the bot as the one who picks', () => {
    expect(IDLE_SENTENCE).toBe(
      'When ten are in a custom lobby with Kustom running, an admin rolls and the bot picks the teams.',
    );
    expect(IDLE_SENTENCE).not.toMatch(/show up/i);
  });

  it('never claims teams appear by themselves, anywhere on the page', () => {
    for (const text of [IDLE_SENTENCE, ROLL_HINT, OVERFULL_SENTENCE]) {
      expect(text).not.toMatch(/show up|appear|automatic|in a moment/i);
    }
  });

  /**
   * `the right ten` read as "trim the lobby to ten by hand", which is the rotation's job: with
   * eleven or more around the bot already sits people out. The admin waits for whoever is coming.
   */
  it('means everyone staying, not literally ten', () => {
    expect(ROLL_HINT).toBe('Once everyone who is staying is in, an admin rolls the teams.');
    for (const text of [ROLL_HINT, ROLL_AT_TEN_HINT]) expect(text).not.toMatch(/right ten|right people/i);
  });

  it('M14.41: the roller reads no Waiting on, and the hint never restates the sub-line', () => {
    expect(rollerSubLine(10)).toBe(ALL_TEN_IN);
    expect(rollerSubLine(12)).toBe(OVERFULL_LEAD);
    expect(rollAdminHint(10, null)).toBe("Roll once everyone who's staying is in the lobby.");
    const preview = 'If the teams rolled now, Chaos and then Mo would sit out.';
    expect(rollAdminHint(12, preview)).toBe(preview);
    expect(rollAdminHint(12, null)).toBeNull();
    // M14.45: a balanced lobby with no teams drawn has its own line, whatever the count.
    expect(rollAdminHint(10, null, 'repair')).toBe(
      "The last roll didn't finish. Roll again to make the teams.",
    );
    expect(rollAdminHint(12, preview, 'repair')).toBe(ROLL_REPAIR_HINT);
    for (const text of [rollerSubLine(10), rollerSubLine(12), ROLL_AT_TEN_HINT]) {
      expect(text).not.toMatch(/Waiting on|Check everyone/);
    }
  });

  it('says the overfull lobby is still waiting on the roll, not only that someone sits out', () => {
    expect(OVERFULL_SENTENCE).toBe('Ten play, the rest sit out. Waiting on an admin to roll the teams.');
  });
});

describe('adminNames (2026-10-03)', () => {
  it('joins one, two and three names with `or`', () => {
    expect(adminNames(['Yasser'])).toBe('Yasser');
    expect(adminNames(['Yasser', 'Omar'])).toBe('Yasser or Omar');
    expect(adminNames(['Yasser', 'Omar', 'Sara'])).toBe('Yasser, Omar or Sara');
  });

  it('says nothing (the caller says `an admin`) for nobody, nameless rows only, or more than three', () => {
    expect(adminNames([])).toBeNull();
    expect(adminNames([null])).toBeNull();
    expect(adminNames(['A', 'B', 'C', 'D'])).toBeNull();
  });

  it('prints names the way the rest of the page does: trimmed and cut at 32', () => {
    expect(adminNames(['  Yasser  '])).toBe('Yasser');
    expect(adminNames(['a'.repeat(40)])).toBe(`${'a'.repeat(31)}…`);
  });
});

describe('rerollMarker (2026-10-03)', () => {
  it("is Discord's `reroll 1 of 2` as a sentence, for rank 2 and rank 3 of three", () => {
    expect(rerollMarker(2, 3)).toBe('Reroll 1 of 2. Teams changed.');
    expect(rerollMarker(3, 3)).toBe('Reroll 2 of 2. Teams changed.');
  });

  it('counts the splits the lobby stored, never a literal', () => {
    expect(rerollMarker(2, 2)).toBe('Reroll 1 of 1. Teams changed.');
    // A rank past the stored count still never reads `3 of 2`.
    expect(rerollMarker(4, 3)).toBe('Reroll 3 of 3. Teams changed.');
  });

  it("says nothing for the balancer's own split, or with no chosen split", () => {
    expect(rerollMarker(1, 3)).toBeNull();
    expect(rerollMarker(null, 3)).toBeNull();
  });
});

describe('asSentence', () => {
  it('capitalises a route refusal and gives it a full stop, once', () => {
    expect(asSentence('the lobby changed since you looked')).toBe('The lobby changed since you looked.');
    expect(asSentence('Already a sentence.')).toBe('Already a sentence.');
    expect(asSentence('  spaced out!  ')).toBe('Spaced out!');
  });
});
