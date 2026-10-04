import { KUSTOM_START, SETTLING_GAMES } from '@customs/core';
import { ADMIN_PRE_ROLL_POWERS, type Rich } from '../receipt/copy';
import { RELEASE_ASSET } from '../release';

/**
 * Every word on Kustom's own pages: the landing page (`/`, `/about`), `/how` and `/download`
 * (M14.24). Verbatim from redesign/STRATEGY.md §1 and §2.3 where it exists; everything else is
 * listed as [NEW COPY] in the task report for the user's review.
 *
 * No number here is formatted by hand: the starting rating is core's `KUSTOM_START`
 * (M18.6), and the settling count is core's `SETTLING_GAMES`.
 */

/** What every new player's number is, as the board prints it (1200 today). */
export const START_RATING = KUSTOM_START;

/* --------------------------------------------------------------------------------------------
 * The landing page (STRATEGY §2.3), section by section.
 * ------------------------------------------------------------------------------------------ */

export const PAGE_TITLE = 'Kustom: fair teams for your League customs';
export const PAGE_DESCRIPTION =
  'Kustom picks fair teams for your League customs and keeps score by itself. Nobody picks, nobody votes, nobody argues.';

export { backToGroup } from './backCopy';

// 1. Hero
export const HERO_TITLE = 'Fair teams. No arguments.';
/**
 * {@link HERO_TITLE} as the h1 sets it, with a soft hyphen (U+00AD) in `argu-ments` (M14.42 design
 * round 2): at 200% text on a phone the word breaks as `ARGU-MENTS.`. `hyphens: auto` alone doesn't
 * do it, because Chromium never hyphenates a capitalised or all-caps word. Invisible unless the line
 * breaks there, and screen readers skip it.
 */
export const HERO_TITLE_SET = 'Fair teams. No argu\u00ADments.';
export const HERO_SUB =
  'Kustom reads your League custom lobby, splits the ten into two even teams with real roles, and keeps ratings from actual results. Nobody picks. Nobody types.';
export const CREATE_GROUP = 'Create your group';
export const SEE_REAL_GROUP = 'See a real group';
/** Under the live hero receipt: which game it is, and when. */
export const liveReceiptCaption = (groupName: string, date: string): string =>
  `A real split from ${groupName}, ${date}.`;
export const SEE_THIS_GAME = 'See this game';
/** Under the worked-example receipt, when the demo group has no rolled game to show. */
export const EXAMPLE_RECEIPT_CAPTION = 'An example split: ten friends on an ordinary Tuesday.';
/** The hero's example game (05-design 12.9, designer draft; product may reword). */
export const EXAMPLE_GAME_CAPTION = 'An example game: ten friends on an ordinary Tuesday.';
/** Its title row, sentence case: the upper-case side word stays inside the bar (12.9). */
export const EXAMPLE_GAME_WON = 'Red won';
/** The table's visually hidden caption (12.6). */
export const EXAMPLE_GAME_TABLE_CAPTION = 'Example game, lane by lane. Red won.';
/** The table's visually hidden column headers (12.6): blue, lane, red. */
export const EXAMPLE_GAME_HEADERS = { blue: 'Blue team', lane: 'Lane', red: 'Red team' } as const;

// 2. The problem
export const PROBLEM_TITLE = 'Sound familiar?';
export const PROBLEM_LINES = [
  '"Who\'s picking teams?"',
  '"Bro, those teams are stacked."',
  '"Wait, who won game 2?"',
] as const;
export const PROBLEM_CLOSE = 'Kustom ends all three before they start.';

// 3. How it works
export const STEPS_TITLE = 'How it works';
export const STEPS = [
  { title: 'Get in a lobby.', body: 'One friend has Kustom running. Everyone joins the custom like always.' },
  {
    title: 'An admin taps Roll teams.',
    body: 'The bot tries every way to split the ten, picks the fairest, and posts it to your Discord with the odds.',
  },
  {
    title: 'Play.',
    body: 'When the game ends, Kustom reads the result from the client. Ratings move. The board updates. Nobody reports anything.',
  },
] as const;

