import {
  afterRecord,
  type ChampionTable,
  type CheckSeat,
  checkMode,
  type GameStamp,
  gameStamp,
  type ModeState,
  type RecordedGame,
  type RecordedGameKind,
  type StandingModeId,
} from '@customs/core';
import type { Json, RoleValue, SideValue } from '@customs/db';
import { ruleColumnsOf, storedRuleCheck } from '@customs/db/schemas';
import type { StoredLock } from './lock';
import type { ModeStore } from './state';

/**
 * What a recorded game is stamped with, and the compare-and-clear after it (M15.3; R1, R2, R4).
 * Core decides both (`gameStamp`, `afterRecord`, `checkMode`); this maps them to columns.
 *
 * - A game from a **locked lobby** takes the lobby's copy (R2): a mid-game switch never changes
 *   the game being played. `games.mode` is the standing mode at Roll, `games.rule*` the rule.
 * - A game with **no lock** (backfill, hand-made teams, no lobby row) takes the standing mode at
 *   record time at its default rated flag; the rule and the switch wait for a rolled game.
 * - **Remake and ARAM** are stamped with the lock but never rated, never checked, and do not use
 *   up the rule.
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
  /** M15.17 (`0035`): the lobby locked a region wars that could not be drawn. */
  rule_no_draw: boolean;
}

export interface StampInput {
  kind: RecordedGameKind;
  lock: StoredLock | null;
  /** The group's card now: only its standing mode is read, and only for a game with no lock. */
  state: ModeState;
  seats: readonly { side: SideValue; championId: number | null; role: RoleValue | null }[];
  table: ChampionTable;
}

export function recordedGame(kind: RecordedGameKind, lock: StoredLock | null): RecordedGame {
  return { kind, lock: lock?.lock ?? null };
}

/** The columns to insert. Pure. */
export function stampColumns(input: StampInput): GameModeColumns {
  const stamp: GameStamp = gameStamp(input.state, recordedGame(input.kind, input.lock));
  const rule = ruleColumnsOf(stamp.mode);
  const seats: CheckSeat[] = input.seats.map((seat) => ({
    side: seat.side,
    championId: seat.championId,
    position: seat.role,
  }));
  return {
    mode: input.lock?.standing ?? input.state.standing,
    rule: rule.rule,
    rule_class_tag: rule.classTag,
    rule_region_blue: rule.regionBlue,
    rule_region_red: rule.regionRed,
    rated: stamp.rated,
    rule_checked: stamp.checked,
    rule_check: stamp.checked ? (storedRuleCheck(checkMode(stamp.mode, seats, input.table)) as Json) : null,
    rule_no_draw: rule.rule === null && input.lock?.noDraw === true,
  };
}

/**
 * After the game is stored: core's `afterRecord`, written only if the card's version is still the
 * one the state was read at. A rule queued after Roll moved the version, so it survives; a Rated
 * flip after Roll survives too but changes only Rated, so the locked rule is still used up (the
 * user, 2026-10-04); a game that does not consume (remake, ARAM, no lock) changes nothing.
 * Idempotent: a second companion's post finds nothing left to clear and writes nothing.
 *
 * Returns true when it cleared something.
 */
export async function clearAfterRecord(
  store: ModeStore,
  groupId: string,
  game: RecordedGame,
): Promise<boolean> {
  const current = await store.read(groupId);
  const next = afterRecord(current.state, game);
  if (next === current.state) return false;
  // No admin here: `set_by` keeps the last admin's id.
  return store.write(groupId, current, next, {});
}
