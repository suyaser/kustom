import type { LobbyStatusValue } from '@customs/db';
import { HOST_WINDOW_MS } from './hostPresence';
import type { ServiceClient } from './supabase';
import { tonightStart } from './tonight/night';

/**
 * **Which lobbies are live, and which Kustom is in which** (M22.3, decision rows M22 D4 and D7).
 *
 * A **table** is the night's `lobbies` rows of one `lcu_party_id` in one group: one row per game
 * cycle (M2.14), so "a lobby" across its games. Friends say "lobby"; the code says table so it is
 * never confused with a row. A table is **live** while its newest row is `open`, `balanced` or
 * `in_game`, or `finished` less than {@link TABLE_LINGER_MS} ago (the walk back to the lobby
 * after a game); it ends when its newest row is `abandoned` or `dropped`, or once the linger has
 * passed with no next cycle. **A finished table also ends at once when its Kustoms have moved on**
 * (lead ruling 2026-10-05, "a host's Kustom is in one lobby at a time"): nobody's Kustom watches
 * it any more and a Kustom that was in it has since posted another party ({@link movedOn}). The
 * linger is only for players still in the post-game lobby whose Kustom has not posted elsewhere.
 *
 * A table is **watched** while some token of the group, unrevoked and seen inside
 * {@link HOST_WINDOW_MS}, is in it ({@link tokenWatches}). The lobby route keeps each token's
 * current party (`companion_tokens.current_party_id`, `0050`), written only when it changes.
 *
 * {@link liveTables} is the one reader of "the live lobbies"; every later M22 task reads it and
 * nothing else re-derives them. The lobby route's let-go (`lib/ingest/lobby.ts`) shares
 * {@link selectWatchingTokens} and {@link tokenWatches}, so "watched" means one thing.
 */

/** How long a `finished` table stays live with no next cycle (M22 D4). */
export const TABLE_LINGER_MS = 20 * 60_000;

/** A `lobbies` row as the table fold reads it. */
export interface TableRow {
  id: string;
  lcuPartyId: string;
  status: LobbyStatusValue;
  createdAt: string;
  updatedAt: string;
  reportedByPlayerId: string | null;
  lobbyName: string | null;
}

/** A token that may be watching a table: unrevoked, of the group, seen inside the window. */
export interface WatchingToken {
  tokenId: string;
  playerId: string;
  currentPartyId: string | null;
  currentPartyAt: string | null;
}

/** A `lobby_members` row: who, in which row, since when (the row is kept while they stay, M19.8). */
export interface SeatSeen {
  lobbyId: string;
  playerId: string;
  createdAt: string;
}

export interface LiveTable {
  partyId: string;
  /** The table's newest row: the cycle a one-table Tonight draws. */
  lobby: TableRow;
  /** The tokens in this table, oldest token id first. Empty: nobody's Kustom is in it any more. */
  watchers: { tokenId: string; playerId: string }[];
  /**
   * What a label is made of (OPEN 5 and the lead's M22.2 ruling: the first reporter's name, fixed for
   * the night): the reporter of the table's first row tonight that has one, and the newest row's
   * client lobby name. `hostPlayerId` does not move when a later cycle is first posted by someone else.
   */
  label: { hostPlayerId: string | null; lobbyName: string | null };
  /** Every row of the party in the fold's input, oldest first (M22.7: which table a post's lobby row is). */
  rowIds: string[];
  /** ISO 8601: the party's oldest row in the fold's input, its first tonight (labels number by it). */
  openedAt: string;
}

/**
 * Is a table whose newest row is this one live at `now`? (M22 D4) `movedOn`: its Kustoms have
 * moved to another party ({@link movedOn}), which ends a `finished` table before its linger.
 */
export function isTableLive(
  newest: Pick<TableRow, 'status' | 'updatedAt'>,
  now: Date,
  movedOn = false,
): boolean {
  switch (newest.status) {
    case 'open':
    case 'balanced':
    case 'in_game':
      return true;
    case 'finished':
      // `updated_at` moves when the row becomes `finished` and a finished row takes no more posts
      // (a post for the party opens the next cycle), so it is when the game ended.
      return !movedOn && now.getTime() - Date.parse(newest.updatedAt) < TABLE_LINGER_MS;
    case 'abandoned':
    case 'dropped':
      return false;
  }
}

