import type { Route } from 'next';
import { GAMES_LABEL } from './games/copy';
import { isOriginalGroup, type PageGroup } from './groups/pageGroup';
import { DAILY_LABEL } from './mystery/copy';
import { RELEASES_URL } from './release';
import { STATS_LABEL } from './stats/copy';
import { FUN_LABEL } from './stats/funCopy';
import { VERSUS_LABEL } from './versus/copy';

/**
 * Where the shell can send you, built from the page's group (05-design.md, "The app shell";
 * M13.9).
 *
 * **Every in-app link is built here, from the current group**, so a link on `/g/a/...` never
 * lands on `/g/b/...`, and nothing on one group's page links to another's. The pages that render
 * links (the shell, the night tape, the rail, the daily pointer, the controls' no-JavaScript
 * return path) ask {@link groupHref}; none of them writes a path by hand.
 *
 * **A tab is rendered only if its route exists** -- the rule this file has kept since M3.18, now
 * per group. M13.9 moves the tonight page (and mounts M11.4's game page) under `/g/<slug>`; the
 * leaderboard, player, games, stats, fun, 1v1, daily and admin pages move in M13.10 to M13.14.
 * Until a page moves it still lives at its old path **for the original group only** (the brief:
 * "an un-moved page keeps working at its old path for the original group in between"), so:
 *
 * - on the original group's pages its link is the old path, which works and shows that group;
 * - on any other group's pages there is **no link at all** -- the old path would show the
 *   original group's numbers under another group's name, and a link that 404s is worse than a
 *   missing one.
 *
 * Moving a page is one line in {@link DESTINATIONS}: flip `moved`, and every link to it on every
 * group's pages takes the `/g/<slug>` prefix at once.
 *
 * The wordmark and every label are product's, from the final copy table (2026-09-09). The
 * product is called **Kustom**; the repo's codename appears on no friend-facing surface (a
 * group's own name is data, not our copy -- the original group happens to be called that).
 */

/** The one lit letterform: a 3px brand bar, then six letters at 800. That is the whole logo. */
export const WORDMARK = 'KUSTOM';

/**
 * The release links live in `./release` (one source for the download URL and the asset name, M17.12) and
 * are re-exported here because the shell and its pages already import them from the nav. The direct
 * `.exe` link is for the PC that will run Kustom; every friend-facing surface links {@link RELEASES_URL}.
 */
export { RELEASE_ASSET, RELEASE_EXE_SHA256_URL, RELEASE_EXE_URL, RELEASES_URL } from './release';

/** The nav's external download item (M14.41 [NEW COPY]; was `Companion ↗`, a word friends never see). */
export const GET_KUSTOM_NAV_LABEL = 'Get Kustom ↗';

/** The tab a group admin sees (M13.9, product). The admin area's own name for itself. */
export const ADMIN_TAB_LABEL = 'Admin';

/** Somewhere inside one group's pages. */
export type GroupDestination =
  | { page: 'tonight' }
  | { page: 'leaderboard' }
  | { page: 'player'; puuid: string }
  | { page: 'games' }
  | { page: 'game'; gameId: string }
  | { page: 'stats' }
  | { page: 'fun' }
  | { page: 'versus' }
  | { page: 'mystery' }
  | { page: 'you' }
  | { page: 'admin' };

type PageKey = GroupDestination['page'];

interface DestinationRule {
  /**
   * Whether the page lives under `/g/<slug>` yet. `false` means it is still the original
   * group's page at {@link legacy}, and unreachable from any other group.
   */
  moved: boolean;
  /** The path under `/g/<slug>`: `''` for the group's home, `/leaderboard`, `/games/<id>`, ... */
  grouped: (destination: GroupDestination) => string;
  /** Where the original group's copy of the page lives until it moves. */
  legacy: (destination: GroupDestination) => string;
}

const segment = (value: string): string => encodeURIComponent(value);

const fixed =
  (path: string): DestinationRule['grouped'] =>
  () =>
    path;

/**
 * Every destination, and whether it has moved. **M13.10 to M13.14 each flip their rows** (and
 * add the 308 from the old path in the same commit, so the old path and the new one never both
 * answer for long).
 */
