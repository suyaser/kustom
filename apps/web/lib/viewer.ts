import { isAtLeast, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { cache } from 'react';
import { claimablePuuids } from './me/claimable';
import { currentLiveSession } from './session/currentLiveSession';
import type { LiveSession } from './session/liveSession';
import { getServiceClient } from './supabase';
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
export const currentSessionPlayer: () => Promise<SessionPlayer> = cache(async () => {
  try {
    // The verified session lookup (`lib/session/liveSession.ts`): the token's signature checked
    // locally, then one service-role call that requires a live session row and maps the Discord
    // identity to the player. No session cookie is the common path and costs nothing.
    return sessionPlayerOf(await currentLiveSession(null));
  } catch (error) {
    console.error('reading the viewer failed', error);
    return ANONYMOUS_SESSION;
  }
});

/**
 * A live session read as a {@link SessionPlayer}. A session with no Discord identity has nothing to
 * link and nothing to tap: it reads the page exactly as an anonymous visitor does. Signed in and
 * matching no player row is M3.6's `That's me` case, and the first thing every friend sees:
 * **not** an error and not anonymous. `discord_id` never leaves the server; only the puuid and the
 * admin decision reach the page.
 */
function sessionPlayerOf(live: LiveSession): SessionPlayer {
  if (live.kind !== 'signed-in') return ANONYMOUS_SESSION;
  if (live.player === null) return { kind: 'unlinked' };
  return { kind: 'linked', playerId: live.player.playerId, puuid: live.player.puuid };
}

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
    let live: LiveSession;
    try {
      // One lookup answers who this is and their role in this group; the layout, the page and the
      // admin helpers asking about the same group share it (React `cache`).
      live = await currentLiveSession(groupId);
    } catch (error) {
      // The lookup both identifies the reader and reads the role. Failing it draws no control and
      // no "you" rule: the page reads as it does for an anonymous visitor, never an error page.
      console.error('reading the viewer failed', error);
      return ANONYMOUS_VIEWER;
    }
    const session = sessionPlayerOf(live);
    if (session.kind === 'anonymous') return ANONYMOUS_VIEWER;
    // Signed in, matching no player row: the `That's me` case. The list of who may be claimed
    // is a service-role read of `players.discord_id` and is decided here, so the page never
    // sees a Discord id — one extra query, and only for this state.
    if (session.kind === 'unlinked') return { kind: 'unlinked', claimable: await claimable(groupId) };

    const role = live.kind === 'signed-in' ? live.role : null;
    return {
      kind: 'linked',
      puuid: session.puuid,
      isAdmin: isAtLeast(role, 'admin'),
      isOwner: role === 'owner',
      isMember: role !== null,
    };
  },
);

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
