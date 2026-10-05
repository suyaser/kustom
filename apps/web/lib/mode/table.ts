import type { RowPatch } from '@customs/core';
import type { Database } from '@customs/db';
import { inPlay, type LiveTable, liveTablesWithTokens } from '../liveTables';
import type { ServiceClient } from '../supabase';
import { tonightStart } from '../tonight/night';
import {
  columnsOfPatch,
  type ModeStore,
  type ModeWriter,
  pendingOf,
  readModeRow,
  type StoredModeRow,
  supabaseModeStore,
} from './state';

/**
 * **Which card a lobby's mode reads and writes** (M22.4, decision rows M22 D5 and the 2026-10-05
 * "M22.2 rulings"; `0051`). A table (M22 D4, `lib/liveTables.ts`) whose first row was created while
 * another table of the group was live is **forked**: the database copied the group's card into a
 * `lobby_modes` row for it (`lobbies_fork_mode`), and its pending rule, region pair and Rated live
 * there. The standing mode (Normal or Fearless) and its ban list stay group-wide on `group_modes`.
 * A table with no row reads and writes `group_modes`.
 *
 * **One lobby is exactly today (M22 D2).** With no `lobby_modes` row in the group (every night with
 * one lobby: the trigger never forks the first table), {@link GROUP_TABLE} comes back after one
 * read, and every caller takes the code path it had before M22: the same queries, unfiltered by
 * party, the same `group_modes` writes, the same `mode_take` and `mode_hand_back`.
 *
 * **In play** is `lib/liveTables.ts`' `inPlay`, the one rule: a live table (M22.5's fold) with a
 * Kustom in it by its current party. A finished table inside its 20 minutes that nobody's Kustom is
 * in any more still shows on Tonight but never forks a new one and never needs a `lobbyId`: one
 * host moving on is one lobby, exactly today. The fork trigger (`lobbies_fork_mode`) asks the same.
 *
 * With a row, the server **settles** first ({@link settleForks}): the rows of tables that ended are
 * deleted and, with exactly one table in play, its row is **folded** onto `group_modes`
 * (`lobby_modes_settle` -> `lobby_mode_fold`), unless that table holds a live lock (the lock's
 * hand-back must still find its row; a later settle folds). Settling runs on every mode read and
 * write of a forked night, so the fold happens within the next settle after the other table ended;
 * Tonight's reader can show the same card before that with {@link cardSourceOf}.
 *
 * Core's `transition`, `take`, `handBack` and `recordGame` are unchanged: the row is their input
 * whichever table it came from. This file only routes storage.
 */

/** A table's card: where its pending rule, pair and Rated are. */
export interface ModeTable {
  /**
   * The table's party, for the reads that pick "this game" (the lock, Spin's previous rule, an
   * open lobby): filtered to it. Null on the one-lobby path (no fork tonight): those reads stay
   * group-wide, exactly as before M22.
   */
  partyId: string | null;
  /** The pending rule, pair and Rated are on the table's `lobby_modes` row (else `group_modes`). */
  forked: boolean;
}

/** No fork tonight: the group's card, every read group-wide (today's path). */
export const GROUP_TABLE: ModeTable = { partyId: null, forked: false };

/** The refusal for an action that names no lobby while two are live, or one that is not live. */
export const PICK_A_LOBBY = 'pick-a-lobby' as const;

/**
 * Which table a mode action is for, pure: `live` the group's live tables, `playing` the parties of
 * those in play (`inPlay`), `forked` the parties with a fresh `lobby_modes` row after the settle,
 * `partyId` the table the caller named (null: none).
 *
 * - A party named: its own row when forked, else `group_modes` filtered to it while it is live.
 * - None named (or one that is not live): the only table in play; the group's card when none is;
 *   {@link PICK_A_LOBBY} when two or more are.
 */
export function tableOf(
  live: readonly Pick<LiveTable, 'partyId'>[],
  playing: ReadonlySet<string>,
  forked: ReadonlySet<string>,
  partyId: string | null,
): ModeTable | typeof PICK_A_LOBBY {
  if (partyId !== null) {
    if (forked.has(partyId)) return { partyId, forked: true };
    if (live.some((table) => table.partyId === partyId)) return { partyId, forked: false };
  }
  const inPlayNow = live.filter((table) => playing.has(table.partyId));
  if (inPlayNow.length >= 2) return PICK_A_LOBBY;
  const only = inPlayNow[0];
  if (only === undefined) return GROUP_TABLE;
  return { partyId: only.partyId, forked: forked.has(only.partyId) };
}

