import { groupRoleSchema, isAtLeast } from '@customs/db';
import { inChunks } from '../chunks';
import type { TableRow } from '../liveTables';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';
import { nightTables } from '../tonight/tables';

/**
 * Who a signed-in visitor with no player row may claim as themselves (M3.6, widened by M14.34).
 *
 * **The claim set** is the PUUIDs a friend could plausibly be, decided by the group in the
 * request and the clock, never by anything the page sends:
 *
 *   1. the members of the group's tonight lobby (its newest non-`abandoned` lobby since the
 *      night began, the one the tonight page renders), M3.6's rule. M22.5: of **every live
 *      table** (`lib/liveTables.ts`), since Tonight may draw any of them and offers only the drawn
 *      table's rows (`RoleTonight`); with no live table, the newest row as before;
 *   2. **the ten of any game of the group that finished in the last {@link CLAIM_WINDOW_HOURS}
 *      hours** (M14.34), so someone who signs in the next morning from the game page or the
 *      Discord link can still say `That's me`. "Finished" is the game's own end,
 *      `started_at + duration_s`, never `created_at`: a backfilled game from last month is
 *      written today and must not reopen its ten.
 *
 * **Claimable** is the claim set minus every player somebody is already linked to (M3.6 rule 2:
 * a linked player is not on the list, not greyed out, not refused on tap). That is a fact about
 * `players.discord_id`, which is service-role only, so it is decided here and only the PUUIDs of
 * unclaimed players travel to the browser. Nothing about who is linked to what reaches a page.
 *
 * **Never an unlinked owner or admin** (M14.26): a player who holds an `owner` or `admin`
 * membership in any group is left off the list, and the route refuses them with the
 * not-claimable sentence. Admins and owners link through host pairing.
 *
 * `POST /api/me/link` asks {@link claimSetPuuids} again before it writes and its write is
 * conditional on `discord_id is null`: this list decides what is drawn, never what is allowed.
 * The security reasoning is the decision row of 2026-10-03 (M14.34).
 */

/** How long after a game ends its ten stay claimable (M14.34). */
export const CLAIM_WINDOW_HOURS = 12;

const CLAIM_WINDOW_MS = CLAIM_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * How far before the window the read looks for a game's start: no custom runs four hours, and a
 * game longer than that only loses the morning-after claim, which an admin can still make.
 */
const LONGEST_GAME_MS = 4 * 60 * 60 * 1000;

export interface ClaimSetOptions {
  /** Injected in tests. */
  now?: Date;
  /** IANA name for "tonight" (M2.5). */
  timeZone: string;
  /** The group whose lobby and games may be claimed out of (M13.4): the request's `groupId`. */
  groupId: string;
}

/** Every PUUID in the claim set, linked or not: rule 1 plus rule 2 above. */
export async function claimSetPuuids(client: ServiceClient, options: ClaimSetOptions): Promise<Set<string>> {
  const [lobby, games] = await Promise.all([
    tonightLobbyPuuids(client, options),
    recentGamePuuids(client, options),
  ]);
  return new Set([...lobby, ...games]);
}

/**
 * True when any of a player's memberships is `admin` or above (M14.26). A role the schema does
 * not know counts as privileged: fail closed, the cost is one friend linking through pairing.
 */
export function holdsAdminRole(memberships: readonly { role: string }[] | null | undefined): boolean {
  for (const membership of memberships ?? []) {
    const role = groupRoleSchema.safeParse(membership.role);
    if (!role.success || isAtLeast(role.data, 'admin')) return true;
  }
  return false;
}

/** The claim set without anybody already linked or any admin or owner: what the page offers. */
export async function claimablePuuids(client: ServiceClient, options: ClaimSetOptions): Promise<string[]> {
  const set = [...(await claimSetPuuids(client, options))];
  const unlinked: string[] = [];
  for (const chunk of inChunks(set)) {
    const { data, error } = await client
      .from('players')
      .select('puuid, discord_id, group_memberships(role)')
      .in('puuid', chunk)
      .is('discord_id', null);
    if (error) throw new Error(`claimable: player lookup failed: ${error.message}`);
    // The `is` filter is the whole rule; this second check is the one that would survive a
    // filter that stopped filtering, because an unclaimable name on the list is a tap that can
    // only ever be refused.
    for (const row of data ?? []) {
      if (row.discord_id === null && !holdsAdminRole(row.group_memberships)) unlinked.push(row.puuid);
    }
  }
  // A stable order for the page and the tests: the set's own (lobby first, then games).
  const keep = new Set(unlinked);
  return set.filter((puuid) => keep.has(puuid));
}

