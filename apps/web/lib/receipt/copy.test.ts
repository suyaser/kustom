import type { Assignment, Role } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { HOW_SPLIT_LINES } from '../landing/copy';
import {
  barPercents,
  barSentence,
  bothSidesOdds,
  calibrationLineParts,
  calibrationTooFewParts,
  explanationShown,
  howIntroParts,
  mainRolesChip,
  mainRolesChipParts,
  NO_MAIN_ROLES_CHIP,
  NOBODY_HAS_A_MAIN,
  ONLY_SPLIT,
  oddsSentence,
  offRoleLineParts,
  pickChip,
  pickChipParts,
  plain,
  RECEIPT_ANCHOR,
  type ReceiptSplit,
  rankedLowerParts,
  ratingGapChip,
  ratingGapChipParts,
  reasonLine,
  reasonLineParts,
  receiptChips,
  rerollAnnouncement,
  rerollPrefix,
  resultOdds,
  resultOddsLine,
  resultOddsShort,
  sideOdds,
  sideOddsParts,
  splitRolesTerm,
  whyLowerClause,
} from './copy';

/** STRATEGY §4.3 to §4.9's words, pinned against the numbers they are built from. */

const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const side = (prefix: string): Assignment[] => LANES.map((role) => ({ puuid: `${prefix}-${role}`, role }));

function split(overrides: Partial<ReceiptSplit> = {}): ReceiptSplit {
  return {
    rank: 1,
    blue: side('b'),
    red: side('r'),
    gap: 100,
    offRoleCount: 0,
    blueWinProb: 0.54,
    ...overrides,
  };
}

/** Swap blue's `a` lane with red's `b` lane. */
function swapped(base: ReceiptSplit, a: Role, b: Role, overrides: Partial<ReceiptSplit> = {}): ReceiptSplit {
  const fromBlue = base.blue.find((x) => x.role === a) as Assignment;
  const fromRed = base.red.find((x) => x.role === b) as Assignment;
  return {
    ...base,
    rank: base.rank + 1,
    blue: base.blue.map((x) => (x === fromBlue ? { puuid: fromRed.puuid, role: a } : x)),
    red: base.red.map((x) => (x === fromRed ? { puuid: fromBlue.puuid, role: b } : x)),
    ...overrides,
  };
}

const name = (puuid: string): string => puuid.toUpperCase();

describe('oddsSentence (STRATEGY §4.3)', () => {
  it.each([
    [0.5, 'Dead even.'],
    [0.504, 'Dead even.'],
    [0.52, 'Basically a coin flip.'],
    [0.47, 'Basically a coin flip.'],
    [0.54, 'Close. Blue has a slight edge.'],
    [0.43, 'Close. Red has a slight edge.'],
    [0.6, 'Blue is favored.'],
    [0.38, 'Red is favored.'],
    [0.7, 'Blue is clearly favored. This was the fairest split these ten allow.'],
  ])('%s -> %s', (p, sentence) => {
    expect(oddsSentence(p, 1)).toBe(sentence);
  });

  it('never claims the fairest split on a reroll', () => {
    expect(oddsSentence(0.3, 2)).toBe('Red is clearly favored.');
  });
});

