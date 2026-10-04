'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';
import { askTonight } from '@/lib/tonight/live';

/**
 * Brief 1.2: the recap "appears live when it lands". The line is written a few seconds after the
 * game is stored and lives in a table no Realtime channel publishes, so a page showing a fresh
 * finished game with no line yet checks again a few times, then stops. Renders nothing: the page
 * looks exactly as it would without a line. Only drawn while a line may still land (a live game of
 * a group whose AI lines are on, inside the 15-minute window).
 *
 * **A targeted check, then one render** (M19.17). For a linked member (`poll`), each check is
 * `GET /api/me/recap/status` (one indexed read); the page is re-rendered once, when it says the line
 * has landed, and the checks stop. An anonymous visitor may not read that route, so without `poll`
 * (and whenever the route cannot answer) a check is a page re-render, as before.
 *
 * **On Tonight a re-render goes through Tonight's scheduler** (M19.3): one more change for
 * `TonightLive` to fold into the render it is running or about to run. On any other page (the
 * board, You, a game page) it asks the router directly, inside a transition.
 */
export const RECAP_RECHECK_MS: readonly number[] = [15_000, 40_000, 90_000, 180_000];

const STATUS_ROUTE = '/api/me/recap/status';

/** Has the line landed? `null` when the route could not say (signed out, not a member, offline). */
async function recapLanded(groupId: string, gameId: string): Promise<boolean | null> {
  try {
    // The response schema loads with the check, not with the page (zod stays out of first load).
    const [response, schema] = await Promise.all([
      fetch(`${STATUS_ROUTE}?groupId=${encodeURIComponent(groupId)}&gameId=${encodeURIComponent(gameId)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }),
      import('@/app/api/me/recap/status/schema'),
    ]);
    if (!response.ok) return null;
    const parsed = schema.recapStatusResponseSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data.landed : null;
  } catch {
    return null;
  }
}

export function RecapWaiter({
  delays = RECAP_RECHECK_MS,
  poll,
}: {
  delays?: readonly number[];
  /** A linked member's view of a finished game: check the small read instead of the page. */
  poll?: { groupId: string; gameId: string } | undefined;
}) {
  const router = useRouter();
  const groupId = poll?.groupId;
  const gameId = poll?.gameId;
  useEffect(() => {
    let done = false;
    const rerender = (): void => {
      if (askTonight() !== null) return;
      startTransition(() => router.refresh());
    };
    const recheck = async (): Promise<void> => {
      if (done) return;
      if (groupId === undefined || gameId === undefined) {
        rerender();
        return;
      }
      const landed = await recapLanded(groupId, gameId);
      if (done || landed === false) return;
      // Landed: one render shows it and nothing more is asked. Unknown: the old fallback.
      if (landed === true) done = true;
      rerender();
    };
    const timers = delays.map((ms) => setTimeout(() => void recheck(), ms));
    return () => {
      done = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [delays, router, groupId, gameId]);
  return null;
}
