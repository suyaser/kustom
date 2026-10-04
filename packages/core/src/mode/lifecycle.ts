/**
 * @deprecated M20.6: replaced by `transition.ts` (one row, no version; decision row M20 D6). Kept
 * only while apps/web still calls it; delete this file and its tests when M20.7 and M20.8 land.
 *
 * The rule's lifecycle (M15.2, brief D2, R1, R2, R9), as pure state transitions the server
 * applies to whatever it stores (platform owns the columns, M15.3).
 *
 *   standing ──(pick a rule / Spin)──> pending ──(Roll teams)──> locked on the lobby
 *       ^                                 │ (pick Normal/Fearless: cleared)     │ (game recorded)
 *       └────────────────── back to the standing mode <─────────────────────────┘
 *
 * **Compare and clear.** Every change to the card moves `version`. A lock remembers the version
 * it was taken at; a recorded game clears the rule and resets the Rated switch only if the
 * version is unchanged. So anything an admin did after Roll (a new rule, the same rule queued
 * again, a Rated flip) is for the next game and survives the record.
 *
 * **A Rated flip changes only Rated** (the user, 2026-10-04): when everything since Roll was Rated
 * flips ({@link onlyRatedSinceRoll}), the record still uses up the locked rule and keeps the flip
 * for the next game. Before, the moved version kept the rule pending too, so flipping Rated
 * mid-game silently repeated `Tanks only`.
 */

import {
  type Mode,
  type ModeId,
  modeRatedDefault,
  type RegionPair,
  type RuleOption,
  ruleOf,
  type StandingModeId,
  sameRule,
} from './model';

/** The group's mode state: what the card shows for the next game. */
export interface ModeState {
  standing: StandingModeId;
  /** At most one rule, for the next game only. */
  pending: RuleOption | null;
  /** The Rated switch for the next game; `null` is the effective mode's default. */
  ratedOverride: boolean | null;
  /** Moves on every change; the compare-and-clear token. */
  version: number;
}

/** The lobby's copy, taken at Roll teams. Reroll keeps it; teams coming down drop it. */
export interface LockedMode {
  mode: Mode;
  rated: boolean;
  /** The `ModeState.version` the copy was taken at. */
  version: number;
}

/** How the game was recorded. A `dropped` lobby is not a record: nothing is called until a late block. */
export type RecordedGameKind = 'rift' | 'remake' | 'aram';

export interface RecordedGame {
  kind: RecordedGameKind;
  /** The lobby's copy, or `null` for a game with no rolled lobby (hand-made teams, backfill). */
  lock: LockedMode | null;
}

/** What the recorded game is stamped with, and whether it gets a rule line. */
export interface GameStamp {
  mode: Mode;
  rated: boolean;
  checked: boolean;
}

/** @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8. */
export function startState(standing: StandingModeId): ModeState {
  return { standing, pending: null, ratedOverride: null, version: 0 };
}

/** Picking Normal or Fearless: sets the standing mode, clears a pending rule, resets the switch.
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function chooseStanding(state: ModeState, standing: StandingModeId): ModeState {
  return { standing, pending: null, ratedOverride: null, version: state.version + 1 };
}

/** Picking a rule or a Spin result: the standing mode stays, the switch resets to the rule's default.
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function chooseRule(state: ModeState, rule: RuleOption): ModeState {
  return { ...state, pending: rule, ratedOverride: null, version: state.version + 1 };
}

/** The Rated switch, for the next game, either way, in any mode.
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function setRated(state: ModeState, rated: boolean): ModeState {
  return { ...state, ratedOverride: rated, version: state.version + 1 };
}

/** What the card says the next game is.
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function nextGame(state: ModeState): { modeId: ModeId; rule: RuleOption | null; rated: boolean } {
  const modeId: ModeId = state.pending?.id ?? state.standing;
  return { modeId, rule: state.pending, rated: state.ratedOverride ?? modeRatedDefault(modeId) };
}

/**
 * The lobby's copy at Roll teams. With `existing` (a Reroll) the copy is kept as it was, region
 * draw included. Region wars needs `regions` (`drawRegions`); if no pair could be drawn, the game
 * is locked on the standing mode with the rated flag the card showed, and the rule stays pending.
 *
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function lockAtRoll(
  state: ModeState,
  regions: RegionPair | null,
  existing?: LockedMode | null,
): LockedMode {
  if (existing) return existing;
  const { rated } = nextGame(state);
  const rule = state.pending;
  let mode: Mode;
  if (rule === null) mode = { id: state.standing };
  else if (rule.id === 'region')
    mode = regions === null ? { id: state.standing } : { id: 'region', ...regions };
  else mode = rule;
  return { mode, rated, version: state.version };
}

/** Only a Rift game from a rolled lobby uses up the rule. Remake, ARAM and no-lobby games do not.
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function consumesRule(game: RecordedGame): boolean {
  return game.kind === 'rift' && game.lock !== null;
}

/**
 * The game's stamp. A rolled game takes the lobby's copy; a remake or ARAM is never rated and
 * never checked. A game with no lobby copy takes the standing mode at its default (the switch
 * and the rule wait for a rolled game).
 *
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function gameStamp(state: ModeState, game: RecordedGame): GameStamp {
  if (game.lock === null) {
    return { mode: { id: state.standing }, rated: modeRatedDefault(state.standing), checked: false };
  }
  const rift = game.kind === 'rift';
  const isRule = game.lock.mode.id !== 'normal' && game.lock.mode.id !== 'fearless';
  return { mode: game.lock.mode, rated: rift && game.lock.rated, checked: rift && isRule };
}

/**
 * Whether everything an admin did since Roll was Rated flips: the version moved, the rule the
 * lobby locked is still the one pending, and the switch is set. Picking a rule (even the same one
 * again) resets the switch, so a re-queued rule reads as a new choice and survives. The one case
 * the card's state cannot tell apart is the same rule re-queued **and then** a Rated flip: that
 * reads as Rated only and the rule is used up (there is no second token; decision row 2026-10-04).
 *
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function onlyRatedSinceRoll(state: ModeState, lock: LockedMode): boolean {
  return (
    lock.version !== state.version &&
    state.ratedOverride !== null &&
    sameRule(ruleOf(lock.mode), state.pending)
  );
}

/**
 * After a game is recorded: compare and clear. Unchanged unless the game consumes and either
 * nothing moved since Roll (the rule is used up, the switch resets) or only the Rated switch moved
 * (the rule is used up, the flip stays for the next game).
 *
 * @deprecated M20.6: use `transition.ts`; delete with M20.7/M20.8.
 */
export function afterRecord(state: ModeState, game: RecordedGame): ModeState {
  if (!consumesRule(game) || game.lock === null) return state;
  if (game.lock.version !== state.version) {
    if (!onlyRatedSinceRoll(state, game.lock)) return state;
    return { ...state, pending: null, version: state.version + 1 };
  }
  const lockedRule = game.lock.mode.id !== 'normal' && game.lock.mode.id !== 'fearless';
  return {
    ...state,
    pending: lockedRule ? null : state.pending,
    ratedOverride: null,
    version: state.version + 1,
  };
}
