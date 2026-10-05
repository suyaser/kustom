import type { ModeLock, ModeRow } from '@customs/core';
import type { LobbyStatusValue } from '@customs/db';
import {
  DEFAULT_GROUP_MODE,
  type GroupMode,
  NEW_GROUP_MODE,
  parseGroupMode,
  type RuleCheck,
  ruleCheckSchema,
  ruleModeOf,
} from '@customs/db/schemas';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { MIN_RATED_DURATION_S } from '../lobbyRules';
import type { PublicClient } from '../publicClient';
import { pickTable } from '../tonight/selection';
import { nightTables, tablesOverlapped } from '../tonight/tables';
import { loadCheckNames } from './clientNames';
import { readGroupModeRow } from './load';
import { LOCK_COLUMNS, modeLockOf } from './lock';
import { rowFromColumns } from './state';
import type { GameStampView } from './types';

/**
 * Tonight's reads of the Mode card's M15 facts (M15.5), with the anon key: `0032` grants anon the
 * card state on `group_modes`, the lock on `lobbies` and the stamp on `games`. Each read is its
 * own query and **never throws**: a failure logs and answers "nothing" (no pending rule, no lock,
 * no stamp), so a page never 500s over a rule and a database one migration behind still renders.
 */

export async function loadModeState(client: PublicClient, groupId: string): Promise<ModeRow | null> {
  // The same row the fearless pool reads, once per render (`readGroupModeRow`).
  const { data, error } = await readGroupModeRow(client, groupId);
  if (error) {
    console.error('mode: reading the card state failed', error.message);
    return null;
  }
  return data === null ? null : rowFromColumns(data);
}

export async function loadLobbyLock(client: PublicClient, lobbyId: string): Promise<ModeLock | null> {
  const { data, error } = await client.from('lobbies').select(LOCK_COLUMNS).eq('id', lobbyId).maybeSingle();
  if (error) {
    console.error('mode: reading the lobby lock failed', error.message);
    return null;
  }
  return data === null ? null : modeLockOf(data);
}

/**
 * The lobby Tonight draws, with its status and lock, for the mode panel, which shows what the card
 * shows without reading the whole night. Null with none or on failure.
 *
 * M22.5: the drawn lobby is a live table's (`lib/tonight/tables.ts`): table `lobbyId` (any of its
 * rows tonight, `?lobby=`) when it is live, else the most recently changed; with no live table the
 * night's newest non-`abandoned` row, as before. One read, as before (tonight's rows of the group).
 */
export async function loadTonightLobbyLock(
  client: PublicClient,
  groupId: string,
  nightStart: Date,
  options: { lobbyId?: string | null; now?: Date } = {},
): Promise<{
  status: LobbyStatusValue;
  lock: ModeLock | null;
  /** M22.6: the drawn row's party and how many tables are live (the panel's per-lobby card). */
  partyId: string;
  liveTables: number;
  /** M22.12: two tables overlapped tonight (`tablesOverlapped`): the last one may hold a fork. */
  overlapped: boolean;
} | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(
      `id, lcu_party_id, status, created_at, updated_at, reported_by_player_id, lobby_name, ${LOCK_COLUMNS}`,
    )
    .eq('group_id', groupId)
    .gte('created_at', nightStart.toISOString());
  if (error) {
    console.error('mode: reading tonight lobby lock failed', error.message);
    return null;
  }
  const rows = data ?? [];
  const tableRows = rows.map((row) => ({
    id: row.id,
    lcuPartyId: row.lcu_party_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reportedByPlayerId: row.reported_by_player_id,
    lobbyName: row.lobby_name,
  }));
  const now = options.now ?? new Date();
  const tables = nightTables(tableRows, now);
  const picked = pickTable(
    tables.map((table) => ({
      id: table.lobby.id,
      rowIds: table.rowIds,
      openedAt: table.openedAt,
      changedAt: table.changedAt,
    })),
    { requested: options.lobbyId ?? null },
  );
  let drawn: (typeof rows)[number] | null = null;
  if (picked !== null) drawn = rows.find((row) => row.id === picked) ?? null;
  else {
    for (const row of rows) {
      if (row.status === 'abandoned') continue;
      if (drawn === null || Date.parse(row.created_at) >= Date.parse(drawn.created_at)) drawn = row;
    }
  }
  return drawn === null
    ? null
    : {
        status: drawn.status,
        lock: modeLockOf(drawn),
        partyId: drawn.lcu_party_id,
        liveTables: tables.length,
        overlapped: tablesOverlapped(tableRows, now),
      };
}

