import {
  type ChampionTable,
  CLASS_TAGS,
  classPool,
  type ModeLock,
  type ModeRow,
  RULE_OPTIONS,
  type RuleOption,
  ruleKey,
  rulePlayable,
} from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { championLane } from '../champs/lanes';
import { LANE_ORDER } from '../laneOrder';
import {
  type ClassCount,
  type ClassFacts,
  type ModeCardView,
  modeCardViewFrom,
  tooFewFrom,
  type UnplayableRules,
} from './cardView';

export {
  type ClassFacts,
  type ModeCardView,
  modeCardViewFrom,
  selectValue,
  showsFearlessPool,
  type UnplayableRules,
} from './cardView';

/**
 * What the Mode card shows (M15.5; brief D2, 05-design 8.3, 8.10): pure, so every state is a unit
 * test and the card, the panel, the answer band and the strip's host line read one answer.
 *
 * - **Before Roll** (no lobby, filling, finished) the card is the **next game**: the group's row
 *   (`group_modes`), its pending rule if any (region wars with its pair, M20 D9), else the standing
 *   mode, with the Rated switch or the mode's default.
 * - **Set and in game** the card is **this game**: the lobby's lock (Roll moved the row's pending
 *   fields onto it, M20 D6). The row is the next game: when it says more than the lock, admins read
 *   `Next game: Mages only.` in the foot.
 *
 * M19.13: the view itself is `cardView.ts` (no champion table, client-safe); this file adds the
 * table-backed facts the server computes once per render ({@link classFacts},
 * {@link unplayableRules}) and hands to the client mode store, so both cards are one function.
 */

export interface ModeCardInput {
  row: ModeRow;
  lobbyStatus: LobbyStatusValue | null;
  lock: ModeLock | null;
  /** The Fearless pool's champion ids (counted only while the standing mode is Fearless). */
  bans: readonly number[];
  table: ChampionTable;
  /** `group_modes.updated_at` and the lock's `locked_at` (the didn't-apply note, `cardView.ts`). */
  rowUpdatedAt?: string | null | undefined;
  lockedAt?: string | null | undefined;
}

export function modeCardView(input: ModeCardInput): ModeCardView {
  return modeCardViewFrom({
    row: input.row,
    lobbyStatus: input.lobbyStatus,
    lock: input.lock,
    classFacts: classFacts(input.bans, input.table),
    rowUpdatedAt: input.rowUpdatedAt,
    lockedAt: input.lockedAt,
  });
}

function classCount(open: readonly number[]): ClassCount {
  const lanes = Object.fromEntries(LANE_ORDER.map((role) => [role, 0])) as Record<RoleValue, number>;
  for (const id of open) {
    const role = championLane(id);
    if (role !== null) lanes[role] += 1;
  }
  return { open: open.length, lanes };
}

/** Every class's open count and lane counts, with `bans` taken out and with none (M19.13). */
export function classFacts(bans: readonly number[], table: ChampionTable): ClassFacts {
  const banned = new Set(bans);
  return Object.fromEntries(
    CLASS_TAGS.map((tag) => {
      const pool = classPool(tag, table);
      return [tag, { banned: classCount(pool.filter((id) => !banned.has(id))), all: classCount(pool) }];
    }),
  ) as ClassFacts;
}

/** The rule keys unplayable with `bans` and with none, in the select's order (M19.13). */
export function unplayableRules(bans: readonly number[], table: ChampionTable): UnplayableRules {
  const keys = (counted: readonly number[]) =>
    RULE_OPTIONS.filter((rule: RuleOption) => !rulePlayable(rule, table, counted)).map(ruleKey);
  return { banned: keys(bans), all: keys([]) };
}

/**
 * Which rule options the select greys out with ` (too few open)` (D7): under standing Fearless, a
 * class under 10 open or no two regions with 8 open. The rule already pending stays selectable.
 */
export function tooFewOpen(row: ModeRow, bans: readonly number[], table: ChampionTable): string[] {
  return tooFewFrom(row, unplayableRules(bans, table));
}
