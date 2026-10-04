import {
  type ChampionTable,
  type CheckSeat,
  checkMode,
  type ModeLock,
  type ModeRow,
  type RecordedGameKind,
  type RecordResult,
  recordGame,
  type StandingModeId,
} from '@customs/core';
import type { Json, RoleValue, SideValue } from '@customs/db';
import { ruleColumnsOf, storedRuleCheck } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * What a recorded game is stamped with, and what it writes to the card (M20.7; core's
 * `recordGame`). There is no compare-and-clear any more (`clearAfterRecord` is gone, M20 D6):
 *
 * - A game with a **lock** (Roll, or taken at game start) is stamped with it. A Rift game writes
 *   nothing to `group_modes`, so a choice made after Roll is never cleared (M20 D7). A remake or an
 *   ARAM hands the lock back into the row's empty fields (`mode_hand_back`, one statement), never
 *   rated, never checked.
 * - A **live** game with no lock (no lobby row) plays the pending rule and Rated and uses them up:
 *   one conditional update that empties them only if they are still what the stamp read.
 * - A **backfill**, and a game from a `finished` or `dropped` lobby with no lock, takes the
 *   standing mode at its default and touches nothing.
 *
 * The write runs once per game: only the post that inserted it (`created`), so a second companion's
 * post, or a replay after an admin re-queued the same rule, never clears or hands back twice
 * (audit defect 4).
 */

/** The insert's mode columns (`games`, `0024` + `0032`). */
export interface GameModeColumns {
  mode: StandingModeId;
  rule: string | null;
  rule_class_tag: string | null;
  rule_region_blue: string | null;
  rule_region_red: string | null;
  rated: boolean;
  rule_checked: boolean;
  rule_check: Json | null;
}

/** The game as the card sees it, carried from ingest to the route's write after the fold. */
export interface ModeRecord {
  kind: RecordedGameKind;
  lock: ModeLock | null;
  live: boolean;
  /** The row the stamp read. */
  row: ModeRow;
}

export interface StampInput extends ModeRecord {
  seats: readonly { side: SideValue; championId: number | null; role: RoleValue | null }[];
  table: ChampionTable;
}

export function recordResultOf(record: ModeRecord): RecordResult {
  return recordGame(record.row, { kind: record.kind, lock: record.lock, live: record.live });
}

/** The columns to insert. Pure. */
export function stampColumns(input: StampInput): GameModeColumns {
  const { stamp } = recordResultOf(input);
  const rule = ruleColumnsOf(stamp.mode);
  const seats: CheckSeat[] = input.seats.map((seat) => ({
    side: seat.side,
    championId: seat.championId,
    position: seat.role,
  }));
  return {
    mode: stamp.standing,
    rule: rule.rule,
    rule_class_tag: rule.classTag,
    rule_region_blue: rule.regionBlue,
    rule_region_red: rule.regionRed,
    rated: stamp.rated,
    rule_checked: stamp.checked,
    rule_check: stamp.checked ? (storedRuleCheck(checkMode(stamp.mode, seats, input.table)) as Json) : null,
  };
}

const nullable = <T>(value: T | null): T => value as T;

/** Teams down's twin for a remake or an ARAM: the lock back into the row's empty fields, one statement. */
export async function handBackLock(client: ServiceClient, groupId: string, lock: ModeLock): Promise<boolean> {
  const rule = ruleColumnsOf(lock.mode);
  const { data, error } = await client.rpc('mode_hand_back', {
    p_group_id: groupId,
    p_rule: nullable(rule.rule),
    p_class_tag: nullable(rule.classTag),
    p_region_blue: nullable(rule.regionBlue),
    p_region_red: nullable(rule.regionRed),
    p_rated: nullable(lock.rated),
  });
  if (error) throw new Error(`mode: hand-back failed: ${error.message}`);
  return data === true;
}

/**
 * After the game is stored (the first post only): what core's `recordGame` says the game writes to
 * the row. Returns true when it wrote something.
 */
export async function applyModeRecord(
  client: ServiceClient,
  groupId: string,
  record: ModeRecord,
): Promise<boolean> {
  const { patch } = recordResultOf(record);
  if (Object.keys(patch).length === 0) return false;
  // A remake or an ARAM from a locked lobby: core's patch is handBack's, re-decided in the
  // database against the row as it is now, so a choice made since the read always wins.
  if (record.lock !== null) return handBackLock(client, groupId, record.lock);

  // A live Rift game with no lock used the pending state up: empty it only if it is still what the
  // stamp read (an admin who chose since keeps the choice). Nothing to use up writes nothing.
  if (record.row.pending === null && record.row.rated === null) return false;
  const read = record.row.pending === null ? null : ruleColumnsOf(record.row.pending);
  let update = client
    .from('group_modes')
    .update({
      pending_rule: null,
      pending_class_tag: null,
      pending_region_blue: null,
      pending_region_red: null,
      rated_override: null,
      pending_set_by: null,
    })
    .eq('group_id', groupId)
    .eq('mode', record.row.standing);
  update = read?.rule == null ? update.is('pending_rule', null) : update.eq('pending_rule', read.rule);
  update =
    read?.classTag == null
      ? update.is('pending_class_tag', null)
      : update.eq('pending_class_tag', read.classTag);
  update =
    read?.regionBlue == null
      ? update.is('pending_region_blue', null)
      : update.eq('pending_region_blue', read.regionBlue);
  update =
    read?.regionRed == null
      ? update.is('pending_region_red', null)
      : update.eq('pending_region_red', read.regionRed);
  update =
    record.row.rated === null
      ? update.is('rated_override', null)
      : update.eq('rated_override', record.row.rated);
  const { data, error } = await update.select('group_id');
  if (error) throw new Error(`mode: using up the pending rule failed: ${error.message}`);
  return (data ?? []).length > 0;
}
