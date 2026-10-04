import { printedChange } from '@customs/core';

/**
 * The display boundary for ratings (M3.3), in one place. Kustom since M18.6: the stored numbers
 * are unrounded Kustom Ratings (`r_before` / `r_after`, or the weekly pair), and core's
 * `printedChange` is the rule.
 *
 * Every surface that prints a change — the result embed, the tonight page, `/p/[puuid]` — calls
 * `displayDelta`, so the Discord message and the web page can never disagree about the same game.
 */

/**
 * **The delta rule.** Round both Ratings first, then subtract (core's `printedChange`):
 * `round(rAfter) - round(rBefore)`. Never `round(rAfter - rBefore)`.
 *
 * The row on the screen has to add up — `1300 (+8)` next to a Rating before of `1292` — and it
 * only does under this rule. Recorded in `04-decisions.md`.
 *
 * **A change too small to round to a point keeps its direction**, as `-0` when the Rating went
 * down. `05-design.md`, "Rating delta": `(0)` never appears, because a column of ten signed
 * numbers with one unsigned entry reads as a bug. `-0` is the honest carrier for that.
 */
export function displayDelta(rBefore: number, rAfter: number): number {
  const delta = printedChange(rBefore, rAfter);
  return delta === 0 && rAfter < rBefore ? -0 : delta;
}

/** One rated game's two stored numbers on one track, the pair {@link displayDelta} reads. */
export interface DeltaPair {
  rBefore: number;
  rAfter: number;
}

/**
 * **One rounding rule for a sum** (M14.57): a night's or a week's total is the sum of the
 * per-game deltas **as printed**, never one rounded difference. Each game's `r_after` is the next
 * game's `r_before` when the games chain, and then the two agree; when they do not (a reset inside
 * the range) the sum of the rows wins, so a column always adds up.
 *
 * Your night and the player page's Tonight tile call this. `null` for no pair (nothing rated to
 * sum). A net zero is `+0`, never `-0`: a total is not a direction.
 */
export function sumDisplayDeltas(pairs: readonly DeltaPair[]): number | null {
  if (pairs.length === 0) return null;
  let sum = 0;
  for (const pair of pairs) sum += displayDelta(pair.rBefore, pair.rAfter);
  return sum === 0 ? 0 : sum;
}

/**
 * The delta as the **web** prints it: `+43`, `−45`, `+0`, `−0`.
 *
 * `05-design.md`, "Rating delta": always signed, and U+2212 for the minus, which is the width
 * of `+` in the mono face (Martian Mono) so a column of ten stays a column. Discord gets ASCII from `formatDelta`
 * in `lib/discord/embeds.ts` instead, because it has no font control and its lines get
 * copy-pasted. One number from {@link displayDelta}, two glyphs.
 *
 * `-0 >= 0` is true in JavaScript, so the negative zero is asked about by identity first.
 * `(0)` never appears on any surface.
 */
export function formatWebDelta(delta: number): string {
  if (Object.is(delta, -0)) return '−0';
  return delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

/** A gain is `text` at 600, a loss is `dim` at 400. Never coloured by sign (05-design.md). */
export function isGain(delta: number): boolean {
  return !Object.is(delta, -0) && delta >= 0;
}
