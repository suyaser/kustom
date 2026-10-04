'use client';

import { ruleKey } from '@customs/core';
import { useEffect, useRef } from 'react';
import { createLiveClient } from '@/lib/liveClient';
import { applyFearlessReset, applyModeRow } from '@/lib/mode/clientStore';
import { modeRowParsers } from '@/lib/mode/liveRows';
import { SPIN_BROADCAST, SPIN_BROADCAST_EVENT, SPIN_REVEAL_EVENT, spinDetail } from '@/lib/mode/spinEvents';
import {
  resetLiveState,
  setLiveState,
  TONIGHT_PRESS_EVENT,
  TONIGHT_REFRESH_EVENT,
  type TonightPressDetail,
  type TonightRefreshDetail,
} from '@/lib/tonight/live';
import {
  groupLiveFilter,
  groupLiveParser,
  LiveVersionGate,
  readGroupLive,
  warnMalformedLiveRow,
} from '@/lib/tonight/liveSignal';
import { REFRESH_DEBOUNCE_MS, RefreshScheduler } from '@/lib/tonight/refreshScheduler';
import { useCommittedRefresh } from '@/lib/useCommittedRefresh';

/**
 * The live half of the tonight page (M3.4; rebuilt for 2.0 in M14.9).
 *
 * The server renders the whole page, every state, with real content, so the WhatsApp link never
 * opens on a spinner. This attaches after hydration, subscribes to **its own group's live signal**
 * (`group_live`, filtered `group_id=eq.<id>`, M19.10) and, when its version moves past the one the
 * page has shown, asks the server for the page again with `router.refresh()`. React swaps the new
 * server payload in place: no document load, no scroll, client state (a pressed role, an open
 * `How the bot decided`) kept.
 *
 * **One signal, after the writes** (M19.10, supersedes decision row 2026-10-03 on per-table
 * filters). Every write route bumps `group_live` as its last statement, so an end-of-game block is
 * one event that arrives after the game, its players and its ratings are readable: one render, never
 * a half-written game, and another group's activity never reaches this page. The per-table
 * subscriptions are gone; `group_modes` and `fearless_state` are still heard (filtered) for the
 * Mode card's client slice (M19.13): they never start a render themselves, because their writers
 * bump too and a render from their earlier row would read the eog half-written. Every row is parsed
 * strictly (`groupLiveRowSchema`) and a row that fails is dropped; a DELETE (the group itself was
 * deleted, or a mode row went) re-reads, and the server answers with what is true now.
 *
 * **The client may hold a name-free slice patched from a `postgres_changes` row this channel
 * received (never from a broadcast). Anything that prints a player's name comes from the server
 * render** (decision row 2026-10-04, M19.13; narrows M14.69's rule below and the 2026-09-09
 * "re-read, don't apply payloads" row for this slice only). The slice is the Mode card's state
 * (`lib/mode/clientStore.ts`): each `group_modes` row goes into the client mode store, gated on its
 * `version`, and each `fearless_state` row moves the pool's reset time; `set_by`,
 * `pending_set_by` and `reset_by` are never read into it. So a `mode` bump (Rated, Set mode, Spin)
 * whose `group_modes` row has arrived re-reads nothing: the card, its controls, the announcer and
 * the mirror host line follow the store, and the page costs no server render. A `mode` bump still
 * re-reads when its row does not arrive within {@link MODE_ROW_WAIT_MS}, when a Fearless reset was
 * heard (the pool, the panel and the `Banned next game` ten are the server's), and while the mode
 * panel is open over the page (its pool is a server render).
 *
 * **Every other change re-reads; no other event is trusted to carry state** (M3.4's rule): the row
 * only says *that* the group moved. The server re-reads with the same loader as the first paint,
 * so the receipt, the poster, the tape and the rail are server components that never ship to the
 * phone, and server-only facts (who would sit out, the calibration line) stay current.
 *
 * On the first `SUBSCRIBED`, every reconnect, a visible tab and `online` it reads the row once and
 * re-reads the page only if the version moved past the one shown, or is unknown (missed events are
 * not replayed): opening the page is one render, and a phone that slept shows the current state. The connection state is published to `lib/tonight/live`
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
 * change to anything that prints a name always goes back to the server for the whole page. The
 * Mode card's state is the one exception (above): it prints no name.
 */

/**
 * What the page listens to (M19.10): its group's live row, and the Mode card's two rows for M19.13.
 * Every one filtered to the group by the server, so another group's activity never arrives.
 */
const LIVE_TABLES = ['group_live', 'group_modes', 'fearless_state'] as const;

type LiveTable = (typeof LIVE_TABLES)[number];

