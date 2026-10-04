import type { KustomReason } from './read';

/**
 * The words for "why this many points" (M14.58, Kustom since M18.6) and the odds-gap line (M14.59).
 * The sentences are the designer's draft copy of `05-design.md` 11.6.1 (M18.8), which product
 * finalises in M18.9 and the web lane styles in M18.7; the third-person variants follow 11.6.1's
 * rule (the name once, then `They` / `their`).
 *
 * Pure and client-safe: type-only imports, no zod, no `node:*`. Core decides every fact (the
 * expected score, K, the share rank and the award, through `explainKustomDelta`); this file only
 * picks words. Sigma is never a number here, and no certainty word is used.
 *
 * A sentence is a list of parts so a number can be set in mono inside running text (05-design 6.12):
 * a string is text, `{ num }` is a number.
 */
export type CopyPart = string | { num: string };
export type Sentence = readonly CopyPart[];

/** Whose row it is: the signed-in viewer's (`Your side won`) or somebody else's (`Omar's side won`). */
export type ExplainSubject = { kind: 'you' } | { kind: 'name'; name: string };

/** Under every explanation, small (05-design 11.6, [DRAFT COPY]). */
export const EXPLAIN_FOOTNOTE = 'Upsets and first games move the most.';

/** The settled K, core's `config.kustom.kSettled` (pinned equal by `copy.test.ts`). */
export const SETTLED_K = 16;

/** U+2009 around `×` and `=` (05-design 11.6). */
const THIN = ' ';
const TIMES = `${THIN}×${THIN}`;
const EQUALS = `${THIN}=${THIN}`;

/** `1.2`, `0.9`, `1` (no trailing `.0`). */
function multiplier(share: number): string {
  return String(Math.round(share * 10) / 10);
}