const DESTINATIONS: Record<PageKey, DestinationRule> = {
  tonight: { moved: true, grouped: fixed(''), legacy: fixed('/') },
  game: {
    // M11.4's page, mounted at its M13.11 address by M13.9 (the brief) so the `/g/<uuid>`
    // redirect has a target. M13.11 moves the page itself and its card.
    moved: true,
    grouped: (destination) => (destination.page === 'game' ? `/games/${segment(destination.gameId)}` : ''),
    legacy: (destination) => (destination.page === 'game' ? `/g/${segment(destination.gameId)}` : '/'),
  },
  // M14.15 (M13.10's move): both live under the group; the old paths 308 (next.config.ts).
  leaderboard: { moved: true, grouped: fixed('/leaderboard'), legacy: fixed('/leaderboard') },
  player: {
    moved: true,
    grouped: (destination) => (destination.page === 'player' ? `/p/${segment(destination.puuid)}` : ''),
    legacy: (destination) => (destination.page === 'player' ? `/p/${segment(destination.puuid)}` : '/'),
  },
  // M14.16 (folds in M13.11's list): under the group; `/games` 308s to the original group's.
  games: { moved: true, grouped: fixed('/games'), legacy: fixed('/games') },
  // M14.17: Stats with three segments under the group; Fun and 1v1 are two of them.
  stats: { moved: true, grouped: fixed('/stats'), legacy: fixed('/stats') },
  fun: { moved: true, grouped: fixed('/stats/champions'), legacy: fixed('/fun') },
  versus: { moved: true, grouped: fixed('/stats/1v1'), legacy: fixed('/1v1') },
  mystery: { moved: true, grouped: fixed('/mystery'), legacy: fixed('/mystery') },
  // The You tab (M14.7b, redesign/nav/proposal.md option A): born under the group, no old path.
  you: { moved: true, grouped: fixed('/you'), legacy: fixed('/') },
  // Moved by M14.22: `/g/<slug>/admin` for every group (the 1.0 `/admin/*` pages still answer for the
  // original group, linked from its admin area, until M14.23 moves Discord, Hosts and Games).
  admin: { moved: true, grouped: fixed('/admin'), legacy: fixed('/admin') },
};

/** `/g/<slug>`: the group's tonight page, and the prefix of every one of its pages. */
export function groupBase(group: Pick<PageGroup, 'slug'>): string {
  return `/g/${segment(group.slug)}`;
}

/**
 * The link to `destination` on `group`'s pages, or `null` when that page has no address for
 * this group yet (see the file comment). Never another group's path.
 */
export function groupHref(
  group: Pick<PageGroup, 'id' | 'slug'>,
  destination: GroupDestination,
): Route | null {
  const rule = DESTINATIONS[destination.page];
  if (rule.moved) return `${groupBase(group)}${rule.grouped(destination)}` as Route;
  return isOriginalGroup(group) ? (rule.legacy(destination) as Route) : null;
}

/** {@link groupHref} for a destination that has always moved (the tonight page). */
export function groupHome(group: Pick<PageGroup, 'slug'>): Route {
  return groupBase(group) as Route;
}

/**
 * An in-app destination, checked by `typedRoutes` at build time, or an external one — which
 * opens in a new tab and carries the `↗` in its label already.
 */
export type NavItem =
  | { label: string; href: Route; page: PageKey; external?: false }
  | { label: string; href: string; external: true };

/** The board's section label, and its page's h1 and title (M14.72: one word, Board). */
export const BOARD_TAB_LABEL = 'Board';

interface TabDefinition {
  label: string;
  destination: GroupDestination;
}

/**
 * **No `Tonight` tab** (the product owner, M13.9): the wordmark lockup is one link to the group's
 * tonight page, so a tab to the same place was the same destination twice. The lockup is the way
 * home on every page.
 */
const TABS: readonly TabDefinition[] = [
  { label: BOARD_TAB_LABEL, destination: { page: 'leaderboard' } },
  /**
   * `Games` (M5.25), beside `Board`: the captured customs, expandable into both
   * scoreboards. Its label is `lib/games/copy.ts`'s own word — the tab, the page heading
   * and the `<title>` are one string.
   */
  { label: GAMES_LABEL, destination: { page: 'games' } },
  /**
   * `Stats` (M5.4), beside `Board` and before the external one: it is the same numbers
   * read a different way, and its label is `lib/stats/copy.ts`'s own word.
   */
  { label: STATS_LABEL, destination: { page: 'stats' } },
  { label: FUN_LABEL, destination: { page: 'fun' } },
  /** `1v1` (M8.5), after `Fun` and before `Daily`: lane wars and any two people. */
  { label: VERSUS_LABEL, destination: { page: 'versus' } },
  /**
   * `Daily` (M5.32, renamed by M8.4): today's one guessing game, whichever of the two it is.
   * The word is kind-neutral because this tab renders on every page and the shell does not
   * know which game today is — and must not spend a query per page view to find out.
   */
  { label: DAILY_LABEL, destination: { page: 'mystery' } },
];

export interface GroupNavOptions {
  /**
   * The viewer is an admin of **this** group (`group_memberships.role = 'admin'`, decided on the
   * server). Draws the `Admin` tab and grants nothing: the admin pages check again.
   */
  isAdmin: boolean;
}

/**
 * The shell's tabs for one group: the destinations that exist for it besides its home (the
 * wordmark's), `Admin` for its admins after the in-app ones, and `Get Kustom ↗` last (M14.41: "Companion" is retired in friend-facing copy).
 */
