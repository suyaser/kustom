/**
 * The group admin home's sentences (M14.21 builds the page the creator lands on; M14.22 fills it out).
 * Product's from STRATEGY 3.1 / 3.2 where quoted there; the rest is `[NEW COPY]` in the task report.
 * Tests assert these constants, never literals.
 */

export const ADMIN_TITLE = 'Admin';
/** The way back to the group's own pages (M13.14's added note, the user's request). [NEW COPY] */
export const backToGroupLabel = (groupName: string): string => `Back to ${groupName}`;

/* ---------------------------------------------------------------------------
 * Access
 * ------------------------------------------------------------------------- */

/** Signed out. [NEW COPY] */
export const adminSignInLine = (groupName: string): string =>
  `Sign in with the Discord account that runs ${groupName}.`;
/** Signed in, not an admin of this group. [NEW COPY] */
export const NOT_ADMIN_TITLE = 'This page is for admins';
export const notAdminReason = (groupName: string): string => `Only ${groupName}'s admins can open it.`;
/** The creator before they pair: not a member yet, so not the owner yet (M13.5). [NEW COPY] */
export const CREATOR_UNLINKED_LINE =
  "You started this group, so you're its owner. Set up Kustom below to link your League account.";

/* ---------------------------------------------------------------------------
 * Get your group ready (STRATEGY 3.1, 3.2)
 * ------------------------------------------------------------------------- */

export const CHECKLIST_TITLE = 'Get your group ready';
export const CHECKLIST_READY = 'Your group is ready for game night.';
export const STATE_DONE = 'Done';
export const STATE_TO_DO = 'To do';
/** The Kustom row while a host token exists that has never connected. Its own state word, no spinner. */
export const STATE_WAITING = 'Waiting for Kustom to connect…';

export const ROW_CREATED_TITLE = 'Create the group';
export const rowCreatedDetail = (link: string): string => `Group created. Your link: ${link}`;

export const ROW_DISCORD_TITLE = 'Connect Discord';
export const rowDiscordTestedDetail = (ago: string): string => `test post sent ${ago}`;
export const ROW_DISCORD_WHY = 'Without this, teams and results only show on the site.';

export const ROW_INVITE_TITLE = 'Invite players';
export const rowInviteDoneDetail = (members: number): string => `${members} people in the group`;
export const ROW_INVITE_TODO_DETAIL = 'Just you so far';
export const ROW_INVITE_WHY =
  'Friends also join by playing: anyone in a lobby with your Kustom joins the group automatically.';

export const ROW_KUSTOM_TITLE = 'Install Kustom on one PC';
export const rowKustomSeenDetail = (label: string | null, ago: string): string =>
  label === null ? `Kustom seen ${ago}` : `Kustom seen on ${label}, ${ago}`;
export const ROW_KUSTOM_WHY = 'Kustom has to be running in the lobby for teams and results to work.';

export const ROW_FIRST_GAME_TITLE = 'Play your first game';
/** The first-game row's line while no game is recorded. [NEW COPY] */
export const ROW_FIRST_GAME_WHY =
  'Make a custom lobby with Kustom running and play. It shows up here when it ends.';

/** Row links. */
export const CONNECT_DISCORD_LABEL = 'Connect Discord';
export const SET_UP_HOST_LABEL = 'Set up your PC as host';
/** Row 3's link to the invite card (designer round 1). [NEW COPY] */
export const GET_INVITE_LABEL = 'Get the invite link';

/* ---------------------------------------------------------------------------
 * Set up your PC as host (STRATEGY 3.2 step 4, M14.12)
 * ------------------------------------------------------------------------- */

export const HOST_CARD_TITLE = 'Set up your PC as host';
/** The three steps. [NEW COPY] for the wording; the steps are STRATEGY's. */
export const HOST_STEP_DOWNLOAD = 'Download Kustom on the PC that runs your lobbies.';
export const HOST_STEP_DOWNLOAD_LINK = 'Download Kustom';
/** M17.12 (ruled 2026-10-04): no "pick Host", the Rust Kustom has one mode. */
export const HOST_STEP_OPEN = 'Open Kustom with League running.';
/** M14.42 (walk gap 12, design round 2): the host's code step names no member-flow slot. [NEW COPY] */
export const HOST_STEP_CODE = 'Get a code, then type it in Kustom.';
/** M14.55: the host card folded into a disclosure once a host is seen. [NEW COPY] */
export const HOST_ANOTHER_PC_LABEL = 'Set up another PC';

/* ---------------------------------------------------------------------------
 * Admin sections (M14.22)
 * ------------------------------------------------------------------------- */

