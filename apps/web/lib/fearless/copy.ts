/**
 * Every sentence Fearless says, on the tonight page, in Discord and on `/admin` (M10).
 *
 * The companion never auto-bans: this copy is for humans, and nothing here promises the
 * client will lock anything.
 */

import type { RoleValue } from '@customs/db';

export const FEARLESS_TITLE = 'Fearless';

export const FEARLESS_SENTENCE = 'Ban these next game.';

export const FEARLESS_OTHER = 'other';

export const FEARLESS_SEARCH = 'Find a champion';

export const FEARLESS_SEARCH_EMPTY = 'No champion matches.';

/**
 * The lane filter's group name, for a screen reader only (2026-10-03): the five toggles say
 * their role words themselves, and this says what pressing them does.
 */
export const FEARLESS_LANE_FILTER = 'Lanes to show';

/**
 * The tonight card's sentence (designer, 2026-10-03). The card leads with who is still open,
 * so `Ban these next game.` above a list of open champions would say the opposite of what is
 * under it. Discord posts the ban list alone and keeps {@link FEARLESS_SENTENCE}.
 */
export const FEARLESS_CARD_SENTENCE = 'Still open, by lane. Played champions are banned next game.';

/** Champions in a lane the pool has not locked. */
export const FEARLESS_OPEN = 'still open';

/** The fold under each lane: the champions in it already on the ban list. */
export const FEARLESS_BANNED_LABEL = 'banned';

/** The card's head count on the tonight page: the bans, named as bans. */
export function fearlessBannedCount(n: number): string {
  return `${n} banned.`;
}

/** Beside each lane word: how many are still open in it. */
export function fearlessLaneOpen(n: number): string {
  return n === 0 ? 'none open' : `${n} open`;
}

export const FEARLESS_RESET_DESCRIPTION = 'Pool cleared. Ban list is empty.';

export const FEARLESS_RESET_BUTTON = 'Reset fearless';

export const FEARLESS_EMPTY_ADMIN = 'No champions in the pool. The next Rift custom fills it.';

export const FEARLESS_RESET_NOTICE = 'Fearless pool cleared.';

export const FEARLESS_RESET_POSTED = 'Fearless pool cleared. Posted to Discord.';

export const FEARLESS_RESET_SKIPPED =
  'Fearless pool cleared. No webhook is configured, so nothing was posted.';

export const FEARLESS_RESET_FAILED =
  'Fearless pool cleared. Discord did not take the post, but the pool is empty.';

export function fearlessCount(n: number): string {
  return n === 1 ? '1 champion.' : `${n} champions.`;
}

export function fearlessDescription(n: number): string {
  return `${FEARLESS_SENTENCE} ${fearlessCount(n)}`;
}

export function fearlessLaneTitle(role: RoleValue | null): string {
  return role === null ? FEARLESS_OTHER : role;
}

export function fearlessBanned(name: string): string {
  return `${name} is on the ban list.`;
}

export function fearlessAvailable(name: string): string {
  return `${name} is still available.`;
}
