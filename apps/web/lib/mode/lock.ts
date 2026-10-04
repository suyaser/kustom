import {
  type ChampionTable,
  drawRegions,
  type LockedMode,
  lockAtRoll,
  type ModeState,
  type RegionId,
  type RegionPair,
  type Rng,
  type StandingModeId,
} from '@customs/core';
import { parseGroupMode, ruleColumnsOf, ruleModeOf } from '@customs/db/schemas';
import { loadFearless } from '../fearless/load';
import type { ServiceClient } from '../supabase';
import { championTable, regionIds } from './champions';
import { supabaseModeStore } from './state';

/**
 * The lobby's copy of the mode, taken at Roll teams (M15.3; R1, R2). Core's `lockAtRoll` decides
 * what is locked; this reads the card and the lobby and writes the lobby's `lock_*` columns
 * (`0032`).
 *
 * - **Roll** locks the effective mode (the pending rule, else the standing mode) and the rated
 *   flag the card shows, plus the version it was taken at. Region wars draws its two regions here
 *   (`drawRegions`, the server's RNG); with no possible draw the game locks the standing mode and
 *   the rule stays pending (decision row 2026-10-04).
 * - **Reroll** never touches the lobby row, so it keeps the copy, region draw included. A roll
 *   repair (`balanced` with no chosen split) passes the copy it finds as `existing`, which core
 *   keeps as it was.
 * - **Teams coming down** (`balanced -> open`) drop the copy in the database
 *   (`lobbies_drop_mode_lock`), whoever writes the status.
 *
 * `games.mode` keeps meaning the standing mode, so the lock stores the standing mode at Roll
 * beside core's `LockedMode` (whose `mode` is the rule when there is one).
 */

export interface StoredLock {
  lock: LockedMode;
  /** The standing mode at Roll: what `games.mode` is stamped with (the fearless pool reads it). */
  standing: StandingModeId;
  /**
   * M15.17 (`0035`): region wars was pending at Roll and could not be drawn, so the lock is the
   * standing mode. The teams post and admin Recording name it instead of `not rated`.
   */
  noDraw: boolean;
}

const LOCK_COLUMNS =
  'lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, lock_version, lock_no_draw' as const;

export interface LockRow {
  lock_mode: string | null;
  lock_rule: string | null;
  lock_class_tag: string | null;
  lock_region_blue: string | null;
  lock_region_red: string | null;
  lock_rated: boolean | null;
  lock_version: number | null;
  /** `0035`; absent from a read that did not ask for it (Tonight's), which reads as false. */
  lock_no_draw?: boolean | null;
}

/** The lock columns as a {@link StoredLock}, or null for no lock (or one this build cannot read). */
export function lockFromRow(row: LockRow): StoredLock | null {
  if (row.lock_mode === null || row.lock_rated === null || row.lock_version === null) return null;
  const standing = parseGroupMode(row.lock_mode);
  const rule =
    row.lock_rule === null
      ? null
      : ruleModeOf({
          rule: row.lock_rule,
          classTag: row.lock_class_tag,
          regionBlue: row.lock_region_blue,
          regionRed: row.lock_region_red,
        });
  if (row.lock_rule !== null && rule === null) return null;
  return {
    standing,
    lock: { mode: rule ?? { id: standing }, rated: row.lock_rated, version: row.lock_version },
    noDraw: rule === null && row.lock_no_draw === true,
  };
}

/** A {@link StoredLock} as the lobby's columns. */
export function rowFromLock(stored: StoredLock, now: Date) {
  const rule = ruleColumnsOf(stored.lock.mode);
  return {
    lock_mode: stored.standing,
    lock_rule: rule.rule,
    lock_class_tag: rule.classTag,
    lock_region_blue: rule.regionBlue,
    lock_region_red: rule.regionRed,
    lock_rated: stored.lock.rated,
    lock_version: stored.lock.version,
    locked_at: now.toISOString(),
    lock_no_draw: stored.noDraw,
  };
}

export interface LockInputs {
  table: ChampionTable;
  regions: readonly RegionId[];
  /** The group's Fearless pool; counted only while the standing mode is Fearless. */
  bans: readonly number[];
  rng: Rng;
  /**
   * `false` for the lock taken when a game starts or lands with none (hand-made teams): regions
   * drawn after champion select would name sides nobody played to, so region wars is not drawn,
   * the game locks the standing mode, and the rule stays pending for a rolled game. Default true.
   */
  draw?: boolean;
}

/**
 * The lock for this card state (pure): core's `lockAtRoll`, with the region draw when the pending
 * rule is region wars and there is no copy to keep.
 */
