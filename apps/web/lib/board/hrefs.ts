import type { Route } from 'next';
import type { PageGroup } from '../groups/pageGroup';
import { groupBase, groupHref } from '../nav';
import type { WindowKind } from '../night';
import { windowHref } from './windowKinds';

/**
 * The board's and the player page's links inside one group (M14.15). Both pages live under
 * `/g/<slug>`, so a player link is always the group's own; a game link follows `lib/nav.ts`.
 */

export function leaderboardPath(group: Pick<PageGroup, 'slug'>): string {
  return `${groupBase(group)}/leaderboard`;
}

export function playerPath(group: Pick<PageGroup, 'slug'>, puuid: string): string {
  return `${groupBase(group)}/p/${encodeURIComponent(puuid)}`;
}

/**
 * A player link from a windowed page. With `window`, the link carries it (M14.42, scene-walk gap
 * 13): a board row on `This week` opens that person on `This week`, not on the player page's own
 * `All time` default.
 */
export function playerHrefFor(group: Pick<PageGroup, 'slug'>, window?: WindowKind): (puuid: string) => Route {
  if (window === undefined) return (puuid) => playerPath(group, puuid) as Route;
  return (puuid) => windowHref(playerPath(group, puuid), window) as Route;
}

export function gameHrefFor(group: Pick<PageGroup, 'id' | 'slug'>): (gameId: string) => Route | null {
  return (gameId) => groupHref(group, { page: 'game', gameId });
}

/**
 * The group's games page narrowed to one player (`?player=`, M14.16's filter). Always the group's own
 * `/g/<slug>/games`, never the 1.0 `/games`.
 */
export function allGamesHref(group: Pick<PageGroup, 'id' | 'slug'>, puuid: string): Route {
  return `${groupBase(group)}/games?${new URLSearchParams({ player: puuid }).toString()}` as Route;
}

/**
 * Where every self-linking path lands once the link succeeds (M14.33, amended to option A): the You
 * tab with the welcome card. `That's me` on Tonight, the `/join` Kustom-code card, and an unlinked
 * creator's Host-mode pairing. Only a linked viewer ever sees the card there.
 */
export function welcomeHref(group: Pick<PageGroup, 'slug'>): Route {
  return `${groupBase(group)}/you?${WELCOME_PARAM}=1` as Route;
}

/** The query flag the welcome card reads, and drops from the URL on its first client render. */
export const WELCOME_PARAM = 'welcome';