/** The admin area's own nav, as links. [NEW COPY] for the labels not already the pages' names. */
export const ADMIN_NAV_LABEL = 'Admin pages';
export const ADMIN_HOME_LABEL = 'Home';
export const MEMBERS_TITLE = 'Members';
export const DISCORD_TITLE = 'Discord';
export const HOSTS_TITLE = 'Hosts';
/** The admin page about recording; not `Games`, which is the main tab (M14.53). [NEW COPY] */
export const GAMES_TITLE = 'Recording';

/* ---------------------------------------------------------------------------
 * Invite card (STRATEGY 3.2 step 3, M13.7, M13.14)
 * ------------------------------------------------------------------------- */

export const INVITE_TITLE = 'Invite your group';
/**
 * Under the title. M17.12: the Hosts and home views never say "paste" (the hand-key era's word), so
 * the link is dropped in the chat. [NEW COPY]
 */
export const INVITE_LINE = 'Drop this in your group chat. Anyone with it can join.';
export const NEW_LINK_LABEL = 'New link';
/** The confirm (STRATEGY 3.3): title [NEW COPY], consequence and button are product's. */
export const NEW_LINK_CONFIRM_TITLE = 'Make a new link?';
export const NEW_LINK_CONFIRM_BODY = 'The old link will stop working.';
export const NEW_LINK_CONFIRM_ACTION = 'Make a new link';
export const NEW_LINK_PENDING = 'Making a new link…';
/** A group with no live invite (should not happen: `create_group` makes one). [NEW COPY] */
export const NO_INVITE_LINE = 'No invite link yet.';
/** A write that failed without a sentence of its own. [NEW COPY] */
export const ACTION_FAILED = "That didn't work. Try again.";

/* ---------------------------------------------------------------------------
 * Members (STRATEGY 3.5)
 * ------------------------------------------------------------------------- */

export const membersCount = (n: number): string => (n === 1 ? '1 person' : `${n} people`);
export const SEE_MEMBERS_LABEL = 'See everyone';
export const COLUMN_NAME = 'Name';
export const COLUMN_ROLE = 'Role';
export const COLUMN_LAST_PLAYED = 'Last played';
export const COLUMN_GAMES = 'Games';
export const COLUMN_ACTIONS = 'Actions';
export const ROLE_WORDS = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;
/** Last played, for someone with no game in this group yet. [NEW COPY] */
export const NEVER_PLAYED = 'Not yet';
/**
 * The owner's own row in place of buttons, so the missing Remove reads as a rule, not a bug, and
 * names the way out (M14.74, flow audit).
 */
export const OWNER_ROW_NOTE = "You're the owner. To step back, make an admin the owner.";

/** A member with no name yet (`Someone` in the list), inside a confirm's sentence and the Don't write about label. [NEW COPY] */
export const THIS_PLAYER = 'this player';
/** Design round 1 (F4): the search's own clear button. [NEW COPY] */
export const CLEAR_LABEL = 'Clear';
/** Design round 1 (N2): the `you` chip on your own row. */
export const YOU_CHIP = 'You';
/** M14.52: the list's filter, as you type, no server call. [NEW COPY] */
export const FIND_SOMEONE_LABEL = 'Find someone';
/** M14.52: the filter matched nobody. [NEW COPY] */
export const noMemberMatch = (query: string): string => `Nobody called “${query}” in this group.`;
/** M14.52: one row's actions fold behind this (visible word; the name follows for screen readers). [NEW COPY] */
export const MANAGE_LABEL = 'Manage';
/** M14.52: a phone row's games, in words (the desktop column says `Games`). [NEW COPY] */
export const gamesCount = (n: number): string => (n === 1 ? '1 game' : `${n} games`);
/** M14.52: a phone row's last played, before the date. [NEW COPY] */
export const LAST_PLAYED_PREFIX = 'last played';

export const MAKE_ADMIN_LABEL = 'Make admin';
export const MAKE_MEMBER_LABEL = 'Make member';
export const MAKE_OWNER_LABEL = 'Make owner';
export const REMOVE_LABEL = 'Remove from group';
export const CANCEL_LABEL = 'Cancel';
export const WORKING_LABEL = 'Saving…';

/** Confirm titles and bodies. Make owner's body and Remove's are STRATEGY 3.5's; the rest [NEW COPY]. */
export const confirmMakeAdminTitle = (name: string): string => `Make ${name} an admin?`;
export const CONFIRM_MAKE_ADMIN_BODY =
  'They can roll teams, set the mode or a rule, and open these admin pages.';