describe('the chips (STRATEGY §4.5)', () => {
  it('labels the gap with its unit', () => {
    expect(ratingGapChip(45)).toBe('Rating gap 45 pts');
  });

  it('says the good case positively', () => {
    expect(mainRolesChip(0)).toBe('Main roles 10/10');
    expect(mainRolesChip(2)).toBe('2 off main role');
  });

  it('M14.41: counts main roles only among players who have one (0, some, all ten without)', () => {
    expect(mainRolesChip(0, 0)).toBe('Main roles 10/10');
    expect(mainRolesChip(0, 4)).toBe('Main roles 6/6 · 4 new');
    expect(mainRolesChip(2, 4)).toBe('2 off main role · 4 new');
    expect(mainRolesChip(0, 10)).toBe(NO_MAIN_ROLES_CHIP);
    expect(receiptChips(split(), 3, 4)[1]).toBe('Main roles 6/6 · 4 new');
    const name = (puuid: string) => puuid;
    expect(plain(offRoleLineParts([], name, 0))).toBe("Everyone's on their main role.");
    expect(plain(offRoleLineParts([], name, 1))).toBe('1 person has no main role yet.');
    expect(plain(offRoleLineParts([], name, 4))).toBe('4 people have no main role yet.');
    expect(plain(offRoleLineParts([], name, 10))).toBe(NOBODY_HAS_A_MAIN);
    expect(splitRolesTerm(0, 4)).toEqual({ term: 'Main roles', value: '6/6' });
    expect(splitRolesTerm(0, 10)).toEqual({
      term: 'Main roles',
      value: 'no main roles yet',
      termHidden: true,
    });
    // History passes nothing: unchanged.
    expect(splitRolesTerm(0)).toEqual({ term: 'Main roles', value: '10/10' });
  });

  it("M14.41 review: core's all-on-main clause follows the chip, matched whole, history untouched", () => {
    const core = 'Blue favored 54%. Everyone on a main role. Gap 60. Next best: swap A and B, gap 40.';
    expect(explanationShown(core, 0)).toBe(core);
    expect(explanationShown(core, 4)).toBe(
      'Blue favored 54%. 4 new, the rest on a main role. Gap 60. Next best: swap A and B, gap 40.',
    );
    expect(explanationShown('Even 50%. Everyone on a main role. Gap 0.', 10)).toBe(
      'Even 50%. No main roles yet. Gap 0.',
    );
    // An off-role sentence makes no claim about everyone, and a stray phrase elsewhere is not the clause.
    const off = 'Red favored 51%. Hana off-role at support. Gap 45.';
    expect(explanationShown(off, 4)).toBe(off);
    const odd = 'Gap 9. Everyone on a main role. lol';
    expect(explanationShown(odd, 4)).toBe(odd);
  });

  it('shows the pick and the reroll', () => {
    expect(pickChip(1, 3)).toBe("Bot's pick #1 of 3");
    expect(pickChip(2, 3)).toBe('Reroll 1 of 2 · pick #2');
    expect(pickChip(3, 3)).toBe('Reroll 2 of 2 · pick #3');
    expect(receiptChips(split(), 3)).toEqual([
      'Rating gap 100 pts',
      'Main roles 10/10',
      "Bot's pick #1 of 3",
    ]);
  });

  it("prefixes a reroll post, and nothing on the bot's own pick", () => {
    expect(rerollPrefix(1, 3)).toBe('');
    expect(rerollPrefix(2, 3)).toBe('Reroll 1 of 2. ');
  });
});

describe('reasonLine (STRATEGY §4.4)', () => {
  it('names a same-lane swap by lane', () => {
    const chosen = split();
    const next = swapped(chosen, 'top', 'top', { gap: 170, blueWinProb: 0.57 });
    expect(reasonLine(chosen, next, 3, name)).toBe(
      "Next best: swap the top players, B-TOP and R-TOP. That's Blue 57%, with a bigger rating gap (170 vs 100 pts).",
    );
  });

  it('names each lane when the two play different ones', () => {
    const chosen = split();
    const next = swapped(chosen, 'mid', 'support', { offRoleCount: 2, blueWinProb: 0.48 });
    expect(reasonLine(chosen, next, 3, name)).toBe(
      'Next best: swap B-MID (mid) and R-SUPPORT (support). Red 52%, with 2 more off their main role.',
    );
  });

  it('counts the players a reshuffle moves', () => {
    const chosen = split();
    const next = swapped(swapped(chosen, 'top', 'top'), 'mid', 'mid', { rank: 2, gap: 90, blueWinProb: 0.5 });
    expect(reasonLine(chosen, next, 3, name)).toBe(
      'Next best reshuffles 4 players. 50–50, and it scored a hair worse overall (repeated teams, recent fills or rounding).',
    );
  });

  it('explains a runner-up with closer odds: case 1 or 2 always fires', () => {
    const chosen = split({ blueWinProb: 0.56, gap: 40 });
    const next = swapped(chosen, 'top', 'top', { blueWinProb: 0.51, gap: 80 });
    expect(reasonLine(chosen, next, 3, name)).toContain('with a bigger rating gap (80 vs 40 pts)');
  });

  it('says the only split fit when the lobby stored one, and nothing at the end of a reroll', () => {
    expect(reasonLine(split(), null, 1, name)).toBe(ONLY_SPLIT);
    expect(reasonLine(split({ rank: 3 }), null, 3, name)).toBeNull();
  });

  it('says nothing about two splits of different tens', () => {
    const other = { ...split({ rank: 2 }), blue: side('x') };
    expect(reasonLine(split(), other, 3, name)).toBeNull();
  });

  it('spells the three why-lower clauses', () => {
    expect(whyLowerClause({ kind: 'off-role', k: 1 })).toBe('with 1 more off their main role');
    expect(whyLowerClause({ kind: 'gap', chosenGap: 10, nextGap: 20 })).toBe(
      'with a bigger rating gap (20 vs 10 pts)',
    );
    expect(whyLowerClause({ kind: 'role-costs' })).toBe(
      'and it scored a hair worse overall (repeated teams, recent fills or rounding)',
    );
  });

  it('spells the three stored-term clauses (M18.13)', () => {
    expect(whyLowerClause({ kind: 'repeat' })).toBe("and it's last game's teams again");
    expect(whyLowerClause({ kind: 'variety', chosenPairs: 1, nextPairs: 4 })).toBe(
      "and it keeps more of last game's teammates together (4 vs 1 pair)",
    );
    expect(whyLowerClause({ kind: 'recent-fills' })).toBe(
      'and it fills someone who was filled more recently',
    );
  });
});