export interface LiveSubscription {
  table: LiveTable;
  /** A Realtime `postgres_changes` filter: always the page's group. */
  filter: string;
}

/** What the page listens to for one group. Pure, so the filter is a unit test. */
export function liveSubscriptions(groupId: string): LiveSubscription[] {
  return LIVE_TABLES.map((table) => ({ table, filter: groupLiveFilter(groupId) }));
}

/** Ten members joining at once is one re-render, not ten (the scheduler's trailing debounce). */
export const COALESCE_MS = REFRESH_DEBOUNCE_MS;

/**
 * After a press answers, how long its hold waits for the route's own `group_live` bump (M19.10):
 * every write route bumps as its last statement, so the bump is committed before the answer, but
 * Realtime can deliver it a little after. Waiting for it means the one render after the press
 * starts after the bump has arrived, so the bump is never a follow-up. A route that wrote nothing
 * sends no bump; its re-read waits this long instead.
 */
export const PRESS_BUMP_WAIT_MS = 500;

/**
 * How long a `mode` bump waits for its `group_modes` row before it re-reads the page instead (M19.13).
 * The route writes the row before it bumps, so the row is normally first; this covers a row that
 * arrives late, or not at all.
 */
export const MODE_ROW_WAIT_MS = 500;

/** The mode panel is open over the page (`/g/<slug>/mode`): its pool is a server render. */
function modePanelOpen(): boolean {
  return typeof window !== 'undefined' && /\/mode\/?$/.test(window.location.pathname);
}

/** No `SUBSCRIBED` this long after mounting reads as down, not as still connecting (5.4). */
export const CONNECT_TIMEOUT_MS = 8_000;

/**
 * How often the page re-reads while any name on it says `Someone`: `players` is in no publication,
 * so a name arriving is the one change that never turns up as an event (M3.10). **Kept by M19.17**:
 * a name can arrive with no `group_live` bump (a lobby post that changed nobody's seat writes only
 * the player row), it costs one render a minute and only while a fallback name is on screen.
 *
 * The 5 s page poll for a pending `Start a lobby` is gone (M19.17): `StartLobby` polls the small
 * status route itself and asks for one render when the command settles.
 */
export const NAME_REREAD_MS = 60_000;

export interface TonightLiveProps {
  groupId: string;
  /**
   * The `group_live.version` the server render showed (`lib/tonight/liveVersion.ts`), or null when
   * unknown: the first subscribe then re-reads.
   */
  liveVersion?: number | null | undefined;
  /** A lobby is filling, set or in game (the server's `tonightHeader(...).live`). */
  lobbyLive: boolean;
  /** Some name on the page is still the fallback word. */
  nameless?: boolean | undefined;
}