/**
 * Is this token in the table whose newest row is `lobbyId`? The newest evidence wins:
 *
 * 1. its current party is the table's party (its last lobby post was from there); or
 * 2. its player sits on the newest row's roster and that seat is newer than the token's current
 *    party (or the token has made no lobby post since `0050`): somebody else's Kustom saw them
 *    arrive after their own Kustom last said where it was. This is M22.1's rule, kept for a token
 *    that has not posted yet, and it is what still holds a co-host whose Kustom sits quietly in
 *    the lobby. A co-host whose Kustom posted another party after taking the seat is not in it.
 *
 * `seats` holds the roster rows of the table's newest row (other rows are ignored).
 */
export function tokenWatches(
  token: WatchingToken,
  table: { partyId: string; lobbyId: string },
  seats: readonly SeatSeen[],
  options: { seatCounts?: boolean } = {},
): boolean {
  if (token.currentPartyId === table.partyId) return true;
  if (options.seatCounts === false) return false;
  const seat = seats.find((row) => row.lobbyId === table.lobbyId && row.playerId === token.playerId);
  if (seat === undefined) return false;
  return token.currentPartyAt === null || Date.parse(token.currentPartyAt) < Date.parse(seat.createdAt);
}

/**
 * Have the Kustoms of the finished table whose newest row is `lobbyId` moved on? True when no token
 * watches it (`watchers` empty) and some token **was in it** (its player sits on the newest row's
 * roster) and has posted another party since the game ended (`current_party_at` after the row's
 * `updated_at`). A table no Kustom was ever seen in, or whose Kustoms have posted nothing since,
 * keeps its linger. Only meaningful for a `finished` row.
 */
export function movedOn(
  table: { partyId: string; lobbyId: string; endedAt: string },
  watchers: readonly unknown[],
  tokens: readonly WatchingToken[],
  seats: readonly SeatSeen[],
): boolean {
  if (watchers.length > 0) return false;
  const ended = Date.parse(table.endedAt);
  return tokens.some(
    (token) =>
      token.currentPartyId !== null &&
      token.currentPartyId !== table.partyId &&
      token.currentPartyAt !== null &&
      Date.parse(token.currentPartyAt) >= ended &&
      seats.some((seat) => seat.lobbyId === table.lobbyId && seat.playerId === token.playerId),
  );
}

/**
 * The fold, pure: `rows` are the group's rows of every candidate party, enough of them that each
 * party's newest row is among them; `tokens` the group's {@link WatchingToken}s; `seats` the roster
 * rows of those tokens' players in the newest rows. Tables come oldest newest-row first.
 *
 * The label's host is the reporter of the party's oldest row in `rows` that has one (the first
 * reporter), so pass every row of the night for the label to be the night's first reporter.
 */
export function foldLiveTables(
  rows: readonly TableRow[],
  tokens: readonly WatchingToken[],
  seats: readonly SeatSeen[],
  now: Date,
): LiveTable[] {
  const newestByParty = new Map<string, TableRow>();
  const firstReported = new Map<string, TableRow>();
  const ownRows = new Map<string, TableRow[]>();
  for (const row of rows) {
    const own = ownRows.get(row.lcuPartyId) ?? [];
    own.push(row);
    ownRows.set(row.lcuPartyId, own);
    const held = newestByParty.get(row.lcuPartyId);
    if (held === undefined || isNewer(row, held)) newestByParty.set(row.lcuPartyId, row);
    if (row.reportedByPlayerId === null) continue;
    const first = firstReported.get(row.lcuPartyId);
    if (first === undefined || isNewer(first, row)) firstReported.set(row.lcuPartyId, row);
  }
  const newest = [...newestByParty.values()].sort((a, b) => (isNewer(a, b) ? 1 : isNewer(b, a) ? -1 : 0));
  return newest.flatMap((lobby) => {
    const table = { partyId: lobby.lcuPartyId, lobbyId: lobby.id };
    const watchers = tokens
      .filter((token) => tokenWatches(token, table, seats))
      .map((token) => ({ tokenId: token.tokenId, playerId: token.playerId }))
      .sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0));
    const moved =
      lobby.status === 'finished' && movedOn({ ...table, endedAt: lobby.updatedAt }, watchers, tokens, seats);
    if (!isTableLive(lobby, now, moved)) return [];
    const own = [...(ownRows.get(lobby.lcuPartyId) ?? [lobby])].sort((a, b) =>
      isNewer(a, b) ? 1 : isNewer(b, a) ? -1 : 0,
    );
    return {
      partyId: lobby.lcuPartyId,
      lobby,
      watchers,
      label: {
        hostPlayerId: firstReported.get(lobby.lcuPartyId)?.reportedByPlayerId ?? null,
        lobbyName: lobby.lobbyName,
      },
      rowIds: own.map((row) => row.id),
      openedAt: own[0]?.createdAt ?? lobby.createdAt,
    };
  });
}

