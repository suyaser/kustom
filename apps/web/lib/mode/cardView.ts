import {
  type ClassTag,
  lockRated,
  type Mode,
  type ModeLock,
  type ModeRow,
  modeRatedDefault,
  nextRated,
  type PendingRule,
  ruleKey,
  ruleOf,
  type StandingModeId,
} from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { nextGameLine } from './ruleCopy';

/**
 * What the Mode card shows, with no champion table (M19.13): the half of `lib/mode/card.ts` the
 * client may hold. The server computes the per-class counts once per render ({@link ClassFacts},
 * from the table and tonight's bans) and hands them down, so the client mode store can render the
 * card for any mode an admin picks next without shipping the champion table to every phone.
 * `modeCardView` (`card.ts`) is this function over facts it computes itself, so the server card and
 * the client card are one function (the parity test in `app/_mode/modeCardParity.test.tsx`).
 *
 * M20.8: one row, no version (M20 D6). "This game" is the lobby's lock (core's `ModeLock`, taken at
 * Roll or at game start), "next game" is the group's row (core's `ModeRow`). Nothing here predicts
 * what a record will leave: a Rift record writes nothing to the row, so the row already is the next
 * game.
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
  /** The next game: `group_modes`. */
  row: ModeRow;
  lobbyStatus: LobbyStatusValue | null;
  /** This game: the lobby's lock, or null. */
  lock: ModeLock | null;
  classFacts: ClassFacts | null;
  /** The Fearless pool was reset since the render (a `fearless_state` row): no bans count. */
  poolCleared?: boolean | undefined;
}

export interface ModeCardView {
  /** The game the card is about: the lock while the teams are set or in game, else the row's. */
  shown: Mode;
  rated: boolean;
  /** That game's standing mode (the lock's while locked). */
  standing: StandingModeId;
  /** The card is the lobby's lock (balanced or in game). */
  locked: boolean;
  /** Admins, after Roll, when the row says more than the lock: `Next game: Mages only.` */
  nextLine: string | null;
  /** Class wars: the open count for `Tanks only · 12 open` (under Fearless only), else null. */
  classOpen: number | null;
  /** Class wars: open champions of the class per usual lane, for the tiles and `Your lane`. */
  laneCounts: Record<RoleValue, number> | null;
  /**
   * The row's pending rule (region wars with its pair), whatever the card shows: what a Spin
   * broadcast must match before the reveal plays (M15.5 review), and what it names. Null with none.
   */
  pending: PendingRule | null;
}

const LOCKED_STATUSES: ReadonlySet<LobbyStatusValue> = new Set(['balanced', 'in_game']);

/** The row as the mode it plays: the pending rule, else the standing mode. */
export function rowMode(row: ModeRow): Mode {
  return row.pending ?? { id: row.standing };
}

export function modeCardViewFrom(input: ModeCardViewInput): ModeCardView {
  const { row, lock } = input;
  const live = input.lobbyStatus !== null && LOCKED_STATUSES.has(input.lobbyStatus);
  const locked = live && lock !== null;

  const shown: Mode = locked ? lock.mode : rowMode(row);
  const standing = locked ? lock.standing : row.standing;
  const rated = locked ? lockRated(lock) : nextRated(row);

  let classOpen: number | null = null;
  let laneCounts: Record<RoleValue, number> | null = null;
  if (shown.id === 'class' && input.classFacts !== null) {
    const facts = input.classFacts[shown.tag];
    const count = standing === 'fearless' && input.poolCleared !== true ? facts.banned : facts.all;
    classOpen = standing === 'fearless' ? count.open : null;
    laneCounts = { ...count.lanes };
  }

  return {
    shown,
    rated,
    standing,
    locked,
    nextLine: locked ? nextLineOf(row, lock) : null,
    classOpen,
    laneCounts,
    pending: row.pending,
  };
}

const modeKeyOf = (mode: Mode): string => {
  const rule = ruleOf(mode);
  return rule === null ? mode.id : ruleKey(rule);
};

/**
 * `Next game: …` after Roll, read off the row: nothing while the row is as Roll left it (no rule,
 * Rated at its default, the lock's standing mode). The mode is named unless it is this game's;
 * Rated is said when it is not the next mode's default, or when it is all that differs from this
 * game.
 */
export function nextLineOf(row: ModeRow, lock: ModeLock): string | null {
  if (row.pending === null && row.rated === null && row.standing === lock.standing) return null;
  const next = rowMode(row);
  const choice = row.pending ?? row.standing;
  const rated = nextRated(row);
  const sameMode = modeKeyOf(next) === modeKeyOf(lock.mode);
  const saysRated = rated !== modeRatedDefault(next.id) || (sameMode && rated !== lockRated(lock));
  if (!saysRated) return nextGameLine(choice);
  return nextGameLine(sameMode ? null : choice, rated);
}

/**
 * Whether the card and the panel show the Fearless pool (M15.14): standing Fearless itself, or a
 * mirror match on a Fearless night, which keeps every Fearless ban (only its lanes' rule is new).
 * Class and region wars show their own pools with the bans folded in, so they are not this.
 */
export function showsFearlessPool(view: Pick<ModeCardView, 'shown' | 'standing'>): boolean {
  return view.shown.id === 'fearless' || (view.shown.id === 'mirror' && view.standing === 'fearless');
}

/** The select's value: what is set for the next game, a standing mode or a rule key (`class:Tank`). */
export function selectValue(row: ModeRow): string {
  return row.pending === null ? row.standing : ruleKey(row.pending);
}

/**
 * Which rule options the select greys out with ` (too few open)` (D7): under standing Fearless, the
 * rules unplayable with tonight's bans. The rule already pending stays selectable.
 */
export function tooFewFrom(row: ModeRow, unplayable: UnplayableRules, poolCleared = false): string[] {
  const list = row.standing === 'fearless' && !poolCleared ? unplayable.banned : unplayable.all;
  const pending = row.pending === null ? null : ruleKey(row.pending);
  return list.filter((key) => key !== pending);
}

/**
 * What the members' `Normal mode now.` note needs from the night besides the switch: the newest
 * finished tape entry, and whether a lobby is in game or finished now. Computed on the server
 * (`normalNoteFactsOf`, `view.ts`), so the client card can answer the note for a switch it heard
 * after the render.
 */
export interface NormalNoteFacts {
  /** The newest `createdAt` (ms) of tonight's tape entries with a result, or null with none. */
  lastResultAt: number | null;
  finishedNow: boolean;
}

/**
 * The members' dashed `Normal mode now.` note (M14.30): the group is on plain Normal, an admin
 * switched Fearless off at `since`, and no game has landed since (a game landing ends the moment).
 *
 * M20.8: `since` is the admin write itself, as this page heard it (the client mode store records
 * the `group_modes` row that moved the standing mode from Fearless to Normal; only an admin's
 * Set mode moves it). It used to be `group_modes.updated_at`, which Roll and the hand-backs move
 * too since M20.7. A page opened after the switch has no `since` and shows no note.
 */
export function normalNote(
  facts: NormalNoteFacts,
  card: { standing: StandingModeId; pending: PendingRule | null; since: string | null },
): boolean {
  if (card.standing !== 'normal' || card.since === null) return false;
  // M15.5: a pending rule is what the card shows; the note is about plain Normal.
  if (card.pending !== null) return false;
  const since = Date.parse(card.since);
  if (!Number.isFinite(since)) return false;
  const laterGame = facts.lastResultAt !== null && facts.lastResultAt > since;
  return !laterGame && !facts.finishedNow;
}
