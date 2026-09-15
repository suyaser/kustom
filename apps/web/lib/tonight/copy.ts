import { evenness } from '@customs/core';
import { NAMELESS_PLAYER, type PlayerName } from '../discord/embeds';
import { PLAYERS_PER_GAME } from '../lobbyState';

/**
 * Every sentence the tonight page says, in one file, spelled the way product and
 * `docs/05-design.md` spell them ("Copy — final (product 2026-09-09)"). Nothing here is
 * composed from a template an engineer invented, and nothing here is edited without product.
 *
 * The two surfaces that quote a **stored** string — the explanation line and, through it, the
 * off-role clause (M3.7) — are not in this file at all: they are rendered verbatim from
 * `splits.explanation` and may never be recomposed.
 */

/* ---------------------------------------------------------------------------
 * The status strip's headline. One word or phrase per state, upper case, in the display cut:
 * it is read at arm's length, and the sentence under it never repeats it.
 * ------------------------------------------------------------------------- */

/**
 * No lobby tonight. Not `NOTHING TONIGHT`: this is the screen a friend hits at 19:00 from a
 * WhatsApp link, and "nothing tonight" reads as *the night is off* to a group that plays every
 * night — and it is false in the other idle case, an abandoned lobby.
 */
export const HEADLINE_IDLE = 'NOBODY IN YET';

/** The count is the other half: `9 IN THE LOBBY`. */
export const HEADLINE_FILLING = 'IN THE LOBBY';

export const HEADLINE_BALANCED = 'TEAMS ARE SET';

export const HEADLINE_IN_GAME = 'IN GAME';

/** Not `FINAL`: that is the broadcast lower-third word this design has no room for. */
export const HEADLINE_FINISHED = 'GAME OVER';

/* ---------------------------------------------------------------------------
 * The strip's sentence: the page's one polite live region, two lines reserved so that a
 * change of count moves nothing under a thumb.
 * ------------------------------------------------------------------------- */

/** M1.10's sentence, unchanged word for word, so the wording does not move under people. */
export const IDLE_SENTENCE =
  'When ten of you are in a custom lobby with the companion running, the teams show up here.';

/**
 * Nobody has joined yet — said **once**, in the strip, and never again under the rack. A rack
 * of ten `open` seats is the picture; this is the fact.
 */
export const EMPTY_LOBBY = 'Nobody in the lobby yet.';

export const BALANCED_SENTENCE = 'Split by rating and role. Nobody picked the teams.';

export const IN_GAME_SENTENCE = 'Ratings move when it ends.';

export const FINISHED_SENTENCE = 'Ratings are updated. The leaderboard has the rest.';

/** Eleven or more around: the ten play and the sit-out strip explains who is not in them. */
export const OVERFULL_SENTENCE = 'Ten play, the rest sit out this game.';

/** Ten in, nothing to do: the balancer runs on the companion's next post. */
export const TEN_IN_SENTENCE = 'Teams in a moment.';

/**
 * How many are still missing, as a **word** — the digit is already 44px above it in the
 * headline. Index 1 is one seat left to fill, which is the line under `9 IN THE LOBBY`.
 *
 * A full and an empty lobby are not in here: they have sentences of their own
 * ({@link EMPTY_LOBBY}, {@link TEN_IN_SENTENCE}, {@link OVERFULL_SENTENCE}).
 */
const COUNTDOWN_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'] as const;

/** The strip's sentence while the lobby fills. The one text that changes without a state change. */
export function fillingSentence(around: number): string {
  if (around <= 0) return EMPTY_LOBBY;
  if (around > PLAYERS_PER_GAME) return OVERFULL_SENTENCE;
  if (around === PLAYERS_PER_GAME) return TEN_IN_SENTENCE;
  return `${COUNTDOWN_WORDS[PLAYERS_PER_GAME - around]} more to go.`;
}

/* ---------------------------------------------------------------------------
 * The seat rack.
 * ------------------------------------------------------------------------- */

/** The rack's header: `SEATS · 9 of 10`, and the `rating` legend right-aligned over the column. */
export const RACK_LABEL = 'SEATS';

export const RACK_LEGEND = 'rating';

export function rackCount(around: number): string {
  return `${Math.min(around, PLAYERS_PER_GAME)} of ${PLAYERS_PER_GAME}`;
}

/** A seat nobody is in. Lower case, mono, on `bg`: recessed below the card. */
export const OPEN_SEAT = 'open';

