'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';

/**
 * Brief 1.2: the recap "appears live when it lands". The line is written a few seconds after the
 * game is stored and lives in a table no Realtime channel publishes, so a page showing a fresh
 * finished game with no line yet asks the server for itself again a few times, then stops. Renders
 * nothing: the page looks exactly as it would without a line. Only drawn while a line may still
 * land (a live game of a group whose AI lines are on, inside the 15-minute window).
 */
export const RECAP_RECHECK_MS: readonly number[] = [15_000, 40_000, 90_000, 180_000];

export function RecapWaiter({ delays = RECAP_RECHECK_MS }: { delays?: readonly number[] }) {
  const router = useRouter();
  useEffect(() => {
    const timers = delays.map((ms) => setTimeout(() => startTransition(() => router.refresh()), ms));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [delays, router]);
  return null;
}
