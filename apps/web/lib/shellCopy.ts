/**
 * Every word the shell says, in one file, spelled the way product spells them
 * (05-design.md, "Copy — final (product 2026-09-09)"). Nothing here is composed from a
 * template and nothing here is edited without product.
 *
 * The 1.0 footer's four `How this works` lines left with that footer (M14.25): `/how` explains
 * the system now.
 */

/* -------------------------------------------------------------------------------------------
 * The 2.0 shell (M14.7). Words verbatim from redesign/STRATEGY.md 2.4 and 2.5 or docs/05-design.md
 * 5.8 and 5.9 where they exist; the rest is listed as [NEW COPY] in the task report for product.
 * ----------------------------------------------------------------------------------------- */

/** First in the DOM, visible on focus (05-design.md 6.2). */
export const SKIP_LINK_LABEL = 'Skip to content';

/** The accessible name of both renderings of the four sections (05-design.md 5.11). */
export const MAIN_NAV_LABEL = 'Main';

/** STRATEGY 2.4. Footer link to `/download` (M14.24). */
export const GET_KUSTOM_LABEL = 'Get Kustom';
/** STRATEGY 2.2. Footer link to `/about`, on group pages only (M14.24). */
export const WHATS_KUSTOM_LABEL = "What's Kustom?";
export const YOUR_PAGE_LABEL = 'Your page';
export const SIGN_IN_LABEL = 'Sign in';
export const SIGN_OUT_LABEL = 'Sign out';

/** 404 (05-design.md 5.8). The h1 is the same everywhere; the reason names what was missing. */
export const NOT_FOUND_TITLE = 'Page not found';
export const NOT_FOUND_GROUP_REASON = 'No group at this link. Check it with whoever sent it.';
export const NOT_FOUND_SITE_REASON = "There's nothing at this link.";
export const notFoundInGroupReason = (groupName: string): string =>
  `There's nothing at this link in ${groupName}.`;
export const notFoundGameReason = (groupName: string): string =>
  `There's no game at this link in ${groupName}.`;
export const notFoundPlayerReason = (groupName: string): string =>
  `There's no player at this link in ${groupName}.`;
export const BACK_TO_TONIGHT_LABEL = 'Back to tonight';
export const BACK_TO_KUSTOM_LABEL = 'Back to Kustom';

/** error.tsx (05-design.md 5.8). */
export const ERROR_TITLE = "Couldn't load this page.";
export const TRY_AGAIN_LABEL = 'Try again';
export const errorReference = (digest: string): string => `ref ${digest}`;

/** Route h1s. (M14.39 removed the tonight and board `loading.tsx` files: a streamed first paint never swaps in without JavaScript.) */
export const TONIGHT_TITLE = 'Tonight';
export const GAME_TITLE = 'Game';

/* -------------------------------------------------------------------------------------------
 * M14.7b: the You page and the footer (redesign/nav/proposal.md option A).
 * ----------------------------------------------------------------------------------------- */

/** The footer's link to `/how` (M14.24 replaced M14.7b's disclosure with the page). */
export const HOW_THE_BOT_DECIDES_LABEL = 'How the bot decides';

/**
 * Riot's developer-policy notice (M14.8; developer.riotgames.com/policies/general, last updated
 * 29 May 2025), verbatim with `Kustom` as the product. On every page's footer, as real text.
 */
export const RIOT_NOTICE =
  "Kustom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

/** The You page's line above the h1 (the prototype's eyebrow, in sentence case per 05-design 1.3). */
export const youInGroup = (groupName: string): string => `You in ${groupName}`;

/** The admin entry, first on You for admins. */
export const ADMIN_CARD_TITLE = 'Admin';
/** STRATEGY §6(b3) (copy review row 3): the owner runs the group, an admin helps. */
export const adminCardLine = (groupName: string, owner: boolean): string =>
  owner ? `You run ${groupName}.` : `You help run ${groupName}.`;
export const ADMIN_CARD_ACTION = 'Open admin';

/** The self lens's tonight tile (M14.15; the Rating and games tiles' words are lib/board/copy.ts'). */
export const TONIGHT_TILE_LABEL = 'tonight';
/** The way from You to the public view of the same page (STRATEGY §6(b3)). */
export const SEE_YOUR_PUBLIC_PAGE_LABEL = 'See your public page';

/** Signed in, but no player row in this group yet (STRATEGY §2.4, copy review row 17). */
export const UNLINKED_TITLE = 'Which League account is yours?';
/**
 * How an unlinked friend claims their account (M14.73, flow audit): the group's lobby, the Tonight
 * tab and the button by its own label. The same sentence on You and on the join page's `I don't`.
 */
export const CLAIM_PROMPT = "Next time you're in the group's lobby, open Tonight and tap That's me.";
export const unlinkedLine = (_groupName: string): string =>
  `Once we know, you'll see every game you've played with this group. ${CLAIM_PROMPT}`;

/** Signed out: the sign-in pitch (the proposal's copy; the game count is generic, nobody is known). */
export const PITCH_TITLE = 'See it from where you stand.';
export const pitchSub = (groupName: string): string =>
  `Sign in and this page becomes yours: every game you've played with ${groupName}, your Rating, and your record with and against each friend.`;
export const PITCH_FOOT =
  'Nothing here is hidden. Every game and every number is already public; signing in just puts you at the centre of it.';
export const SIGN_IN_WITH_DISCORD_LABEL = 'Sign in with Discord';

/** The account cards. */
export const ACCOUNT_CARD_TITLE = 'Account';
export const THIS_DEVICE_CARD_TITLE = 'This device';
/** Design round 1 (N7): the You account row, muted. [NEW COPY] */
export const signedInAs = (name: string): string => `Signed in as ${name}`;