// 4. The proof
export const PROOF_TITLE = 'Every split shows its odds.';
export const PROOF_LINES = [
  { strong: 'Nobody votes on who won.', rest: 'The result comes straight from the League client.' },
  { strong: 'Nobody picks the teams.', rest: 'Not the admins, not the host.' },
  { strong: 'Nobody can hand-edit a rating.', rest: 'It only moves when a game ends.' },
] as const;
export const ADMINS_CAN = `Admins can ${ADMIN_PRE_ROLL_POWERS} before its teams are rolled, then roll, and reroll to the bot's next pick. The owner can reset everyone's ratings at once, never one person's. That's it.`;
/**
 * The demo group's calibration line, as one sentence led by its name (STRATEGY §2.3.4):
 * `In Customs Night, the side the bot favored won 27 of 48 games (56%). It expected about 55%.`
 * Takes the receipt's own `calibrationLineParts` so the numbers stay core's; only the first
 * letter of its opening word is lowered to follow the comma.
 */
export function inGroupCalibrationParts(groupName: string, line: Rich): Rich {
  const [first, ...rest] = line;
  const opening = typeof first === 'string' ? `${first.charAt(0).toLowerCase()}${first.slice(1)}` : first;
  return [`In ${groupName}, `, ...(opening === undefined ? [] : [opening]), ...rest];
}

// 5. Try it
export const TRY_TITLE = 'Look around a real group.';
export const tryGamesParts = (groupName: string, games: string): Rich => [
  `${groupName} has played `,
  { num: games },
  ' games with Kustom.',
];
/** Right after `X has played N games with Kustom.`, which names the group for `Their`. */
export const TRY_BODY_AFTER_COUNT = 'Their tonight page, board and every game are public. No sign-in needed.';
/** When that games line is hidden (the counters show), the sentence names the group itself. */
export const tryBodyNamed = (groupName: string): string =>
  `${groupName}'s tonight page, board and every game are public. No sign-in needed.`;
export const openGroup = (groupName: string): string => `Open ${groupName}`;
export const COUNTERS_LABEL = 'Kustom so far';
export const COUNTER_GAMES = 'games refereed';
export const COUNTER_PLAYERS = 'players rated';
export const COUNTER_TYPED = 'results typed in';

// 6. The companion
export const COMPANION_TITLE = 'The one download, and what it does.';
export const COMPANION_INTRO =
  'Kustom has a small Windows app. Only one friend per lobby needs it running. Everyone else just plays.';
export const COMPANION_FACTS = [
  {
    term: 'What it reads',
    body: "Who's in your custom lobby, the end-of-game stats screen, and your past customs from the client's match history, so your group's history fills in by itself.",
  },
  {
    term: 'What it can do',
    body: 'When you tap a button on the site: open the custom, send the invites, and move players to their side.',
  },
  {
    term: 'What it never touches',
    body: "Champ select, anything in game, your account or password. It doesn't play for you and it doesn't ban for you.",
  },
] as const;
export const COMPANION_WINDOWS =
  "Windows only, for now. Friends on Mac can still play in the lobby; they just can't be the one hosting.";
export const GET_FOR_WINDOWS = 'Get Kustom for Windows';

// 7. Final CTA
export const FINAL_TITLE = 'Start your group in two minutes.';
export const FINAL_CHECKLIST = [
  'Name it.',
  'Connect your Discord channel.',
  // M14.67 (flow audit): a group can't play a night without one host running Kustom.
  'Install Kustom on one Windows PC.',
  'Send your friends one link.',
] as const;
export const FREE_SIGNED_OUT = 'Free. Sign in with Discord to start.';
export const FREE_SIGNED_IN = "Free. You're already signed in.";