describe('reasonLine from stored score parts (M18.13)', () => {
  const parts = (over: Partial<NonNullable<ReceiptSplit['scoreParts']>> = {}) => ({
    gap: 90,
    offRole: 0,
    repeat: 0,
    variety: 0,
    repeatedPairs: 0,
    ...over,
  });
  // Same gap and fills on both, so the reason has to come from the parts.
  const chosen = split({ gap: 90, scoreParts: parts() });
  const next = (over: Partial<NonNullable<ReceiptSplit['scoreParts']>>) =>
    swapped(chosen, 'top', 'top', { gap: 90, blueWinProb: 0.51, scoreParts: parts(over) });

  it('names each term', () => {
    expect(reasonLine(chosen, next({ repeat: 200 }), 3, name)).toBe(
      "Next best: swap the top players, B-TOP and R-TOP. That's Blue 51%, and it's last game's teams again.",
    );
    expect(reasonLine(chosen, next({ variety: 75, repeatedPairs: 3 }), 3, name)).toBe(
      "Next best: swap the top players, B-TOP and R-TOP. That's Blue 51%, and it keeps more of last game's teammates together (3 vs 0 pairs).",
    );
    expect(reasonLine(chosen, next({ offRole: 60 }), 3, name)).toBe(
      "Next best: swap the top players, B-TOP and R-TOP. That's Blue 51%, and it fills someone who was filled more recently.",
    );
  });

  it('keeps the old words for a row stored before score_parts', () => {
    expect(reasonLine(split({ gap: 90 }), next({ repeat: 200 }), 3, name)).toContain(
      'and it scored a hair worse overall',
    );
  });
});

describe('the scoring sentence (M18.13)', () => {
  it('names fill protection, the repeat nudge and teammate variety, the same on the receipt and /how', () => {
    const sentence =
      "plus a cost for every player off their main role (bigger if they were filled recently), plus a nudge against repeating last game's teams or putting last game's teammates back together. Lowest score wins.";
    expect(plain(howIntroParts(3))).toContain(sentence);
    expect(HOW_SPLIT_LINES[1]).toContain(sentence);
  });
});

describe('rankedLowerParts (M18.13 terms)', () => {
  it('names each stored term on a split row', () => {
    expect(plain(rankedLowerParts({ kind: 'repeat' }, false))).toBe("Ranked lower: last game's teams again.");
    expect(plain(rankedLowerParts({ kind: 'variety', chosenPairs: 2, nextPairs: 4 }, true))).toBe(
      "Closer odds, but ranked lower: more of last game's teammates together (4 vs 2 pairs).",
    );
    expect(plain(rankedLowerParts({ kind: 'variety', chosenPairs: 1, nextPairs: 4 }, false))).toBe(
      "Ranked lower: more of last game's teammates together (4 vs 1 pair).",
    );
    expect(plain(rankedLowerParts({ kind: 'recent-fills' }, false))).toBe(
      'Ranked lower: it fills someone who was filled more recently.',
    );
  });
});

