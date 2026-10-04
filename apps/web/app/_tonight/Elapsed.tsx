'use client';

import { useEffect, useState } from 'react';
import { elapsedLabel } from '@/lib/tonight/screenCopy';

/**
 * `23 min in` (STRATEGY §6(a)), from the game's start. Updated once a minute, never per second, and
 * not in a live region (05-design.md 5.4: a ticking timer read aloud is noise).
 *
 * `renderedAt` is the server's clock at render, so the first client paint prints exactly what the
 * server did (no hydration mismatch); the minute timer takes over from there.
 */
export function Elapsed({ startedAt, renderedAt }: { startedAt: string; renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const label = elapsedLabel(startedAt, now);
  if (label === null) return null;
  return (
    <span data-slot="elapsed" className="num">
      {label}
    </span>
  );
}
