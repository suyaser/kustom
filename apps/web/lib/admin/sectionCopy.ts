/**
 * The Discord, Hosts, Games and `/ops` pages' sentences (M14.23). Product's where STRATEGY 3.2 / 6(d)
 * quote them; the rest is `[NEW COPY]` in the task report. No developer words (`revoked_at`, `pnpm`,
 * snowflakes, "row", "companion token"): the audit's list (M14.23 acceptance 7). Tests assert these
 * constants, never literals.
 */

import { ruleLabel } from '../mode/ruleNotices';
import type { RatedReason } from './games';

/* ---------------------------------------------------------------------------
 * Discord (STRATEGY 3.2 step 2; M14.20)
 * ------------------------------------------------------------------------- */

export const CONNECT_DISCORD = 'Connect Discord';
export const CONNECT_LINE =
  'Pick the server and channel for teams and results. You need permission to manage webhooks there.';
export const PASTE_SUMMARY = 'Or paste a webhook link instead';
export const WEBHOOK_LABEL = 'Webhook link';
export const WEBHOOK_HOWTO =
  'In Discord: Server Settings → Integrations → Webhooks → New Webhook. Pick the channel for teams and results. Copy Webhook URL and paste it here.';
export const WEBHOOK_PLACEHOLDER = 'https://discord.com/api/webhooks/…';
export const SAVE_AND_TEST = 'Save and send a test post';
/** While the paste is saving. [NEW COPY] */
export const SAVING_AND_TESTING = 'Saving…';
/** A pasted link the route refuses (400). [NEW COPY] */
export const WEBHOOK_INVALID =
  "That isn't a Discord webhook link. It starts with https://discord.com/api/webhooks/.";
/** Not connected: the why (STRATEGY 3.2). */
export const DISCORD_NOT_CONNECTED = 'Without this, teams and results only show on the site.';
/** The state words. [NEW COPY] */
export const DISCORD_STATE_NOT_CONNECTED = 'Not connected';
export const DISCORD_STATE_CONNECTED = 'Connected';
/** The last test post failed (designer round 1). [NEW COPY] */
export const DISCORD_STATE_TEST_FAILED = 'Test post failed';
export const discordTestedLine = (ago: string): string => `Done · test post sent ${ago}`;
/** A webhook stored before test posts were recorded. [NEW COPY] */
export const DISCORD_UNTESTED = 'Send a test post to check it lands where you expect.';
/** The last test failed: Discord's reason follows. [NEW COPY] */
export const discordTestFailed = (reason: string): string =>
  `The test post didn't go through. Discord said: ${reason}`;
/** Back from Discord with a webhook (`?discord=connected`). [NEW COPY] */
export const DISCORD_JUST_CONNECTED = 'Test post sent. Check the channel.';
export const SEND_TEST = 'Send a test post';
export const SENDING_TEST = 'Sending…';
export const TEST_SENT = 'Test post sent';
/** Connecting again replaces the webhook (one channel per group). [NEW COPY] */
export const CONNECT_AGAIN = 'Connect a different channel';

/* ---------------------------------------------------------------------------
 * Hosts (replaces /admin/tokens; STRATEGY 6(d))
 * ------------------------------------------------------------------------- */

/**
 * The Hosts intro (M17.12, Kustom 1.0: no hand-made keys, every host links itself with a code). The
 * whole sentence, and its two halves around the link to the admin home's host card. [NEW COPY]
 */
export const HOSTS_INTRO_LEAD =
  'A host is a PC that runs Kustom in the lobby. Each admin sets up their own from the';
export const HOSTS_INTRO_LINK = 'admin home';
export const HOSTS_INTRO_TAIL = 'with a code. To host on a friend’s PC, make them an admin first.';
export const HOSTS_INTRO = `${HOSTS_INTRO_LEAD} ${HOSTS_INTRO_LINK} ${HOSTS_INTRO_TAIL}`;
export const HOSTS_LIST_TITLE = 'Hosts';
export const HOSTS_EMPTY = 'No hosts yet. Set one up from the admin home.';
export const COLUMN_HOST = 'Host';
export const COLUMN_PERSON = 'Account';
export const COLUMN_ADDED = 'Added';
export const COLUMN_LAST_SEEN = 'Last seen';
export const COLUMN_STATUS = 'Status';
/** M14.71: a host that has not connected yet reads as waiting, not as broken. [NEW COPY] */
export const NEVER_SEEN = 'Not seen yet';
export const HOST_ACTIVE = 'Working';
export const HOST_STOPPED = 'Stopped';
export const UNNAMED_HOST = 'Unnamed PC';
/** A host named after its League account (M14.50). [NEW COPY] */
export const pcOf = (account: string): string => `${account}’s PC`;
/** The fold that holds stopped hosts (M14.50). [NEW COPY] */
export const stoppedHosts = (count: number): string => `Stopped (${count})`;
export const REVOKE = 'Stop this host';
export const revokeTitle = (host: string): string => `Stop ${host}?`;
/** M17.12: the PC gets going again by linking with a code, never a new key. [NEW COPY] */
export const REVOKE_BODY =
  'Kustom on that PC stops recording games until someone sets it up again with a code.';

