'use client';

import { ruleKey } from '@customs/core';
import { useEffect, useRef } from 'react';
import { createLiveClient } from '@/lib/liveClient';
import { SPIN_BROADCAST, SPIN_BROADCAST_EVENT, SPIN_REVEAL_EVENT, spinDetail } from '@/lib/mode/spinEvents';
import {
  resetLiveState,
  setLiveState,
  TONIGHT_PRESS_EVENT,
  TONIGHT_REFRESH_EVENT,
  type TonightPressDetail,
  type TonightRefreshDetail,
} from '@/lib/tonight/live';
import { REFRESH_DEBOUNCE_MS, RefreshScheduler } from '@/lib/tonight/refreshScheduler';
import { useCommittedRefresh } from '@/lib/useCommittedRefresh';

/**
 * The live half of the tonight page (M3.4; rebuilt for 2.0 in M14.9).
 *
 * The server renders the whole page, every state, with real content, so the WhatsApp link never
 * opens on a spinner. This attaches after hydration, subscribes to `postgres_changes` on the
 * published tables for **this group** (M13.9's filters), and on any change asks the server for the
 * page again with `router.refresh()`. React swaps the new server payload in place: no document
 * load, no scroll, client state (a pressed role, an open `How the bot decided`) kept.
 *
 * **Every event re-reads; no event is trusted to carry state** (M3.4's rule, unchanged). What
 * changed in M14.9 is *who* re-reads: the server, with the same loader as the first paint, instead
 * of the browser running the loader with the anon key. So the receipt, the poster, the tape and
 * the rail are server components that never ship to the phone (the brief's "the client island is
 * the live part only"), and server-only facts (who would sit out, the calibration line) stay
 * current on the same refresh. Decision row proposed in the M14.9 report.
 *
 * It also re-reads when the tab becomes visible again and whenever the channel (re)subscribes, so a
 * phone that slept shows the current state. The connection state is published to `lib/tonight/live`
 * for the strip's live tag and the Tonight tab's dot; neither says `Live` until `SUBSCRIBED`.
 *
 * **One re-read at a time, once per change** (M19.3): every trigger goes through one
 * {@link RefreshScheduler} — a trailing debounce with a max wait, single flight with exactly one
 * follow-up for changes heard mid-render, and controls' asks joined to a render that started after
 * their route answered. A press holds renders until its route answers (`beginTonightPress`), so the
 * route's own rows and its answer are one render. A control's ask resolves when that render has
 * committed, so its button stays pending until the screen it changed has changed.
 *
 * It renders nothing.
 *
 * **Never cache a snapshot on the client** (M14.69, code review): every name on the page carries its
 * same-name label (`Ali (2)`), which only the server render folds in (`labelSnapshot` over
 * `loadRosterLabels`). A client-kept or client-patched snapshot would print the bare names, so a
 * change always goes back to the server for the whole page.
 */

/** Published, publicly readable, and group-scoped or reached through a group-scoped lobby. */
const LIVE_TABLES = [
  'lobbies',
  'lobby_members',
  'splits',
  'games',
  'game_players',
  'ratings',
  'fearless_state',
  // M14.29's mode (0024 publishes it): a mode change shows on the Mode card without a reload.
  'group_modes',
] as const;

type LiveTable = (typeof LIVE_TABLES)[number];

/**
 * The published tables that carry `group_id` (M13.2, M14.29). Their events are filtered to the
 * page's group **by the server** (`group_id=eq.<id>`), so a game landing in another group never
 * reaches this page and never re-renders it (M13.9).
 *
 * `lobby_members` and `splits` reach their group through their lobby and have no column to filter
 * on, so they stay unfiltered: another group's lobby filling costs this page one re-render that
 * comes back unchanged. Correct, and cheap.
 */
const GROUP_SCOPED: ReadonlySet<LiveTable> = new Set([
  'lobbies',
  'games',
  'game_players',
  'ratings',
  'fearless_state',
  'group_modes',
]);

export interface LiveSubscription {
  table: LiveTable;
  /** A Realtime `postgres_changes` filter, or absent for a table with no `group_id`. */
  filter?: string;
}

/** What the page listens to for one group. Pure, so the filter is a unit test. */
export function liveSubscriptions(groupId: string): LiveSubscription[] {
  return LIVE_TABLES.map((table) =>
    GROUP_SCOPED.has(table) ? { table, filter: `group_id=eq.${groupId}` } : { table },
  );
}

/** Ten members joining at once is one re-render, not ten (the scheduler's trailing debounce). */
export const COALESCE_MS = REFRESH_DEBOUNCE_MS;

/** No `SUBSCRIBED` this long after mounting reads as down, not as still connecting (5.4). */
export const CONNECT_TIMEOUT_MS = 8_000;

/**
 * How often the page re-reads while any name on it says `Someone`: `players` is in no publication,
 * so a name arriving is the one change that never turns up as an event (M3.10).
 */
export const NAME_REREAD_MS = 60_000;

