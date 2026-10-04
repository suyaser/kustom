import {
  chooseRule,
  chooseStanding,
  type ModeState,
  nextGame,
  type RuleOption,
  type StandingModeId,
  sameRule,
  setRated,
} from '@customs/core';
import { type NextGame, ruleChoiceOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type ModeStore, type StoredModeState, supabaseModeStore } from './state';

/**
 * One write to the Mode card (M14.29, extended by M15.3): the standing mode, the next game's rule,
 * the Rated switch, or a Spin. Core decides the new state (`chooseStanding`, `chooseRule`,
 * `setRated`); this applies it to the group's `group_modes` row, compare-and-set on `version`.
 *
 * **What moves the version.** Every write that changes something. A repeat of the current
 * standing mode with nothing pending and the switch at its default writes nothing (M14.29's
 * `changed: false`, no Realtime event). A rule pick, a Spin and a Rated flip always write, even
 * when they repeat what is pending: a rule re-queued mid-game, or the switch set again, is a
 * choice for the **next** game and must survive the running game's compare-and-clear (decision
 * row 2026-10-04, the version token). A Rated-only flip after Roll changes only Rated: the record
 * still uses up the locked rule (core's `onlyRatedSinceRoll`, the user's decision 2026-10-04).
 *
 * **Two admins at once.** The write is compare-and-set; the loser re-reads and re-applies its
 * action to the winner's state, so the last write wins and nothing is half-applied.
 *
 * Posts nothing to Discord (changing the mode is not news).
 */

export type ModeAction =
  | { kind: 'standing'; standing: StandingModeId }
  /**
   * A rule pick. `playable` (QA fix 2026-10-04) is the server's check for the state it is written
   * on: false refuses the pick (`too-few-open`), unless it is the rule already pending.
   */
  | { kind: 'rule'; rule: RuleOption; playable?: (state: ModeState, rule: RuleOption) => Promise<boolean> }
  | { kind: 'rated'; rated: boolean }
  /** Spin: `draw` is the server's pick for this state (`lib/mode/spin.ts`), or null for none. */
  | { kind: 'spin'; draw: (state: ModeState) => Promise<RuleOption | null> };

export type ModeWriteResult =
  | { ok: true; state: ModeState; changed: boolean; spun: RuleOption | null }
  /** Spin found nothing playable (every option excluded). Nothing was written. */
  | { ok: false; reason: 'nothing-to-spin'; state: ModeState }
  /** A rule pick with too few champions open tonight (Fearless bans counted). Nothing was written. */
  | { ok: false; reason: 'too-few-open'; state: ModeState };

/** Re-reads after a lost compare-and-set before giving up (a write storm, not a normal night). */
const MAX_ATTEMPTS = 5;

export async function writeModeCard(
  store: ModeStore,
  input: { groupId: string; playerId: string; action: ModeAction },
): Promise<ModeWriteResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await store.read(input.groupId);
    const step = await apply(current, input.action);
    if (step.kind === 'nothing-to-spin' || step.kind === 'too-few-open')
      return { ok: false, reason: step.kind, state: current.state };
    if (step.kind === 'unchanged') return { ok: true, state: current.state, changed: false, spun: null };

    const wrote = await store.write(input.groupId, current, step.next, {
      playerId: input.playerId,
      setsRule: input.action.kind === 'rule' || input.action.kind === 'spin',
    });
    if (wrote) return { ok: true, state: step.next, changed: true, spun: step.spun };
  }
  throw new Error(
    `mode: ${MAX_ATTEMPTS} writes in a row lost the compare-and-set for group ${input.groupId}`,
  );
}

type Step =
  | { kind: 'unchanged' }
  | { kind: 'nothing-to-spin' }
  | { kind: 'too-few-open' }
  | { kind: 'write'; next: ModeState; spun: RuleOption | null };

async function apply(current: StoredModeState, action: ModeAction): Promise<Step> {
  const state = current.state;
  switch (action.kind) {
    case 'standing': {
      const repeat =
        state.standing === action.standing && state.pending === null && state.ratedOverride === null;
      // A missing row read as Normal: writing Normal there changes nothing anybody could see.
      if (repeat) return { kind: 'unchanged' };
      return { kind: 'write', next: chooseStanding(state, action.standing), spun: null };
    }
    case 'rule': {
      // The rule already pending stays pickable, as the select keeps it (`tooFewOpen`).
      const pending = sameRule(state.pending, action.rule);
      if (!pending && action.playable !== undefined && !(await action.playable(state, action.rule)))
        return { kind: 'too-few-open' };
      return { kind: 'write', next: chooseRule(state, action.rule), spun: null };
    }
    case 'rated':
      return { kind: 'write', next: setRated(state, action.rated), spun: null };
    case 'spin': {
      const rule = await action.draw(state);
      if (rule === null) return { kind: 'nothing-to-spin' };
      return { kind: 'write', next: chooseRule(state, rule), spun: rule };
    }
  }
}

/** The card's answer for a state: core's `nextGame`, the standing mode and the token. */
export function nextGameOf(state: ModeState): NextGame {
  const next = nextGame(state);
  return {
    standing: state.standing,
    rule: next.rule === null ? null : ruleChoiceOf(next.rule),
    rated: next.rated,
    ratedOverride: state.ratedOverride,
    version: state.version,
  };
}

/**
 * M14.29's entry point, kept: set the standing mode. `changed: false` for a repeat that writes
 * nothing. Picking a standing mode clears a pending rule and resets the Rated switch (R1).
 */
export async function setGroupMode(
  client: ServiceClient,
  input: { groupId: string; mode: StandingModeId; playerId: string },
): Promise<{ mode: StandingModeId; changed: boolean }> {
  const result = await writeModeCard(supabaseModeStore(client), {
    groupId: input.groupId,
    playerId: input.playerId,
    action: { kind: 'standing', standing: input.mode },
  });
  if (!result.ok) throw new Error('mode: a standing-mode write cannot be a spin');
  return { mode: result.state.standing, changed: result.changed };
}