// 8. FAQ
export const FAQ_TITLE = 'Questions';
export const FAQ = [
  {
    q: 'Is this allowed by Riot?',
    a: 'Kustom only reads the League client and opens custom lobbies, the way you would by hand. It never touches champ select or the game itself.',
  },
  { q: 'Do we all need to install something?', a: 'No. One person in the lobby runs it.' },
  {
    q: "What if someone's new?",
    a: `Everyone starts at ${START_RATING}. Their first ${SETTLING_GAMES} games count extra, so they find their level fast.`,
  },
  {
    q: 'Can an admin rig it?',
    a: "No. Admins can't pick teams or edit ratings. They tap Roll teams; the bot does the rest, and shows its work.",
  },
  { q: 'Does it cost anything?', a: 'No. Kustom is free.' },
] as const;

/* --------------------------------------------------------------------------------------------
 * `/how`: how the bot decides.
 * ------------------------------------------------------------------------------------------ */

export const HOW_TITLE = 'How the bot decides';
export const HOW_LEAD =
  'Everything the bot does on a game night, in plain words. No admin, host or player can override any of it.';

export const HOW_RATING_TITLE = 'Your rating';
export const HOW_RATING_LINES = [
  `Everyone starts at ${START_RATING}. Win and your Rating goes up, lose and it goes down: a win never lowers it and a loss never raises it.`,
  "How much depends on the odds, and they are the same win chance the bot shows on the teams, from each team's total Rating. Beating the favourite pays more than beating a team you were expected to beat, and losing as the favourite costs more.",
  `Once you have played ${SETTLING_GAMES} games, an even game moves you about 8 points, and one game never moves you more than 20.`,
  `Your first ${SETTLING_GAMES} games count extra, up to twice as much, so a new player finds their level quickly. Until then the board shows them as still settling instead of giving them a rank.`,
  'Everyone on a team gets the same amount from a game. Then the five are lined up by how they played, read for their role: on the winning team the best game counts ×1.2, down to ×0.8 for the fifth; on the losing team it flips, so the best game gives back least. The best on each side is the MVP and the ACE.',
  `Points come from the other team. Once everyone in a game has played ${SETTLING_GAMES} games, what one side wins the other side loses, so ${START_RATING} stays the average.`,
  'Only your own games move your Rating. Nothing fades: take a month off and it is right where you left it.',
  `The week has its own board. Every Sunday at 06:00 Cairo time everyone starts the week at zero points, and only that week's games count. Teams are always made from the all-time Rating.`,
  "Only Summoner's Rift games count. ARAM is tracked but never moves a rating. Nobody can edit a Rating by hand, and tapping any change on the site shows the sum behind it.",
] as const;

export const HOW_SPLIT_TITLE = 'Picking the teams';
export const HOW_SPLIT_LINES = [
  'When an admin taps Roll teams, the bot tries all 126 ways to split ten people into two teams of five.',
  "For each one it puts everyone in their best lane and scores it: the rating gap between the teams, plus a cost for every player off their main role (bigger if they were filled last game), plus a nudge against repeating last game's teams. Lowest score wins.",
  'It keeps its top three. The first is posted. A reroll moves to the second, then the third. There is no fourth, and nothing is random.',
] as const;

export const HOW_RECEIPT_TITLE = 'Reading a split';
export const HOW_RECEIPT_LEAD =
  'Every split comes with a receipt like this one. Here is what each part means.';
export const HOW_RECEIPT_PARTS = [
  {
    term: 'Win chance',
    body: "The headline number: how likely each side is to win, from each team's total Rating. It is the same win chance the rating uses when the game ends.",
  },
  {
    term: 'Rating gap',
    body: 'How far apart the two teams are, in rating points. This is what the bot balances on, counting anyone off their main role as a bit weaker there.',
  },
  { term: 'Main roles', body: 'How many of the ten are on the role they main.' },
  {
    term: "Bot's pick",
    body: 'Which of the three splits is in play. A reroll shows here, so it is never hidden.',
  },
  {
    term: 'How the bot decided',
    body: "Open it to see all three splits side by side, why the lower ones ranked lower, and the bot's own note.",
  },
] as const;