/**
 * One line under the rack, and only while **no** member on screen has a role — where the word
 * `flexible` on nine rows would be a column of identical grey words rather than information.
 * `the bot`, because that is what product calls it on every other surface.
 */
export const ALL_FLEXIBLE_HINT = 'Nobody has set a role tonight, so the bot can put anyone anywhere.';

/** A row for somebody who has declared nothing, on a screen where somebody else has. */
export const FLEXIBLE_ROLE = 'flexible';

/** Beyond the ten a custom lobby can seat. */
export const AROUND_LABEL = 'Around';

/* ---------------------------------------------------------------------------
 * Team cards.
 * ------------------------------------------------------------------------- */

/**
 * The legend in a team card's header, when that card has a seat off its role (the designer,
 * 2026-09-10, `05-design.md` "The `· off-role` legend in a team card header").
 *
 * It is the key to the amber dot on the rows below it, dressed like every other mono
 * micro-label on the page — `rating`, `SEATS`, `live`, `open` — and never `brand` itself: the
 * one amber in a header bar is the dot.
 *
 * The suffix is visually hidden. The bare word straight after `RED` reads as a property of the
 * side; `off-role seats in this card` is what a listener moving header to header needs, and the
 * plural is a category, like `rating` over a column of many, so nothing pluralises at render.
 */
export const OFF_ROLE_LEGEND = 'off-role';

export const OFF_ROLE_LEGEND_SUFFIX = ' seats in this card';

/**
 * The one punctuation mark between a heading and its legend, the same one the rack header's
 * `SEATS · 9 of 10` uses. In its own `aria-hidden` span and **not** a CSS `::before`:
 * generated content is announced by VoiceOver, and this is punctuation.
 */
export const HEAD_SEPARATOR = '·';

/**
 * M3.10's one quiet line, under the block and never per row. It appears while any row on
 * screen reads `Someone` and disappears with the last of them.
 */
export const NAMELESS_HINT = "Names fill in after someone's first game.";

/* ---------------------------------------------------------------------------
 * Teams, the sit-out strip and the result.
 * ------------------------------------------------------------------------- */

/** `05-design.md`, "Explanation line": the ghost button on the strip. */
export const REROLL_LABEL = 'Reroll';

/**
 * `100% even.` is a claim nobody believes, so the top of the scale gets its own sentence
 * (product, 2026-09-15). It is also what the first night ever says, when nobody has a rating
 * and the split is a flat 50% — which is true, and is the same thing `Neither side was
 * favored.` already says in the stored explanation.
 */
export const EVENNESS_PERFECT = 'Teams are as even as they get.';

/**
 * `Teams are 92% even.` — M3.31, the one line under the balanced teams.
 *
 * **It is arithmetic on the number the page is already showing, never a second opinion.** The
 * argument comes from `splits.blue_win_prob`, the chosen split's *stored* probability, and the
 * transform is core's `evenness`. That is the whole of why this line can never disagree with
 * the `Blue favored 54%.` in the explanation above it: one number, read twice, even after
 * somebody's rating has moved the morning after. Recomputing it from the ratings on screen is
 * the way to get this wrong.
 *
 * `null` — no line at all, not `—` and not `unknown` — for a split with no stored probability:
 * a row written before the column, or a page rendering a lobby optimistically. The column is
 * `not null` with a `[0, 1]` check today, so the guard is for a value that crossed a wire and
 * lost its type, and it returns rather than throwing: `evenness` throws outside `[0, 1]`, and a
 * throw here would take down the page twenty people are reading in the dark over one line.
 */
export function evennessLine(blueWinProb: number | null | undefined): string | null {
  if (typeof blueWinProb !== 'number' || !Number.isFinite(blueWinProb)) return null;
  if (blueWinProb < 0 || blueWinProb > 1) return null;

  const score = evenness(blueWinProb);
  return score === 100 ? EVENNESS_PERFECT : `Teams are ${score}% even.`;
}

/**
 * The sit-out strip (05-design.md, "Sit-out notice"; product, 2026-09-08 — final).
 *
 * Two versions and no third: the general one, and the second-person one for a viewer who is
 * signed in, linked, and one of the people sitting. Nobody else's strip changes.
 */
export function sitOutGeneral(names: string): string {
  return `Sitting out this game: ${names}. Each game goes to whoever has played least tonight, so they are first in line for the next one.`;
}

export const SIT_OUT_VIEWER =
  'You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.';

/** `05-design.md`: truncate a display name at 32 characters with an ellipsis. */
const MAX_NAME_LENGTH = 32;

