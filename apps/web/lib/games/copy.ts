import type { WindowKind } from '../night';
import { SIDE_LABELS } from '../stats/copy';
import { kdaLine, kpLine } from '../stats/funCopy';

/**
 * Every word `/games` says. The tab, the heading, the result line and the scoreboard
 * labels live here so the page cannot invent a second sentence for the same fact.
 */

/** The nav tab, the heading beside the window's name, the `<title>`. */
export const GAMES_LABEL = 'Games';

/** The player page's link out of `Recent games` and onto this list. */
export const ALL_GAMES_LABEL = 'All games';

/** The group list, when `?p=` is naming one person. */
export const EVERYONE_LABEL = 'Everyone';

/** The two maps this page lists. The picker's accessible name is the noun, not a label on screen. */
export const QUEUE_PICKER_LABEL = 'Map';

export const QUEUE_LABELS: Readonly<Record<'sr' | 'aram', string>> = {
  sr: "Summoner's Rift",
  aram: 'ARAM',
};

export const SCOREBOARD_LABEL = 'Scoreboard';

export const COL_KDA = 'KDA';
export const COL_DAMAGE = 'Damage';
export const COL_GOLD = 'Gold';
export const COL_CS = 'CS';

export function blueWon(): string {
  return `${SIDE_LABELS[100]} won`;
}

export function redWon(): string {
  return `${SIDE_LABELS[200]} won`;
}

export function resultForWinner(side: 100 | 200): string {
  return side === 100 ? blueWon() : redWon();
}

/** `39–25`: blue kills first, then red. An en dash, the same mark the scoreboards use. */
export function scoreLine(blueKills: number, redKills: number): string {
  return `${blueKills}–${redKills}`;
}

export function teamHeading(side: 100 | 200, kills: number): string {
  return `${SIDE_LABELS[side]} · ${kills}`;
}

export function showingFocus(name: string): string {
  return `Showing ${name}'s games.`;
}

export function focusMetaLine(
  kills: number,
  deaths: number,
  assists: number,
  kp: number | null,
  cs: number,
): string {
  const kda = kdaLine(kills, deaths, assists);
  const farm = `${cs} CS`;
  return kp === null ? `${kda} · ${farm}` : `${kda} · ${kpLine(kp)} · ${farm}`;
}

/* -------------------------------------------------------------------------------------------
 * Kustom 2.0 (M14.16): the Games list and the game page. Every friend-facing string on them is
 * here or in `lib/receipt/copy.ts`.
 * ----------------------------------------------------------------------------------------- */

/** The date chips (STRATEGY §6(c)). `last-week` links still work, with no chip lit. */
export const GAMES_WINDOW_LABELS: Readonly<Record<'tonight' | WindowKind, string>> = {
  tonight: 'Tonight',
  'this-week': 'This week',
  'last-week': 'Last week',
  'all-time': 'All',
};

/** The mode chips. */
export const GAMES_MODE_LABELS: Readonly<Record<'sr' | 'aram', string>> = { sr: 'Rift', aram: 'ARAM' };

export const DATE_FILTER_LABEL = 'Date';
export const MODE_FILTER_LABEL = 'Map';
export const PLAYER_FILTER_LABEL = 'Player';
export const PLAYER_FILTER_SUBMIT = 'Show';

/** STRATEGY §6(c), verbatim. */
export const NO_GAMES_MATCH = 'No games match. Try a wider date range.';
export const SEE_ALL_DATES = 'See all dates';
export const NO_GAMES_YET = 'No games yet. They show up here when a custom ends.';

/** `112 games`. */
export function gamesCount(total: number): string {
  return total === 1 ? '1 game' : `${total} games`;
}

export const NEWER_PAGE = 'Newer';
export const OLDER_PAGE = 'Older';
export const PAGES_LABEL = 'Pages';

/** `Page 2 of 7`. */
export function pageOf(page: number, pages: number): string {
  return `Page ${page} of ${pages}`;
}

/** The viewer's line on a row starts with this word (beside the `YOU` sticker on the game page). */
export const YOU_WORD = 'You';

export const COL_VISION = 'Vision';
export const BACK_TO_GAMES = 'All games';

/** The team card's header tag on the winner (05-design 5.1). */
export const WON_TAG = 'Won';

/** `Blue team`: the team section's heading. */
export function teamTitle(side: 100 | 200): string {
  return `${SIDE_LABELS[side]} team`;
}

export const NOT_RATED = 'not rated';

/** M23.1 [NEW COPY]: a voided game's note, on its Games row and its page. */
export const VOIDED_NOTE = 'Not rated · voided';
/** M23.1 [NEW COPY]: the game page's admin buttons. */
export const VOID_GAME = 'Void game';
export const RESTORE_GAME = 'Restore';
/** M23.1 [NEW COPY]: the notices after a void or a restore, and the refusal for a game never rated. */
export const VOID_DONE = 'Voided. It no longer counts for ratings.';
export const RESTORE_DONE = 'Restored. It counts for ratings again.';
export const VOID_NOT_RATED = 'This game is not rated.';
/** M23.1 [NEW COPY]: a game the ingest voided because it ended under 15 minutes (people left). */
export const ENDED_EARLY_NOTE = 'Not rated · ended early';
/** M23.1 [NEW COPY]: the restore button on a game that ended early (a real short stomp). */
export const RATE_ANYWAY = 'Rate it anyway';
/** M23.1 [NEW COPY]: a void or restore whose rebuild did not finish; the flag was put back (503). */
/**
 * M23.3 [NEW COPY]: under a disabled Void / Restore / Rate it anyway while a lobby is live or a game
 * landed in the last 15 minutes (the rebuild guard), and the route's 409 for the same.
 */
export const VOID_AFTER_TONIGHT = "Ratings can change after tonight's games.";
export const REBUILD_FAILED = "Couldn't update ratings. Try again in a minute.";

/** The Games row and game page note for a voided game, by why it was voided. */
export function voidedNote(reason: string | null): string | null {
  if (reason === null) return null;
  return reason === 'early-end' ? ENDED_EARLY_NOTE : VOIDED_NOTE;
}
