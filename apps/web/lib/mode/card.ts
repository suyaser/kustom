import {
  afterRecord,
  type ChampionTable,
  CLASS_TAGS,
  type ClassTag,
  classPool,
  type LockedMode,
  type Mode,
  type ModeState,
  modeRatedDefault,
  nextGame,
  RULE_OPTIONS,
  type RuleOption,
  ruleKey,
  ruleOf,
  rulePlayable,
  type StandingModeId,
} from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { championLane } from '../champs/lanes';
import { LANE_ORDER } from '../laneOrder';
import { isRule, nextGameLine, type ShownMode } from './ruleCopy';

/**
 * What the Mode card shows (M15.5; brief D2, 05-design 8.3, 8.10): pure, so every state is a unit
 * test and the card, the panel, the answer band and the strip's host line read one answer.
 *
 * - **Before Roll** (no lobby, filling, finished) the card is the **next game**: the pending rule if
 *   any, else the standing mode, with the Rated switch or the mode's default (core's `nextGame`).
 * - **Set and in game** the card is **this game**: the lobby's lock taken at Roll. Anything an admin
 *   did since (the version moved) is for the next game: `Next game: Mages only.` in the admin foot.
 *   A Rated-only flip changes only Rated (the user, 2026-10-04): the line is the game after this
 *   one's record ({@link upcomingState}), e.g. `Next game: Fearless.` or `Next game: not rated.`
 * - Region wars that could not be drawn at Roll locked the standing mode while the rule stayed
 *   pending at the same version: the card says the rule didn't apply.
 * - A lobby set before `0032` (no lock) reads as the next game.
 */

export interface ModeCardInput {
  state: ModeState;
  lobbyStatus: LobbyStatusValue | null;
  lock: LockedMode | null;
  /** The Fearless pool's champion ids (counted only while the standing mode is Fearless). */
  bans: readonly number[];
  table: ChampionTable;
}

export interface ModeCardView {
  shown: ShownMode;
  rated: boolean;
  standing: StandingModeId;
  /** The card is the lobby's lock (balanced or in game). */
  locked: boolean;
  /** Admins, after Roll, when something changed since: `Next game: Mages only.` */
  nextLine: string | null;
  /** Region wars could not be drawn at Roll; the rule is still pending. */
  didntApply: boolean;
  /** Class wars: the open count for `Tanks only · 12 open` (under Fearless only), else null. */
  classOpen: number | null;
  /** Class wars: open champions of the class per usual lane, for the tiles and `Your lane`. */
  laneCounts: Record<RoleValue, number> | null;
  /**
   * The group's pending rule key (`class:Tank`), whatever the card shows: what a Spin broadcast must
   * match before the reveal plays (M15.5 review). Null with none.
   */
  pendingKey: string | null;
}

const LOCKED_STATUSES: ReadonlySet<LobbyStatusValue> = new Set(['balanced', 'in_game']);

export function modeCardView(input: ModeCardInput): ModeCardView {
  const { state, lock } = input;
  const live = input.lobbyStatus !== null && LOCKED_STATUSES.has(input.lobbyStatus);
  const locked = live && lock !== null;
  const next = nextGame(state);
  const bans = state.standing === 'fearless' ? new Set(input.bans) : new Set<number>();

  const shown: ShownMode = locked ? lock.mode : (state.pending ?? { id: state.standing });
  const rated = locked ? lock.rated : next.rated;
  const moved = locked && lock.version !== state.version;
  const didntApply = locked && !moved && state.pending?.id === 'region' && lock.mode.id !== 'region';

  let classOpen: number | null = null;
  let laneCounts: Record<RoleValue, number> | null = null;
  if (shown.id === 'class') {
    const open = classPool(shown.tag, input.table).filter((id) => !bans.has(id));
    classOpen = state.standing === 'fearless' ? open.length : null;
    laneCounts = Object.fromEntries(LANE_ORDER.map((role) => [role, 0])) as Record<RoleValue, number>;
    for (const id of open) {
      const role = championLane(id);
      if (role !== null) laneCounts[role] += 1;
    }
  }

  return {
    shown,
    rated,
    standing: state.standing,
    locked,
    nextLine: moved ? nextLineFor(upcomingState(state, input.lobbyStatus, lock), lock) : null,
    didntApply,
    classOpen,
    laneCounts,
    pendingKey: state.pending === null ? null : ruleKey(state.pending),
  };
}

/**
 * The card as it will be for the next game: after Roll, what this game's record will leave
 * (core's `afterRecord`: the locked rule used up unless an admin queued something since, a
 * Rated-only flip kept); before Roll, the card itself. The admin controls' select and switch read
 * this, so they are about the same game as `Next game: …`.
 */
export function upcomingState(
  state: ModeState,
  lobbyStatus: LobbyStatusValue | null,
  lock: LockedMode | null,
): ModeState {
  const live = lobbyStatus !== null && LOCKED_STATUSES.has(lobbyStatus);
  return live && lock !== null ? afterRecord(state, { kind: 'rift', lock }) : state;
}

const modeKeyOf = (mode: Mode | RuleOption | StandingModeId): string => {
  if (typeof mode === 'string') return mode;
  const rule = ruleOf(mode);
  return rule === null ? mode.id : ruleKey(rule);
};

/**
 * `Next game: …` for the upcoming state against this game's lock. The mode is named unless it is
 * this game's; Rated is said when it is not the next mode's default, or when it is all that differs
 * from this game.
 */
function nextLineFor(upcoming: ModeState, lock: LockedMode): string {
  const next = nextGame(upcoming);
  const choice = upcoming.pending ?? upcoming.standing;
  const sameMode = modeKeyOf(choice) === modeKeyOf(lock.mode);
  const saysRated = next.rated !== modeRatedDefault(next.modeId) || (sameMode && next.rated !== lock.rated);
  if (!saysRated) return nextGameLine(choice);
  return nextGameLine(sameMode ? null : choice, next.rated);
}

/**
 * Whether the card and the panel show the Fearless pool (M15.14): standing Fearless itself, or a
 * mirror match on a Fearless night, which keeps every Fearless ban (only its lanes' rule is new).
 * Class and region wars show their own pools with the bans folded in, so they are not this.
 */
export function showsFearlessPool(view: Pick<ModeCardView, 'shown' | 'standing'>): boolean {
  return view.shown.id === 'fearless' || (view.shown.id === 'mirror' && view.standing === 'fearless');
}

/** The standing mode whose card this is, for `This game only. Then back to …`. */
export function showsRule(view: ModeCardView): boolean {
  return isRule(view.shown);
}

/** The select's value for the next game: a standing mode or a rule key (`class:Tank`). */
export function selectValue(state: ModeState): string {
  return state.pending === null ? state.standing : ruleKey(state.pending);
}

/**
 * Which rule options the select greys out with ` (too few open)` (D7): under standing Fearless, a
 * class under 10 open or no two regions with 8 open. The rule already pending stays selectable.
 */
export function tooFewOpen(state: ModeState, bans: readonly number[], table: ChampionTable): string[] {
  const counted = state.standing === 'fearless' ? bans : [];
  return RULE_OPTIONS.filter(
    (rule: RuleOption) =>
      !rulePlayable(rule, table, counted) &&
      !(state.pending !== null && ruleKey(state.pending) === ruleKey(rule)),
  ).map(ruleKey);
}

/** The five classes in the select's order (re-exported for the controls). */
export const CLASS_ORDER: readonly ClassTag[] = CLASS_TAGS;