/** The `games` columns a stamp is made of; Tonight reads them with the rest of the game row. */
export const GAME_STAMP_COLUMNS =
  'duration_s, gameMode:game_mode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated, rule_checked, rule_check, void_reason' as const;

export interface GameStampRow {
  duration_s: number;
  gameMode: unknown;
  rule: string | null;
  rule_class_tag: string | null;
  rule_region_blue: string | null;
  rule_region_red: string | null;
  rated: boolean;
  rule_checked: boolean;
  rule_check: unknown;
  /** M23.2 (`0052`): why it was voided; absent in older fixtures, read as not voided. */
  void_reason?: string | null;
}

/** The stored rule check of a stamp row, or null (not checked, or a check this build cannot parse, logged). */
export function stampCheck(gameId: string, data: GameStampRow): RuleCheck | null {
  const check = data.rule_checked ? ruleCheckSchema.safeParse(data.rule_check) : null;
  if (check !== null && !check.success) console.error('mode: a stored rule check did not parse', gameId);
  return check?.success ? check.data : null;
}

/** The stamp from its row, its parsed check and the client's names for that check. Pure. */
export function stampFromRow(
  data: GameStampRow,
  check: RuleCheck | null,
  names: Readonly<Record<number, string>>,
): GameStampView {
  return {
    rule: ruleModeOf({
      rule: data.rule,
      classTag: data.rule_class_tag,
      regionBlue: data.rule_region_blue,
      regionRed: data.rule_region_red,
    }),
    rated: data.rated,
    // ARAM and remakes are never rated anyway, and say nothing about it (the existing rule).
    rift:
      matchesQueue(gameModeFromRaw({ gameMode: data.gameMode }), 'sr') &&
      data.duration_s > MIN_RATED_DURATION_S,
    check,
    ...(data.void_reason == null ? {} : { voidReason: data.void_reason }),
    ...(Object.keys(names).length === 0 ? {} : { names }),
  };
}

export async function loadGameStamp(client: PublicClient, gameId: string): Promise<GameStampView | null> {
  const { data, error } = await client
    .from('games')
    .select(GAME_STAMP_COLUMNS)
    .eq('id', gameId)
    .maybeSingle();
  if (error) {
    console.error('mode: reading the game stamp failed', error.message);
    return null;
  }
  if (data === null) return null;
  const check = stampCheck(gameId, data);
  return stampFromRow(data, check, await loadCheckNames(client, gameId, check));
}

/**
 * The group's `group_modes` row read **once** for both of Tonight's uses (performance plan, phase
 * 2): the standing mode and when it was set, as {@link loadGroupModeState} answers it (the fearless
 * pool and the card's "Normal mode now." note), and the card state, as {@link loadModeState}
 * answers it. Never throws, and each half keeps its own fallback: a failed read is the default
 * mode with no `since` and no card state; a missing row is a new group's mode and no card state.
 */
export async function loadModeFacts(
  client: PublicClient,
  groupId: string,
): Promise<{
  standing: { mode: GroupMode; since: string | null };
  state: ModeRow | null;
  failed: boolean;
}> {
  // The one read of the row per render (`readGroupModeRow`, audit defect 10).
  const { data, error } = await readGroupModeRow(client, groupId);
  if (error) {
    console.error('mode: reading the group mode failed', error.message);
    return { standing: { mode: DEFAULT_GROUP_MODE, since: null }, state: null, failed: true };
  }
  if (data === null) return { standing: { mode: NEW_GROUP_MODE, since: null }, state: null, failed: false };
  return {
    standing: { mode: parseGroupMode(data.mode), since: data.updated_at },
    state: rowFromColumns(data),
    failed: false,
  };
}
