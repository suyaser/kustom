import { displayRating, ordinal, type Rating } from '@customs/core';

/**
 * The display boundary for ratings (M3.3), in one place.
 *
 * `packages/core` keeps `displayRating` and gains no delta concept; this is where the two
 * stored numbers of a finished game become the pair a friend reads. Every surface that prints
 * a change — the result embed, the tonight page, `/p/[puuid]` — calls `displayDelta`, so the
 * Discord message and the web page can never disagree about the same game.
 */

/**
 * **The delta rule.** Round both ratings first, then subtract:
 * `displayRating(muAfter) - displayRating(muBefore)`. Never `round((muAfter - muBefore) * 60)`.
 *
 * The row on the screen has to add up — `1469 (+43)` next to a new rating of `1512` — and it
 * only does under this rule. Recorded in `04-decisions.md`.
 *
 * **A change too small to round to a point keeps its direction**, as `-0` when the rating went
 * down. `05-design.md`, "Rating delta": `(0)` never appears, because a column of ten signed
 * numbers with one unsigned entry reads as a bug. `-0` is the honest carrier for that — it is
 * a real number a caller can print, compare with `Object.is`, or ignore — and it costs no
 * extra field on every row that will never need one.
 */
export function displayDelta(muBefore: number, muAfter: number): number {
  const delta = displayRating(muAfter) - displayRating(muBefore);
  return delta === 0 && muAfter < muBefore ? -0 : delta;
}

/** One rated game's two stored numbers, the pair {@link displayDelta} reads. */
export interface DeltaPair {
  muBefore: number;
  muAfter: number;
}

/**
 * **One rounding rule for a sum** (M14.57): a night's or a week's total is the sum of the
 * per-game deltas **as printed**, never one rounded `mu` difference. Each game's `mu_after` is
 * the next game's `mu_before` when the games chain, and then the two agree; when they do not (a
 * reset inside the range, a backfilled game waiting for `rebuild-ratings`) the sum of the rows
 * wins, so a column always adds up.
 *
 * Your night, the player page's Tonight tile and the week boards' net points all call this.
 * `null` for no pair (nothing rated to sum). A net zero is `+0`, never `-0`: a total is not a
 * direction.
 */
export function sumDisplayDeltas(pairs: readonly DeltaPair[]): number | null {
  if (pairs.length === 0) return null;
  let sum = 0;
  for (const pair of pairs) sum += displayDelta(pair.muBefore, pair.muAfter);
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

/**
 * **Proven**, as it is printed: `round(ordinal * 60)`, floored at zero (M3.5; the designer's
 * review, 2026-09-09).
 *
 * One helper, because three surfaces print it — `/leaderboard`, `/p/[puuid]` and the nightly
 * Discord embed. It is composed from core's own `ordinal` and `displayRating` rather than
 * multiplying by 60 here: the sixty is `config.rating.displayMultiplier` and the two is
 * `config.rating.ordinalSigmaWeight`, and neither is this package's number to hold.
 *
 * **The floor.** `ordinal = mu - 2σ` is negative for anybody whose uncertainty is larger than
 * half their skill, which is not an edge case: an Iron IV seed is `14 - 2 × 8.33 = -2.66`, so
 * `-160` on the board, and a low seed after two losses gets there too. A negative rating on a
 * scoreboard reads as a penalty a friend has been given rather than as "the board has not seen
 * you play yet" — which is the sentence M3.8 already prints beside them. Zero is the honest
 * floor: it is what "no evidence yet" looks like, and the `settling` chip is the explanation.
 *
 * **The sort does not use this number.** Rows are ordered by the raw `ordinal` from core, so
 * two players who both display `0` keep their true order rather than falling back to the
 * name tie-break. `Math.max` is monotonic, so the displayed column is still non-increasing
 * down the page and product's rule — the order matches the number shown — holds either way.
 * See `lib/board/order.ts`.
 *
 * `ratings.ordinal` is also a generated column in Postgres (`mu - 2 * sigma`), and it is what
 * the index sorts on. The number a reader sees still comes through here, so the page cannot
 * print a value SQL and core would disagree about.
 */
export function provenRating(rating: Rating): number {
  return Math.max(0, displayRating(ordinal(rating)));
}

/**
 * The unfloored `ordinal`, for ordering only. Never printed.
 *
 * Exported so the board's comparator and this file's floor cannot drift apart: the sort key
 * and the displayed number come from the same two lines of code.
 */
export function provenSortKey(rating: Rating): number {
  return ordinal(rating);
}
