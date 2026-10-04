'use client';

import { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MainTabKey } from '@/lib/nav';
import { TabFrame } from './TabFrame';

/**
 * Tab feedback and pending frames (05-design.md 5.9a, M19.14; built in M19.15).
 *
 * A tab tap answers on the tab itself in the same paint: a `LinkPendingProbe` inside each nav `Link`
 * reads `useLinkStatus()` and reports its tab here; the bars mark that link `data-pending`. If the
 * navigation is still pending {@link FRAME_DELAY_MS} after the tap, `PendingMain` hides the old page
 * (the `hidden` attribute, never unmounted, so an abandoned navigation shows it again unchanged) and
 * draws the destination's `TabFrame` beside it, with `aria-busy` on `<main>`.
 *
 * Only a link navigation sets a pending tab. `router.refresh()` and Realtime re-reads are not link
 * navigations, so they never draw a frame: the shown page stays until the new one is ready (5.10).
 * There is no `loading.tsx` and no `<Suspense>` under the group routes: a streamed boundary hides
 * the page from a no-JS first load (5.9, M14.39).
 */

/** The desktop `Admin` link gets the pressed state too, but no frame (5.9a, per route). */
export type PendingKey = MainTabKey | 'admin-nav';

/** Under this, a navigation is fast enough that a frame would only flash (5.9: 52 to 104 ms). */
export const FRAME_DELAY_MS = 300;

export interface NavPendingState {
  pendingTab: PendingKey | null;
  /** `performance.now()` when the tab went pending; a new tap is a new `since`. */
  since: number | null;
}

const IDLE: NavPendingState = { pendingTab: null, since: null };

interface NavPendingValue {
  state: NavPendingState;
  report: (key: PendingKey, pending: boolean) => void;
}

const NOOP_VALUE: NavPendingValue = { state: IDLE, report: () => {} };

const NavPendingContext = createContext<NavPendingValue>(NOOP_VALUE);

/** The pending tab, or idle outside a provider (a bar rendered on its own in a test). */
export function useNavPending(): NavPendingState {
  return useContext(NavPendingContext).state;
}

export function NavPendingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<NavPendingState>(IDLE);
  const [seenPath, setSeenPath] = useState(pathname);

  // Landing clears in the same render as the new pathname: the new page is never hidden, not even
  // for one paint, whichever of this and the link's own `pending: false` React applies first.
  let shown = state;
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (state.pendingTab !== null) setState(IDLE);
    shown = IDLE;
  }

  const report = useCallback((key: PendingKey, pending: boolean) => {
    setState((prev) => {
      if (pending) return prev.pendingTab === key ? prev : { pendingTab: key, since: performance.now() };
      return prev.pendingTab === key ? IDLE : prev;
    });
  }, []);

  const value = useMemo(() => ({ state: shown, report }), [shown, report]);
  return <NavPendingContext.Provider value={value}>{children}</NavPendingContext.Provider>;
}

/**
 * Lives inside a nav `Link` (it must: `useLinkStatus` reads the nearest link) and renders nothing.
 * Reports in a layout effect, so the tab's pressed state is committed before the browser paints the
 * tap. Only a change is reported: the same tab's twin in the other bar (bottom bar and top nav both
 * carry the five) never clears a tap it did not receive. The tab already on screen reports nothing:
 * tapping it is not a navigation (5.9a).
 */
export function LinkPendingProbe({ tab, current }: { tab: PendingKey; current: boolean }) {
  const { pending } = useLinkStatus();
  const { report } = useContext(NavPendingContext);
  const reported = useRef(false);
  const now = pending && !current;

  useLayoutEffect(() => {
    if (now === reported.current) return;
    reported.current = now;
    report(tab, now);
  }, [now, tab, report]);

  useLayoutEffect(
    () => () => {
      if (reported.current) report(tab, false);
    },
    [tab, report],
  );

  return null;
}

function isFramedTab(key: PendingKey | null): key is MainTabKey {
  return key !== null && key !== 'admin-nav';
}

/**
 * `<main>` for the group shell. Holds the page in a wrapper that takes `hidden` while a frame shows;
 * `aria-busy` is on `<main>` for exactly as long. The frame itself is `aria-hidden` (as every `Frame`).
 */
export function PendingMain({ children }: { children: ReactNode }) {
  const { pendingTab, since } = useNavPending();
  const framed = isFramedTab(pendingTab) ? pendingTab : null;
  /** The `since` whose 300 ms have run out. A new tap has a new `since`, so it waits its own 300 ms. */
  const [elapsedFor, setElapsedFor] = useState<number | null>(null);

  useEffect(() => {
    if (framed === null || since === null) return;
    const left = Math.max(0, FRAME_DELAY_MS - (performance.now() - since));
    const timer = setTimeout(() => setElapsedFor(since), left);
    return () => clearTimeout(timer);
  }, [framed, since]);

  const showing = framed !== null && since !== null && elapsedFor === since;

  return (
    // tabIndex -1: the skip link moves focus here in browsers that only scroll to a fragment.
    <main id="main" tabIndex={-1} aria-busy={showing ? true : undefined} className="flex flex-1 flex-col">
      <div data-slot="page" hidden={showing} className="flex flex-1 flex-col">
        {children}
      </div>
      {showing ? <TabFrame tab={framed} /> : null}
    </main>
  );
}
