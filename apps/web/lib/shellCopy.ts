/**
 * Every word the shell says, in one file, spelled the way product spells them
 * (05-design.md, "Copy — final (product 2026-09-09)"). Nothing here is composed from a
 * template and nothing here is edited without product.
 *
 * The four `How this works` lines are the whole explanation of the system to somebody who
 * joined the group last week, and each claim is true of what is shipped — the table under the
 * copy section names the code behind every one of them.
 *
 * The fourth was re-written by M7.19 (product, 2026-09-16) and fixes three things at once: no
 * rating starts from a League rank any more (`provisionalSeed()`), only a Summoner's Rift result
 * moves one (M7.1 took ARAM out of the fold), and the Proven gap **settles** — it never catches
 * up, the verb M3.19 retired. `lib/board/board.test.ts`'s `promises a gap that settles` guard has
 * a twin over this line in `app/_shell/Shell.test.tsx`.
 */

/** The footer's `<details>`, closed by default. The one place on the page allowed to grow. */
export const HOW_THIS_WORKS_TITLE = 'How this works';

export const HOW_THIS_WORKS_LINES = [
  "Nobody checks in. The companion app on somebody's PC reads the League lobby and sends who is in it.",
  'The bot makes three splits and posts the fairest, with the win chance and the rating gap. An admin can step to the next one. Nothing is picked at random.',
  'Results come off the end-of-game screen. Nobody reports a score.',
  "Everybody starts on the same rating, and every Summoner's Rift result moves it. Proven is the board's careful version of it and settles after about 30 games.",
] as const;

/** The rail's and the idle page's second card. */
export const COMPANION_CARD_TITLE = 'Run the companion';

export const COMPANION_CARD_BODY =
  'Windows only. Install it once, paste in the token an admin gives you, and leave it running while you play.';

/** Footer link and companion-card link. Both point at the releases page (`lib/nav.ts`). */
export const COMPANION_LINK_LABEL = 'Get the companion';

/** Only for a signed-in viewer with a player row; points at `/p/<their puuid>`. */
export const YOUR_GAMES_LABEL = 'Your games';
