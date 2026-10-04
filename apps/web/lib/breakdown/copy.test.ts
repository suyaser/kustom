import { config, type DeltaReason, type LegacyDeltaReason, type StoredDeltaReason } from '@customs/core';
import { describe, expect, it } from 'vitest';
import {
  EVEN_PCT,
  EXPLAIN_FOOTNOTE,
  explainSentences,
  explainText,
  LEGACY_AWARD_SENTENCE,
  oddsGapSentence,
  sentenceText,
} from './copy';

/**
 * "Why this many points" (M14.58) and the odds-gap line (M14.59): product's words, in product's
 * order, over core's structured reason. Plain-text assertions; the parts' mono split is the
 * component's business.
 */

const YOU = { kind: 'you' } as const;
const OMAR = { kind: 'name', name: 'Omar' } as const;

function stored(over: Partial<StoredDeltaReason> = {}): StoredDeltaReason {
  return {
    basis: 'stored',
    result: 'won',
    points: 31,
    basePoints: 31,
    odds: { pct: 50, stance: 'even' },
    certainty: 'settled',
    award: 'none',
    ...over,
  };
}

function legacy(over: Partial<LegacyDeltaReason> = {}): LegacyDeltaReason {
  return {
    basis: 'legacy',
    result: 'lost',
    points: -40,
    odds: { pct: 55, stance: 'favourite' },
    certainty: 'settling',
    award: 'unknown',
    ...over,
  };
}

describe('explainText: the brief example', () => {
  it('renders the example sentence for its fixture', () => {
    const reason = stored({
      result: 'lost',
      points: -50,
      basePoints: -62,
      odds: { pct: 62, stance: 'favourite' },
      certainty: 'settled',
      award: { kind: 'ace', effect: 12, fraction: 0.2 },
    });
    expect(explainText(reason, YOU)).toBe(
      "You lost 50. Your side was the 62% favourite, so a loss costs more. You're settled, so swings are small. ACE softened it by a fifth.",
    );
  });
});

describe('explainSentences: one per stance', () => {
  const lines = (reason: DeltaReason, subject: typeof YOU | typeof OMAR = YOU) =>
    explainSentences(reason, subject).map(sentenceText);

  it('favourite won', () => {
    expect(lines(stored({ odds: { pct: 62, stance: 'favourite' } }))[1]).toBe(
      'Your side was the 62% favourite, so a win pays less.',
    );
  });

  it('favourite lost', () => {
    expect(lines(stored({ result: 'lost', points: -30, odds: { pct: 62, stance: 'favourite' } }))[1]).toBe(
      'Your side was the 62% favourite, so a loss costs more.',
    );
  });

  it('underdog won', () => {
    expect(lines(stored({ odds: { pct: 38, stance: 'underdog' } }))[1]).toBe(
      'You were the 38% side, so beating the odds pays more.',
    );
  });

  it('underdog lost', () => {
    expect(lines(stored({ result: 'lost', points: -12, odds: { pct: 38, stance: 'underdog' } }))[1]).toBe(
      'You were the 38% side, so a loss costs less.',
    );
  });

  it('even', () => {
    expect(lines(stored())[1]).toBe('It was an even game.');
  });

  it("another player's row says their name once, in the lead, then They / Their", () => {
    expect(lines(stored({ odds: { pct: 62, stance: 'favourite' } }), OMAR)).toEqual([
      'Omar won 31.',
      'Their side was the 62% favourite, so a win pays less.',
      "They're settled, so swings are small.",
    ]);
    expect(
      lines(stored({ result: 'lost', points: -9, odds: { pct: 38, stance: 'underdog' } }), OMAR)[1],
    ).toBe('They were the 38% side, so a loss costs less.');
    const all = explainText(stored({ certainty: 'new', odds: { pct: 38, stance: 'underdog' } }), OMAR);
    expect(all.match(/Omar/g)).toHaveLength(1);
  });
});

