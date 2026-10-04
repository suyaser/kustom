import type { Route } from 'next';
import type { PageGroup } from '../groups/pageGroup';
import { ADMIN_HOME_LABEL, DISCORD_TITLE, GAMES_TITLE, HOSTS_TITLE, MEMBERS_TITLE } from './homeCopy';

export type AdminPage = 'home' | 'members' | 'discord' | 'hosts' | 'games';

export interface AdminNavLink {
  label: string;
  href: Route;
  current: boolean;
}

const PAGES: readonly { page: AdminPage; label: string; suffix: string }[] = [
  { page: 'home', label: ADMIN_HOME_LABEL, suffix: '' },
  { page: 'members', label: MEMBERS_TITLE, suffix: '/members' },
  { page: 'discord', label: DISCORD_TITLE, suffix: '/discord' },
  { page: 'hosts', label: HOSTS_TITLE, suffix: '/hosts' },
  { page: 'games', label: GAMES_TITLE, suffix: '/games' },
];

/** `/g/<slug>/admin<suffix>` for one admin page. */
export function adminHref(group: Pick<PageGroup, 'slug'>, page: AdminPage): Route {
  const found = PAGES.find((entry) => entry.page === page);
  return `/g/${encodeURIComponent(group.slug)}/admin${found?.suffix ?? ''}` as Route;
}

/**
 * The admin area's own links (M14.22, M14.23): all five pages live under `/g/<slug>/admin` for every
 * group since M14.23 moved Discord, Hosts and Games. The 1.0 `/admin/*` paths 308 to the original
 * group's copies (`next.config.ts`).
 */
export function adminNav(group: Pick<PageGroup, 'slug'>, current: AdminPage): AdminNavLink[] {
  return PAGES.map(({ page, label }) => ({ label, href: adminHref(group, page), current: page === current }));
}