/**
 * How often the page asks what became of a pending `create_lobby` (M4.2): `companion_commands` is
 * service-role only and in no publication, so a poll, at the companion's own five seconds, for the
 * one viewer who pressed the button and only while the command is live.
 */
export const START_POLL_MS = 5_000;

export interface TonightLiveProps {
  groupId: string;
  /** A lobby is filling, set or in game (the server's `tonightHeader(...).live`). */
  lobbyLive: boolean;
  /** Some name on the page is still the fallback word. */
  nameless?: boolean | undefined;
  /** Tonight's `create_lobby` is pending or sent (linked viewers only). */
  startPending?: boolean | undefined;
}

export function TonightLive({
  groupId,
  lobbyLive,
  nameless = false,
  startPending = false,
}: TonightLiveProps) {
  const { refresh: committedRefresh } = useCommittedRefresh();
  const run = useRef(committedRefresh);
  run.current = committedRefresh;
  const scheduler = useRef<RefreshScheduler | null>(null);
  const refresh = useRef<() => void>(() => {});

  // One scheduler per mounted page: every trigger below is a `change()`, every control an `ask()`.
  useEffect(() => {
    const live = new RefreshScheduler({ run: () => run.current() });
    scheduler.current = live;
    refresh.current = () => live.change();
    return () => {
      live.dispose();
      scheduler.current = null;
      refresh.current = () => {};
    };
  }, []);

  useEffect(() => {
    setLiveState({ lobbyLive, mounted: true });
  }, [lobbyLive]);

  useEffect(() => {
    let cancelled = false;
    // realtime-js alone, anon key (M14.44): the island only listens.
    const client = createLiveClient();
    setLiveState({ connection: 'connecting', mounted: true });
    const timeout = setTimeout(() => {
      if (!cancelled) setLiveState({ connection: 'reconnecting' });
    }, CONNECT_TIMEOUT_MS);

    const channel = client.channel(`tonight:${groupId}`);
    const onChange = (): void => refresh.current();
    for (const { table, filter } of liveSubscriptions(groupId)) {
      channel.on(
        'postgres_changes',
        filter === undefined
          ? { event: '*', schema: 'public', table }
          : { event: '*', schema: 'public', table, filter },
        onChange,
      );
    }
    // M15.5: another admin's Spin, said on the channel so every open page plays the same reveal.
    // The card itself still comes from the database (`group_modes` above); this only names the rule,
    // and the reveal plays only once the card's pending rule confirms it (`SpinReveal`).
    channel.on('broadcast', { event: SPIN_BROADCAST }, (message) => {
      const rule = spinDetail({ payload: message.payload });
      if (rule === null) return;
      const detail = { rule: ruleKey(rule), source: 'broadcast' };
      window.dispatchEvent(new CustomEvent(SPIN_REVEAL_EVENT, { detail }));
    });
    channel.subscribe((status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        setLiveState({ connection: 'live' });
        // The first subscribe and every reconnect: anything that moved while we were not
        // listening is on the page after one re-read.
        refresh.current();
        return;
      }
      // CHANNEL_ERROR, TIMED_OUT, CLOSED: realtime-js retries by itself; say so until it is back.
      setLiveState({ connection: 'reconnecting' });
    });

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh.current();
    };
    const onAsked = (event: Event): void => {
      const live = scheduler.current;
      if (live === null) return;
      const detail = (event as CustomEvent<TonightRefreshDetail | null>).detail;
      if (detail === null || typeof detail !== 'object') {
        void live.ask();
        return;
      }
      detail.answered = live.ask(detail.answeredAt);
    };
    const onPress = (event: Event): void => {
      const detail = (event as CustomEvent<TonightPressDetail | null>).detail;
      const live = scheduler.current;
      if (live === null || detail === null || typeof detail !== 'object') return;
      detail.release = live.hold();
    };
    const onSpun = (event: Event): void => {
      const rule = spinDetail(event);
      if (rule === null) return;
      void channel.send({ type: 'broadcast', event: SPIN_BROADCAST, payload: { rule: ruleKey(rule) } });
    };
    window.addEventListener(SPIN_BROADCAST_EVENT, onSpun);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener(TONIGHT_REFRESH_EVENT, onAsked);
    window.addEventListener(TONIGHT_PRESS_EVENT, onPress);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener(TONIGHT_REFRESH_EVENT, onAsked);
      window.removeEventListener(TONIGHT_PRESS_EVENT, onPress);
      window.removeEventListener(SPIN_BROADCAST_EVENT, onSpun);
      void client.removeChannel(channel);
      resetLiveState();
    };
  }, [groupId]);

  useEffect(() => {
    if (!nameless) return;
    const interval = setInterval(() => refresh.current(), NAME_REREAD_MS);
    return () => clearInterval(interval);
  }, [nameless]);

  useEffect(() => {
    if (!startPending) return;
    const interval = setInterval(() => refresh.current(), START_POLL_MS);
    return () => clearInterval(interval);
  }, [startPending]);

  return null;
}
