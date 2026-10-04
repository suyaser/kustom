import type { GroupRole } from '@customs/db/schemas';
import { cache } from 'react';
import { currentLiveSession } from '../session/currentLiveSession';
import type { LiveSession } from '../session/liveSession';

/**
 * Who opened `/new`, `/join/<code>` or a group's admin page (M14.21): nobody, or a Discord session
 * with its auth user id and, when it has paired, its player. Read only; a page never writes.
 *
 * Unlike `currentSessionPlayer` (`lib/viewer.ts`) it keeps the auth user id, because the admin page
 * recognises a group's **unlinked creator** by `groups.created_by`, which is that id (M13.5), and
 * unlike it, a failure to read the session is thrown to the page's error boundary rather than read
 * as "signed out": on these pages a false "sign in" button would loop a signed-in person.
 * No session cookie at all is the common case and costs no round trip.
 *
 * Read through the verified session lookup (`lib/session/liveSession.ts`): the token's signature
 * checked locally, then one service-role call that requires a live session row.
 */
export type PageSession =
  | { kind: 'anonymous' }
  /**
   * A verified session with no Discord identity: it can neither create, join nor pair, so those
   * pages read it as signed out. Kept apart only because the operator (`SUPER_ADMIN_USER_IDS`,
   * M14.19) may sign in that way and still read a group's admin pages.
   */
  | { kind: 'no-discord'; userId: string }
  | {
      kind: 'signed-in';
      userId: string;
      discordId: string;
      /** `null` until they pair a League account through Kustom (or pick themselves on tonight's page). */
      player: { playerId: string; puuid: string } | null;
      /**
       * The player's role in the group the session was read for (`currentPageSession(groupId)`),
       * from the same lookup. Absent when no group was asked; `role` null is "not a member".
       */
      membership?: { groupId: string; role: GroupRole | null };
    };

/** A live session read as a {@link PageSession}. */
export function pageSessionOf(live: LiveSession): PageSession {
  if (live.kind === 'anonymous') return { kind: 'anonymous' };
  if (live.kind === 'no-discord') return { kind: 'no-discord', userId: live.userId };
  return {
    kind: 'signed-in',
    userId: live.userId,
    discordId: live.discordId,
    player: live.player === null ? null : { playerId: live.player.playerId, puuid: live.player.puuid },
    ...(live.groupId === null ? {} : { membership: { groupId: live.groupId, role: live.role } }),
  };
}

/**
 * The page session, optionally with the role in one group: the admin pages pass theirs, so the
 * session and the membership are one round trip, shared with `currentViewerState(groupId)`.
 */
export const currentPageSession: (groupId?: string) => Promise<PageSession> = cache(
  async (groupId?: string) => pageSessionOf(await currentLiveSession(groupId ?? null)),
);