/* ---------------------------------------------------------------------------
 * Games (M5.5's report, scoped and restyled)
 * ------------------------------------------------------------------------- */

export const COLUMN_NIGHT = 'Night';
export const COLUMN_STARTED = 'Started';
export const COLUMN_REPORTED_BY = 'Seen by';
export const COLUMN_PLAYERS = 'Players';
export const COLUMN_WHAT = 'What happened';
export const COLUMN_LENGTH = 'Length';
export const COLUMN_PICKED_UP = 'How it came in';
export const COLUMN_RATED = 'Rated';
export const MISSED_NO_GAME = 'No result';
export const MISSED_STUCK = 'Result in, lobby stuck';
export const SOURCE_LIVE = 'At the end of the game';
export const SOURCE_LATER = 'Picked up later';
export const RATED_YES = 'Yes';
/* The Rated column says why a game isn't rated, never `Not yet` (M14.53). [NEW COPY] */
export const RATED_NO_ARAM = 'No · ARAM';
export const RATED_NO_OTHER_MAP = 'No · not Summoner’s Rift';
export const ratedNoRule = (ruleName: string): string => `No · ${ruleName}`;
export const RATED_NO_SWITCHED_OFF = 'No · Rated was off';
export const RATED_NO_GATE = 'No · too short or not ten players';
/** M15.13: a game from before the owner's latest Reset ratings. [NEW COPY] */
export const RATED_NO_BEFORE_RESET = 'No · before the ratings reset';
/** M15.17: region wars picked, too few open champions to draw two regions at Roll. [NEW COPY] */
export const RATED_NO_REGION_NO_DRAW = "No · Region wars couldn't be drawn";
export const RATED_WAITING = 'Waiting to be counted';

/** The Rated cell for one captured game. */
export function ratedLabel(reason: RatedReason): string {
  switch (reason.kind) {
    case 'rated':
      return RATED_YES;
    case 'aram':
      return RATED_NO_ARAM;
    case 'not-rift':
      return RATED_NO_OTHER_MAP;
    case 'rule':
      return ratedNoRule(ruleLabel(reason.rule));
    case 'switched-off':
      return RATED_NO_SWITCHED_OFF;
    case 'gate':
      return RATED_NO_GATE;
    case 'no-draw':
      return RATED_NO_REGION_NO_DRAW;
    case 'before-reset':
      return RATED_NO_BEFORE_RESET;
    case 'waiting':
      return RATED_WAITING;
  }
}
export const NOBODY = 'Nobody';
export const showingNewest = (shown: number, total: number): string =>
  `Showing the newest ${shown} of ${total}.`;
/** The real count under the Captured cap (designer round 1). [NEW COPY] */
export const capturedCount = (n: number, cap: number): string =>
  n >= cap ? `Showing the newest ${cap}.` : n === 1 ? 'Showing 1 game.' : `Showing ${n} games.`;

/* ---------------------------------------------------------------------------
 * /ops (M13.14, M14.19)
 * ------------------------------------------------------------------------- */

export const OPS_TITLE = 'All groups';
export const OPS_LINE =
  'Every group on this Kustom. You can read each one’s admin pages; you can’t change them.';
export const OPS_EMPTY = 'No groups yet.';
export const COLUMN_GROUP = 'Group';
export const COLUMN_CREATED = 'Started';
export const COLUMN_MEMBERS = 'People';
export const COLUMN_ADMINS = 'Admins';
export const COLUMN_LAST_GAME = 'Last game';
export const COLUMN_DISCORD = 'Discord';
export const NO_GAMES_YET = 'None yet';
export const OPEN_ADMIN = 'Open admin';
export const COLUMN_OPS_ACTIONS = 'Actions';
/** M16.2: Kustom Premium, read-only. Only `/ops` shows these; friends never see the word. */
export const COLUMN_PREMIUM = 'Premium';
export const PREMIUM_OFF = 'Off';
export const PREMIUM_ON = 'On';
export const premiumSince = (date: string): string => `since ${date}`;
export const premiumCap = (dollars: string): string => `$${dollars} a month cap`;
/** M16.10 (M16.1 §3): a Premium group whose month's AI budget is used up [NEW COPY]. */
export const PREMIUM_CAP_REACHED = 'Paused · cap reached';
