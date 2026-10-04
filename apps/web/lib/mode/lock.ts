import {
  type ChampionTable,
  type LockedMode,
  lockRated,
  type ModeLock,
  type ModeRow,
  type Rng,
  type TakeRegions,
  take,
} from '@customs/core';
import { parseGroupMode, ruleColumnsOf, ruleModeOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { modeContext } from './context';
import { readModeRow } from './state';

/**
 * This game: the lobby's lock (M20.7, `0047`; core's `ModeLock`). Roll **moves** the card's
 * pending rule (with its region pair) and Rated onto the lock and empties them on the row in one
 * transaction (`mode_take`), so anything chosen after Roll is the next game's. Core's `take`
 * decides what is locked: a region pair still drawable under tonight's bans as it is, a pair the
 * bans made short redrawn (`redrawn`, the card's notice), and with no pair at all the standing mode
 * with Rated copied and the rule left pending (`no-draw`, M20 D6 (d) as amended 2026-10-05).
 *
 * - **Reroll** never touches the lobby row, so it keeps the lock, region pair included.
 * - **Teams coming down** (`balanced -> open`) hand the lock back into the row's empty fields and
 *   drop it, in the database (`lobbies_drop_mode_lock` -> `mode_hand_back`), whoever writes the
 *   status.
 * - **Rolling is a suggestion** (owner, 2026-10-05): a live lobby with no lock takes one when its
 *   game starts, or at the end-of-game block when no start was heard ({@link lockLobbyAtStart}).
 *
 * `games.mode` keeps meaning the standing mode, which the lock stores beside the rule.
 */

export interface StoredLock {
  lock: ModeLock;
  /** `lobbies.locked_at`; null on a read that did not ask for it. */
  lockedAt: string | null;
}

export const LOCK_COLUMNS =
  'lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, locked_at' as const;

export interface LockRow {
  lock_mode: string | null;
  lock_rule: string | null;
  lock_class_tag: string | null;
  lock_region_blue: string | null;
  lock_region_red: string | null;
  lock_rated: boolean | null;
  locked_at?: string | null;
}

/** The lock columns as core's lock, or null for no lock (keyed on `lock_mode`) or one this build cannot read. */
export function modeLockOf(row: LockRow): ModeLock | null {
  if (row.lock_mode === null) return null;
  const standing = parseGroupMode(row.lock_mode);
  if (row.lock_rule === null) return { standing, mode: { id: standing }, rated: row.lock_rated };
  const rule = ruleModeOf({
    rule: row.lock_rule,
    classTag: row.lock_class_tag,
    regionBlue: row.lock_region_blue,
    regionRed: row.lock_region_red,
  });
  return rule === null ? null : { standing, mode: rule, rated: row.lock_rated };
}

export function storedLockOf(row: LockRow): StoredLock | null {
  const lock = modeLockOf(row);
  return lock === null ? null : { lock, lockedAt: row.locked_at ?? null };
}

/** The lobby's lock, or null. */
export async function readLobbyLock(client: ServiceClient, lobbyId: string): Promise<StoredLock | null> {
  const { data, error } = await client.from('lobbies').select(LOCK_COLUMNS).eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`mode lock: lobby read failed: ${error.message}`);
  return data === null ? null : storedLockOf(data);
}

/** What a take did: the lock in force, what Roll did with a region pair, and whether this call wrote. */
export interface TakeOutcome {
  stored: StoredLock | null;
  /** Core's region outcome for the lock this call wrote; null when it wrote none or no region was pending. */
  regions: TakeRegions | null;
  wrote: boolean;
}

/** Re-reads after an admin wrote between the read and the move (a tap storm, not a normal night). */
export const TAKE_ATTEMPTS = 5;

/**
 * Core's `take` onto the lobby: read the row, decide the lock, and move it in one transaction that
 * only lands if the row is still what was read (`mode_take` answers `stale` otherwise and this
 * re-reads). So an admin's pick racing Roll ends in the lock (it landed first) or still pending
 * (it landed after), never lost. A lobby that already has a lock keeps it.
 */
async function takeOnto(
  client: ServiceClient,
  input: {
    lobbyId: string;
    groupId: string;
    statuses: readonly string[];
    rng?: Rng;
    table?: ChampionTable;
    /** False at game start: the pair everyone saw on the card is locked as it is. */
    bans?: boolean;
  },
): Promise<TakeOutcome> {
  for (let attempt = 0; attempt < TAKE_ATTEMPTS; attempt += 1) {
    const existing = await readLobbyLock(client, input.lobbyId);
    if (existing !== null) return { stored: existing, regions: null, wrote: false };

    const { row } = await readModeRow(client, input.groupId);
    const needsBans = row.pending?.id === 'region';
    const context = await modeContext(client, input.groupId, needsBans ? row.standing : 'normal', {
      ...(input.rng === undefined ? {} : { rng: input.rng }),
      ...(input.table === undefined ? {} : { table: input.table }),
      ...(input.bans === undefined ? {} : { bans: input.bans }),
    });
    const taken = take(row, context);
    const answer = await callTake(client, input, row, taken.lock, Object.keys(taken.patch).length > 0);
    if (answer === 'locked') {
      return {
        stored: (await readLobbyLock(client, input.lobbyId)) ?? { lock: taken.lock, lockedAt: null },
        regions: taken.regions,
        wrote: true,
      };
    }
    if (answer === 'exists') return { stored: await readLobbyLock(client, input.lobbyId), regions: null, wrote: false };
  }
  throw new Error(`mode lock: ${TAKE_ATTEMPTS} takes in a row found the card changed for lobby ${input.lobbyId}`);
}

