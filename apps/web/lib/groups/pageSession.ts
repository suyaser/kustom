import { cache } from 'react';
import { currentLiveSession } from '../session/currentLiveSession';
import type { LiveSession } from '../session/liveSession';
import { getServiceClient } from '../supabase';
import { type PlayerInGroup, type PlayerInGroupLookup, supabasePlayerInGroup } from './membership';

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
 * Everything here reads the verified session lookup (`lib/session/liveSession.ts`): the token's
 * signature checked locally, then one service-role `session_player` call that requires a live
 * session row and returns the player and, when a group is asked, the role in it.
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
    };

/**
 * The verified session without the player: what `decideAdminAccess` takes, beside a
 * {@link PlayerInGroupLookup}. The Discord id is `auth.identities`' (read by `session_player`),
 * never `user_metadata`.
 */
export type PageIdentity =
  | { kind: 'anonymous' }
  | { kind: 'no-discord'; userId: string }
  | { kind: 'discord'; userId: string; discordId: string };

/** A live session read as a {@link PageIdentity}. */
export function pageIdentityOf(live: LiveSession): PageIdentity {
  if (live.kind === 'signed-in') return { kind: 'discord', userId: live.userId, discordId: live.discordId };
  return live.kind === 'no-discord' ? { kind: 'no-discord', userId: live.userId } : { kind: 'anonymous' };
}

/** A live session read as a {@link PageSession}. */
export function pageSessionOf(live: LiveSession): PageSession {
  if (live.kind !== 'signed-in') return pageIdentityOf(live) as PageSession;
  return {
    kind: 'signed-in',
    userId: live.userId,
    discordId: live.discordId,
    player: live.player === null ? null : { playerId: live.player.playerId, puuid: live.player.puuid },
  };
}

/**
 * The page identity, read in the same lookup as the role in `groupId` when a page names its group
 * (the admin pages do: identity, player and role are then one round trip for the whole render,
 * shared with `currentViewerState(groupId)`).
 */
export const currentPageIdentity: (groupId?: string) => Promise<PageIdentity> = cache(
  async (groupId?: string) => pageIdentityOf(await currentLiveSession(groupId ?? null)),
);

/**
 * The player behind a Discord id and their role in one group, from the request's live session for
 * that group (one `session_player` call, React-cached): the group layout's viewer and the admin
 * pages' access check share it. A Discord id that is not the session's own (no caller does that)
 * falls back to the plain one-query read.
 */
export const currentPlayerInGroup: PlayerInGroupLookup = cache(
  async (discordId: string, groupId: string): Promise<PlayerInGroup> => {
    const live = await currentLiveSession(groupId);
    if (live.kind === 'signed-in' && live.discordId === discordId) return playerInGroupOf(live);
    return supabasePlayerInGroup(getServiceClient())(discordId, groupId);
  },
);

/** A signed-in live session as the {@link PlayerInGroup} shape (`null`: no player row). */
export function playerInGroupOf(live: Extract<LiveSession, { kind: 'signed-in' }>): PlayerInGroup {
  if (live.player === null) return null;
  return { player: { playerId: live.player.playerId, puuid: live.player.puuid }, role: live.role };
}

export const currentPageSession: () => Promise<PageSession> = cache(async () =>
  pageSessionOf(await currentLiveSession(null)),
);
