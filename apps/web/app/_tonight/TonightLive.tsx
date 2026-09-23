'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { BoardRow } from '@/lib/board/types';
import type { MysteryPageState } from '@/lib/mystery/service';
import { createPublicClient } from '@/lib/publicClient';
import { loadTonight } from '@/lib/tonight/load';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { hasNamelessRow, tonightState } from '@/lib/tonight/state';
import type { TonightSnapshot } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { TonightView } from './TonightView';

/**
 * The live half of the tonight page (M3.4).
 *
 * The server rendered the first paint with real content, so the WhatsApp link never opens on a
 * spinner. This attaches after hydration, subscribes to `postgres_changes` on the published
 * tables, and re-reads the same snapshot the server built whenever one of them
 * moves. React then replaces the primary block in place: no append, no scroll, no refetch of
 * anything the reader is not looking at.
 *
 * **Every event re-reads; no event is trusted to carry state.** A `postgres_changes` payload
 * is one row of one table, and every state on this page is five joins wide — the newest lobby,
 * its members, its promoted split, its game. Re-reading is one round trip on a page nobody is
 * scrolling, and it means the live path and the first paint can never disagree.
 *
 * If the socket drops, `supabase-js` reconnects by itself and we re-read once on the way back
 * up. No banner, no toast, no "reconnecting…": the design has no toasts, and a page that
 * shouts at 1 a.m. about a socket is worse than a page that is quietly a few seconds stale.
 */

/** Published in migration 0001, and publicly readable. `players` is in neither list. */
const LIVE_TABLES = [
  'lobbies',
  'lobby_members',
  'splits',
  'games',
  'game_players',
  'ratings',
  'fearless_state',
] as const;

/** Ten members joining at once is one re-read, not ten. */
const COALESCE_MS = 120;

/**
 * How often the page re-reads names while any row says `Someone`.
 *
 * `players` is service-role only and is in no Realtime publication, so a name arriving is the
 * one change that will never turn up as an event (M3.10 promises it replaces itself live).
 * The timer stops as soon as no row is nameless.
 */
const NAME_REREAD_MS = 60_000;

/**
 * How often the page asks the server what became of a pending `create_lobby` (M4.2).
 *
 * **A poll, not a subscription, and not by choice.** `companion_commands` has no RLS policy at
 * all and is in no Realtime publication (`0001_init.sql`) — the browser may not read that table
 * with the anon key and will never be sent an event about it — so the only way to learn that
 * the host's client answered is to ask this route's server components again. Five seconds is
 * the companion's own poll interval, so the page cannot be more than one companion tick behind
 * the client, and the command lives sixty seconds, so this runs at most a dozen times and only
 * for the one admin who pressed the button.
 */
const START_POLL_MS = 5_000;

export interface TonightLiveProps {
  initial: TonightSnapshot;
  /** Who is reading, decided on the server from the session (`lib/viewer.ts`). */
  viewer: ViewerState;
  /**
   * The rail's `Top of the board`, read on the server with the page. It is **not** re-read on a
   * Realtime event: the rail never carries state, and a board that reshuffled itself while
   * somebody was reading the teams beside it would be the one thing on the page that moves for
   * no reason a reader can see.
   */
  topPlayers: readonly BoardRow[];
  /**
   * Tonight's newest `create_lobby`, read on the server for a linked viewer only. Re-read by
   * `router.refresh()` — see {@link START_POLL_MS} — and never by the snapshot's own re-read,
   * which is made with the anon key and cannot see that table.
   */
  lobbyStart?: LobbyStartView | null;
  mystery?: MysteryPageState | null;
}

export function TonightLive({
  initial,
  viewer,
  topPlayers,
  lobbyStart = null,
  mystery = null,
}: TonightLiveProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const router = useRouter();
  const [, startTransition] = useTransition();
  /**
   * Who the viewer is comes from the **session**, on the server, so the self-link (M3.6) is
   * the one change on this page that Realtime cannot deliver: it writes `players.discord_id`,
   * which is in no publication and which the browser may not read. `router.refresh()` re-reads
   * this route's server components — the page's viewer and the shell's footer — in place. It
   * is not a navigation: no document load, no scroll, and the pressed control keeps focus.
   */
  const onViewerChanged = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);
  /**
   * The same re-read, for the same reason: `companion_commands` is service-role only, so the
   * answer to "did the lobby open?" is a server render and not an event. One function, two
   * callers, so a press and a self-link cannot end up refreshing two different things.
   */
  const refreshServer = onViewerChanged;
  const startPending = lobbyStart?.status === 'pending' || lobbyStart?.status === 'sent';

  useEffect(() => {
    if (!startPending) return;
    const timer = setInterval(refreshServer, START_POLL_MS);
    return () => clearInterval(timer);
  }, [startPending, refreshServer]);
  const refresh = useRef<() => void>(() => {});
  const nightStart = initial.nightStart;
  /**
   * The slug the **server** formatted, carried through every re-read. The browser has no
   * `CUSTOMS_NIGHT_TZ`, so formatting it here would quietly use the default zone and could
   * change the weekday under the reader a second after the first paint (M3.18, reviewer).
   */
  const nightLabel = initial.nightLabel;
  /** The zone's offset for the night, for the tape's clocks, by the same rule (M11.2). */
  const [nightClock] = useState(initial.nightClock);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    const client = createPublicClient();

    const schedule = (): void => {
      if (cancelled || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, COALESCE_MS);
    };

    const run = async (): Promise<void> => {
      // One read at a time. Events that land while one is in flight collapse into a single
      // follow-up, so a burst of ten inserts cannot queue ten round trips.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const next = await loadTonight(client, { nightStart: new Date(nightStart), nightLabel, nightClock });
        if (!cancelled) setSnapshot(next);
      } catch (error) {
        // The last snapshot stays on the screen. A failed read is not something to announce.
        console.error('tonight: re-reading the page failed', error);
      } finally {
        inFlight = false;
        if (again && !cancelled) {
          again = false;
          schedule();
        }
      }
    };

    refresh.current = schedule;

    const channel = client.channel('tonight');
    for (const table of LIVE_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
    }
    channel.subscribe((status) => {
      // The first subscribe and every reconnect land here: re-read once, say nothing.
      if (status === 'SUBSCRIBED') schedule();
    });

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [nightStart, nightLabel, nightClock]);

  const nameless = hasNamelessRow(tonightState(snapshot), snapshot.tape);

  useEffect(() => {
    if (!nameless) return;

    const reread = (): void => refresh.current();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') reread();
    };

    const interval = setInterval(reread, NAME_REREAD_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [nameless]);

  return (
    <TonightView
      snapshot={snapshot}
      viewer={viewer}
      topPlayers={topPlayers}
      lobbyStart={lobbyStart}
      onViewerChanged={onViewerChanged}
      onLobbyStarted={refreshServer}
      mystery={mystery}
    />
  );
}
