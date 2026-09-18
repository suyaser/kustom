/**
 * Every sentence Fearless says, on the tonight page, in Discord and on `/admin` (M10).
 *
 * The companion never auto-bans: this copy is for humans, and nothing here promises the
 * client will lock anything.
 */

export const FEARLESS_TITLE = 'Fearless';

export const FEARLESS_SENTENCE = 'Ban these next game.';

export const FEARLESS_FIELD = 'Champions';

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