/** Newer by `created_at`, then by id: the same order Tonight's `newestLobby` keeps, made total. */
function isNewer(a: TableRow, b: TableRow): boolean {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  return at !== bt ? at > bt : a.id > b.id;
}

/** The group's tokens that may be watching anything: unrevoked and seen inside {@link HOST_WINDOW_MS}. */
export async function selectWatchingTokens(
  client: ServiceClient,
  groupId: string,
  now: Date,
): Promise<WatchingToken[]> {
  const seenSince = new Date(now.getTime() - HOST_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from('companion_tokens')
    .select('id, player_id, current_party_id, current_party_at')
    .eq('group_id', groupId)
    .is('revoked_at', null)
    .gte('last_seen_at', seenSince);
  if (error) throw new Error(`liveTables: token select failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    tokenId: row.id,
    playerId: row.player_id,
    currentPartyId: row.current_party_id,
    currentPartyAt: row.current_party_at,
  }));
}

/** The roster rows of `playerIds` in `lobbyIds`, for {@link tokenWatches}. No read when either is empty. */
export async function selectSeats(
  client: ServiceClient,
  lobbyIds: readonly string[],
  playerIds: readonly string[],
): Promise<SeatSeen[]> {
  if (lobbyIds.length === 0 || playerIds.length === 0) return [];
  const { data, error } = await client
    .from('lobby_members')
    .select('lobby_id, player_id, created_at')
    .in('lobby_id', [...new Set(lobbyIds)])
    .in('player_id', [...new Set(playerIds)]);
  if (error) throw new Error(`liveTables: seat select failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    lobbyId: row.lobby_id,
    playerId: row.player_id,
    createdAt: row.created_at,
  }));
}

const TABLE_COLUMNS = 'id, lcu_party_id, status, created_at, updated_at, reported_by_player_id, lobby_name';

/**
 * The group's live tables at `now` (M22 D4), each with its newest row, who is watching it, and its
 * label inputs. Tonight's tables only: rows created since `nightStart` (default: the 06:00 boundary
 * of the night containing `now`, Tonight's own window, `lib/tonight/night.ts`), so the label's host
 * is the night's first reporter of the party and a party's rows from an earlier night do not count.
 *
 * Three reads, the first two at once: tonight's candidate rows (live statuses, or `finished` inside
 * the linger) and the group's watching tokens; then every row of the candidate parties tonight (a
 * newer row of a party ends or replaces its candidate; the oldest names the host); then the tokens'
 * seats in the newest rows (skipped when no token is up).
 */
export async function liveTables(
  client: ServiceClient,
  groupId: string,
  now: Date,
  options: { nightStart?: Date } = {},
): Promise<LiveTable[]> {
  const nightStart = (options.nightStart ?? tonightStart(now)).toISOString();
  const lingerSince = new Date(now.getTime() - TABLE_LINGER_MS).toISOString();
  const [candidates, tokens] = await Promise.all([
    client
      .from('lobbies')
      .select('lcu_party_id')
      .eq('group_id', groupId)
      .gte('created_at', nightStart)
      .or(`status.in.(open,balanced,in_game),and(status.eq.finished,updated_at.gte."${lingerSince}")`),
    selectWatchingTokens(client, groupId, now),
  ]);
  if (candidates.error) throw new Error(`liveTables: candidate select failed: ${candidates.error.message}`);
  const parties = [...new Set((candidates.data ?? []).map((row) => row.lcu_party_id))];
  if (parties.length === 0) return [];

  const { data, error } = await client
    .from('lobbies')
    .select(TABLE_COLUMNS)
    .eq('group_id', groupId)
    .in('lcu_party_id', parties)
    .gte('created_at', nightStart);
  if (error) throw new Error(`liveTables: table select failed: ${error.message}`);
  const rows: TableRow[] = (data ?? []).map((row) => ({
    id: row.id,
    lcuPartyId: row.lcu_party_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reportedByPlayerId: row.reported_by_player_id,
    lobbyName: row.lobby_name,
  }));

  // The seats only matter for the newest rows of live tables; fold once without them to find those.
  const unseated = foldLiveTables(rows, [], [], now);
  const seats = await selectSeats(
    client,
    unseated.map((table) => table.lobby.id),
    tokens.map((token) => token.playerId),
  );
  return foldLiveTables(rows, tokens, seats, now);
}
