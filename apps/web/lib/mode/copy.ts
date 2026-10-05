import type { GroupMode } from '@customs/db/schemas';

/**
 * Mode strings (M14.29 / M14.30, product's copy table of 2026-10-03). One row per mode, so M15
 * adds rows here and nothing else changes. M14.30 adds the card's and the panel's strings.
 */

/**
 * Said once when the mode changes: Tonight's announcer (M14.30), and the notice a no-JS form post
 * of `POST /api/admin/mode` is sent back with. A repeat of the current mode says the same thing:
 * it is the mode now either way.
 */
export const MODE_ANNOUNCEMENTS: Record<GroupMode, string> = {
  normal: 'Mode: Normal. Every champion is open.',
  fearless: 'Mode: Fearless. The ban list picks up where it stopped.',
};

/** A mode change or a reset that failed, said in place. */
export const MODE_CHANGE_FAILED = "Couldn't change that. Try again.";

/* ---------------------------------------------------------------------------
 * The Mode card and the mode panel (M14.30; 02-milestones M14.30's copy table, 05-design.md 8.11).
 * ------------------------------------------------------------------------- */

/** The card's label (read before its title: `Mode Fearless`). */
export const MODE_CARD_LABEL = 'Mode';

/**
 * M15.15: the finished card's head over its row. After a game the card is about the next one, so
 * its `Rated` chip must not read as the verdict on the game just played.
 */
export const MODE_CARD_NEXT_GAME = 'Next game';

/** Each mode's name: the card title and the panel heading. */
export const MODE_NAMES: Record<GroupMode, string> = { normal: 'Normal', fearless: 'Fearless' };

/** Both M14 modes are rated (no rated toggle until M15.1); the chip word comes from the mode. */
export const MODE_RATED: Record<GroupMode, boolean> = { normal: true, fearless: true };
export const RATED_CHIP = 'Rated';
export const NOT_RATED_CHIP = 'Not rated';

/** The card's status line in Normal. */
export const NORMAL_STATUS = 'Every champion is open.';

/** The card's action, per mode. */
export const MODE_ACTIONS: Record<GroupMode, string> = {
  normal: 'All modes',
  fearless: "See what's open",
};

/** The admin foot. */
export const MODE_ADMIN_EYEBROW = 'Admins and the owner';
export const MODE_SETTINGS_LABEL = 'Mode settings';
export const MODE_PICKER_LABEL = 'Mode';
/** M20.8 (lead's call): after Roll the picker is the next game's (the row), so it says so. */
export const MODE_PICKER_LABEL_NEXT = 'Next game';
export const SET_MODE = 'Set mode';
export const SETTING_MODE = 'Setting…';
/** Under the select (design round 1): only Normal says something; Fearless is the card above it. */
export const MODE_PICKER_SENTENCES: Record<GroupMode, string | null> = {
  normal: 'Every champion is open. The fearless list is saved for later.',
  fearless: null,
};
export const MODE_APPLIES_NEXT_GAME = 'Changes apply from the next game.';

/** Members, the moment it goes Normal, until the next game lands. */
export const MODE_NOW_NORMAL_TITLE = 'Normal mode now.';
export const MODE_NOW_NORMAL_BODY = 'An admin switched off Fearless, so every champion is open.';

/** The panel. */
export const PANEL_CRUMB_TONIGHT = 'Tonight';
export const PANEL_CRUMB_MODE = 'Mode';
export const PANEL_CLOSE = 'Close';
export const PANEL_NORMAL_BODY = 'Every champion is open, and games are rated as usual.';
export function panelNormalPaused(banned: number): string {
  return `Fearless is paused with ${banned} banned. When an admin picks Fearless again, the list picks up where it stopped.`;
}
/** `To change the mode or reset, use the Mode card on Tonight.`, the last words a link to the card. */
export const PANEL_ADMIN_LEAD = 'To change the mode or reset, use the ';
export const PANEL_ADMIN_LINK = 'Mode card on Tonight';
export const PANEL_ADMIN_END = '.';

/**
 * `<title>` of the panel and the direct page: `Fearless | Kustom`. M15.5: a rule's name too
 * (`Class wars | Kustom`), so it takes the name the card shows (`modeName`).
 */
export function modeTitle(name: GroupMode | string): string {
  return `${name === 'normal' || name === 'fearless' ? MODE_NAMES[name] : name} | Kustom`;
}

/**
 * [NEW COPY] The Mode card when the `group_modes` read failed (audit, M19.13): the card keeps the
 * last mode it had, or the stand-in on a first paint, and never claims it is the group's.
 */
export const MODE_READ_FAILED = "Couldn't read the mode just now.";