/** The generated types mark every RPC argument required and non-null; the functions take nulls. */
const nullable = <T>(value: T | null): T => value as T;

async function callTake(
  client: ServiceClient,
  input: { lobbyId: string; groupId: string; statuses: readonly string[] },
  row: ModeRow,
  lock: ModeLock,
  emptyRow: boolean,
): Promise<'locked' | 'stale' | 'exists'> {
  const read = row.pending === null ? null : ruleColumnsOf(row.pending);
  const locked = ruleColumnsOf(lock.mode);
  const { data, error } = await client.rpc('mode_take', {
    p_lobby_id: input.lobbyId,
    p_group_id: input.groupId,
    p_statuses: [...input.statuses],
    p_read_standing: row.standing,
    p_read_rule: nullable(read?.rule ?? null),
    p_read_class_tag: nullable(read?.classTag ?? null),
    p_read_region_blue: nullable(read?.regionBlue ?? null),
    p_read_region_red: nullable(read?.regionRed ?? null),
    p_read_rated: nullable(row.rated),
    p_lock_mode: lock.standing,
    p_lock_rule: nullable(locked.rule),
    p_lock_class_tag: nullable(locked.classTag),
    p_lock_region_blue: nullable(locked.regionBlue),
    p_lock_region_red: nullable(locked.regionRed),
    p_lock_rated: nullable(lock.rated),
    p_empty_row: emptyRow,
  });
  if (error) throw new Error(`mode lock: take failed: ${error.message}`);
  if (data !== 'locked' && data !== 'stale' && data !== 'exists') {
    throw new Error(`mode lock: take answered ${String(data)}`);
  }
  return data;
}

/**
 * Lock the lobby at Roll (the roll calls this once it owns the lobby at `balanced`). A lobby that
 * already has a lock keeps it (a roll repair). `onWrite` runs when this call wrote the lock.
 */
export async function lockLobbyAtRoll(
  client: ServiceClient,
  input: {
    lobbyId: string;
    groupId: string;
    now: Date;
    rng: Rng;
    table?: ChampionTable;
    onWrite?: () => void;
  },
): Promise<TakeOutcome> {
  const outcome = await takeOnto(client, {
    lobbyId: input.lobbyId,
    groupId: input.groupId,
    statuses: ['balanced'],
    rng: input.rng,
    ...(input.table === undefined ? {} : { table: input.table }),
  });
  if (outcome.wrote) input.onWrite?.();
  return outcome;
}

/** Lobby statuses a game can still be starting or landing from: a lock taken there is this game's. */
const PLAYABLE_STATUSES = ['open', 'balanced', 'in_game'] as const;

export function isPlayableStatus(status: string): boolean {
  return (PLAYABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The lock for the game actually played (owner bug 2026-10-04, decision row 2026-10-05 "Rolling is
 * a suggestion"): a lobby whose teams were made by hand has no lock (never rolled, or the rolled
 * teams came down and handed it back), so it takes one from the card when its game starts
 * (`in_progress`), or at the end-of-game block when no start was heard: core's `take`, as at Roll,
 * so the pending rule and Rated are this game's and leave the row. Region wars locks the pair the
 * card shows as it is (no bans counted: champion select is over, so a redraw would name sides
 * nobody played to). A lock already there (Roll) is kept, so R9 holds.
 *
 * Only a lobby still `open`, `balanced` or `in_game`: a `finished` or `dropped` lobby's game was
 * played long before the card the server would read now. Returns the lock in force, or null.
 * `onWrite` runs when this call wrote the lock (Tonight's live signal).
 */
export async function lockLobbyAtStart(
  client: ServiceClient,
  input: { lobbyId: string; groupId: string; status: string; now: Date; onWrite?: () => void },
): Promise<StoredLock | null> {
  if (!isPlayableStatus(input.status)) return readLobbyLock(client, input.lobbyId);
  const outcome = await takeOnto(client, {
    lobbyId: input.lobbyId,
    groupId: input.groupId,
    statuses: PLAYABLE_STATUSES,
    bans: false,
  });
  if (outcome.wrote) input.onWrite?.();
  return outcome.stored;
}

// ---------------------------------------------------------------------------
// The pre-M20.8 card's shape. M20.8 deletes it with the version reads.
// ---------------------------------------------------------------------------

/**
 * @deprecated M20.8: the card client still renders core's old `LockedMode`. `rated` is the
 * effective flag (`lockRated`); `version` is `Date.parse(locked_at)`, which the card compares with
 * the row's `Date.parse(updated_at)` (`cardView.ts`: the card was written after the lock = the
 * next game's choice). Roll empties the row in the same transaction as the lock, so the two are
 * equal right after a Roll that moved something.
 */
export function lockFromRow(row: LockRow): { lock: LockedMode } | null {
  const lock = modeLockOf(row);
  if (lock === null) return null;
  const ms = row.locked_at == null ? Number.NaN : Date.parse(row.locked_at);
  return { lock: { mode: lock.mode, rated: lockRated(lock), version: Number.isFinite(ms) ? ms : 0 } };
}