export function TonightLive({ groupId, liveVersion = null, lobbyLive, nameless = false }: TonightLiveProps) {
  const { refresh: committedRefresh } = useCommittedRefresh();
  const run = useRef(committedRefresh);
  run.current = committedRefresh;
  const scheduler = useRef<RefreshScheduler | null>(null);
  const refresh = useRef<() => void>(() => {});
  const gate = useRef(new LiveVersionGate(liveVersion));

  // Each render that arrives showed at least its own version.
  useEffect(() => {
    gate.current.rendered(liveVersion);
  }, [liveVersion]);

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
    /** Answered presses whose hold waits for their route's bump (or {@link PRESS_BUMP_WAIT_MS}). */
    const awaitingBump = new Set<() => void>();
    /** Presses still with their route, and whether a bump has arrived since each began. */
    const pressing = new Set<{ bumped: boolean }>();
    /**
     * Matching `mode` bumps to their `group_modes` rows (M19.13): rows heard that no bump has
     * claimed yet, bumps still waiting for their row, and whether a Fearless reset was heard. All
     * three start again with every re-read (the render shows everything heard before it).
     */
    const modes = {
      rowsAhead: 0,
      bumpsWaiting: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
      reset: false,
    };
    const rereadAll = (): void => {
      modes.rowsAhead = 0;
      modes.bumpsWaiting = 0;
      modes.reset = false;
      if (modes.timer !== null) clearTimeout(modes.timer);
      modes.timer = null;
      refresh.current();
    };
    /**
     * A row (or the version check) says the group is at `version`: re-read if the page is behind,
     * unless it is a `mode` bump the client mode store has already answered (M19.13).
     */
    const offer = (version: number, kind: string | null = null): void => {
      if (!gate.current.moved(version)) return;
      for (const press of pressing) press.bumped = true;
      if (kind === 'mode' && !modes.reset && !modePanelOpen()) {
        if (modes.rowsAhead > 0) modes.rowsAhead -= 1;
        else {
          modes.bumpsWaiting += 1;
          modes.timer ??= setTimeout(() => {
            modes.timer = null;
            if (modes.bumpsWaiting > 0) rereadAll();
          }, MODE_ROW_WAIT_MS);
        }
      } else {
        // Marked while still held, then let go: the render starts a debounce after this row.
        rereadAll();
      }
      for (const free of [...awaitingBump]) free();
    };
    /** A `group_modes` row arrived: it answers a `mode` bump waiting for it, or the next one. */
    const modeRowHeard = (): void => {
      if (modes.bumpsWaiting === 0) {
        modes.rowsAhead += 1;
        return;
      }
      modes.bumpsWaiting -= 1;
      if (modes.bumpsWaiting === 0 && modes.timer !== null) {
        clearTimeout(modes.timer);
        modes.timer = null;
      }
    };
    // The row parsers are a dynamic import: start it now, so the first row finds it loaded.
    void modeRowParsers();
    /** After a gap (subscribe, reconnect, visible, online): read the row; unknown re-reads. */
    const check = (): void => {
      void readGroupLive(groupId).then((row) => {
        if (cancelled) return;
        // After a gap the mode rows may have been missed too: a moved version always re-reads.
        if (row === null) rereadAll();
        else offer(row.version);
      });
    };
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'group_live', filter: groupLiveFilter(groupId) },
      (payload: { eventType?: string; new?: unknown }) => {
        // The group was deleted: the re-read answers with its not-found page.
        if (payload.eventType === 'DELETE') {
          rereadAll();
          return;
        }
        // The parser is asked per row: a schema chunk that failed to load is retried next time.
        void groupLiveParser().then((read) => {
          if (cancelled || read === null) return;
          const row = read(payload.new);
          if (row === null) {
            warnMalformedLiveRow(payload.new);
            return;
          }
          if (row.group_id !== groupId) return;
          offer(row.version, row.kind);
        });
      },
    );
    // The Mode card's client slice (M19.13): each row goes into the client mode store; none
    // starts a render by itself (see the header). A DELETE is never a patch: it re-reads.
    for (const table of ['group_modes', 'fearless_state'] as const) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: groupLiveFilter(groupId) },
        (payload: { eventType?: string; new?: unknown }) => {
          if (payload.eventType === 'DELETE') {
            rereadAll();
            return;
          }
          void modeRowParsers().then((parsers) => {
            if (cancelled || parsers === null) return;
            if (table === 'group_modes') {
              const row = parsers.parseModeRow(payload.new);
              if (row === null) {
                console.warn('group_modes: dropped a malformed row');
                return;
              }
              if (row.groupId !== groupId) return;
              applyModeRow(groupId, row.slice);
              modeRowHeard();
              return;
            }
            const row = parsers.parseFearlessRow(payload.new);
            if (row === null) {
              console.warn('fearless_state: dropped a malformed row');
              return;
            }
            if (row.groupId !== groupId) return;
            applyFearlessReset(groupId, row.resetAt);
            modes.reset = true;
          });
        },
      );
    }
    // M15.5: another admin's Spin, said on the channel so every open page plays the same reveal.
    // The card itself still comes from the database (the `group_modes` row above, into the client
    // mode store); a broadcast never patches it, it only names the rule, and the reveal plays only
    // once the card's pending rule confirms it (`SpinReveal`).
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
        // The first subscribe and every reconnect: re-read only if the group moved while we were
        // not listening (or we cannot tell).
        check();
        return;
      }
      // CHANNEL_ERROR, TIMED_OUT, CLOSED: realtime-js retries by itself; say so until it is back.
      setLiveState({ connection: 'reconnecting' });
    });

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check();
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
      const letGo = live.hold();
      const press = { bumped: false };
      pressing.add(press);
      detail.release = (answered) => {
        pressing.delete(press);
        // Failed, or the route's bump already arrived while it worked: let go now.
        if (!answered || press.bumped) {
          letGo();
          return;
        }
        // Answered: keep holding until the route's own bump arrives, or a moment passes.
        const free = (): void => {
          clearTimeout(timer);
          awaitingBump.delete(free);
          letGo();
        };
        const timer = setTimeout(free, PRESS_BUMP_WAIT_MS);
        awaitingBump.add(free);
      };
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
      for (const free of [...awaitingBump]) free();
      if (modes.timer !== null) clearTimeout(modes.timer);
      void client.removeChannel(channel);
      resetLiveState();
    };
  }, [groupId]);

  useEffect(() => {
    if (!nameless) return;
    const interval = setInterval(() => refresh.current(), NAME_REREAD_MS);
    return () => clearInterval(interval);
  }, [nameless]);

  return null;
}