/**
 * The card each live table shows, pure, for a reader that cannot settle (Tonight, anon): a table
 * with a fresh row shows it; so does the only live table when its row is not folded yet (the fold
 * is what the next server call writes); every other table shows `group_modes`. Rows of tables
 * that are not live are ignored.
 */
export function cardSourceOf(
  live: readonly Pick<LiveTable, 'partyId'>[],
  forked: ReadonlySet<string>,
): Map<string, 'group' | 'lobby'> {
  return new Map(live.map((table) => [table.partyId, forked.has(table.partyId) ? 'lobby' : 'group']));
}

/** A `lobby_modes` row's key and age. */
interface ForkRef {
  partyId: string;
  createdAt: string;
}

/** The group's `lobby_modes` rows (key and age only). Empty on every one-lobby night. */
export async function readForks(client: ServiceClient, groupId: string): Promise<ForkRef[]> {
  const { data, error } = await client
    .from('lobby_modes')
    .select('lcu_party_id, created_at')
    .eq('group_id', groupId);
  if (error) throw new Error(`mode table: fork read failed: ${error.message}`);
  return (data ?? []).map((row) => ({ partyId: row.lcu_party_id, createdAt: row.created_at }));
}

/**
 * Settle a forked night: read the live tables, delete the rows of ended tables (and an earlier
 * night's), fold the row of the only table in play. Answers the live tables and the parties still
 * forked.
 */
export async function settleForks(
  client: ServiceClient,
  groupId: string,
  now: Date,
): Promise<{ live: LiveTable[]; playing: Set<string>; forked: Set<string> }> {
  const since = tonightStart(now);
  const { tables: live, tokens } = await liveTablesWithTokens(client, groupId, now, { nightStart: since });
  const parties = live.map((table) => table.partyId);
  const playing = live.filter((table) => inPlay(table, tokens));
  const { data: folded, error } = await client.rpc('lobby_modes_settle', {
    p_group_id: groupId,
    p_live_parties: parties,
    // The generated types mark every argument non-null; the function takes a null party.
    p_fold_party: (playing.length === 1 ? playing[0]?.partyId : null) as string,
    p_since: since.toISOString(),
  });
  if (error) throw new Error(`mode table: settle failed: ${error.message}`);
  const forks = await readForks(client, groupId);
  const forked = new Set(
    forks
      .filter((fork) => fork.partyId !== folded && Date.parse(fork.createdAt) >= since.getTime())
      .map((fork) => fork.partyId),
  );
  return { live, playing: new Set(playing.map((table) => table.partyId)), forked };
}

/**
 * The table for a server path that knows its lobby's party (Roll, the start lock, the record, the
 * teams post): today's {@link GROUP_TABLE} when nothing is forked; otherwise the party's own row,
 * or `group_modes` filtered to the party.
 */
export async function modeTableOfParty(
  client: ServiceClient,
  groupId: string,
  partyId: string | null,
  now: Date,
): Promise<ModeTable> {
  if (partyId === null) return GROUP_TABLE;
  if ((await readForks(client, groupId)).length === 0) return GROUP_TABLE;
  const { live, playing, forked } = await settleForks(client, groupId, now);
  const table = tableOf(live, playing, forked, partyId);
  return table === PICK_A_LOBBY ? { partyId, forked: false } : table;
}

/** As {@link modeTableOfParty}, from a lobby id (one read of its party, only on a forked night). */
export async function modeTableOfLobby(
  client: ServiceClient,
  groupId: string,
  lobbyId: string,
  now: Date,
): Promise<ModeTable> {
  if ((await readForks(client, groupId)).length === 0) return GROUP_TABLE;
  const partyId = await partyOfLobby(client, groupId, lobbyId);
  if (partyId === null) return GROUP_TABLE;
  const { live, playing, forked } = await settleForks(client, groupId, now);
  const table = tableOf(live, playing, forked, partyId);
  return table === PICK_A_LOBBY ? { partyId, forked: false } : table;
}

/**
 * The table for the card route (`POST /api/admin/mode`): `lobbyId` from the body, or none.
 * {@link PICK_A_LOBBY} when none is named (or a lobby of no live table) while two are live, or a
 * lobby that is not this group's on a forked night.
 */
