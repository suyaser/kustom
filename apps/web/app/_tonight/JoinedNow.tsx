'use client';

import { useEffect, useState } from 'react';
import { JOINED_JUST_NOW } from '@/lib/tonight/screenCopy';

/** How long a new seat says `joined just now` (05-design.md 5.1, "Just joined"). */
export const JOINED_NOW_MS = 60_000;

/**
 * `joined just now` under a name for the first minute (05-design.md 5.1): a word, no accent, no
 * outline, so it can never be mistaken for "you". Server-rendered as nothing (the server cannot
 * know the reader's clock); the client shows it if the join is recent and removes it when the
 * minute is up.
 */
export function JoinedNow({ joinedAt }: { joinedAt: string }) {
  const [recent, setRecent] = useState(false);

  useEffect(() => {
    const age = Date.now() - Date.parse(joinedAt);
    if (!Number.isFinite(age) || age < 0 || age >= JOINED_NOW_MS) {
      setRecent(false);
      return;
    }
    setRecent(true);
    const timer = setTimeout(() => setRecent(false), JOINED_NOW_MS - age);
    return () => clearTimeout(timer);
  }, [joinedAt]);

  if (!recent) return null;
  return <span className="font-mono text-xs text-muted-foreground font-stretch-85%">{JOINED_JUST_NOW}</span>;
}