export const HOW_CALIBRATION_TITLE = 'Are the odds honest?';
export const HOW_CALIBRATION_LEAD =
  "Odds are only worth something if they come true about as often as they say. So every group checks the bot against itself, under every split's How the bot decided: of the games where one side was favored, how often did that side win, and how often did the bot expect it to?";
export const HOW_CALIBRATION_EXPLAIN =
  "If the bot says 55% every game, the favorite should win about 55% of them, not all of them. Games where the teams changed in the lobby after the roll are left out, because those were not the bot's teams.";

export const HOW_CANT_TITLE = "What admins can't do";
export const HOW_CANT_LINES = [
  'Pick the teams, or move anyone between them.',
  "Set, add to or edit anyone's rating.",
  'Change who won. The result comes from the end-of-game screen.',
] as const;
export const HOW_CAN_LINE = `What they can do: ${ADMIN_PRE_ROLL_POWERS}, before its teams are rolled; tap Roll teams; and Reroll to the bot's next pick. The group's owner can also reset everyone's ratings at once, for a fresh start, but never one person's.`;

/** The in-page index under `/how`'s intro: each section's own heading, by its id. */
export const HOW_INDEX_LABEL = 'On this page';
export const HOW_INDEX = [
  { id: 'rating', label: HOW_RATING_TITLE },
  { id: 'splits', label: HOW_SPLIT_TITLE },
  { id: 'receipt', label: HOW_RECEIPT_TITLE },
  { id: 'calibration', label: HOW_CALIBRATION_TITLE },
  { id: 'admins', label: HOW_CANT_TITLE },
] as const;

/* --------------------------------------------------------------------------------------------
 * `/download`: Get Kustom.
 * ------------------------------------------------------------------------------------------ */

export const DOWNLOAD_TITLE = 'Get Kustom';
/** M17.12 (Kustom 1.0): one app, an admin's PC; the README's friend section says the same. [NEW COPY] */
export const DOWNLOAD_LEAD =
  "One small Windows app that sits next to the League client. Only one PC per lobby needs it, and it has to be an admin's. Everyone else just plays and installs nothing.";
export const DOWNLOAD_BUTTON = 'Download Kustom';
/** The file named here is `RELEASE_ASSET` (`lib/release.ts`, M17.12), the same switch as the direct link. */
export const DOWNLOAD_BUTTON_NOTE = `Opens the download page on GitHub. Grab ${RELEASE_ASSET} there, on the Windows PC that will run it.`;
/** M14.42 (walk gap 8): the exe isn't code-signed, so SmartScreen warns on first run. */
export const DOWNLOAD_SMARTSCREEN: Rich = [
  "Windows may warn you because Kustom isn't signed yet. Click ",
  { strong: 'More info' },
  ', then ',
  { strong: 'Run anyway' },
  '.',
];
/**
 * M17.12 (Kustom 1.0): how setup goes, in the companion README's words (install, link with a code, it
 * updates itself). The link step is for admins only (hosting is admin-only), so it never points at an
 * invite link (product, 2026-10-04). [NEW COPY]
 */
export const DOWNLOAD_SETUP_TITLE = 'Set it up once';
export const DOWNLOAD_SETUP = [
  {
    term: 'Install it',
    body: `Run ${RELEASE_ASSET}. It installs just for you, so it never asks for an administrator password, and it starts with Windows.`,
  },
  {
    term: 'Link it with a code',
    body: "Kustom asks for a code the first time. On the site, open your group's admin home and tap Get a code under Set up your PC as host. Open League signed in to your own account, type the code into Kustom and press Link. When Kustom shows your group's name, that's all the setup there is.",
  },
  {
    term: 'It updates itself',
    body: "New versions download in the background and install at a quiet moment. Never in a lobby, in champ select or in a game, so an update can't cost you a game.",
  },
] as const;
export const DOWNLOAD_REQUIREMENTS_TITLE = 'Before you install';
export const DOWNLOAD_REQUIREMENTS = [
  'A Windows PC, the one that plays League. There is no Mac version yet; friends on Mac can still play in the lobby.',
  'The League client open and signed in. Kustom only talks to the client on your own PC.',
] as const;
