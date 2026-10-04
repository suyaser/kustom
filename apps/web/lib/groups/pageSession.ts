import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordIdFromUser, supabaseSessionUser } from '../adminAuth';
import { getServiceClient } from '../supabase';
import { createAuthClient, readOnlyCookieJar } from '../supabaseAuth';

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

export const currentPageSession: () => Promise<PageSession> = cache(async () => {
  const store = await cookies();
  const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
  if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return { kind: 'anonymous' };

  const user = await supabaseSessionUser(createAuthClient(jar))();
  if (user === null) return { kind: 'anonymous' };
  const discordId = discordIdFromUser(user);
  if (discordId === null) return { kind: 'no-discord', userId: user.id };

  const { data, error } = await getServiceClient()
    .from('players')
    .select('id, puuid')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error !== null) throw new Error(`reading the session's player failed: ${error.message}`);
  return {
    kind: 'signed-in',
    userId: user.id,
    discordId,
    player: data === null ? null : { playerId: data.id, puuid: data.puuid },
  };
});
