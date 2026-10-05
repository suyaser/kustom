import { useCallback, useSyncExternalStore } from 'react';

/**
 * The Mode card's admin controls' own state, per group (M19.13; audit defects 2, 7 and 8).
 *
 * The controls show what the client mode store says (the select's value, the Rated switch): those
 * come in as props and are never copied into local state. What is left is only what the page cannot
 * know: the **unsaved pick** in the select, **which write is in flight**, how long Spin stays quiet
 * for its reveal, and the outcome line. One reducer holds it.
 *
 * It lives in a small external store keyed by group, not in component state, because Tonight draws
 * the Mode card in a different place per lobby phase (filling, teams, finished, idle): a Roll moves
 * the card and React mounts the controls afresh. Kept here, an unsaved pick, a write in flight, a
 * Spin's quiet time and the outcome line all survive the move. No names, no ids.
 */

/** A region control's write (M20.10): which control, on which game's pair. */
export type RegionWrite = `${'redraw' | 'blue' | 'red'}-${'next' | 'this'}`;

export type ControlsWrite = 'mode' | 'spin' | 'rated' | RegionWrite;

export interface ControlsState {
  /** The select's unsaved choice, or null to follow the card. */
  pick: string | null;
  /** The write in flight, or null. */
  pending: ControlsWrite | null;
  /** Spin stays quiet until this time (ms since epoch) for its own reveal, or null. */
  spinUntil: number | null;
  /** The outcome line of the last write. */
  said: string | null;
  /** The refusal of the last write (`role="alert"`). */
  failed: string | null;
  /** A write happened here: a no-JS `?notice=` / `?error=` no longer applies. */
  acted: boolean;
}

export type ControlsAction =
  | { type: 'pick'; value: string }
  | { type: 'start'; write: ControlsWrite }
  | { type: 'refused'; failed: string }
  | { type: 'answered'; said: string | null; spinUntil?: number | null }
  | { type: 'spin-free' };

export const IDLE_CONTROLS: ControlsState = {
  pick: null,
  pending: null,
  spinUntil: null,
  said: null,
  failed: null,
  acted: false,
};

/** Pure, so every transition is a unit test. */
export function controlsReducer(state: ControlsState, action: ControlsAction): ControlsState {
  switch (action.type) {
    case 'pick':
      return { ...state, pick: action.value };
    case 'start':
      if (state.pending !== null) return state;
      return { ...state, pending: action.write, said: null, failed: null, acted: true };
    case 'refused':
      // The pick goes back to the card: the select shows what is really set.
      return { ...state, pending: null, pick: null, failed: action.failed };
    case 'answered':
      return {
        ...state,
        pending: null,
        pick: null,
        said: action.said,
        spinUntil: action.spinUntil === undefined ? state.spinUntil : action.spinUntil,
      };
    case 'spin-free':
      return { ...state, spinUntil: null };
  }
}

let states = new Map<string, ControlsState>();
const listeners = new Set<() => void>();

export function controlsOf(groupId: string): ControlsState {
  return states.get(groupId) ?? IDLE_CONTROLS;
}

export function dispatchControls(groupId: string, action: ControlsAction): ControlsState {
  const next = controlsReducer(controlsOf(groupId), action);
  if (next !== controlsOf(groupId)) {
    states = new Map(states).set(groupId, next);
    for (const listener of listeners) listener();
  }
  return next;
}

/** Tests only: forget every group. */
export function resetControlsForTests(): void {
  states = new Map();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The controls' state for a group, and its dispatch. The server render sees the idle state. */
export function useControls(groupId: string): [ControlsState, (action: ControlsAction) => ControlsState] {
  const state = useSyncExternalStore(
    subscribe,
    () => controlsOf(groupId),
    () => IDLE_CONTROLS,
  );
  const dispatch = useCallback((action: ControlsAction) => dispatchControls(groupId, action), [groupId]);
  return [state, dispatch];
}
