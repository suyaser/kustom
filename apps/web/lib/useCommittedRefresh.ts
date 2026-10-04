'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useTransition } from 'react';

/**
 * `router.refresh()` that says when the new screen is on (M19.3).
 *
 * The refresh runs inside `startTransition`, so React keeps the old screen interactive and
 * `isPending` stays true until the server's new payload has committed. The returned promise
 * resolves on that commit, which is what a control holds its pending state on: the button stays
 * quiet until the screen it changed has changed (no "dead window" with the old screen up and the
 * button live again).
 *
 * A refresh that never lands (offline, a hung request) still resolves after
 * {@link REFRESH_HOLD_MAX_MS}, so no control is held quiet forever.
 */
export const REFRESH_HOLD_MAX_MS = 10_000;

export function useCommittedRefresh(): { refresh: () => Promise<void>; refreshing: boolean } {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const waiters = useRef<(() => void)[]>([]);

  // `isPending` goes true with the transition and false once everything in it has committed;
  // every refresh asked while it was true is answered by that commit. A layout effect, so it runs
  // inside the commit itself and no timer can slip a new refresh in between.
  useLayoutEffect(() => {
    if (refreshing) return;
    const landed = waiters.current;
    waiters.current = [];
    for (const resolve of landed) resolve();
  }, [refreshing]);

  // Nobody is left waiting on a page that has gone.
  useEffect(
    () => () => {
      const left = waiters.current;
      waiters.current = [];
      for (const resolve of left) resolve();
    },
    [],
  );

  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(cap);
          resolve();
        };
        const cap = setTimeout(finish, REFRESH_HOLD_MAX_MS);
        waiters.current.push(finish);
        startTransition(() => router.refresh());
      }),
    [router],
  );

  return { refresh, refreshing };
}
