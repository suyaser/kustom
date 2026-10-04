/**
 * Every friend-facing sentence on `/new`, `/join/<code>` and the `You're in.` line (M14.21, folding in
 * M13.13). Product's where the brief or STRATEGY section 3.2 to 3.4 words it; the rest is marked
 * `[NEW COPY]` in the task report so product can replace it. Tests assert these constants, never
 * literals.
 *
 * The server's own refusals (`That link is taken.`, the dead-link sentence, the pairing refusals)
 * live in `./copy.ts` and `@customs/db/schemas` and are printed as the route answers them.
 */

import { CLAIM_PROMPT } from '../shellCopy';

/* ---------------------------------------------------------------------------
 * /new
 * ------------------------------------------------------------------------- */

export const NEW_TITLE = 'Start a group';
export const NEW_NAME_LABEL = 'Name';
export const NEW_NAME_HINT = 'What your friends call it.';
export const NEW_LINK_LABEL = 'Link';
/** The field's prefix: the path every group lives under. */
export const NEW_LINK_PREFIX = '…/g/';
export const NEW_LINK_HINT = "Letters, numbers and dashes. You can't change it later.";
export const NEW_CREATE_LABEL = 'Create';
/** While the create request is in flight. [NEW COPY] */
export const NEW_CREATING_LABEL = 'Creating…';
/** Signed out: what the sign-in is for. [NEW COPY] */
export const NEW_SIGNED_OUT_LINE = 'Sign in with Discord to start a group for your customs.';
/** Anything the server answered without a field to blame (a 500, the network). [NEW COPY] */
export const NEW_FAILED = "Couldn't create the group. Try again.";

/* ---------------------------------------------------------------------------
 * /join/<code>
 * ------------------------------------------------------------------------- */

/**
 * A dead code: M13.13's one sentence (`INVITE_DEAD` in `./copy.ts`, which the routes answer), split
 * into the h1 and the line under it on the page (designer round 1). Together they are that sentence.
 */
export const INVITE_DEAD_TITLE = "This link doesn't work anymore.";
export const INVITE_DEAD_LINE = 'Ask your group for the new one.';

/** Signed out (M13.13). */
export const joinPitch = (groupName: string): string =>
  `${groupName} uses Kustom to pick fair teams for your customs.`;

/** Signed in and linked: the one button (M13.13). */
export const joinButtonLabel = (groupName: string): string => `Join ${groupName}`;
/** While the join request is in flight. [NEW COPY] */
export const JOINING_LABEL = 'Joining…';
/** The join request failed without a sentence of its own. [NEW COPY] */
export const JOIN_FAILED = "Couldn't join. Try again.";

/** Signed in, not linked (STRATEGY 3.4). [NEW COPY] */
export const WHICH_ACCOUNT_TITLE = 'Which League account is yours?';
/** The reason under it (M14.33, STRATEGY §2.4). [NEW COPY] */
export const WHICH_ACCOUNT_REASON = "Once we know, you'll see every game you've played with this group.";
export const HAVE_KUSTOM_TITLE = 'I have Kustom';
/** The instruction, ending in the colon the code follows (M17.18: in Kustom 1.0's own words). */
export const HAVE_KUSTOM_LINE =
  'Open Kustom on your PC with League running and type this code where it asks for one:';
export const DONT_HAVE_KUSTOM_TITLE = "I don't";
/** M14.73: the claim sentence is You's own ({@link CLAIM_PROMPT}). */
export const DONT_HAVE_KUSTOM_LINE = `No problem. Play a game with the group. ${CLAIM_PROMPT}`;
export const openGroupLabel = (groupName: string): string => `Open ${groupName}`;

/** On `/g/<slug>?joined=1`, whichever way they came in (STRATEGY 3.3). */
export const JOINED_LINE = "You're in.";

/* ---------------------------------------------------------------------------
 * The pairing code (the `I have Kustom` card and the admin's host card)
 * ------------------------------------------------------------------------- */

export const PAIRING_TTL_LINE = 'It works for 15 minutes.';
/** The code ran out (STRATEGY 3.3, matching the server's 410). */
export const PAIRING_EXPIRED_LINE = 'That code ran out.';
export const NEW_CODE_LABEL = 'New code';
/** The admin card asks for a code on a tap, so a page view does not mint one. [NEW COPY] */
export const GET_CODE_LABEL = 'Get a code';
/** While a code is being made. [NEW COPY] */
export const GETTING_CODE_LABEL = 'Getting a code…';
/** A code request failed without a sentence of its own. [NEW COPY] */
export const PAIRING_FAILED = "Couldn't get a code. Try again.";
/** Accessible name for the code itself, read out letter by letter by the code's own label. */
export const PAIRING_CODE_LABEL = 'Your code';
/** The in-place copy control (05-design 5.0: the label is the result, 2 s). */
export const COPY_LABEL = 'Copy';
export const COPY_LINK_LABEL = 'Copy link';
export const COPIED_LABEL = 'Copied';

/* ---------------------------------------------------------------------------
 * Session refusals, in place of the gate's developer text (lead, 2026-10-03)
 * ------------------------------------------------------------------------- */

/** Any 401 from a create, join or pairing post: the session ran out while the page sat open. [NEW COPY] */
export const SESSION_EXPIRED = 'Your sign-in ran out. Sign in again.';
/** A 403 that carries no product sentence of its own (a session with no Discord identity). [NEW COPY] */
export const NOT_ALLOWED_HERE = "You can't do that here.";
