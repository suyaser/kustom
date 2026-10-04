import { isAtLeast, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordIdFromUser, supabaseSessionUser } from './adminAuth';
import type { PlayerInGroup } from './groups/membership';
import { currentPlayerInGroup } from './groups/pageSession';
import { claimablePuuids } from './me/claimable';
import { getServiceClient } from './supabase';
import { createAuthClient, readOnlyCookieJar } from './supabaseAuth';
import { nightTimeZone } from './tonight/night';
import { ANONYMOUS_VIEWER, type ViewerState } from './tonight/viewer';

/**
 * Who is reading a group's page, when anybody is (M3.4; per group since M13.9).
 *
 * The page is public and renders completely without this: it decides two cosmetic things —
 * which row gets the `accent` "you" border, and whether the sit-out strip uses the
 * second-person sentence — and the real ones: whether the reroll and roll controls and the
 * shell's `Admin` tab are drawn.
 *
 * **`isAdmin` is decided here, on the server, from the session.** The controls it draws post to
 * `/api/admin/*`, which checks the session again with the service-role client before it writes
 * anything, so this is a rendering decision and never the gate. A client that lied about it
 * would get a 403 from the route.
 *
 * **Admin of the page's group** (M13.4): an `admin` or `owner` membership (M14.11) in the group the page
 * shows -- the `/g/<slug>` group since M13.9, and the original group for the pages that have not
 * moved yet (the default). The same check the admin routes make, so a control is drawn exactly
 * for the people the route will let through.
 *
 * Deliberately **not** `resolveAdmin`: that calls `ensureBootstrapAdmin`, which writes. A page
 * never writes to the database (CLAUDE.md), and the tonight page is the one page that anyone
 * on the internet can open.
 */

export interface Viewer {
  puuid: string;
  isAdmin: boolean;
}

/**
 * The session's player, before any group is asked about: nobody, a Discord session with no
 * player row (M3.6's `That's me` case), or a linked player. `/` reads this to decide where to
 * send somebody (M13.9); {@link currentViewerState} builds the page's viewer on it.
 */
export type SessionPlayer =
  | { kind: 'anonymous' }
  | { kind: 'unlinked' }
  | { kind: 'linked'; playerId: string; puuid: string };

const ANONYMOUS_SESSION: SessionPlayer = { kind: 'anonymous' };

/**
 * Every failure below is `anonymous`, and deliberately so: no session, no Discord identity, no
 * configured environment, Supabase unreachable. A friend opening a WhatsApp link must never see
 * an error page because the auth server was slow — they see the page they came for, with no
 * control on it.
 */
/**
 * The GoTrue step on its own: the session's Discord id (from `user.identities[]`, never
 * `user_metadata`), or `null` for every reason there is none. Split out so a page that knows its
 * group reads the player and the membership in one query ({@link currentViewerState}) rather than
 * the player first and the membership after it. The group layout starts this beside the slug
 * lookup. Every failure is `null`, as below.
 */
export const currentSessionDiscordId: () => Promise<string | null> = cache(async () => {
  try {
    const store = await cookies();
    const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
    // No session cookie, no round trip: this is the common path and it costs nothing.
    if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return null;

    const user = await supabaseSessionUser(createAuthClient(jar))();
    if (user === null) return null;
    // A session with no Discord identity has nothing to link and nothing to tap. It reads the
    // page exactly as an anonymous visitor does.
    return discordIdFromUser(user);
  } catch (error) {
    console.error('reading the viewer failed', error);
    return null;
  }
});