/** `+8`, `−7` (U+2212), `±0`. */
function signed(points: number): string {
  if (points === 0) return '±0';
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function ordinalSuffix(rank: number): string {
  return rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
}

/**
 * The sum the odds sentence prints: the game's K rounded (`30`, never `30.4`), the percent the
 * result was worth (the other side's for a win, the side's own for a loss), and the base rounded.
 */
export function worthOf(reason: KustomReason): { k: number; pct: number; worth: number } {
  const k = Math.round(reason.parts.k);
  const pct = reason.parts.result === 'win' ? 100 - reason.parts.expectedPct : reason.parts.expectedPct;
  return { k, pct, worth: Math.round((k * pct) / 100) };
}

/**
 * 05-design 5.5's even band, inclusive, in a side's percent: core's
 * `config.rating.explain.evenPct` (pinned equal by `copy.test.ts`).
 */
export const EVEN_PCT = { low: 48, high: 52 } as const;

function inEvenBand(pct: number): boolean {
  return pct >= EVEN_PCT.low && pct <= EVEN_PCT.high;
}

/**
 * The odds sentence (11.6.1). `weekPrefix` opens it with `On this week's numbers` on a week row
 * whose weekly odds differ from the printed roll odds, or on a first game of the week (11.6.3).
 */
function oddsSentence(reason: KustomReason, subject: ExplainSubject, weekPrefix: boolean): Sentence {
  const { expectedPct, result } = reason.parts;
  const { k, pct, worth } = worthOf(reason);
  const sum: CopyPart[] = [
    { num: String(k) },
    TIMES,
    { num: `${pct}%` },
    EQUALS,
    { num: String(worth) },
    '.',
  ];
  const tail = result === 'win' ? ', so the win was worth ' : ', so the loss cost ';
  const opener = weekPrefix ? "On this week's numbers " : '';
  if (inEvenBand(expectedPct)) {
    // [NEW COPY] somebody else's even game names them here, the sentence's one name (11.6.1's rule).
    const forWhom = subject.kind === 'name' ? ` for ${subject.name}'s side` : '';
    const it = weekPrefix ? 'it' : 'It';
    return [`${opener}${it} was an even game${forWhom} (`, { num: `${expectedPct}%` }, `)${tail}`, ...sum];
  }
  const side = subject.kind === 'you' ? (weekPrefix ? 'your side' : 'Your side') : `${subject.name}'s side`;
  const verb = result === 'win' ? 'won' : 'lost';
  const stance = expectedPct > EVEN_PCT.high ? 'favourite' : 'underdog';
  return [`${opener}${side} ${verb} as the `, { num: `${expectedPct}%` }, ` ${stance}${tail}`, ...sum];
}

/** The share sentence (11.6.1): the rank in words and the multiplier. Ranks never say `worst`. */
function shareSentence(reason: KustomReason, subject: ExplainSubject): Sentence {
  const { shareRank, share, result } = reason.parts;
  const times: CopyPart[] = ['×', { num: multiplier(share) }, '.'];
  if (shareRank === null) return ['This game has no performance score, so everyone counts ', ...times];
  const you = subject.kind === 'you';
  const team = you ? 'your team' : 'their team';
  if (shareRank === 1) {
    const had = you ? 'You had' : 'They had';
    return result === 'win'
      ? [`${had} the best game on ${team} (MVP): `, ...times]
      : [`${had} the best game on ${team} (ACE), so ${you ? 'you' : 'they'} gave back least: `, ...times];
  }
  const game = you ? 'Your game' : 'Their game';
  const most = shareRank === 5 && result === 'loss' ? `, so ${you ? 'you' : 'they'} gave back most` : '';
  return [
    `${game} was `,
    { num: String(shareRank) },
    `${ordinalSuffix(shareRank)} best on ${team}${most}: `,
    ...times,
  ];
}

/** The first-ten sentence (11.6.1), only when K is above the settled 16. */
function firstTenSentence(reason: KustomReason, subject: ExplainSubject): Sentence {
  const k = { num: String(Math.round(reason.parts.k)) };
  const settled = { num: String(SETTLED_K) };
  if (reason.track === 'week') {
    return ["Everyone's first 10 games of a week count extra (×", k, ' instead of ×', settled, ').'];
  }
  const whose = subject.kind === 'you' ? ['Your', 'your'] : ['Their', 'their'];
  return [
    `${whose[0]} first 10 games count extra while ${whose[1]} Rating finds its level (×`,
    k,
    ' instead of ×',
    settled,
    ').',
  ];
}

/** The week row's track clause (11.6.3): `All time: +8, to 1300.` */
function trackClause(allTime: { points: number; rating: number }): Sentence {
  return ['All time: ', { num: signed(allTime.points) }, ', to ', { num: String(allTime.rating) }, '.'];
}

/** What the row knows and the reason does not. */
export interface ExplainOptions {
  /**
   * The subject's side's printed roll odds on the row (the compact receipt's number), or `null` when
   * the row prints none. A week reason whose weekly odds differ from it opens with
   * `On this week's numbers` (11.6.3).
   */
  rollSidePct?: number | null;
}

/**
 * The explanation's sentences, in 11.6's order: the odds, the share, the first-ten line (only when
 * K is above 16), and on a week row the all-time clause. At most four.
 */
export function explainSentences(
  reason: KustomReason,
  subject: ExplainSubject,
  options: ExplainOptions = {},
): Sentence[] {
  const roll = options.rollSidePct ?? null;
  const weekPrefix =
    reason.track === 'week' &&
    (reason.gamesBefore === 0 || roll === null || roll !== reason.parts.expectedPct);
  const out: Sentence[] = [oddsSentence(reason, subject, weekPrefix), shareSentence(reason, subject)];
  if (reason.parts.firstTenGames) out.push(firstTenSentence(reason, subject));
  if (reason.track === 'week' && reason.allTime !== null) out.push(trackClause(reason.allTime));
  return out;
}

/**
 * The rounding line (11.6.4), or `null` when the sum matches: the sentences multiply rounded
 * numbers and the printed change is a difference of rounded Ratings, so they can be 1 apart.
 */
export function roundingSentence(reason: KustomReason): Sentence | null {
  const { worth } = worthOf(reason);
  const off = Math.abs(Math.abs(reason.parts.points) - Math.round(worth * reason.parts.share));
  if (off === 0) return null;
  return ['Ratings keep their decimals, so this shows ', { num: String(off) }, ' off the sum.'];
}

/** One sentence as plain text (tests, screen-reader strings). */
export function sentenceText(sentence: Sentence): string {
  return sentence.map((part) => (typeof part === 'string' ? part : part.num)).join('');
}

/** The whole explanation as plain text, sentences joined by a space. */
export function explainText(
  reason: KustomReason,
  subject: ExplainSubject,
  options: ExplainOptions = {},
): string {
  return explainSentences(reason, subject, options).map(sentenceText).join(' ');
}

/** The disclosure button's spoken tail, after the change's words (`lost 50. Why?`). [NEW COPY] */
export const WHY_SR = '. Why?';

/* ---------------------------------------------------------------------------------------------
 * M14.59: when the bot's odds and the rating's odds round differently, the result line adds the
 * one number the rating used, on the winner's side. Since M18.6 only a game rolled before the M18
 * switch can differ (`ResultOdds.differ`), and the line carries no `because` clause (05-design
 * 11.7: neither old reason is true for those games, and the rebuild is unannounced).
 * ------------------------------------------------------------------------------------------- */

/**
 * `For points, Red was 50%.`, or `null` when there is nothing to add: the two agree, either is
 * missing, the roll was Kustom's, or both put the winner inside the even band.
 */
export function oddsGapSentence(
  odds: { botBluePct: number | null; ratingBluePct: number | null; differ: boolean },
  winner: 100 | 200,
): Sentence | null {
  if (!odds.differ || odds.botBluePct === null || odds.ratingBluePct === null) return null;
  const forWinner = (bluePct: number) => (winner === 100 ? bluePct : 100 - bluePct);
  const bot = forWinner(odds.botBluePct);
  const rating = forWinner(odds.ratingBluePct);
  if (inEvenBand(bot) && inEvenBand(rating)) return null;
  return [`For points, ${winner === 100 ? 'Blue' : 'Red'} was `, { num: `${rating}%` }, '.'];
}