export async function modeTableForRoute(
  client: ServiceClient,
  groupId: string,
  lobbyId: string | undefined,
  now: Date,
): Promise<ModeTable | typeof PICK_A_LOBBY> {
  if ((await readForks(client, groupId)).length === 0) return GROUP_TABLE;
  let partyId: string | null = null;
  if (lobbyId !== undefined) {
    partyId = await partyOfLobby(client, groupId, lobbyId);
    if (partyId === null) return PICK_A_LOBBY;
  }
  const { live, playing, forked } = await settleForks(client, groupId, now);
  return tableOf(live, playing, forked, partyId);
}

async function partyOfLobby(client: ServiceClient, groupId: string, lobbyId: string): Promise<string | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('lcu_party_id')
    .eq('id', lobbyId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`mode table: lobby read failed: ${error.message}`);
  return data?.lcu_party_id ?? null;
}

// ---------------------------------------------------------------------------
// The card store of a table
// ---------------------------------------------------------------------------

const LOBBY_MODE_COLUMNS =
  'pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at' as const;

interface LobbyModeColumns {
  pending_rule: string | null;
  pending_class_tag: string | null;
  pending_region_blue: string | null;
  pending_region_red: string | null;
  rated_override: boolean | null;
  updated_at: string;
}

type LobbyModeUpdate = Database['public']['Tables']['lobby_modes']['Update'];

/** The group's standing mode and a forked row as one card (the row's `updated_at`: it is the table's card). */
function storedOfFork(group: StoredModeRow, fork: LobbyModeColumns): StoredModeRow {
  return {
    row: { standing: group.row.standing, pending: pendingOf(fork), rated: fork.rated_override },
    exists: true,
    updatedAt: fork.updated_at,
  };
}

async function readFork(
  client: ServiceClient,
  groupId: string,
  partyId: string,
): Promise<LobbyModeColumns | null> {
  const { data, error } = await client
    .from('lobby_modes')
    .select(LOBBY_MODE_COLUMNS)
    .eq('group_id', groupId)
    .eq('lcu_party_id', partyId)
    .maybeSingle();
  if (error) throw new Error(`mode table: card read failed: ${error.message}`);
  return data;
}

/** The table's card as core's row: `group_modes` unless forked. */
export async function readTableModeRow(
  client: ServiceClient,
  groupId: string,
  table: ModeTable,
): Promise<StoredModeRow> {
  if (!table.forked || table.partyId === null) return readModeRow(client, groupId);
  const [group, fork] = await Promise.all([
    readModeRow(client, groupId),
    readFork(client, groupId, table.partyId),
  ]);
  // Folded since the table was resolved: the table reads group_modes now.
  return fork === null ? group : storedOfFork(group, fork);
}

/**
 * The {@link ModeStore} of a table: today's `group_modes` store unless forked. A forked table's
 * write is split by owner: the standing mode to `group_modes` (`mode`, `set_by`: group-wide), the
 * pending rule, pair and Rated to its row. Every admin write lands on the row too (`set_by`), so
 * its `updated_at` passes a lock's `locked_at` exactly as `group_modes`' does on the one-lobby path
 * (M20.7's "an admin write after the lock wins", per table). A row folded in between sends the
 * whole patch to `group_modes`, where the table's card now is.
 */
export function tableModeStore(client: ServiceClient, table: ModeTable): ModeStore {
  const groupStore = supabaseModeStore(client);
  const partyId = table.partyId;
  if (!table.forked || partyId === null) return groupStore;
  return {
    read: (groupId) => readTableModeRow(client, groupId, table),

    async write(groupId, patch: RowPatch, writer: ModeWriter) {
      const { standing, ...rest } = patch;
      const forkColumns: LobbyModeUpdate = columnsOfPatch(rest, writer);
      let fork: LobbyModeColumns | null = null;
      if (Object.keys(forkColumns).length > 0) {
        const { data, error } = await client
          .from('lobby_modes')
          .update(forkColumns)
          .eq('group_id', groupId)
          .eq('lcu_party_id', partyId)
          .select(LOBBY_MODE_COLUMNS);
        if (error) throw new Error(`mode table: card update failed: ${error.message}`);
        fork = data?.[0] ?? null;
        if (fork === null) return groupStore.write(groupId, patch, writer);
      } else {
        fork = await readFork(client, groupId, partyId);
        if (fork === null) return groupStore.write(groupId, patch, writer);
      }
      const group =
        standing === undefined
          ? await readModeRow(client, groupId)
          : await groupStore.write(groupId, { standing }, writer);
      return storedOfFork(group, fork);
    },
  };
}
