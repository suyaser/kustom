/**
 * Every sentence the M13.5 routes answer with: creating a group, joining by the invite link, and
 * pairing a PUUID through Kustom.
 *
 * Kustom prints the pairing refusals **verbatim** in its `Join a group` slot (M13.7, M13.8), and
 * the `/new` and `/join/<code>` pages print the others under the field or button they belong to,
 * so each one is copy, not a log line. Product's own sentences are marked as such; the rest are
 * platform's, written to the same rule as `lib/me/copy.ts` (say what happened, then what to do
 * next; no database words; ASCII apostrophes) and listed in the 2026-10-03 decision row so product
 * can replace them. Tests assert these constants, never literals.
 *
 * The slug and name rules (`GROUP_SLUG_RULE`, `GROUP_NAME_RULE`) live with their schema in
 * `@customs/db/schemas`, because they are that schema's messages.
 */

/* ---------------------------------------------------------------------------
 * POST /api/groups
 * ------------------------------------------------------------------------- */

/** A slug another group has (409). Product's (M13.5). */
export const SLUG_TAKEN = 'That link is taken.';

/* ---------------------------------------------------------------------------
 * The invite link: POST /api/groups/join, POST /api/me/pairing { inviteCode }
 * ------------------------------------------------------------------------- */

/**
 * A rotated or never-issued invite code (404). The join page's own dead-code sentence (M13.13),
 * so a code rotated while the page sat open reads the same as one that was dead on arrival.
 */
export const INVITE_DEAD = "This link doesn't work anymore. Ask your group for the new one.";

/**
 * `Join <Group>` pressed by a session with no player row (403). The page shows that visitor the
 * pairing code instead of the button, so this is the forged-or-stale post's answer, and it says
 * what the page would have.
 */
export const JOIN_NOT_LINKED = 'Link your League account first: type the code from this page into Kustom.';

/* ---------------------------------------------------------------------------
 * POST /api/me/pairing { groupId }, GET /api/me/pairing/status
 * ------------------------------------------------------------------------- */

/** A `groupId` that names no group (404). */
export const NO_SUCH_GROUP = 'No such group.';

/**
 * A `groupId` pairing request from somebody who did not create the group (403). Only the creator
 * pairs from `/new`; everyone else comes in through the invite link.
 */
export const PAIRING_NOT_CREATOR =
  "Only the person who started this group can get a code here. Use the group's invite link.";

/** A status poll for a code this session was not given, or one a newer code replaced (404). */
export const PAIRING_NO_SUCH_CODE = 'No such code. Get a new one from the page.';

/* ---------------------------------------------------------------------------
 * POST /api/companion/pair  (printed by Kustom)
 * ------------------------------------------------------------------------- */

/** Used or past its 15 minutes (410). Product's (M13.5). */
export const PAIRING_CODE_EXPIRED = 'That code ran out. Get a new one from the page.';

/**
 * A code nobody was given -- a typo, almost always (404). Not worded by M13.5; platform's,
 * decision row 2026-10-03.
 */
export const PAIRING_CODE_UNKNOWN = "That code doesn't match. Check the page and type it again.";

/** The 11th attempt in a minute from one address (429). Not worded by M13.5; platform's. */
export const PAIRING_RATE_LIMITED = 'Too many tries. Wait a minute, then type the code again.';

/**
 * The code's Discord account is already on another PUUID's row (409): pairing from a second
 * League account. Product's (M13.5), with the linked player's name in it.
 */
export function pairingDiscordLinked(name: string | null): string {
  return `This Discord account is already linked to ${name ?? FALLBACK_LINKED_NAME}.`;
}

/**
 * The name in {@link pairingDiscordLinked} when the linked row has none yet (a player paired but
 * never seen in a lobby). Platform's.
 */
export const FALLBACK_LINKED_NAME = 'another League account';

/** The PUUID's row carries a different Discord account (409). Product's (M13.5), M3.6's never-steal rule. */
export const PAIRING_PUUID_LINKED = 'That League account is already linked to someone else.';

/* ---------------------------------------------------------------------------
 * POST /api/admin/invite/rotate
 * ------------------------------------------------------------------------- */

/**
 * The admin form's answer after `New link` (M13.14's invite card; `[copy owed]` in 05-design.md).
 * Platform's, until product words it.
 */
export const INVITE_ROTATED = 'New link made. The old one no longer works.';
