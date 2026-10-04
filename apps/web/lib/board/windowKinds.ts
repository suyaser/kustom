import type { WindowKind } from '../night';

/**
 * The window words with no zod (M14.45): the three in order, a plain type guard, each page's default
 * and the option link. Client components (the board's welcome card, Tonight's role card) reach
 * `windowHref` through `hrefs.ts`, and `lib/clientGraph.test.ts` keeps zod out of client bundles;
 * `window.ts` re-exports all of this and builds its zod schema from {@link WINDOW_ORDER}.
 */

/**
 * The order the picker prints them in: the two weeks, then all time. Nearest window first,
 * because the leaderboard opens on `This week` and the tap most people make is one step away
 * from it. The two months sat between them until M14.48 dropped them (user, 2026-10-03).
 */
export const WINDOW_ORDER = ['this-week', 'last-week', 'all-time'] as const satisfies readonly WindowKind[];

/** One of the three, by a plain `includes` over {@link WINDOW_ORDER}. */
export function isWindow(value: unknown): value is WindowKind {
  return typeof value === 'string' && (WINDOW_ORDER as readonly string[]).includes(value);
}

/**
 * Is this window one of the two weeks (`This week`, `Last week`)? Those boards rank by net points
 * (M14.57). It moved here when the weekly rating track was retired.
 */
export function isWeekWindow(kind: WindowKind): boolean {
  return kind === 'this-week' || kind === 'last-week';
}

/**
 * `/leaderboard` opens on the running week: the board is a thing that ends, and the page
 * somebody opens on the bus on Monday should be the week they are in.
 */
export const LEADERBOARD_WINDOW: WindowKind = 'this-week';

/**
 * `/p/[puuid]` opens on `All time`: the page is a person's history, and a page that opened on
 * six days of games would answer a question nobody asked it (M5.12, M5.15).
 */
export const PLAYER_WINDOW: WindowKind = 'all-time';

/**
 * All three Stats segments open on `All time` (M14.42, scene-walk gap 13): one default, so switching
 * segments never changes the window under you. It was `This month` for Records and Champions (M5.4)
 * and `All time` for 1v1 (M8.5); every minimum on those pages is five games or more and a lane
 * series is rare, so the widest window is the one that prints something for a new group and a busy
 * one alike. One tap gets to the week.
 */
export const STATS_WINDOW: WindowKind = 'all-time';

/**
 * The link behind one option: `/leaderboard?window=last-week`, `/p/<puuid>?window=all-time`.
 *
 * **Every option names its window, including the page's default.** A parameterless link would
 * be one character shorter and would give the page two URLs for one board — the one somebody
 * copies out of the address bar after tapping `This week` has to say which board they are
 * looking at, because that is the link they paste into the group chat.
 */
export function windowHref(path: string, kind: WindowKind, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ window: kind, ...query });
  return `${path}?${params.toString()}`;
}