/**
 * The name as the **web** prints it: the newest display name we have, trimmed, cut at 32
 * characters, and `Someone` when we have none (M3.10).
 *
 * Deliberately not `renderName` from `lib/discord/embeds.ts`, which escapes Discord markdown:
 * a backslash before an underscore is right in a channel and wrong on a page, where a name is
 * text in a `<span>` and React escapes what needs escaping. The fallback word is imported
 * rather than retyped — one word, spelled in one place, on every surface.
 */
export function renderWebName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  return trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
}

/** True when this row will print the fallback, which is what turns the hint line on. */
export function isNameless(name: PlayerName): boolean {
  return (name ?? '').trim().length === 0;
}

/** `Sara and Deniz`, `Sara, Deniz and Ali` (05-design.md, "Sit-out notice"). */
export function joinWebNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderWebName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}

/* ---------------------------------------------------------------------------
 * Role for tonight, and picking yourself out of the lobby (M3.6).
 *
 * Product's words, from `05-design.md`, "Copy — the role tap and picking yourself (M3.6,
 * product 2026-09-10)" — the control's own strings are the 2026-09-09 brief's, typed here
 * unchanged, and the two offline sentences are product's from the 2026-09-10 pass. The
 * sentences the **routes** answer with are in `lib/me/copy.ts`, and the same table rules both
 * files.
 * ------------------------------------------------------------------------- */

/**
 * The card's title. Archivo, not the mono micro-label: it is language, and a card title in
 * 12px tracked mono reads as a code comment (the designer, 2026-09-10).
 */
export const ROLE_CONTROL_HEADING = 'Your role tonight';

/**
 * `Your role tonight · Iris` when we have a name for the viewer's player, and the bare title
 * otherwise (product, 2026-09-10). **Never `· Someone`**: the fallback word exists so a row in
 * a list is not blank, and a title that says `· Someone` about the person reading it is worse
 * than a title that says nothing. The separator is the rack header's own middot.
 */
export function roleCardTitle(name: PlayerName): string {
  // `renderWebName` is what every other surface prints, truncation and all; the guard above is
  // what stops its `Someone` fallback ever reaching this line.
  return isNameless(name)
    ? ROLE_CONTROL_HEADING
    : `${ROLE_CONTROL_HEADING} ${HEAD_SEPARATOR} ${renderWebName(name)}`;
}

/**
 * Under the control, once. The whole meaning of the feature in two sentences: it is a
 * preference, not a lock, and the page must not promise more than the balancer does.
 */
export const ROLE_CONTROL_HINT =
  'The bot tries for this one. If the teams need it, you can still end up somewhere else.';

/**
 * The card's **only** hint from `balanced` on, replacing {@link ROLE_CONTROL_HINT} rather than
 * stacking under it (the designer and product, 2026-09-10): a tap then is stored and the teams
 * **do not move** — a rebalance on a role tap would be an unlimited reroll that any one of ten
 * people can pull, and by then people have already moved to their side in the client. It says
 * what the tap is worth instead of announcing a save nobody asked for.
 */
export const ROLE_TEAMS_ALREADY_SET =
  'Teams are already set. A role you pick now is what the bot tries for in the next game.';

/**
 * The signed-out card's sentence. The control beside it is labelled {@link SIGN_IN_LABEL}: a
 * button's label is a label, not a sentence (the designer, 2026-09-10). Reading is never gated.
 */
export const ROLE_SIGN_IN = 'Sign in with Discord to pick your role.';

export const SIGN_IN_LABEL = 'Sign in with Discord';

/** Above the list of tonight's members, for a signed-in visitor who matches no player row. */
export const PICK_YOURSELF =
  'Which one of these is you? Pick yourself once and the page knows you from now on.';

/** On every row of that list. */
export const THATS_ME = "That's me";

/** The same visitor when there is nobody to pick, so the page asks nothing. */
export const SIGNED_IN_NO_LOBBY =
  'Signed in. Open the page while the lobby is up and you can pick yourself out of it.';

/**
 * The request never reached the server, so nothing was written. `tap it again` is the whole
 * fix and the sentence is not allowed to end without it (product, 2026-09-10).
 *
 * Every sentence the **routes** answer with is `lib/me/copy.ts`; these two are the page's own,
 * because only the browser knows a request never left it.
 */
export const ROLE_TAP_OFFLINE = 'That did not reach the server. Your role is unchanged — tap it again.';

/** The same case, on the `That's me` list. */
export const LINK_OFFLINE = 'That did not reach the server. Nothing changed — tap it again.';

