import 'server-only';
import { cookies } from 'next/headers';
import { loadBoard } from '../board/load';
import type { BoardRow, EmptyWindowFallback } from '../board/types';
import { cachedRead } from '../cache/cached';
import { groupTag, NAMES_TAG } from '../cache/tags';
import { groupAdminNames } from '../groups/membership';
import { type HostPresence, hostPresenceFrom, readHostFacts } from '../hostPresence';
import { loadMysteryOrNone } from '../mystery/load';
import { emptyMysteryPage, loadMysteryPage, type MysteryPageState } from '../mystery/service';
import { isVisitorId, MYSTERY_VISITOR_COOKIE } from '../mystery/visitor';
import { type RosterInputs, readRosterInputs } from '../names/roster';
import { civilDayKey, type WindowKind, windowRange } from '../night';
import { createPublicClient } from '../publicClient';
import { getServiceClient } from '../supabase';
import { type LastGame, loadLastGame } from './lastGame';
import type { PlayerName } from './types';

/**
 * Tonight's slow-changing slices, kept in the server cache across requests and dropped by their
 * writers (performance plan, phase 2; tags in `lib/cache/tags.ts`). **Live lobby state is never
 * here**: the lobby, the teams, the result, the tape and the Mode card are read on every render
 * (`loadTonight`), and so is everything about the viewer (the session, the password, the start
 * press, the sit-out preview).
 *
 * Names stay right: every slice that prints one carries {@link NAMES_TAG} (a rename drops it) and
 * a short lifetime, and the same-name labels are still computed per render from the cached roster
 * inputs (`loadRosterLabels`), never cached as labels. Each `...OrNone` keeps the fallback its
 * uncached read had, and a failed read is never cached.
 *
 * Group facts only, the same for every viewer. Admin names and host tokens are read with the service
 * role (the role column and the token table are not public), and only what the page already prints
 * (names, a timestamp per token) is cached.
 */

const games = (groupId: string) => groupTag('games', groupId);
const roster = (groupId: string) => groupTag('roster', groupId);

/** Who the group knows and the first games of the ones who clash: the labels' inputs. */
export const cachedRosterInputs: (groupId: string) => Promise<RosterInputs> = cachedRead(
  'tonight-roster-inputs-v1',
  (groupId: string) => readRosterInputs(createPublicClient(), groupId),
  { tags: (groupId) => [roster(groupId), games(groupId), NAMES_TAG], revalidate: 300 },
);

const cachedTopBoard = cachedRead(
  'tonight-top-board-v1',
  async (groupId: string, window: string, timeZone: string, _windowStart: string, limit: number) => {
    const board = await loadBoard(createPublicClient(), { window: window as WindowKind, groupId, timeZone });
    return { rows: board.rows.slice(0, Math.max(0, limit)), fallback: board.fallback ?? null };
  },
  { tags: (groupId) => [games(groupId), roster(groupId), NAMES_TAG], revalidate: 600 },
);

/**
 * This week's top five (`loadTopBoardOrNone`, cached): the week's start is in the key, so Monday's
 * first render reads the new week without anybody invalidating anything.
 */
export async function loadTopBoardCachedOrNone(options: {
  groupId: string;
  window: WindowKind;
  timeZone: string;
  limit: number;
  now?: Date;
}): Promise<{ rows: BoardRow[]; fallback: EmptyWindowFallback | null }> {
  const start = windowRange(options.window, options.now ?? new Date(), options.timeZone).start;
  try {
    return await cachedTopBoard(
      options.groupId,
      options.window,
      options.timeZone,
      start === null ? 'all-time' : new Date(start).toISOString(),
      options.limit,
    );
  } catch (error) {
    console.error('tonight: reading the rail board failed', error);
    return { rows: [], fallback: null };
  }
}

const cachedAdminNames = cachedRead(
  'tonight-admin-names-v1',
  (groupId: string) => groupAdminNames(getServiceClient(), groupId),
  { tags: (groupId) => [groupTag('admins', groupId), roster(groupId), NAMES_TAG], revalidate: 3_600 },
);

/** `loadAdminNamesOrNone`, cached: an empty list on any failure (the strip then says `an admin`). */
export async function loadAdminNamesCachedOrNone(groupId: string): Promise<PlayerName[]> {
  try {
    return await cachedAdminNames(groupId);
  } catch (error) {
    console.error('tonight: reading the admins failed', error);
    return [];
  }
}

const cachedHostFacts = cachedRead(
  'tonight-host-facts-v1',
  (groupId: string) => readHostFacts(getServiceClient(), groupId),
  // Heartbeats move `last_seen_at` all night and nobody invalidates on a heartbeat: 30 s is how
  // late a host that just came up can be noticed. "Recently" is still decided on every render.
  { tags: (groupId) => [groupTag('hosts', groupId), NAMES_TAG], revalidate: 30 },
);

/** `loadHostPresenceOrNone`, from cached facts: null on any failure (the page draws no line). */
export async function loadHostPresenceCachedOrNone(
  groupId: string,
  now?: Date,
): Promise<HostPresence | null> {
  try {
    return hostPresenceFrom(await cachedHostFacts(groupId), now);
  } catch (error) {
    console.error('tonight: reading the hosts failed', error);
    return null;
  }
}

const cachedLastGame = cachedRead(
  'tonight-last-game-v1',
  (groupId: string) => loadLastGame(createPublicClient(), groupId),
  { tags: (groupId) => [games(groupId), NAMES_TAG], revalidate: 600 },
);

/** `loadLastGameOrNone`, cached: `undefined` on a failed read (no poster, and not "empty group"). */
export async function loadLastGameCachedOrNone(groupId: string): Promise<LastGame | null | undefined> {
  try {
    return await cachedLastGame(groupId);
  } catch (error) {
    console.error('tonight: reading the last game failed', error);
    return undefined;
  }
}

const cachedAnonymousMystery = cachedRead(
  'tonight-anonymous-mystery-v1',
  (groupId: string, timeZone: string, _day: string) =>
    loadMysteryPage(getServiceClient(), { now: new Date(), timeZone, visitorId: null, groupId }),
  {
    tags: (groupId) => [groupTag('mystery', groupId), games(groupId), NAMES_TAG],
    revalidate: 3_600,
  },
);

/**
 * Today's daily game card. A visitor who has played (the visitor cookie) keeps the per-visitor read
 * as it was (`loadMysteryOrNone`: their attempt, their session). Everyone else sees the same
 * anonymous card, cached for the day (the day is in the key).
 */
export async function loadMysteryCachedOrNone(
  now: Date,
  groupId: string,
  timeZone: string,
): Promise<MysteryPageState> {
  const visitor = (await cookies()).get(MYSTERY_VISITOR_COOKIE)?.value;
  if (isVisitorId(visitor)) return loadMysteryOrNone(now, groupId);
  try {
    return await cachedAnonymousMystery(groupId, timeZone, civilDayKey(now, timeZone));
  } catch (error) {
    console.error('daily mystery: page load failed', error);
    return emptyMysteryPage(now, timeZone);
  }
}
