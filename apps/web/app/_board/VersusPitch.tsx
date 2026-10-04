'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  PITCH_DISMISS,
  PITCH_LINKED_AFTER,
  PITCH_LINKED_BEFORE,
  PITCH_LINKED_LINK,
  PITCH_SIGNED_OUT,
} from '@/lib/versus/youCopy';

/**
 * The You-vs-them pitch under a finished game (M14.35): Tonight's finished state and the game page
 * mount it (Lanes A and C). One line, never a modal or a banner:
 *
 * - signed out or not linked: `Played tonight? Sign in and see how you did against everyone.`, the
 *   sentence a sign-in form whose `next` is this page (then `That's me`).
 * - linked: `Tap anyone to see your record with them, or see everyone on You.`, `You` a link.
 *
 * Shown once per night per browser: the dismiss stores `nightKey` (the night's start, from the
 * server) in `localStorage`, and the line stays hidden until the next night's key. Rendered hidden
 * until the client has read the key, so a dismissed line never flashes back.
 */
export const PITCH_STORAGE_KEY = 'kustom-versus-pitch-dismissed';

export function VersusPitch({
  viewer,
  nightKey,
  here,
  you,
}: {
  viewer: 'linked' | 'not-linked';
  /** The night the page is about (e.g. `tonightStart().toISOString()`): the dismiss lasts that long. */
  nightKey: string;
  /** Where sign-in comes back to. */
  here: string;
  /** `/g/<slug>/you`. */
  you: Route;
}) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(PITCH_STORAGE_KEY);
    } catch {}
    setHidden(dismissed === nightKey);
  }, [nightKey]);

  if (hidden) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(PITCH_STORAGE_KEY, nightKey);
    } catch {}
    setHidden(true);
  };

  return (
    <div className="flex items-start gap-2 rounded-card border border-border bg-card px-(--card-pad) py-2 text-sm">
      {viewer === 'linked' ? (
        <p className="flex-1 py-2.5">
          {PITCH_LINKED_BEFORE}
          <Link href={you} className="font-bold underline underline-offset-3">
            {PITCH_LINKED_LINK}
          </Link>
          {PITCH_LINKED_AFTER}
        </p>
      ) : (
        <form action="/auth/signin" method="post" className="flex-1">
          <input type="hidden" name="next" value={here} />
          <button
            type="submit"
            className="min-h-11 cursor-pointer text-start font-bold underline underline-offset-3"
          >
            {PITCH_SIGNED_OUT}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={PITCH_DISMISS}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-5">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
