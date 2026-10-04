import type { Certainty, DeltaReason, GameResult, OddsStance } from '@customs/core';
import type { OddsGapReason } from './read';

/**
 * The words for "why this many points" (M14.58) and the odds-gap line (M14.59). Product's copy
 * (milestones M14.58 / M14.59 briefs, 2026-10-04) for the viewer's own row; the third-person
 * variants for anybody else's row are the web lane's [NEW COPY].
 *
 * Pure and client-safe: type-only imports, no zod, no `node:*`. Core decides every fact (the
 * stance, the certainty band, the award and its effect); this file only picks words. Sigma is
 * never a number here, and no percent is ever called the exact scaling factor.
 *
 * A sentence is a list of parts so a number can be set in mono inside running text (05-design 6.12):
 * a string is text, `{ num }` is a number.
 */
export type CopyPart = string | { num: string };
export type Sentence = readonly CopyPart[];

/** Whose row it is: the signed-in viewer's (`You won 31.`) or somebody else's (`Omar won 31.`). */
export type ExplainSubject = { kind: 'you' } | { kind: 'name'; name: string };

/**
 * Under every explanation, small (product, M14.58; M14.64 made it true for a win and a loss, and
 * for somebody else's row: the old "Bigger when you're new" read wrong under a cheap loss).
 */
export const EXPLAIN_FOOTNOTE = 'Upsets and new players move the most.';

/** A row stored before `0034`: the award sentence's stand-in (product, M14.58). */
export const LEGACY_AWARD_SENTENCE =
  "This game is from before Kustom kept the bonus, so MVP or ACE isn't included.";

/** The odds sentence for an even game, either subject. */
export const EVEN_GAME_SENTENCE = 'It was an even game.';

function lead(subject: ExplainSubject, result: GameResult, points: number): Sentence {
  const who = subject.kind === 'you' ? 'You' : subject.name;
  return [`${who} ${result} `, { num: String(Math.abs(points)) }, '.'];
}

function odds(subject: ExplainSubject, result: GameResult, pct: number, stance: OddsStance): Sentence {
  if (stance === 'even') return [EVEN_GAME_SENTENCE];
  const share = { num: `${pct}%` };
  if (stance === 'favourite') {
    // The name is said once, in the lead; after it, `Their` / `They` (design round 1).
    const side = subject.kind === 'you' ? 'Your side' : 'Their side';
    const tail = result === 'won' ? ' favourite, so a win pays less.' : ' favourite, so a loss costs more.';
    return [`${side} was the `, share, tail];
  }
  const who = subject.kind === 'you' ? 'You were' : 'They were';
  const tail = result === 'won' ? ' side, so beating the odds pays more.' : ' side, so a loss costs less.';
  return [`${who} the `, share, tail];
}

const CERTAINTY_YOU: Readonly<Record<Certainty, string>> = {
  new: "You're new, so your number moves fast.",
  settling: "You're still settling, so swings are bigger.",
  settled: "You're settled, so swings are small.",
};

const CERTAINTY_THEY: Readonly<Record<Certainty, string>> = {
  new: "They're new, so their number moves fast.",
  settling: "They're still settling, so swings are bigger.",
  settled: "They're settled, so swings are small.",
};

function certainty(subject: ExplainSubject, band: Certainty): Sentence {
  return [(subject.kind === 'you' ? CERTAINTY_YOU : CERTAINTY_THEY)[band]];
}

/** `a quarter` / `a fifth` for the configured shares; any other share as a whole percent. */
function share(fraction: number): CopyPart[] {
  if (Math.abs(fraction - 0.25) < 1e-9) return ['a quarter'];
  if (Math.abs(fraction - 0.2) < 1e-9) return ['a fifth'];
  return [{ num: `${Math.round(fraction * 100)}%` }];
}

/**
 * The explanation's sentences, in product's order: the lead, the odds, the certainty, the award.
 * A legacy row swaps the award for {@link LEGACY_AWARD_SENTENCE}; a lead-only row (a pre-`0034`
 * game missing a before) says only the lead. An award whose effect rounds to 0 points is not
 * mentioned (decision row 2026-10-04, M14.58).
 */
export function explainSentences(reason: DeltaReason, subject: ExplainSubject): Sentence[] {
  const out: Sentence[] = [lead(subject, reason.result, reason.points)];
  if (reason.basis === 'lead-only') return out;
  out.push(odds(subject, reason.result, reason.odds.pct, reason.odds.stance));
  out.push(certainty(subject, reason.certainty));
  if (reason.basis === 'legacy') {
    out.push([LEGACY_AWARD_SENTENCE]);
  } else if (reason.award !== 'none' && reason.award.effect !== 0) {
    out.push(
      reason.award.kind === 'mvp'
        ? ['MVP added ', ...share(reason.award.fraction), '.']
        : ['ACE softened it by ', ...share(reason.award.fraction), '.'],
    );
  }
  return out;
}

/** One sentence as plain text (tests, screen-reader strings). */
export function sentenceText(sentence: Sentence): string {
  return sentence.map((part) => (typeof part === 'string' ? part : part.num)).join('');
}

/** The whole explanation as plain text, sentences joined by a space. */
export function explainText(reason: DeltaReason, subject: ExplainSubject): string {
  return explainSentences(reason, subject).map(sentenceText).join(' ');
}

/** The disclosure button's spoken tail, after the change's words (`lost 50. Why?`). [NEW COPY] */
export const WHY_SR = '. Why?';

/* ---------------------------------------------------------------------------------------------
 * M14.59: when the bot's odds and the rating's odds round differently, the result line adds the
 * one number the rating used, on the winner's side (design round 1, lead ruling 2026-10-04: it
 * replaces the brief's `Bot's odds: … For ratings: …` line; the bot's number is already the
 * result line above it).
 * ------------------------------------------------------------------------------------------- */

/**
 * The even band, inclusive, in the winner's percent: core's `config.rating.explain.evenPct`
 * (pinned equal by `copy.test.ts`; kept here so this client-safe file imports no core value).
 */
export const EVEN_PCT = { low: 48, high: 52 } as const;

const GAP_REASON: Readonly<Record<OddsGapReason, string>> = {
  'new-players': 'because new players start at 1200.',
  'ratings-moved': 'because ratings moved since the roll.',
};

function inEvenBand(pct: number): boolean {
  return pct >= EVEN_PCT.low && pct <= EVEN_PCT.high;
}

/**
 * `For points, Red was 50%, because new players start at 1200.`, or `null` when there is nothing
 * to add: the two agree, either is missing, or both put the winner inside the even band (the
 * explanation already says `It was an even game.`).
 */
export function oddsGapSentence(
  odds: {
    botBluePct: number | null;
    ratingBluePct: number | null;
    differ: boolean;
    reason: OddsGapReason | null;
  },
  winner: 100 | 200,
): Sentence | null {
  if (!odds.differ || odds.botBluePct === null || odds.ratingBluePct === null || odds.reason === null) {
    return null;
  }
  const forWinner = (bluePct: number) => (winner === 100 ? bluePct : 100 - bluePct);
  const bot = forWinner(odds.botBluePct);
  const rating = forWinner(odds.ratingBluePct);
  if (inEvenBand(bot) && inEvenBand(rating)) return null;
  return [
    `For points, ${winner === 100 ? 'Blue' : 'Red'} was `,
    { num: `${rating}%` },
    `, ${GAP_REASON[odds.reason]}`,
  ];
}
