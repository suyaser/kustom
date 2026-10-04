import { config, type KustomDeltaParts } from '@customs/core';
import { describe, expect, it } from 'vitest';
import {
  EVEN_PCT,
  EXPLAIN_FOOTNOTE,
  explainSentences,
  explainText,
  oddsGapSentence,
  roundingSentence,
  SETTLED_K,
  sentenceText,
} from './copy';
import type { KustomReason } from './read';

/**
 * "Why this many points" (M14.58, Kustom since M18.6) and the odds-gap line (M14.59): the draft
 * copy of 05-design 11.6.1, in 11.6's order, over core's `explainKustomDelta` parts. Plain-text
 * assertions; the parts' mono split is the component's business.
 */

const YOU = { kind: 'you' } as const;
const OMAR = { kind: 'name', name: 'Omar' } as const;

/** 11.6's sums, written with plain spaces here and U+2009 in the copy. */
function thin(text: string): string {
  return text.replaceAll(' × ', ' × ').replaceAll(' = ', ' = ');
}

function parts(over: Partial<KustomDeltaParts> = {}): KustomDeltaParts {
  return {
    side: 200,
    result: 'win',
    expectedPct: 56,
    k: 16,
    firstTenGames: false,
    shareRank: 1,
    share: 1.2,
    award: 'mvp',
    points: 8,
    ...over,
  };
}

function reason(over: Partial<KustomDeltaParts> = {}, rest: Partial<KustomReason> = {}): KustomReason {
  return { track: 'all-time', parts: parts(over), gamesBefore: 20, allTime: null, ...rest };
}

describe('explainText: 11.6.2, the filled all-time row', () => {
  it('reads the settled MVP of a 56% win', () => {
    expect(explainText(reason(), YOU)).toBe(
      thin(
        'Your side won as the 56% favourite, so the win was worth 16 × 44% = 7. You had the best game on your team (MVP): ×1.2.',
      ),
    );
    expect(roundingSentence(reason())).toBeNull();
  });
});

describe('the odds sentence: one per stance (11.6.1)', () => {
  const first = (r: KustomReason, subject = YOU) => sentenceText(explainSentences(r, subject)[0] ?? []);

  it('favourite won / lost', () => {
    expect(first(reason())).toBe(
      thin('Your side won as the 56% favourite, so the win was worth 16 × 44% = 7.'),
    );
    expect(first(reason({ result: 'loss', share: 0.8, award: 'ace', points: -11 }))).toBe(
      thin('Your side lost as the 56% favourite, so the loss cost 16 × 56% = 9.'),
    );
  });

  it('underdog won / lost', () => {
    expect(first(reason({ expectedPct: 44, points: 11 }))).toBe(
      thin('Your side won as the 44% underdog, so the win was worth 16 × 56% = 9.'),
    );
    expect(first(reason({ expectedPct: 44, result: 'loss', shareRank: 3, share: 1, award: 'none' }))).toBe(
      thin('Your side lost as the 44% underdog, so the loss cost 16 × 44% = 7.'),
    );
  });

  it('even (48 to 52 inclusive), either result', () => {
    expect(first(reason({ expectedPct: 50 }))).toBe(
      thin('It was an even game (50%), so the win was worth 16 × 50% = 8.'),
    );
    expect(first(reason({ expectedPct: 52, result: 'loss' }))).toBe(
      thin('It was an even game (52%), so the loss cost 16 × 52% = 8.'),
    );
  });

  it('a first-ten game prints that game’s K, rounded', () => {
    expect(first(reason({ expectedPct: 44, k: 30.4, firstTenGames: true }))).toBe(
      thin('Your side won as the 44% underdog, so the win was worth 30 × 56% = 17.'),
    );
  });
});

