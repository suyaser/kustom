import {
  type ChampionTable,
  CLASS_TAGS,
  classPool,
  type LockedMode,
  type ModeState,
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
  upcomingState,
} from './cardView';

/**
 * What the Mode card shows (M15.5; brief D2, 05-design 8.3, 8.10): pure, so every state is a unit
 * test and the card, the panel, the answer band and the strip's host line read one answer.
 *
 * - **Before Roll** (no lobby, filling, finished) the card is the **next game**: the pending rule if
 *   any, else the standing mode, with the Rated switch or the mode's default (core's `nextGame`).
 * - **Set and in game** the card is **this game**: the lobby's lock taken at Roll. Anything an admin
 *   did since (the version moved) is for the next game: `Next game: Mages only.` in the admin foot.
 *   A Rated-only flip changes only Rated (the user, 2026-10-04): the line is the game after this
 *   one's record (`upcomingState`), e.g. `Next game: Fearless.` or `Next game: not rated.`
 * - Region wars that could not be drawn at Roll locked the standing mode while the rule stayed
 *   pending at the same version: the card says the rule didn't apply.
 * - A lobby set before `0032` (no lock) reads as the next game.
 *
 * M19.13: the view itself is `cardView.ts` (no champion table, client-safe); this file adds the
 * table-backed facts the server computes once per render ({@link classFacts},
 * {@link unplayableRules}) and hands to the client mode store, so both cards are one function.
 */

export interface ModeCardInput {
  state: ModeState;
  lobbyStatus: LobbyStatusValue | null;
  lock: LockedMode | null;
  /** The Fearless pool's champion ids (counted only while the standing mode is Fearless). */
  bans: readonly number[];
  table: ChampionTable;
}

export function modeCardView(input: ModeCardInput): ModeCardView {
  return modeCardViewFrom({
    state: input.state,
    lobbyStatus: input.lobbyStatus,
    lock: input.lock,
    classFacts: classFacts(input.bans, input.table),
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
export function tooFewOpen(state: ModeState, bans: readonly number[], table: ChampionTable): string[] {
  return tooFewFrom(state, unplayableRules(bans, table));
}
