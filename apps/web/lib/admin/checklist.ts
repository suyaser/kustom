import {
  ROW_CREATED_TITLE,
  ROW_DISCORD_TITLE,
  ROW_DISCORD_WHY,
  ROW_FIRST_GAME_TITLE,
  ROW_FIRST_GAME_WHY,
  ROW_INVITE_TITLE,
  ROW_INVITE_TODO_DETAIL,
  ROW_INVITE_WHY,
  ROW_KUSTOM_TITLE,
  ROW_KUSTOM_WHY,
  rowCreatedDetail,
  rowDiscordTestedDetail,
  rowInviteDoneDetail,
  rowKustomSeenDetail,
} from './homeCopy';
import { hostName } from './hostName';
import { timeAgo } from './timeAgo';

/**
 * `Get your group ready` (STRATEGY 3.1 / 3.2; M14.21, M14.22 acceptance 6): the admin home's setup
 * checklist, **derived from data only**. There is no stored progress and no "mark as done": each row
 * is a fact the database already holds, so it cannot lie, a second admin sees the same truth, and a
 * row reopens by itself when its fact stops being true (the webhook cleared, every host revoked).
 *
 * Pure: the facts are read by `checklistFacts.ts`, and `now` is passed in.
 */

/** What the database says about the group, and nothing else. */
export interface ChecklistFacts {
  discord: {
    /** The group has a webhook (pasted, or M14.20's one-click connect). */
    webhookSet: boolean;
    /** When the last test post landed (M14.20, `0025`); `null` until one has. */
    testPostAt: string | null;
    /** Discord's reason the last test post failed, kept for the page; `null` when it did not. */
    testPostError: string | null;
  };
  /** `group_memberships` rows for the group, every role. */
  members: number;
  /** The group's live (unrevoked) host tokens; `account` names a paired PC (`hostAccount`, M14.50). */
  hosts: { label: string | null; account: string | null; lastSeenAt: string | null }[];
  /** Whether any game of the group is recorded. */
  hasGame: boolean;
}

export type ChecklistKey = 'created' | 'discord' | 'invite' | 'kustom' | 'first-game';

/** `waiting` is the Kustom row's middle state: a token exists, Kustom never connected with it. */
export type ChecklistState = 'done' | 'to-do' | 'waiting';

export interface ChecklistRow {
  key: ChecklistKey;
  title: string;
  state: ChecklistState;
  /** The line after the state word (`Done · 3 people in the group`), or the row's "why". */
  detail: string | null;
  /** The one-line why for a row not done, under it. */
  why: string | null;
}

export interface Checklist {
  /** Kustom seen and a first game (Discord and invite are recommended, not required): the card collapses to one line. */
  ready: boolean;
  rows: ChecklistRow[];
}

export interface ChecklistContext {
  now: Date;
  /** The group's link as people will type it: host and path, no scheme (`kustom.gg/g/<slug>`). */
  groupLink: string;
}

/**
 * Row order (M14.43, scene-walk gap 14): nothing is listed before what it waits on.
 *   created -> discord -> kustom -> invite -> first game
 * Discord waits on nothing (since M14.40 the unlinked creator may connect it). Kustom comes before the
 * invite because players also join by playing in a lobby with the group's Kustom, and the creator is
 * not a member (so not counted) until Kustom pairs them. The first game waits on Kustom.
 */
export function deriveChecklist(facts: ChecklistFacts, context: ChecklistContext): Checklist {
  const { now } = context;
  const rows: ChecklistRow[] = [
    {
      key: 'created',
      title: ROW_CREATED_TITLE,
      state: 'done',
      detail: rowCreatedDetail(context.groupLink),
      why: null,
    },
  ];

  // Done means a test post landed (STRATEGY 3.2 step 2), not merely that a webhook is stored. A
  // failed test keeps the row to do with Discord's reason.
  const discordTestPostAt = facts.discord.testPostAt;
  rows.push(
    discordTestPostAt !== null
      ? {
          key: 'discord',
          title: ROW_DISCORD_TITLE,
          state: 'done',
          detail: rowDiscordTestedDetail(timeAgo(discordTestPostAt, now)),
          why: null,
        }
      : {
          key: 'discord',
          title: ROW_DISCORD_TITLE,
          state: 'to-do',
          detail: null,
          why:
            facts.discord.webhookSet && facts.discord.testPostError !== null
              ? facts.discord.testPostError
              : ROW_DISCORD_WHY,
        },
  );

  const seen = latestSeen(facts.hosts);
  const kustom: ChecklistRow =
    seen !== null
      ? {
          key: 'kustom',
          title: ROW_KUSTOM_TITLE,
          state: 'done',
          detail: rowKustomSeenDetail(hostName(seen), timeAgo(seen.lastSeenAt, now)),
          why: null,
        }
      : facts.hosts.length > 0
        ? { key: 'kustom', title: ROW_KUSTOM_TITLE, state: 'waiting', detail: null, why: null }
        : { key: 'kustom', title: ROW_KUSTOM_TITLE, state: 'to-do', detail: null, why: ROW_KUSTOM_WHY };
  rows.push(kustom);

  rows.push(
    facts.members >= 2
      ? {
          key: 'invite',
          title: ROW_INVITE_TITLE,
          state: 'done',
          detail: rowInviteDoneDetail(facts.members),
          why: null,
        }
      : {
          key: 'invite',
          title: ROW_INVITE_TITLE,
          state: 'to-do',
          detail: ROW_INVITE_TODO_DETAIL,
          why: ROW_INVITE_WHY,
        },
  );

  // The first game is shown once Kustom is seen (STRATEGY 3.2): before Kustom runs, a game cannot be
  // recorded. It is last: it is the goal, and it waits on the Kustom row.
  if (kustom.state === 'done') {
    rows.push(
      facts.hasGame
        ? { key: 'first-game', title: ROW_FIRST_GAME_TITLE, state: 'done', detail: null, why: null }
        : {
            key: 'first-game',
            title: ROW_FIRST_GAME_TITLE,
            state: 'to-do',
            detail: null,
            why: ROW_FIRST_GAME_WHY,
          },
    );
  }

  return { ready: kustom.state === 'done' && facts.hasGame, rows };
}

/** The most recently seen live host, or `null` when none has connected. */
function latestSeen(
  hosts: ChecklistFacts['hosts'],
): { label: string | null; account: string | null; lastSeenAt: string } | null {
  let best: { label: string | null; account: string | null; lastSeenAt: string } | null = null;
  for (const host of hosts) {
    if (host.lastSeenAt === null) continue;
    if (best === null || Date.parse(host.lastSeenAt) > Date.parse(best.lastSeenAt)) {
      best = { label: host.label, account: host.account, lastSeenAt: host.lastSeenAt };
    }
  }
  return best;
}