describe('the share sentence: every rank (11.6.1)', () => {
  const share = (over: Partial<KustomDeltaParts>, subject = YOU) =>
    sentenceText(explainSentences(reason(over), subject)[1] ?? []);

  it('winners, 1 to 5', () => {
    expect(share({})).toBe('You had the best game on your team (MVP): ×1.2.');
    expect(share({ shareRank: 2, share: 1.1, award: 'none' })).toBe(
      'Your game was 2nd best on your team: ×1.1.',
    );
    expect(share({ shareRank: 3, share: 1, award: 'none' })).toBe('Your game was 3rd best on your team: ×1.');
    expect(share({ shareRank: 4, share: 0.9, award: 'none' })).toBe(
      'Your game was 4th best on your team: ×0.9.',
    );
    expect(share({ shareRank: 5, share: 0.8, award: 'none' })).toBe(
      'Your game was 5th best on your team: ×0.8.',
    );
  });

  it('losers, 1 to 5: the best loser gives back least, and nobody is called worst', () => {
    const lost = { result: 'loss' as const, award: 'none' as const };
    expect(share({ ...lost, shareRank: 1, share: 0.8, award: 'ace' })).toBe(
      'You had the best game on your team (ACE), so you gave back least: ×0.8.',
    );
    expect(share({ ...lost, shareRank: 2, share: 0.9 })).toBe('Your game was 2nd best on your team: ×0.9.');
    expect(share({ ...lost, shareRank: 3, share: 1 })).toBe('Your game was 3rd best on your team: ×1.');
    expect(share({ ...lost, shareRank: 4, share: 1.1 })).toBe('Your game was 4th best on your team: ×1.1.');
    expect(share({ ...lost, shareRank: 5, share: 1.2 })).toBe(
      'Your game was 5th best on your team, so you gave back most: ×1.2.',
    );
  });

  it('no performance score: everyone counts ×1', () => {
    expect(share({ shareRank: null, share: 1, award: 'none' })).toBe(
      'This game has no performance score, so everyone counts ×1.',
    );
  });
});

describe('the first-ten sentence (11.6.1)', () => {
  it('appears only when K is above 16, with the game’s K', () => {
    expect(explainSentences(reason(), YOU)).toHaveLength(2);
    const lines = explainSentences(reason({ k: 30.4, firstTenGames: true }), YOU).map(sentenceText);
    expect(lines[2]).toBe(
      'Your first 10 games count extra while your Rating finds its level (×30 instead of ×16).',
    );
  });

  it('on the week track, everyone’s first 10 games of a week', () => {
    const lines = explainSentences(
      reason({ k: 32, firstTenGames: true, expectedPct: 50 }, { track: 'week', gamesBefore: 0 }),
      YOU,
    ).map(sentenceText);
    expect(lines[2]).toBe("Everyone's first 10 games of a week count extra (×32 instead of ×16).");
  });
});

describe("somebody else's row: the name once, then They / their", () => {
  it('reads the 11.6.1 third-person lines', () => {
    expect(explainText(reason({ k: 30.4, firstTenGames: true, points: 16 }), OMAR)).toBe(
      thin(
        "Omar's side won as the 56% favourite, so the win was worth 30 × 44% = 13. They had the best game on their team (MVP): ×1.2. Their first 10 games count extra while their Rating finds its level (×30 instead of ×16).",
      ),
    );
    expect(
      sentenceText(
        explainSentences(reason({ result: 'loss', shareRank: 5, share: 1.2, award: 'none' }), OMAR)[1] ?? [],
      ),
    ).toBe('Their game was 5th best on their team, so they gave back most: ×1.2.');
  });

  it('an even game names them in the one sentence that can', () => {
    expect(sentenceText(explainSentences(reason({ expectedPct: 50 }), OMAR)[0] ?? [])).toBe(
      thin("It was an even game for Omar's side (50%), so the win was worth 16 × 50% = 8."),
    );
  });
});

