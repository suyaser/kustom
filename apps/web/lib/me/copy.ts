/**
 * Every sentence a `/api/me/*` route answers a friend with (M3.6).
 *
 * One file, because a refusal is copy: `05-design.md`, "Copy — the role tap and picking
 * yourself (M3.6, product 2026-09-10)" is the table these are typed from, and product rules
 * every one of them. Spread over the two rule modules and the handler they were four places
 * to edit and four places to drift; here a change is one file and one diff, and the route
 * tests assert **these constants** rather than literals, so a sentence cannot be edited in
 * one place and asserted in another.
 *
 * The rule for the next one, from the same section: *say what happened, then say who can undo
 * it or what to do next.* Never the database's vocabulary — a friend on a phone has no rows,
 * no ids and no player records. Never an apology. Never name a page the reader cannot open.
 *
 * **ASCII apostrophes only.** These are rendered on the page beside `That's me` and `Names
 * fill in after someone's first game.`; a typographic apostrophe in one string of twelve is a
 * typo the reader can see. This whole tree is ASCII-only on that character, so the check is a
 * grep rather than a reading.
 */

/* ---------------------------------------------------------------------------
 * `POST /api/me/role-tonight`
 * ------------------------------------------------------------------------- */

/** A non-admin body naming somebody else (403). Decided before any read. */
export const ROLE_TAP_NOT_YOURS = "That is not you. Only an admin can set somebody else's role.";

/** The lobby is finished, dropped, abandoned or gone (404, 409). */
export const ROLE_TAP_NO_LOBBY = 'That lobby is over. You can set a role when the next one opens.';

/** A linked player who is not in that lobby (409). */
export const ROLE_TAP_NOT_IN_LOBBY = 'You are not in that lobby. Join it in League and you can pick a role.';

/** A signed-in visitor with no player row tapping a role (403). The list is two blocks up. */
export const ROLE_TAP_NOT_LINKED = 'Pick yourself out of the list first, then you can set a role.';

/* ---------------------------------------------------------------------------
 * `POST /api/me/lobbies/start` (M4.13)
 * ------------------------------------------------------------------------- */

/**
 * A signed-in visitor with no player row pressing `Start a lobby` (403). Built on
 * {@link ROLE_TAP_NOT_LINKED}'s shape on purpose — same first clause, same order, one verb
 * changed — because it is the same fact about the same visitor said about a second control.
 *
 * The page cannot produce this request: the control is drawn for linked viewers only, and the
 * signed-in-unlinked visitor is already told `Signed in. Open the page while the lobby is up and
 * you can pick yourself out of it.` at the foot of the column. So this is the forged-post
 * answer, and it is a sentence rather than the raw envelope of a gate that assumed a player row.
 */
export const START_LOBBY_NOT_LINKED = 'Pick yourself out of the list first, then you can start a lobby.';

/* ---------------------------------------------------------------------------
 * `POST /api/me/link`
 * ------------------------------------------------------------------------- */

/**
 * Product's sentence from the M3.6 brief, and pinned by its acceptance check 3. Not touched by
 * the 2026-09-10 copy pass.
 */
export const LINK_TAKEN = 'Someone is already linked to that player.';

/** A session that already has a player tapping `That's me` (409). */
export const LINK_ALREADY_LINKED =
  'You already picked yourself. An admin can undo it if it was the wrong name.';

/** `That's me` on somebody who is not in tonight's lobby (403). */
export const LINK_NOT_IN_LOBBY = "You can only pick somebody who is in tonight's lobby.";

/* ---------------------------------------------------------------------------
 * Both routes
 * ------------------------------------------------------------------------- */

/**
 * A PUUID no player has (404). **Kept as the engineer wrote it** (product, 2026-09-10): the
 * page cannot produce this request, so it is the one string here no friend can reach. If it
 * ever becomes reachable it goes back to the copy table.
 */
export const UNKNOWN_PLAYER = 'No player with that id.';
