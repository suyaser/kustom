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
 * The lane control's group name (05-design.md 8.7.4, M14.30): single select `All · top · jungle ·
 * mid · adc · support`.
 */
export const FEARLESS_LANE_FILTER = 'Lane';

/** The lane control's first button. */
export const FEARLESS_ALL_LANES = 'All';

/** The find box's placeholder (8.7.4). */
export const FEARLESS_SEARCH_PLACEHOLDER = 'Ahri, Lee Sin, Wukong…';

/**
 * The tonight card's sentence (designer, 2026-10-03). The card leads with who is still open,
 * so `Ban these next game.` above a list of open champions would say the opposite of what is
 * under it. Discord posts the ban list alone and keeps {@link FEARLESS_SENTENCE}.
 */
export const FEARLESS_CARD_SENTENCE = 'Still open, by lane. Played champions are banned next game.';

/** Champions in a lane the pool has not locked. */
export const FEARLESS_OPEN = 'still open';

/** The fold under each lane: the champions in it already on the ban list (8.7.5). */
export const FEARLESS_BANNED_LABEL = 'Banned';

/** The card's head count on the tonight page: the bans, named as bans. */
export function fearlessBannedCount(n: number): string {
  return `${n} banned.`;
}

/** Beside each lane word: how many are still open in it. */
export function fearlessLaneOpen(n: number): string {
  return n === 0 ? 'none open' : `${n} open`;
}

export const FEARLESS_RESET_DESCRIPTION = 'Fearless reset. Every champion is open again.';

export const FEARLESS_RESET_BUTTON = 'Reset fearless';

export const FEARLESS_EMPTY_ADMIN = 'Nothing banned yet. The next Rift game adds its ten.';

export const FEARLESS_RESET_NOTICE = 'Fearless reset.';

export const FEARLESS_RESET_POSTED = 'Fearless reset. Posted to Discord.';

export const FEARLESS_RESET_SKIPPED = "Fearless reset. Discord isn't connected, so nothing was posted.";

export const FEARLESS_RESET_FAILED =
  "Fearless reset. Discord didn't take the post, but every champion is open again.";

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
  return `${name} is still open.`;
}

/**
 * The fearless post's description (M14.31, `05-design.md` §8.12): how many ids the game it is
 * about actually added (fewer than ten when a lock repeated a ban), the whole list, and how many
 * roster champions are still open.
 */
export function fearlessPostDescription(added: number, total: number, open: number): string {
  return `Banned next game: ${added} more, ${total} in all. ${open} still open.`;
}

/** Both fearless posts' footer when the title carries the mode panel link (M14.31). */
export const FEARLESS_POST_FOOTER = "Tap the title to see what's still open";

/* ---------------------------------------------------------------------------
 * The Mode card and the panel, Fearless (M14.30; 05-design.md 8.3, 8.7, 8.11).
 * ------------------------------------------------------------------------- */

/** `138 open · 34 banned`, open first, everywhere (8.7.5): the number in mono, then the word. */
export const FEARLESS_OPEN_WORD = 'open';
export const FEARLESS_BANNED_WORD = 'banned';

/** The card's status with an empty pool. */
export function fearlessNothingBanned(total: number): string {
  return `Nothing banned yet. All ${total} open.`;
}

/** Balanced, seated: `Your lane support · 24 open`. */
export const FEARLESS_YOUR_LANE = 'Your lane';

/** The answer band's jump into the panel on the viewer's lane. */
export function fearlessWhatsOpen(role: string): string {
  return `What's open for ${role}`;
}

/** In game. */
export const FEARLESS_IN_GAME = "This game's ten join the ban list when it ends.";

/**
 * In game, a mirror match on a Fearless night (M15.14): both lanes lock the same champion, so a
 * mirror game adds five, not ten.
 */
export const FEARLESS_IN_GAME_MIRROR = "This game's champions join the ban list when it ends.";

/** Finished: the ten this game just banned. */
export const FEARLESS_BANNED_NEXT = 'Banned next game';
export function fearlessFromGame(n: number): string {
  return `from game ${n}`;
}

/*
 * A game played not rated bans nothing (M15.15; R4: only rated Rift games feed the pool), so on a
 * Fearless night no line may promise that its champions join the list.
 */

/** In game (and balanced), a game locked not rated on standing Fearless. */
export const FEARLESS_NOT_RATED_IN_GAME = "This game isn't rated, so it bans nothing.";

/** Finished, where `Banned next game` would be. */
export const FEARLESS_NOT_RATED_FINISHED = 'Not rated, so this game banned nothing.';

/** [NEW COPY] Before Roll, the panel when the next game is not rated (pairs with `Next game is recorded, not rated.`). */
export const FEARLESS_NOT_RATED_NEXT = "Next game isn't rated, so it bans nothing.";

/** [NEW COPY] The empty-pool lead without the promise (`FEARLESS_EMPTY_BALANCED`'s first sentence). */
export const FEARLESS_NOTHING_BANNED_OPEN = 'Nothing banned yet, so every champion is open.';

/** [NEW COPY] The panel's lead without the promise (`FEARLESS_CARD_SENTENCE`'s first sentence). */
export const FEARLESS_STILL_OPEN_BY_LANE = 'Still open, by lane.';

/**
 * The Fearless sentence under the counts when the game it is about is not rated: the lead, then
 * that it bans nothing (`This game` once the teams are set, else `Next game`).
 */
export function fearlessNotRatedSentence(empty: boolean, locked: boolean): string {
  const lead = empty ? FEARLESS_NOTHING_BANNED_OPEN : FEARLESS_STILL_OPEN_BY_LANE;
  return `${lead} ${locked ? FEARLESS_NOT_RATED_IN_GAME : FEARLESS_NOT_RATED_NEXT}`;
}

/** Balanced with an empty pool (8.3). */
export const FEARLESS_EMPTY_BALANCED =
  'Nothing banned yet, so every champion is open. The ten you lock this game are banned next game.';

/** The panel head: `Pool since Thu 1 Oct, 4 games. Every champion locked since then is banned.` */
export function fearlessPoolSince(since: string | null, games: number): string {
  const count = games === 1 ? '1 game' : `${games} games`;
  return since === null
    ? `${count} so far. Every champion locked in them is banned.`
    : `Pool since ${since}, ${count}. Every champion locked since then is banned.`;
}

/** The panel, opened on the viewer's lane. */
export function fearlessYourLaneThisGame(role: string): string {
  return `Your lane this game: ${role}.`;
}
export const FEARLESS_SHOW_EVERY_LANE = 'Show every lane';

/** The Reset AlertDialog (8.11). */
export const FEARLESS_RESET_TITLE = 'Reset the fearless pool?';
export function fearlessResetBody(banned: number): string {
  return `All ${banned} bans are cleared and every champion is open again. Discord gets told.`;
}
export const FEARLESS_RESET_CANCEL = 'Cancel';
export const FEARLESS_RESETTING = 'Resetting…';