/**
 * The game page's offer (M14.34, the contract for M14.35's `That's me` on a game): which of a
 * game's seats the viewer may claim, given the `claimable` list `currentViewerState` already
 * carries. Seat order is kept. An old game's seat is offered only when that player is
 * claimable anyway (in tonight's lobby or a recent game); the route decides either way.
 */
export function claimableSeats(claimable: readonly string[], seatPuuids: readonly string[]): string[] {
  const allowed = new Set(claimable);
  return seatPuuids.filter((puuid) => allowed.has(puuid));
}

async function tonightLobbyPuuids(client: ServiceClient, options: ClaimSetOptions): Promise<string[]> {
  const now = options.now ?? new Date();
  const since = nightStart(now, options.timeZone).toISOString();
  // M22.5: tonight's rows (abandoned too: a newest abandoned row ends its table), one read as before.
  const { data: rows, error: lobbyError } = await client
    .from('lobbies')
    .select('id, lcu_party_id, status, created_at, updated_at, reported_by_player_id, lobby_name')
    .eq('group_id', options.groupId)
    .gte('created_at', since);
  if (lobbyError) throw new Error(`claimable: lobby lookup failed: ${lobbyError.message}`);
  const lobbyIds = drawableLobbyIds(
    (rows ?? []).map((row) => ({
      id: row.id,
      lcuPartyId: row.lcu_party_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reportedByPlayerId: row.reported_by_player_id,
      lobbyName: row.lobby_name,
    })),
    now,
  );
  if (lobbyIds.length === 0) return [];

  const { data, error } = await client
    .from('lobby_members')
    .select('players!inner(puuid)')
    .in('lobby_id', lobbyIds);
  if (error) throw new Error(`claimable: member lookup failed: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.players.puuid))];
}

/**
 * The rows Tonight may draw (M22.5): every live table's newest row, or, with none, the night's
 * newest non-`abandoned` row (M3.6's rule as it was). Exported for its test.
 */
export function drawableLobbyIds(rows: readonly TableRow[], now: Date): string[] {
  const tables = nightTables(rows, now);
  if (tables.length > 0) return tables.map((table) => table.lobby.id);
  let newest: TableRow | null = null;
  for (const row of rows) {
    if (row.status === 'abandoned') continue;
    if (newest === null || Date.parse(row.createdAt) >= Date.parse(newest.createdAt)) newest = row;
  }
  return newest === null ? [] : [newest.id];
}

interface RecentGameRow {
  started_at: string;
  duration_s: number;
  game_players: { players: { puuid: string } | null }[] | null;
}

async function recentGamePuuids(client: ServiceClient, options: ClaimSetOptions): Promise<string[]> {
  const now = (options.now ?? new Date()).getTime();
  const windowStart = now - CLAIM_WINDOW_MS;
  const { data, error } = await client
    .from('games')
    .select('started_at, duration_s, game_players(players!inner(puuid))')
    .eq('group_id', options.groupId)
    .gte('started_at', new Date(windowStart - LONGEST_GAME_MS).toISOString())
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`claimable: recent games lookup failed: ${error.message}`);

  const puuids: string[] = [];
  for (const game of (data ?? []) as unknown as RecentGameRow[]) {
    if (!finishedInWindow(game, windowStart)) continue;
    for (const seat of game.game_players ?? []) {
      if (seat.players !== null) puuids.push(seat.players.puuid);
    }
  }
  return puuids;
}

/** The game's own end, `started_at + duration_s`, at or after the window's start. */
export function finishedInWindow(
  game: { started_at: string; duration_s: number },
  windowStart: number,
): boolean {
  const started = Date.parse(game.started_at);
  if (Number.isNaN(started)) return false;
  return started + game.duration_s * 1000 >= windowStart;
}