export const confirmMakeMemberTitle = (name: string): string => `Make ${name} a member?`;
export const CONFIRM_MAKE_MEMBER_BODY = 'They stop being an admin. Their games and rating stay.';
export const confirmMakeOwnerTitle = (name: string): string => `Make ${name} the owner?`;
export const confirmMakeOwnerBody = (name: string): string =>
  `${name} becomes the owner. You'll stay an admin.`;
export const confirmRemoveTitle = (name: string): string => `Remove ${name} from the group?`;
export const confirmRemoveBody = (name: string): string =>
  `${name} leaves the board. Their games stay in history. If they play with you again, they're back.`;

/**
 * M14.60 `Unlink Discord`, in a member's Manage panel when a Discord account is linked to them. The
 * link belongs to the player, so every confirm says it reaches every group they're in. The relink
 * path differs by role (design round 2): a member taps their name (`/api/me/link`, tonight's lobby
 * or a game in the last 12 hours); an admin or owner is never offered that tap (`claimable.ts`,
 * M14.26) and pairs Kustom again with a new code from the group's invite link (`/join/<code>`,
 * `lib/groups/pairing.ts`), which keeps their admin role. [NEW COPY]
 */
export const UNLINK_DISCORD_LABEL = 'Unlink Discord';
export const UNLINK_DISCORD_ACTION = 'Unlink Discord';
export const UNLINK_DISCORD_PENDING = 'Unlinking…';
export const confirmUnlinkDiscordTitle = (name: string): string => `Unlink ${name}'s Discord?`;
/** A member: they link again with `That's me`. */
export const CONFIRM_UNLINK_DISCORD_BODY =
  "They link again by signing in and tapping their name at their next game. Their games and Rating stay. This unlinks them in every group they're in, not just this one.";
/** Another admin (only the owner sees this): no tap for admins, they pair from the invite link. */
export const CONFIRM_UNLINK_ADMIN_DISCORD_BODY =
  "They'll need the group's invite link to pair Kustom again with a new code. Tapping their name won't work for an admin. Their games and Rating stay. This unlinks them in every group they're in, not just this one.";
/** M14.60: the route's 403 for an admin naming the owner; shown in the confirm as written. [NEW COPY] */
export const ONLY_OWNER_UNLINKS_OWNER = "Only the owner can unlink the owner's Discord.";
/** M14.60 round 2 (lead's ruling): the owner may not unlink themselves. 403. [NEW COPY] */
export const OWNER_UNLINKS_SELF = 'Hand ownership to an admin before you unlink your own Discord.';
/**
 * M14.60: an admin unlinking themselves loses these pages, the invite link with them, so the body
 * says to copy it first: without it they need another admin or the owner to send it. [NEW COPY]
 */
export const CONFIRM_UNLINK_OWN_DISCORD_TITLE = 'Unlink your Discord?';
export const CONFIRM_UNLINK_OWN_DISCORD_BODY =
  "You'll lose these admin pages until you pair Kustom again with a new code from the group's invite link, so copy it first. Tapping your name won't work for an admin. Your games and Rating stay. This unlinks you in every group you're in, not just this one.";

/* ---------------------------------------------------------------------------
 * Reset ratings (STRATEGY 3.6, M14.18): owner only, the one typed confirm in the product
 * ------------------------------------------------------------------------- */

/** The section title and the button. STRATEGY 3.6's `Reset ratings`. */
export const RESET_RATINGS_LABEL = 'Reset ratings';
/** STRATEGY 3.6's consequence, under the title and in the dialog. */
export const RESET_RATINGS_BODY =
  "Everyone's rating goes back to 1200. Games stay in history. This can't be undone.";
/** The dialog title. [NEW COPY] */
export const RESET_RATINGS_CONFIRM_TITLE = "Reset everyone's ratings?";
/** The typed-link field's label. [NEW COPY] */
export const resetRatingsFieldLabel = (slug: string): string => `Type ${slug} to confirm`;
/** While the reset runs. [NEW COPY] */
export const RESET_RATINGS_PENDING = 'Resetting…';
/** Under the title once the group has reset at least once. [NEW COPY] */
export const lastResetLine = (day: string): string => `Last reset on ${day}.`;

/** STRATEGY 3.6 [NEW COPY]: an admin who is not the owner (403, `POST /api/admin/ratings/reset`). */
export const ONLY_OWNER_RESETS = 'Only the owner can reset ratings.';
/** STRATEGY 3.6 [NEW COPY]: a live lobby, or a game in the last 15 minutes (409). */
export const FINISH_TONIGHT_FIRST = "Finish tonight's game first.";
/** [NEW COPY] The typed group link does not match (400). */
export const RESET_NEEDS_SLUG = "Type the group's link exactly to reset its ratings.";