export const currentSessionPlayer: () => Promise<SessionPlayer> = cache(async () => {
  try {
    const discordId = await currentSessionDiscordId();
    if (discordId === null) return ANONYMOUS_SESSION;

    // `discord_id` is service-role only: anon has no privilege on `players` at all, which is
    // exactly why the column lives there and not in `players_public`. This read never leaves
    // the server and only the puuid and the admin decision reach the page.
    const { data, error } = await getServiceClient()
      .from('players')
      .select('id, puuid')
      .eq('discord_id', discordId)
      .maybeSingle();
    if (error !== null) {
      console.error('reading the viewer failed', error);
      return ANONYMOUS_SESSION;
    }
    // Signed in and matching no player row: M3.6's `That's me` case, and the first thing
    // every friend sees. **Not** an error and not anonymous.
    if (data === null) return { kind: 'unlinked' };
    return { kind: 'linked', playerId: data.id, puuid: data.puuid };
  } catch (error) {
    console.error('reading the viewer failed', error);
    return ANONYMOUS_SESSION;
  }
});

/**
 * The signed-in viewer's player row, or `null` — for either reason: nobody is signed in, or
 * whoever is has no player row yet. Callers that only want a puuid want exactly this.
 *
 * Derived from {@link currentViewerState}, which is wrapped in React's `cache`, so the page,
 * the layout's footer and any other caller together cost one round trip per request.
 */
export const currentViewer: (groupId?: string) => Promise<Viewer | null> = cache(
  async (groupId: string = ORIGINAL_GROUP_ID) => {
    const state = await currentViewerState(groupId);
    return state.kind === 'linked' ? { puuid: state.puuid, isAdmin: state.isAdmin } : null;
  },
);

/**
 * The same lookup, with the middle case kept (M3.6), for one group.
 *
 * `currentViewer()` collapses "not signed in" and "signed in, no player row" into `null`,
 * which is right for every caller that only wants a puuid — the footer's `Your games`, the
 * leaderboard's own row. The tonight page needs the difference: a signed-in visitor with no
 * player row is shown the `That's me` list, and an anonymous one is shown the sign-in control.
 *
 * `groupId` is the group the page shows; the default is the original group, which is the
 * group of every page that has not moved under `/g/<slug>` yet.
 */
export const currentViewerState: (groupId?: string) => Promise<ViewerState> = cache(
  async (groupId: string = ORIGINAL_GROUP_ID) => {
    const discordId = await currentSessionDiscordId();
    if (discordId === null) return ANONYMOUS_VIEWER;

    // The player row and its membership in this group in one service-role query (M19.12), shared
    // with the admin pages' access check for the request. Failing it is anonymous, as a failed
    // player read always was: without the row there is no "you" rule to keep.
    let member: PlayerInGroup;
    try {
      member = await currentPlayerInGroup(discordId, groupId);
    } catch (error) {
      console.error('reading the viewer failed', error);
      return ANONYMOUS_VIEWER;
    }
    return viewerStateFor(member, () => claimable(groupId));
  },
);

/**
 * The page's viewer from the one-query lookup, for a signed-in Discord session. Exported for its
 * tests: no session, no I/O beyond `claimableFor`.
 *
 * - no player row (`null`): the `That's me` case, **not** anonymous. The list of who may be claimed
 *   is a service-role read of `players.discord_id`, decided here so the page never sees a Discord
 *   id -- one extra query, and only for this state.
 * - a player with no role in this group (no membership, or a role string the union does not know):
 *   linked, the "you" rule, and nothing a member gets.
 * - a member: the role decides the admin controls and the owner's.
 */
export async function viewerStateFor(
  member: PlayerInGroup,
  claimableFor: () => Promise<readonly string[]>,
): Promise<ViewerState> {
  if (member === null) return { kind: 'unlinked', claimable: await claimableFor() };
  const { role } = member;
  return {
    kind: 'linked',
    puuid: member.player.puuid,
    isAdmin: isAtLeast(role, 'admin'),
    isOwner: role === 'owner',
    isMember: role !== null,
  };
}

/**
 * Tonight's unclaimed members, or none: a failed lookup offers nobody rather than taking the
 * page down. A visitor who is asked nothing can still read every word on it.
 */
async function claimable(groupId: string): Promise<readonly string[]> {
  try {
    return await claimablePuuids(getServiceClient(), { timeZone: nightTimeZone(), groupId });
  } catch (error) {
    console.error('tonight page: reading who can be picked failed', error);
    return [];
  }
}