describe('the result line (STRATEGY §4.5, §4.7, §4.9)', () => {
  it("is the winner's share, with Upset! under 50", () => {
    expect(resultOddsLine(0.54, 100)).toBe('Blue was 54%. Blue won.');
    expect(resultOddsLine(0.54, 200)).toBe('Red was 46%. Red won. Upset!');
    expect(resultOddsLine(0.38, 200)).toBe('Red was 62%. Red won.');
  });

  it('is 50–50 on a rounded coin flip, never an upset', () => {
    expect(resultOddsLine(0.5, 200)).toBe('50–50. Red won.');
    expect(resultOddsLine(0.496, 100)).toBe('50–50. Blue won.');
  });
});

describe('the small pieces', () => {
  it('labels both ends of the bar so they add up', () => {
    expect(barPercents(0.545)).toEqual({ blue: 55, red: 45 });
    expect(sideOdds(0.43)).toBe('Red 57%');
    expect(sideOdds(0.5)).toBe('50–50');
  });

  it("takes core's range check: no probability outside [0, 1] becomes a percentage", () => {
    expect(() => barPercents(1.2)).toThrow();
    expect(() => barPercents(Number.NaN)).toThrow();
    expect(() => resultOddsLine(-0.1, 100)).toThrow();
  });

  it('names the disclosure the Discord link lands on', () => {
    expect(RECEIPT_ANCHOR).toBe('how-the-bot-decided');
  });
});

describe('rich parts and the page receipt (M14.9)', () => {
  it('every plain export is its parts flattened, so page and Discord cannot disagree', () => {
    expect(plain(ratingGapChipParts(45))).toBe(ratingGapChip(45));
    expect(plain(mainRolesChipParts(2))).toBe(mainRolesChip(2));
    expect(plain(pickChipParts(2, 3))).toBe(pickChip(2, 3));
    expect(plain(sideOddsParts(0.5))).toBe(sideOdds(0.5));
    expect(plain(sideOddsParts(0.43))).toBe(sideOdds(0.43));
    const chosen = split();
    const next = split({
      rank: 2,
      gap: 170,
      blueWinProb: 0.57,
      blue: [...side('b').slice(0, 4), { puuid: 'r-support', role: 'support' }],
      red: [...side('r').slice(0, 4), { puuid: 'b-support', role: 'support' }],
    });
    const name = (puuid: string) => puuid.toUpperCase();
    const parts = reasonLineParts(chosen, next, 3, name);
    expect(parts).not.toBeNull();
    expect(plain(parts ?? [])).toBe(reasonLine(chosen, next, 3, name));
    expect(parts).toContainEqual({ strong: 'B-SUPPORT' });
  });

  it('the bar sentence, both-sides odds and the reroll announcement use favoredSide rounding', () => {
    expect(barSentence(0.494)).toBe('Blue 49 percent, Red 51 percent.');
    expect(bothSidesOdds(0.52)).toBe('Blue 52% · 48% Red');
    expect(rerollAnnouncement(0.51)).toBe('Teams rerolled. Blue 51 percent, Red 49 percent.');
  });

  it('resultOdds splits the upset out for the compact tag; resultOddsLine still appends Upset!', () => {
    expect(resultOdds(0.53, 200)).toEqual({
      line: 'Red was 47%. Red won.',
      odds: 'Red was 47%.',
      upset: true,
    });
    expect(resultOddsLine(0.53, 200)).toBe('Red was 47%. Red won. Upset!');
    expect(resultOdds(0.5, 100)).toEqual({ line: '50–50. Blue won.', odds: '50–50.', upset: false });
  });

  it("resultOddsShort is Tonight's poster line: the games row's wording, Upset! kept (M14.45)", () => {
    expect(resultOddsShort(0.49, 200)).toBe('Red was 51%.');
    expect(resultOddsShort(0.54, 200)).toBe('Red was 46%. Upset!');
    expect(resultOddsShort(0.5, 100)).toBe('50–50.');
  });

  it('calibration says nothing in percent under 20 games', () => {
    expect(plain(calibrationTooFewParts(7))).toBe("Not enough games yet to check the bot's odds (7 of 20).");
    expect(plain(calibrationLineParts(103, 58, 56, 55))).toBe(
      'The side the bot favored won 58 of 103 games (56%). It expected about 55%.',
    );
  });
});