describe('two tracks in one panel (11.6.3)', () => {
  const week = reason(
    { expectedPct: 50, k: 32, firstTenGames: true, points: 19 },
    { track: 'week', gamesBefore: 0, allTime: { points: 8, rating: 1300 } },
  );

  it('explains the weekly change, then the all-time change in one labelled clause', () => {
    expect(explainText(week, YOU, { rollSidePct: 56 })).toBe(
      thin(
        "On this week's numbers it was an even game (50%), so the win was worth 32 × 50% = 16. You had the best game on your team (MVP): ×1.2. Everyone's first 10 games of a week count extra (×32 instead of ×16). All time: +8, to 1300.",
      ),
    );
    expect(roundingSentence(week)).toBeNull();
  });

  it('a later game of the week whose odds match the roll opens plainly; a loss clause prints U+2212', () => {
    const later = reason(
      { result: 'loss', shareRank: 3, share: 1, award: 'none', points: -9 },
      { track: 'week', gamesBefore: 3, allTime: { points: -9, rating: 1291 } },
    );
    const lines = explainSentences(later, YOU, { rollSidePct: 56 }).map(sentenceText);
    expect(lines[0]).toBe(thin('Your side lost as the 56% favourite, so the loss cost 16 × 56% = 9.'));
    expect(lines.at(-1)).toBe('All time: −9, to 1291.');
    expect(explainSentences(later, YOU, { rollSidePct: 60 }).map(sentenceText)[0]).toMatch(
      /^On this week's numbers your side/,
    );
  });

  it('All time has no week clause', () => {
    expect(explainSentences(reason({}, { allTime: { points: 8, rating: 1300 } }), YOU)).toHaveLength(2);
  });
});

describe('the rounding line (11.6.4)', () => {
  it('appears on XETA: 16 × 44% = 7, ×0.9 gives 6, printed −7', () => {
    const xeta = reason({
      side: 100,
      result: 'loss',
      expectedPct: 44,
      shareRank: 2,
      share: 0.9,
      award: 'none',
      points: -7,
    });
    expect(sentenceText(explainSentences(xeta, YOU)[0] ?? [])).toBe(
      thin('Your side lost as the 44% underdog, so the loss cost 16 × 44% = 7.'),
    );
    const line = roundingSentence(xeta);
    expect(line && sentenceText(line)).toBe('Ratings keep their decimals, so this shows 1 off the sum.');
  });
});

describe('words that are gone', () => {
  it('never prints a sigma, a certainty word or a decimal K', () => {
    const all = [
      reason(),
      reason({ k: 30.4, firstTenGames: true }),
      reason({ shareRank: null, share: 1, award: 'none' }),
    ]
      .flatMap((r) => [explainText(r, YOU), explainText(r, OMAR)])
      .join(' ');
    expect(all).not.toMatch(/sigma|σ|settl|new player|moves fast|quarter|fifth|30\.4/i);
  });

  it('the footnote is 11.6’s line', () => {
    expect(EXPLAIN_FOOTNOTE).toBe('Upsets and first games move the most.');
  });

  it("the settled K and the even band are core's", () => {
    expect(SETTLED_K).toBe(config.kustom.kSettled);
    expect(EVEN_PCT).toEqual(config.rating.explain.evenPct);
  });
});

describe('oddsGapSentence (M14.59; no because clause since M18.6, 05-design 11.7)', () => {
  const gap = (botBluePct: number, ratingBluePct: number) => ({
    botBluePct,
    ratingBluePct,
    differ: botBluePct !== ratingBluePct,
  });

  it("names the points number once, on the winner's side", () => {
    const line = oddsGapSentence(gap(43, 50), 200);
    expect(line && sentenceText(line)).toBe('For points, Red was 50%.');
    const blue = oddsGapSentence(gap(57, 61), 100);
    expect(blue && sentenceText(blue)).toBe('For points, Blue was 61%.');
  });

  it('is nothing when both numbers put the winner in the even band (48-52)', () => {
    expect(oddsGapSentence(gap(49, 50), 200)).toBeNull();
    expect(oddsGapSentence(gap(48, 52), 100)).toBeNull();
    expect(oddsGapSentence(gap(47, 52), 100)).not.toBeNull();
  });

  it('is nothing when the two do not differ (a Kustom roll), or one is missing', () => {
    expect(oddsGapSentence({ botBluePct: 57, ratingBluePct: 61, differ: false }, 100)).toBeNull();
    expect(oddsGapSentence({ botBluePct: null, ratingBluePct: 57, differ: false }, 100)).toBeNull();
  });
});
