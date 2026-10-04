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
 * Ask the tonight page to re-read now (a roll, a role tap, a self-link, a lobby start were
 * answered). `TonightLive` listens; with no tonight page mounted nothing happens. An event rather
 * than a router call so a control never depends on where it is rendered.
 */
export function requestTonightRefresh(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TONIGHT_REFRESH_EVENT));
}

/** The Tonight tab's dot: a live lobby **and** a subscribed channel, never one without the other. */
export function showsLiveDot(live: LiveState): boolean {
  return live.mounted && live.lobbyLive && live.connection === 'live';
}