export function lockFor(state: ModeState, existing: StoredLock | null, inputs: LockInputs): StoredLock {
  if (existing !== null) return existing;
  const draw = inputs.draw !== false;
  let regions: RegionPair | null = null;
  if (state.pending?.id === 'region' && draw) {
    const bans = state.standing === 'fearless' ? inputs.bans : [];
    // The roster form, so the draw applies M20 D2's union rule to shared champions.
    regions = drawRegions(inputs.regions, { roster: inputs.table, bans }, inputs.rng);
  }
  const lock = lockAtRoll(state, regions);
  // Core locked the standing mode for a region wars it could not draw: say so (M15.17). Not for
  // a draw that was never attempted (a start lock), which is not "too few open champions".
  return {
    lock,
    standing: state.standing,
    noDraw: draw && state.pending?.id === 'region' && lock.mode.id !== 'region',
  };
}

/** The lobby's lock, or null. */
export async function readLobbyLock(client: ServiceClient, lobbyId: string): Promise<StoredLock | null> {
  const { data, error } = await client.from('lobbies').select(LOCK_COLUMNS).eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`mode lock: lobby read failed: ${error.message}`);
  return data === null ? null : lockFromRow(data);
}

/**
 * Lock the lobby at Roll (the roll calls this once it owns the lobby at `balanced`). A lobby that
 * already has a copy keeps it (a roll repair). Returns the lock in force.
 */
export async function lockLobbyAtRoll(
  client: ServiceClient,
  input: {
    lobbyId: string;
    groupId: string;
    now: Date;
    rng: Rng;
    table?: ChampionTable;
    draw?: boolean;
    onWrite?: () => void;
  },
): Promise<StoredLock> {
  const existing = await readLobbyLock(client, input.lobbyId);
  if (existing !== null) return existing;

  const draw = input.draw !== false;
  const { state } = await supabaseModeStore(client).read(input.groupId);
  const needsBans = draw && state.pending?.id === 'region' && state.standing === 'fearless';
  const stored = lockFor(state, null, {
    table: input.table ?? championTable(),
    regions: regionIds(),
    bans: needsBans
      ? (await loadFearless(client, input.groupId)).champions.map((champion) => champion.id)
      : [],
    rng: input.rng,
    draw,
  });

  // Only onto a lobby with no copy: of two writers, the first lock stands and both answer it.
  const { data, error } = await client
    .from('lobbies')
    .update(rowFromLock(stored, input.now))
    .eq('id', input.lobbyId)
    .is('lock_mode', null)
    .select(LOCK_COLUMNS);
  if (error) throw new Error(`mode lock: lobby write failed: ${error.message}`);
  if ((data ?? []).length > 0) {
    input.onWrite?.();
    return stored;
  }
  return (await readLobbyLock(client, input.lobbyId)) ?? stored;
}

/** Lobby statuses a game can still be starting or landing from: a lock taken there is this game's. */
const PLAYABLE_STATUSES = new Set(['open', 'balanced', 'in_game']);

/**
 * The lock for the game actually played (owner bug 2026-10-04): rolling is a suggestion. Teams made
 * by hand either never had a Roll or brought the rolled teams down (`balanced -> open` drops the
 * lock), and a game with no lock used to take the standing mode's default, so `Rated` off and a
 * pending rule were silently skipped (and the switch carried on to some later game). A lobby with
 * no lock takes one from the card when its game starts (`in_progress`), or at the end-of-game block
 * when no start was heard: the card as it stands then, without a region draw ({@link LockInputs}).
 * A lock already there (Roll) is kept, so R9 holds: a flip after the lock is for the next game.
 *
 * Only a lobby still `open`, `balanced` or `in_game`: a `finished` or `dropped` lobby's game was
 * played long before the card the server would read now. Returns the lock in force, or null.
 * `onWrite` runs when this call wrote the lock (Tonight's live signal).
 */
export async function lockLobbyAtStart(
  client: ServiceClient,
  input: { lobbyId: string; groupId: string; status: string; now: Date; onWrite?: () => void },
): Promise<StoredLock | null> {
  if (!PLAYABLE_STATUSES.has(input.status)) return readLobbyLock(client, input.lobbyId);
  return lockLobbyAtRoll(client, {
    lobbyId: input.lobbyId,
    groupId: input.groupId,
    now: input.now,
    // Never used: no draw.
    rng: () => 0,
    draw: false,
    ...(input.onWrite === undefined ? {} : { onWrite: input.onWrite }),
  });
}
