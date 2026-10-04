import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordIdFromUser, supabaseSessionUser } from '../adminAuth';
import { getServiceClient } from '../supabase';
import { createAuthClient, readOnlyCookieJar } from '../supabaseAuth';
import { type PlayerInGroupLookup, supabasePlayerInGroup } from './membership';

/**
 * Who opened `/new`, `/join/<code>` or a group's admin page (M14.21): nobody, or a Discord session
 * with its auth user id and, when it has paired, its player. Read only; a page never writes.
 *
 * Unlike `currentSessionPlayer` (`lib/viewer.ts`) it keeps the auth user id, because the admin page
 * recognises a group's **unlinked creator** by `groups.created_by`, which is that id (M13.5), and
 * unlike it, a failure to read the session is thrown to the page's error boundary rather than read
 * as "signed out": on these pages a false "sign in" button would loop a signed-in person.
 * No session cookie at all is the common case and costs no round trip.
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
 * The verified session before any player is read: the GoTrue step of {@link currentPageSession}, on
 * its own so a page that asks about one group (`currentAdminAccess`) can read the player and the
 * membership in one query ({@link currentPlayerInGroup}) instead of two in a row. The Discord id is
 * the identity's (`discordIdFromUser`, `user.identities[]`), never `user_metadata`.
 */
export type PageIdentity =
  | { kind: 'anonymous' }
  | { kind: 'no-discord'; userId: string }
  | { kind: 'discord'; userId: string; discordId: string };

export const currentPageIdentity: () => Promise<PageIdentity> = cache(async () => {
  const store = await cookies();
  const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
  if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return { kind: 'anonymous' };

  const user = await supabaseSessionUser(createAuthClient(jar))();
  if (user === null) return { kind: 'anonymous' };
  const discordId = discordIdFromUser(user);
  if (discordId === null) return { kind: 'no-discord', userId: user.id };
  return { kind: 'discord', userId: user.id, discordId };
});

/**
 * The player behind a Discord id and their role in one group, one service-role query, once per
 * request whoever asks: the group layout's viewer (`lib/viewer.ts`) and the admin pages' access
 * check share it, so an admin render reads it once.
 */
export const currentPlayerInGroup: PlayerInGroupLookup = cache((discordId: string, groupId: string) =>
  supabasePlayerInGroup(getServiceClient())(discordId, groupId),
);

export const currentPageSession: () => Promise<PageSession> = cache(async () => {
  const identity = await currentPageIdentity();
  if (identity.kind !== 'discord') return identity;
  const { userId, discordId } = identity;

  const { data, error } = await getServiceClient()
    .from('players')
    .select('id, puuid')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error !== null) throw new Error(`reading the session's player failed: ${error.message}`);
  return {
    kind: 'signed-in',
    userId,
    discordId,
    player: data === null ? null : { playerId: data.id, puuid: data.puuid },
  };
});
