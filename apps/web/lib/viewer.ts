import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordIdFromUser, supabaseSessionUser } from './adminAuth';
import { supabaseGroupRole } from './groups/membership';
import { claimablePuuids } from './me/claimable';
import { getServiceClient } from './supabase';
import { createAuthClient, readOnlyCookieJar } from './supabaseAuth';
import { nightTimeZone } from './tonight/night';
import { ANONYMOUS_VIEWER, type ViewerState } from './tonight/viewer';

/**
 * Who is reading the tonight page, when anybody is (M3.4).
 *
 * The page is public and renders completely without this: it decides two cosmetic things —
 * which row gets the `accent` "you" border, and whether the sit-out strip uses the
 * second-person sentence — and one real one: whether the reroll control is drawn.
 *
 * **`isAdmin` is decided here, on the server, from the session.** The control it draws posts to
 * `/api/admin/lobbies/[lobbyId]/reroll`, which checks the session again with the service-role
 * client before it writes anything, so this is a rendering decision and never the gate. A
 * client that lied about it would get a 403 from the route.
 *
 * **Admin of the page's group** (M13.4): `group_memberships.role = 'admin'` in the group the page
 * shows, which is the original group for every page until M13.9 moves the tonight page under
 * `/g/<slug>`. The same check the reroll route makes, so the control is drawn exactly for the
 * people the route will let through.
 *
 * Deliberately **not** `resolveAdmin`: that calls `ensureBootstrapAdmin`, which writes. A page
 * never writes to the database (CLAUDE.md), and the tonight page is the one page that anyone
 * on the internet can open.
 */
/**
 * The group every page that reads the viewer shows until M13.9 to M13.14 move them under
 * `/g/<slug>` and pass their own.
 */
const VIEWER_GROUP_ID = ORIGINAL_GROUP_ID;

export interface Viewer {
  puuid: string;
  isAdmin: boolean;
}

/**
 * The signed-in viewer's player row, or `null` — for either reason: nobody is signed in, or
 * whoever is has no player row yet. Callers that only want a puuid want exactly this.
 *
 * Derived from {@link currentViewerState}, which is wrapped in React's `cache`, so the page,
 * the layout's footer and any other caller together cost one round trip per request.
 */
export const currentViewer: () => Promise<Viewer | null> = cache(async () => {
  const state = await currentViewerState();
  return state.kind === 'linked' ? { puuid: state.puuid, isAdmin: state.isAdmin } : null;
});

/**
 * The same lookup, with the middle case kept (M3.6).
 *
 * `currentViewer()` collapses "not signed in" and "signed in, no player row" into `null`,
 * which is right for every caller that only wants a puuid — the footer's `Your games`, the
 * leaderboard's own row. The tonight page needs the difference: a signed-in visitor with no
 * player row is shown the `That's me` list, and an anonymous one is shown the sign-in control.
 *
 * Every failure below is still `anonymous`, and deliberately so: no session, no Discord
 * identity, no configured environment, Supabase unreachable. A friend opening a WhatsApp link
 * must never see an error page because the auth server was slow — they see the page they came
 * for, with no control on it.
 */
export const currentViewerState: () => Promise<ViewerState> = cache(async () => {
  try {
    const store = await cookies();
    const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
    // No session cookie, no round trip: this is the common path and it costs nothing.
    if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return ANONYMOUS_VIEWER;

    const user = await supabaseSessionUser(createAuthClient(jar))();
    if (user === null) return ANONYMOUS_VIEWER;

    const discordId = discordIdFromUser(user);
    // A session with no Discord identity has nothing to link and nothing to tap. It reads the
    // page exactly as an anonymous visitor does.
    if (discordId === null) return ANONYMOUS_VIEWER;

    // `discord_id` is service-role only: anon has no privilege on `players` at all, which is
    // exactly why the column lives there and not in `players_public`. This read never leaves
    // the server and only the puuid and the admin decision reach the page.
    const client = getServiceClient();
    const { data, error } = await client
      .from('players')
      .select('id, puuid')
      .eq('discord_id', discordId)
      .maybeSingle();
    // Signed in and matching no player row: M3.6's `That's me` case, and the first thing
    // every friend sees. **Not** an error and not anonymous.
    if (error !== null) {
      console.error('tonight page: reading the viewer failed', error);
      return ANONYMOUS_VIEWER;
    }
    // Signed in, matching no player row: the `That's me` case. The list of who may be claimed
    // is a service-role read of `players.discord_id` and is decided here, so the page never
    // sees a Discord id — one extra query, and only for this state.
    if (data === null) {
      return { kind: 'unlinked', claimable: await claimable() };
    }

    const role = await supabaseGroupRole(client)(data.id, VIEWER_GROUP_ID);
    return { kind: 'linked', puuid: data.puuid, isAdmin: role === 'admin' };
  } catch (error) {
    console.error('tonight page: reading the viewer failed', error);
    return ANONYMOUS_VIEWER;
  }
});

/**
 * Tonight's unclaimed members, or none: a failed lookup offers nobody rather than taking the
 * page down. A visitor who is asked nothing can still read every word on it.
 */
async function claimable(): Promise<readonly string[]> {
  try {
    return await claimablePuuids(getServiceClient(), { timeZone: nightTimeZone(), groupId: VIEWER_GROUP_ID });
  } catch (error) {
    console.error('tonight page: reading who can be picked failed', error);
    return [];
  }
}