/* ---------------------------------------------------------------------------
 * `Start a lobby` (M4.2's control, M4.7's placement, M4.13's gate).
 *
 * Every word the control says is product's and lives in `lib/lobbyStart.ts`, beside the rules
 * that answer with it: the label, the pending line, the invited line and the four refusals are
 * imported from there and never retyped here. The two sentences below are the page's own, for
 * the same reason the role tap's is — only the browser knows a request never left it, and only
 * the page knows what to say to somebody who is not signed in at all.
 * ------------------------------------------------------------------------- */

/**
 * The press never reached the server, so nothing was created and nobody was invited. Built to
 * the shape product fixed for the other two (`ROLE_TAP_OFFLINE`, `LINK_OFFLINE`): the fact,
 * what is unchanged, then the whole fix.
 */
export const START_LOBBY_OFFLINE = 'That did not reach the server. No lobby was opened — tap it again.';

/**
 * The signed-out visitor's sentence on the **idle** page, back from the suspension the
 * 2026-09-10 copy row put it under (M4.13). It was suspended on two grounds: it promised a
 * button a non-admin could not press — which this milestone removes — and "this page's one
 * sign-in already lives on the role card forty pixels away", which is false in the one state
 * that matters: `RoleTonight` draws nothing at all for a signed-out visitor with no live lobby,
 * so on an idle page there is no other sign-in control anywhere on this site.
 *
 * It is the reason, and {@link SIGN_IN_LABEL} beside it is the label — the role card's own
 * signed-out shape (the designer, 2026-09-10). **Never a disabled button.**
 *
 * The control prints this same sentence for a **401** as well, which is the same fact: a session
 * that expired between the render and the press. The route's own `sign in required` is gate
 * vocabulary and not a sentence for a friend on a phone, so it is the one refusal on this
 * control the page answers in its own words.
 */
export const START_LOBBY_SIGN_IN = 'Sign in with Discord to start a lobby.';

/* ---------------------------------------------------------------------------
 * `Missed the invite?` (M4.10, product 2026-09-10).
 *
 * `Missed the invite? The lobby is Customs 09 Sep #1, password 4821.` — and the name-only form
 * when no companion has told us a password yet. Three fragments rather than one template,
 * because the two values between them are **data** and are set in mono while the sentence
 * around them stays Archivo; {@link missedInviteSentence} assembles the same words for a test
 * to read, so the page and the string cannot drift.
 *
 * Who sees it is not a copy decision and is not here: the page draws it for a signed-in viewer
 * matched to a player row, and for nobody else (`TonightView`, product and the designer).
 * ------------------------------------------------------------------------- */

export const MISSED_INVITE_LEAD = 'Missed the invite? The lobby is ';

export const MISSED_INVITE_PASSWORD = ', password ';

export const MISSED_INVITE_END = '.';

/** The whole sentence as one string: what the rendered line reads, punctuation and all. */
export function missedInviteSentence(name: string, password: string | null): string {
  const half = password === null ? '' : `${MISSED_INVITE_PASSWORD}${password}`;
  return `${MISSED_INVITE_LEAD}${name}${half}${MISSED_INVITE_END}`;
}

/* ---------------------------------------------------------------------------
 * The side line, under the team cards (M4.3's copy, M4.7 (b)'s placement, and the two rows in
 * `05-design.md`'s copy table of 2026-09-11).
 *
 * **One definition, in `lib/discord/embeds.ts`**, re-exported here so the page keeps importing
 * its copy from its own copy file. The page and the teams embed print the identical two
 * sentences — the embed's is the last line of the `Seats` field — and the two shipped as two
 * spellings of the same words for a day, on two branches. This is the direction that already
 * existed for {@link NAMELESS_PLAYER}: the embed module is where a string both surfaces print
 * lives, because it is the module with no Next, no DOM and no page in front of it.
 *
 * `SIDE_LINE_MANUAL` is the gate-off sentence, `SIDE_LINE_AUTO` the gate-on one, and
 * `sideLine(enabled)` picks. Which one prints is not a copy decision: it is the verification
 * gate (`COMMAND_KIND_ENABLED.switch_side`), read where the line is drawn. The words are pinned
 * character for character — by code point, em dash and all — in `lib/discord/embeds.test.ts`,
 * and again from this side in `app/_tonight/SideLine.test.tsx`.
 * ------------------------------------------------------------------------- */

export { SIDE_LINE_AUTO, SIDE_LINE_MANUAL, sideLine } from '../discord/embeds';
