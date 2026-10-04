import {
  afterRecord,
  type ClassTag,
  type LockedMode,
  type Mode,
  type ModeState,
  modeRatedDefault,
  nextGame,
  type RuleOption,
  ruleKey,
  ruleOf,
  type StandingModeId,
} from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { nextGameLine, type ShownMode } from './ruleCopy';

/**
 * What the Mode card shows, with no champion table (M19.13): the half of `lib/mode/card.ts` the
 * client may hold. The server computes the per-class counts once per render ({@link ClassFacts},
 * from the table and tonight's bans) and hands them down, so the client mode store can render the
 * card for any mode an admin picks next without shipping the champion table to every phone.
 * `modeCardView` (`card.ts`) is this function over facts it computes itself, so the server card and
 * the client card are one function (the parity test in `app/_mode/modeCardParity.test.tsx`).
 *
 * No zod, no names: client islands import it (`lib/clientGraph.test.ts`).
 */

/** One class's open champions: how many, and how many per usual lane. */
export interface ClassCount {
  open: number;
  lanes: Record<RoleValue, number>;
}

/**
 * Per class: open with tonight's Fearless bans taken out (`banned`), and with none (`all`, standing
 * Normal or a pool just reset). Computed on the server from the champion table.
 */
export type ClassFacts = Record<ClassTag, { banned: ClassCount; all: ClassCount }>;

/**
 * Per rule key, whether it is playable with tonight's bans (`banned`) and with none (`all`): the
 * select's ` (too few open)` (D7), computed on the server (`unplayableRules`, `card.ts`).
 */
export interface UnplayableRules {
  banned: readonly string[];
  all: readonly string[];
}

export interface ModeCardViewInput {
  state: ModeState;
  lobbyStatus: LobbyStatusValue | null;
  lock: LockedMode | null;
  classFacts: ClassFacts | null;
  /** The Fearless pool was reset since the render (a `fearless_state` row): no bans count. */
  poolCleared?: boolean | undefined;
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

export function modeCardViewFrom(input: ModeCardViewInput): ModeCardView {
  const { state, lock } = input;
  const live = input.lobbyStatus !== null && LOCKED_STATUSES.has(input.lobbyStatus);
  const locked = live && lock !== null;
  const next = nextGame(state);

  const shown: ShownMode = locked ? lock.mode : (state.pending ?? { id: state.standing });
  const rated = locked ? lock.rated : next.rated;
  // M20.7: the card was written after the lock (timestamps since 0047; old integer versions only grew).
  const moved = locked && state.version > lock.version;
  const didntApply = locked && !moved && state.pending?.id === 'region' && lock.mode.id !== 'region';

  let classOpen: number | null = null;
  let laneCounts: Record<RoleValue, number> | null = null;
  if (shown.id === 'class' && input.classFacts !== null) {
    const facts = input.classFacts[shown.tag];
    const count = state.standing === 'fearless' && input.poolCleared !== true ? facts.banned : facts.all;
    classOpen = state.standing === 'fearless' ? count.open : null;
    laneCounts = { ...count.lanes };
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
 * Rated-only flip kept); before Roll, the card itself. Text only: the admins' `Next game: …` line.
 * The controls never read it (owner bug 1: a prediction there made the select read Normal after
 * Roll); they show what is set.
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

/**
 * After Roll, whether picking the pending rule again would queue it for the next game too
 * (owner bug 3): the lobby locked that very rule and nothing changed since, so the record would use
 * it up. The select already shows it, so the controls offer `Set mode` for it anyway.
 */
export function requeueable(
  state: ModeState,
  lobbyStatus: LobbyStatusValue | null,
  lock: LockedMode | null,
): boolean {
  const live = lobbyStatus !== null && LOCKED_STATUSES.has(lobbyStatus);
  if (!live || lock === null || state.version > lock.version || state.pending === null) return false;
  const locked = ruleOf(lock.mode);
  return locked !== null && ruleKey(locked) === ruleKey(state.pending);
}

/** The select's value for the next game: a standing mode or a rule key (`class:Tank`). */
export function selectValue(state: ModeState): string {
  return state.pending === null ? state.standing : ruleKey(state.pending);
}

/**
 * Which rule options the select greys out with ` (too few open)` (D7): under standing Fearless, the
 * rules unplayable with tonight's bans. The rule already pending stays selectable.
 */
export function tooFewFrom(state: ModeState, unplayable: UnplayableRules, poolCleared = false): string[] {
  const list = state.standing === 'fearless' && !poolCleared ? unplayable.banned : unplayable.all;
  const pending = state.pending === null ? null : ruleKey(state.pending);
  return list.filter((key) => key !== pending);
}

/** How long after a game lands its compare-and-clear write can still arrive (M15.5). */
export const RECORD_CLEAR_SLACK_MS = 30_000;

/**
 * What the members' `Normal mode now.` note needs from the night besides the card state: when the
 * night began, when the last game landed, the newest finished tape entry, and whether a lobby is
 * in game or finished now. Computed on the server (`normalNoteFactsOf`, `view.ts`), so the client
 * card can answer the note for a state it heard after the render.
 */
export interface NormalNoteFacts {
  nightStart: string;
  lastGameAt: string | null;
  /** The newest `createdAt` (ms) of tonight's tape entries with a result, or null with none. */
  lastResultAt: number | null;
  finishedNow: boolean;
}

/**
 * The members' dashed `Normal mode now.` note (M14.30): the group is on Normal, the switch
 * happened tonight, and no game of tonight has started since (a game landing ends the moment).
 */
export function normalNote(
  facts: NormalNoteFacts,
  card: { standing: StandingModeId; pending: RuleOption | null; since: string | null },
): boolean {
  if (card.standing !== 'normal' || card.since === null) return false;
  // M15.5: a pending rule is what the card shows; the note is about plain Normal.
  if (card.pending !== null) return false;
  const since = Date.parse(card.since);
  if (!Number.isFinite(since) || since < Date.parse(facts.nightStart)) return false;
  // M15.5: since 0032 a recorded game writes the card too (the compare-and-clear: a rule game
  // handing back to Normal, a Rated switch resetting). A write that close to the last game landing
  // is the server's, not an admin's switch: no `An admin switched off Fearless` note.
  const landed = facts.lastGameAt === null ? Number.NaN : Date.parse(facts.lastGameAt);
  if (Number.isFinite(landed) && since <= landed + RECORD_CLEAR_SLACK_MS) return false;
  const laterGame = facts.lastResultAt !== null && facts.lastResultAt > since;
  return !laterGame && !facts.finishedNow;
}
