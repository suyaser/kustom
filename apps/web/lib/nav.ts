import type { Route } from 'next';
import { GAMES_LABEL } from './games/copy';
import { MYSTERY_LABEL } from './mystery/copy';
import { STATS_LABEL } from './stats/copy';
import { FUN_LABEL } from './stats/funCopy';
import { VERSUS_LABEL } from './versus/copy';

/**
 * Where the shell can send you, in one list (05-design.md, "The app shell").
 *
 * **A tab is rendered only if its route exists.** `Tonight`, `Leaderboard`, `Games`, `Stats`,
 * `Fun`, `1v1` and `Mystery` are routes in this app; `Companion ↗` is external and is
 * always there.
 * A nav item that 404s is worse than a missing one, and keeping the list here is what stops a
 * second page hand-writing a fifth answer.
 *
 * The wordmark and every label are product's, from the final copy table (2026-09-09). The
 * product is called **Kustom**; the repo's codename appears on no
 * friend-facing surface.
 */

/** The one lit letterform: a 3px brand bar, then six letters at 800. That is the whole logo. */
export const WORDMARK = 'KUSTOM';

/**
 * The releases **page**, never `…/latest/download/Kustom.exe`: this page is opened on a phone,
 * and a link that starts a 90MB Windows download there is a bug. The direct `.exe` link stays
 * on `/admin` and in the group chat, where the reader is on the PC that needs it.
 */
export const RELEASES_URL = 'https://github.com/suyaser/kustom-releases/releases/latest';

/**
 * The Windows build itself, and the checksum published beside it (M2.20).
 *
 * **Copied, not imported**: the same URL is `RELEASE_LATEST_URL` in
 * `apps/companion/build/config.ts`, and the web app does not depend on the companion package.
 * If the release repo is ever renamed, both constants move.
 *
 * These two are for `/admin` only — the page an admin opens on the PC that is going to run it,
 * next to the token they are about to mint. Every friend-facing surface links
 * {@link RELEASES_URL} instead, because a 90MB download started on a phone is a bug.
 */
export const RELEASE_EXE_URL = `${RELEASES_URL}/download/Kustom.exe`;

export const RELEASE_EXE_SHA256_URL = `${RELEASE_EXE_URL}.sha256`;

/**
 * An in-app destination, checked by `typedRoutes` at build time, or an external one — which
 * opens in a new tab and carries the `↗` in its label already.
 */
export type NavItem =
  | { label: string; href: Route; external?: false }
  | { label: string; href: string; external: true };

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Tonight', href: '/' },
  { label: 'Leaderboard', href: '/leaderboard' },
  /**
   * `Games` (M5.25), beside `Leaderboard`: the captured customs, expandable into both
   * scoreboards. Its label is `lib/games/copy.ts`'s own word — the tab, the page heading
   * and the `<title>` are one string.
   */
  { label: GAMES_LABEL, href: '/games' },
  /**
   * `Stats` (M5.4), beside `Leaderboard` and before the external one: it is the same numbers
   * read a different way, and its label is `lib/stats/copy.ts`'s own word — the tab, the page
   * heading and the `<title>` are one string.
   */
  { label: STATS_LABEL, href: '/stats' },
  { label: FUN_LABEL, href: '/fun' },
  { label: VERSUS_LABEL, href: '/1v1' },
  { label: MYSTERY_LABEL, href: '/mystery' },
  { label: 'Companion ↗', href: RELEASES_URL, external: true },
];

/**
 * Which tab is current. `/` matches only itself — every other path would otherwise match the
 * root — and `/p/<puuid>` counts as the leaderboard, because that is where those links come
 * from and a shell with nothing underlined reads as a page outside the product.
 */
export function isCurrentTab(item: NavItem, pathname: string): boolean {
  if (item.external === true) return false;
  if (item.href === '/') return pathname === '/';
  if (item.href === '/leaderboard') return pathname === '/leaderboard' || pathname.startsWith('/p/');
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
