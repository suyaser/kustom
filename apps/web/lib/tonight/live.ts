import { useSyncExternalStore } from 'react';

/**
 * The tonight page's realtime state, shared with the shell (M14.9; 05-design.md 5.4 and 5.11).
 *
 * `TonightLive` owns the channel and writes here; the live tag on the strip and the Tonight tab's
 * dot read it. A tiny external store rather than a context, because the tab bar is rendered by the
 * group layout, outside the page that owns the channel.
 *
 * - `connection`: the page's **own** channel, never a claim about the host's companion.
 *   `connecting` until the first `SUBSCRIBED`; `reconnecting` after an error, a timeout, a close or
 *   eight seconds without a subscription; `live` while subscribed.
 * - `lobbyLive`: a lobby is filling, set or in game (the server's answer, passed down).
 * - `mounted`: the tonight page is on screen. Off the page there is no channel, so no dot.
 */
export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface LiveState {
  connection: Connection;
  lobbyLive: boolean;
  mounted: boolean;
}

const INITIAL: LiveState = { connection: 'connecting', lobbyLive: false, mounted: false };

let state: LiveState = INITIAL;
const listeners = new Set<() => void>();

export function setLiveState(next: Partial<LiveState>): void {
  const merged = { ...state, ...next };
  if (
    merged.connection === state.connection &&
    merged.lobbyLive === state.lobbyLive &&
    merged.mounted === state.mounted
  ) {
    return;
  }
  state = merged;
  for (const listener of listeners) listener();
}

export function resetLiveState(): void {
  setLiveState(INITIAL);
}

export function getLiveState(): LiveState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server render (and the first client paint) always says `connecting`: nothing is subscribed yet. */
function serverState(): LiveState {
  return INITIAL;
}

export function useLiveState(): LiveState {
  return useSyncExternalStore(subscribe, getLiveState, serverState);
}

/** The event a control fires when its press was answered and the page should re-read now. */
export const TONIGHT_REFRESH_EVENT = 'kustom:tonight-refresh';

/**
 * What rides on {@link TONIGHT_REFRESH_EVENT} (M19.3). `answeredAt` is when the route answered
 * (`Date.now()`), so a render that started after it is known to show the write; `TonightLive`
 * sets `answered` with the promise of the render that covers it. A bare `Event` (no detail) is an
 * ask made now with nobody waiting.
 */
export interface TonightRefreshDetail {
  answeredAt: number;
  answered: Promise<void> | null;
}

/**
 * Ask the tonight page to re-read (M19.3): returns the promise of the render that covers the
 * write, or `null` when no tonight page is mounted. `TonightLive` answers through the event, so a
 * control never depends on where it is rendered.
 */
export function askTonight(answeredAt: number = Date.now()): Promise<void> | null {
  if (typeof window === 'undefined') return null;
  const detail: TonightRefreshDetail = { answeredAt, answered: null };
  window.dispatchEvent(new CustomEvent<TonightRefreshDetail>(TONIGHT_REFRESH_EVENT, { detail }));
  return detail.answered;
}

/**
 * A press was answered (a roll, a reroll, a lobby start, a mode change): ask the tonight page to
 * re-read and wait until the new screen is on. Pass the time the route answered; a render already
 * running since then is joined, not repeated (one render per tap). Resolves at once with no
 * tonight page mounted (`/admin`, a test).
 */
export function requestTonightRefresh(answeredAt: number = Date.now()): Promise<void> {
  return askTonight(answeredAt) ?? Promise.resolve();
}

/** The event a control fires as its press leaves for the route (M19.3). */
export const TONIGHT_PRESS_EVENT = 'kustom:tonight-press';

/** What rides on {@link TONIGHT_PRESS_EVENT}: `TonightLive` sets `release` to its hold's release. */
export interface TonightPressDetail {
  release: (() => void) | null;
}

/** One press, from the tap to the screen it changed (M19.3). */
export interface TonightPress {
  /**
   * The route answered at `answeredAt`: ask for the render that shows it and let the page's
   * renders go again. Resolves when that render has committed (at once with no tonight page).
   */
  answered(answeredAt?: number): Promise<void>;
  /** The press failed or needs no re-read: let the page's renders go again. Safe to call twice. */
  release(): void;
}

/**
 * A press is leaving for its route (Roll, Reroll, Start a lobby, Set mode, Spin, Rated): Tonight
 * holds its renders until the press answers, so the route's own Realtime rows and its answer
 * become one render instead of one mid-write and one after (M19.3). Call `answered` with the
 * answer's time, or `release` when there is nothing to re-read; the hold also ends by itself.
 */
export function beginTonightPress(): TonightPress {
  const detail: TonightPressDetail = { release: null };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<TonightPressDetail>(TONIGHT_PRESS_EVENT, { detail }));
  }
  let open = true;
  const release = (): void => {
    if (!open) return;
    open = false;
    detail.release?.();
  };
  return {
    answered(answeredAt = Date.now()) {
      // Ask first, then let go: the release then starts the one render the ask is waiting on.
      const answered = requestTonightRefresh(answeredAt);
      release();
      return answered;
    },
    release,
  };
}

/** The Tonight tab's dot: a live lobby **and** a subscribed channel, never one without the other. */
export function showsLiveDot(live: LiveState): boolean {
  return live.mounted && live.lobbyLive && live.connection === 'live';
}
