import { z } from 'zod';
import { formatDayMonthYear, formatWeekRange, type WindowKind, type WindowRange } from '../night';
import { firstGameLabel } from './copy';
import { WINDOW_ORDER } from './windowKinds';

// The three words, the defaults and `windowHref` live in `windowKinds.ts` (M14.45), which has no
// zod, so client links can import them; they are re-exported here for the server side.
export {
  isWeekWindow,
  isWindow,
  LEADERBOARD_WINDOW,
  PLAYER_WINDOW,
  STATS_WINDOW,
  WINDOW_ORDER,
  windowHref,
} from './windowKinds';

/**
 * The window a page is being read through (M5.12): the parameter, its order, and each page's
 * own default.
 *
 * **The parameter is the same word on every windowed page** — `?window=this-week` on
 * `/leaderboard`, on `/p/[puuid]`, on `/stats` (M5.4), on `/games` (M5.25) and on `/1v1`
 * (M8.5) — so a link
 * pasted from one lands on the same window in another. The boundaries themselves are `lib/night.ts` (M5.9); this file
 * is the reading of a URL and nothing else, which is why it is pure and has no client.
 */

/**
 * The parameter, as a schema — the same `zod` every other boundary in this app is validated
 * with (CLAUDE.md), rather than an `includes` and a cast. It is built from
 * {@link WINDOW_ORDER}, so the three words, the picker's order and what a URL may say are one
 * list and cannot drift.
 */
export const windowKindSchema = z.enum(WINDOW_ORDER);

/**
 * The `?window=` value, or `null` for anything that is not one of the three.
 *
 * Absent is the page's own default; **an unknown value is a 404** and never a silent fallback,
 * because it can only come from a typed or mangled URL and a page that quietly showed a
 * different window than the URL names is a page whose links cannot be trusted. The page owns
 * the `notFound()`; this returns the honest answer.
 *
 * Next hands a repeated parameter over as an array (`?window=a&window=b`). That is not one of
 * the three either, so it is refused rather than reduced to its first element.
 */
export function parseWindow(value: string | string[] | undefined, fallback: WindowKind): WindowKind | null {
  if (value === undefined) return fallback;
  // A repeated parameter arrives as an array; `z.enum` refuses it, like anything else that is
  // not one of the three, so it is a 404 rather than a silent first-element read.
  const parsed = windowKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The 2.0 rule (STRATEGY, 05-design.md 5.8; M14.7): **an unknown `?window=` falls back to the page's
 * default window and is never a 404.** It reverses {@link parseWindow}'s 404 for the pages that adopt
 * it; each screen task (M14.15 on) switches its loader from `parseWindow` to this as it moves. A
 * repeated parameter (`?window=a&window=b`) is not one window either, so it falls back too.
 *
 * It is also what keeps the retired month windows' links alive (M14.48): `?window=this-month` and
 * `?window=last-month`, in months of chat history, open the page on its default window.
 */
export function windowOrDefault(value: string | string[] | undefined, fallback: WindowKind): WindowKind {
  return parseWindow(value, fallback) ?? fallback;
}

/**
 * The slot's **range half**: `Sunday 6 Sep to Saturday 12 Sep`, `first game 8 Sep 2025`
 * (M5.12, the designer's slot).
 *
 * `null` only for `All time` with nothing to date from — a database with no counted game in it,
 * where the slot prints the window's empty sentence instead.
 *
 * Formatted **on the server**, in the fixed locale and the configured zone, for the reason
 * every other date on a public page is (`lib/night.ts`): a date the browser formatted in the
 * reader's own locale would disagree with the server's render and the line would change under
 * them.
 */
/**
 * The window clipped to the group's ratings epoch (M14.18): `All time` starts at `ratings_since`,
 * because games before the reset carry the old ratings. The two weeks are untouched: the weekly
 * rating restarts every Sunday anyway.
 */
export function epochRange(kind: WindowKind, range: WindowRange, since: Date | null): WindowRange {
  if (since === null || kind !== 'all-time') return range;
  return { start: since, end: range.end };
}

/**
 * {@link windowRangeLabel} once a group may have reset (M14.18): `All time` after a reset has no
 * range half (its chip already says `Since <reset day>`). Weeks, and every window of a group that
 * never reset, are {@link windowRangeLabel} unchanged. `range` is the window's own range, before
 * {@link epochRange}.
 */
export function windowRangeLabelSince(
  kind: WindowKind,
  range: WindowRange,
  firstCountedAt: Date | null,
  since: Date | null,
  timeZone?: string,
): string | null {
  if (since !== null && kind === 'all-time') return null;
  return windowRangeLabel(kind, range, firstCountedAt, timeZone);
}

export function windowRangeLabel(
  kind: WindowKind,
  range: WindowRange,
  firstCountedAt: Date | null,
  timeZone?: string,
): string | null {
  if (kind === 'all-time') {
    return firstCountedAt === null ? null : firstGameLabel(formatDayMonthYear(firstCountedAt, timeZone));
  }
  // Every other window is bounded; the nulls belong to `all-time` alone (M5.9).
  const start = range.start as Date;
  const end = range.end as Date;
  return formatWeekRange(start, end, timeZone);
}