describe('explainSentences: certainty and award', () => {
  const third = (reason: DeltaReason, subject: typeof YOU | typeof OMAR = YOU) =>
    sentenceText(explainSentences(reason, subject)[2] ?? []);

  it('one sentence per certainty band, both subjects', () => {
    expect(third(stored({ certainty: 'new' }))).toBe("You're new, so your number moves fast.");
    expect(third(stored({ certainty: 'settling' }))).toBe("You're still settling, so swings are bigger.");
    expect(third(stored({ certainty: 'settled' }))).toBe("You're settled, so swings are small.");
    expect(third(stored({ certainty: 'new' }), OMAR)).toBe("They're new, so their number moves fast.");
    expect(third(stored({ certainty: 'settling' }), OMAR)).toBe(
      "They're still settling, so swings are bigger.",
    );
  });

  it('MVP adds a quarter; none says nothing', () => {
    const mvp = stored({ points: 39, basePoints: 31, award: { kind: 'mvp', effect: 8, fraction: 0.25 } });
    expect(explainSentences(mvp, YOU).map(sentenceText).at(-1)).toBe('MVP added a quarter.');
    expect(explainSentences(stored(), YOU)).toHaveLength(3);
  });

  it('an award that rounds to 0 points is not mentioned', () => {
    const tiny = stored({ points: 1, basePoints: 1, award: { kind: 'mvp', effect: 0, fraction: 0.25 } });
    expect(explainText(tiny, YOU)).not.toMatch(/MVP/);
  });

  it('an old game says the bonus is not included instead of an award', () => {
    const lines = explainSentences(legacy(), YOU).map(sentenceText);
    expect(lines).toEqual([
      'You lost 40.',
      'Your side was the 55% favourite, so a loss costs more.',
      "You're still settling, so swings are bigger.",
      LEGACY_AWARD_SENTENCE,
    ]);
    expect(LEGACY_AWARD_SENTENCE).toBe(
      "This game is from before Kustom kept the bonus, so MVP or ACE isn't included.",
    );
  });

  it('a row missing a before says only the lead', () => {
    expect(explainText({ basis: 'lead-only', result: 'won', points: 18 }, OMAR)).toBe('Omar won 18.');
  });

  it('the footnote is product’s line', () => {
    expect(EXPLAIN_FOOTNOTE).toBe('Upsets and new players move the most.');
  });

  it('never prints a sigma or a decimal', () => {
    const all = [
      stored({ certainty: 'new', odds: { pct: 38, stance: 'underdog' } }),
      legacy(),
      stored({ points: 39, basePoints: 31, award: { kind: 'mvp', effect: 8, fraction: 0.25 } }),
    ]
      .map((reason) => explainText(reason, YOU))
      .join(' ');
    expect(all).not.toMatch(/sigma|σ/i);
    expect(all).not.toMatch(/\d\.\d/);
  });
});

describe('oddsGapSentence (M14.59, design round 1)', () => {
  const gap = (botBluePct: number, ratingBluePct: number, reason: 'new-players' | 'ratings-moved') => ({
    botBluePct,
    ratingBluePct,
    differ: botBluePct !== ratingBluePct,
    reason,
  });

  it("names the points number once, on the winner's side, with the new-player reason", () => {
    const line = oddsGapSentence(gap(43, 50, 'new-players'), 200);
    expect(line && sentenceText(line)).toBe('For points, Red was 50%, because new players start at 1200.');
    const blue = oddsGapSentence(gap(57, 61, 'new-players'), 100);
    expect(blue && sentenceText(blue)).toBe('For points, Blue was 61%, because new players start at 1200.');
  });

  it('says ratings moved when nobody was new', () => {
    const line = oddsGapSentence(gap(57, 55, 'ratings-moved'), 100);
    expect(line && sentenceText(line)).toBe(
      'For points, Blue was 55%, because ratings moved since the roll.',
    );
  });

  it('is nothing when both numbers put the winner in the even band (48-52)', () => {
    expect(oddsGapSentence(gap(49, 50, 'new-players'), 200)).toBeNull();
    expect(oddsGapSentence(gap(48, 52, 'new-players'), 100)).toBeNull();
    // One of the two outside the band: the line shows.
    expect(oddsGapSentence(gap(47, 52, 'new-players'), 100)).not.toBeNull();
  });

  it('is nothing when the two round the same, or one is missing', () => {
    expect(
      oddsGapSentence({ botBluePct: 57, ratingBluePct: 57, differ: false, reason: null }, 100),
    ).toBeNull();
    expect(
      oddsGapSentence({ botBluePct: null, ratingBluePct: 57, differ: false, reason: null }, 100),
    ).toBeNull();
  });

  it("the even band is core's", () => {
    expect(EVEN_PCT).toEqual(config.rating.explain.evenPct);
  });
});