export function groupNavItems(group: Pick<PageGroup, 'id' | 'slug'>, options: GroupNavOptions): NavItem[] {
  const tabs: TabDefinition[] = [...TABS];
  if (options.isAdmin) tabs.push({ label: ADMIN_TAB_LABEL, destination: { page: 'admin' } });

  const items: NavItem[] = [];
  for (const tab of tabs) {
    const href = groupHref(group, tab.destination);
    if (href !== null) items.push({ label: tab.label, href, page: tab.destination.page });
  }
  items.push({ label: GET_KUSTOM_NAV_LABEL, href: RELEASES_URL, external: true });
  return items;
}

/**
 * Which tab is current. A player page counts as the board, because that is where those
 * links come from. A page that has not moved yet is matched at its old path too (the original
 * group's shell is drawn there), and `Admin` is never current: the admin area has its own shell.
 * On the tonight page nothing is underlined -- its way in is the wordmark, which is not a tab.
 */
export function isCurrentTab(
  item: NavItem,
  pathname: string,
  group: Pick<PageGroup, 'id' | 'slug'>,
): boolean {
  if (item.external === true) return false;
  const base = groupBase(group);
  const original = isOriginalGroup(group);

  const under = (path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);
  const at = (suffix: string): boolean => under(`${base}${suffix}`) || (original && under(suffix));

  switch (item.page) {
    case 'leaderboard':
      return at('/leaderboard') || at('/p');
    case 'games':
      return at('/games');
    case 'stats':
      return at('/stats');
    case 'fun':
      return at('/fun');
    case 'versus':
      return at('/1v1');
    case 'mystery':
      return at('/mystery');
    default:
      return false;
  }
}

/* -------------------------------------------------------------------------------------------
 * The 2.0 shell (M14.7, amended by M14.7b: redesign/nav/proposal.md option A). Five sections, the
 * same five in the same order on every width: the bottom bar below 1024px, the top bar from 1024px.
 * There is no More page and no sixth tab: a new feature joins the section where its moment is.
 * ----------------------------------------------------------------------------------------- */

export const STATS_TAB_LABEL = 'Stats';

export const YOU_TAB_LABEL = 'You';

export type MainTabKey = 'tonight' | 'board' | 'games' | 'stats' | 'you';

export interface MainTab {
  key: MainTabKey;
  label: string;
  href: Route;
}

const MAIN_TABS: readonly { key: MainTabKey; label: string; destination: GroupDestination }[] = [
  { key: 'tonight', label: 'Tonight', destination: { page: 'tonight' } },
  { key: 'board', label: BOARD_TAB_LABEL, destination: { page: 'leaderboard' } },
  { key: 'games', label: GAMES_LABEL, destination: { page: 'games' } },
  // The existing stats page until M14.17 builds Records / Champions / 1v1 under the group.
  { key: 'stats', label: STATS_TAB_LABEL, destination: { page: 'stats' } },
  { key: 'you', label: YOU_TAB_LABEL, destination: { page: 'you' } },
];

/**
 * The group's sections, in order. **Still only routes that exist**: until M14.15 to M14.17 move the
 * board, the games list and stats under `/g/<slug>`, a group other than the original has no page for
 * them (the original group's old paths would print its numbers under another name), so its bar is
 * `Tonight · You`. Tonight and You always exist.
 */
export function mainTabs(group: Pick<PageGroup, 'id' | 'slug'>): MainTab[] {
  const tabs: MainTab[] = [];
  for (const tab of MAIN_TABS) {
    const href = groupHref(group, tab.destination);
    if (href !== null) tabs.push({ key: tab.key, label: tab.label, href });
  }
  return tabs;
}

/**
 * The section the page belongs to, or `null` (an unknown path, a 404). A player page is the board's,
 * your own included (You is the lens, the player page the public view); a game page is Games';
 * Stats, Fun and 1v1 are Stats (they become its three segments in M14.17); the daily game and the
 * mode panel are Tonight's. An unmoved page is matched at its old path too, for the original group.
 */
export function currentMainTab(pathname: string, group: Pick<PageGroup, 'id' | 'slug'>): MainTabKey | null {
  const base = groupBase(group);
  const original = isOriginalGroup(group);
  const under = (path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);
  const at = (suffix: string): boolean => under(`${base}${suffix}`) || (original && under(suffix));

  if (pathname === base || pathname === `${base}/` || at('/mystery') || at('/mode')) return 'tonight';
  if (at('/leaderboard') || at('/p')) return 'board';
  if (at('/games')) return 'games';
  if (at('/stats') || at('/fun') || at('/1v1')) return 'stats';
  if (under(`${base}/you`)) return 'you';
  return null;
}
