/**
 * Kustom Premium's switches, as people read them (M16.3b; brief `redesign/briefs/m16.1-premium-ai.md`
 * 1.4 and 1.5, decision rows M16.1 D1 and D6). Every string is the brief's [NEW COPY] unless marked
 * otherwise. Client-safe: no zod, no server import, so the You page's switch can read it.
 *
 * D1: friends never see the word `Premium`. Only {@link PREMIUM_SECTION_TITLE}, on the admin home,
 * names it; every other string here says `AI lines`.
 */

/* ---------------------------------------------------------------------------
 * Admin home: the group's switch (brief 1.5)
 * ------------------------------------------------------------------------- */

/** The admin-home section heading. The only friend-facing `Premium` in the product, admins only. */
export const PREMIUM_SECTION_TITLE = 'Kustom Premium';
/** The switch's label. */
export const AI_LINES_LABEL = 'AI lines';
export const AI_LINES_ON_LINE =
  "Short AI-written lines on each game, the Sunday post and player pages. Every number is checked against your group's games before it shows up.";
export const AI_LINES_OFF_LINE =
  'Off. No new lines are written, and the ones already written are hidden. Turn it back on and they come back.';
/** Only when this month's cap is reached; `day` is `1 Nov`. */
/** Design round 1 (F3): the static neutral chip leading the paused row. [NEW COPY] */
export const AI_PAUSED_CHIP = 'Paused';
export const aiPausedLine = (day: string): string =>
  `AI lines are paused until ${day}: this month's budget is used up. Everything else works as usual.`;

/* ---------------------------------------------------------------------------
 * Admin members: switching a friend off (brief 1.4)
 * ------------------------------------------------------------------------- */

export const dontWriteAboutLabel = (name: string): string => `Don't write about ${name}`;
/** The confirm's title (05-design 5.13: verb + object + question). [NEW COPY] (M16.3b) */
export const dontWriteAboutTitle = (name: string): string => `Don't write about ${name}?`;
/** The brief's confirmation, then why the switch is one-way. Second sentence [NEW COPY] (M16.3b). */
export const dontWriteAboutBody = (name: string): string =>
  `${name} won't be named in AI lines. Only they can turn this back on, from their You page.`;
/** The confirming button. [NEW COPY] (M16.3b) */
export const DONT_WRITE_ABOUT_ACTION = "Don't write about them";
/** A member already switched off, in place of the button. [NEW COPY] (M16.3b) */
export const NOT_IN_AI_LINES = 'Not in AI lines';
/** The admin route's refusal for a forged switch-back-on (never offered on the page). [NEW COPY] (M16.3b) */
export const ADMIN_CANNOT_OPT_IN = 'Only they can turn this back on, from their You page.';

/* ---------------------------------------------------------------------------
 * You: the player's own switch (brief 1.4)
 * ------------------------------------------------------------------------- */

export const AI_ABOUT_YOU_TITLE = 'AI lines about you';
export const AI_ABOUT_YOU_BODY =
  "This group has short AI-written lines about each game, a paragraph about the week, and a few lines on each player's page, all built from the numbers Kustom already has. Turn this off and none of them will name you or describe you. Your games and your rating don't change.";
export const WRITE_ABOUT_ME_LABEL = 'Write about me';
export const writeAboutMeOffDone = (groupName: string): string =>
  `Done. Kustom won't write about you in ${groupName}.`;
/** Design round 1 (F2): the page loads with the switch already off. [NEW COPY] */
export const writeAboutMeOffStanding = (groupName: string): string =>
  `Kustom won't write about you in ${groupName}.`;
export const WRITE_ABOUT_ME_ON_DONE = "Done. You'll show up in AI lines again from the next game.";

/** A switch whose save failed: it flips back and says so. [NEW COPY] (M16.3b) */
export const SWITCH_FAILED = "Couldn't change that. Try again.";
