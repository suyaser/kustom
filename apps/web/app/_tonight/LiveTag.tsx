'use client';

import { useLiveState } from '@/lib/tonight/live';
import { CONNECTING_TAG, LIVE_TAG, RECONNECTING_TAG } from '@/lib/tonight/screenCopy';
import { cn } from '@/lib/utils';

/**
 * The live tag at the start of the strip's first line (05-design.md 5.4).
 *
 * **It never says `Live` unless the page's own channel is `SUBSCRIBED`** (audit problem 10), and it
 * makes no claim about the host's companion: a companion that went quiet leaves the last stored
 * state on screen and this tag alone. While connected it shows only when a lobby is live (the idle
 * page has nothing live to flag); while connecting or reconnecting it shows in every state, because
 * then the page may be behind and the reader should know.
 *
 * The one status region for connection changes (6.4): `role="status"`, atomic. The dot is SVG in
 * `currentColor`, so it survives forced colours; it pulses only while live (static under reduced
 * motion, globals.css).
 */
export function LiveTag({ lobbyLive }: { lobbyLive: boolean }) {
  const { connection } = useLiveState();
  const live = connection === 'live';
  const shown = !live || lobbyLive;

  return (
    <span role="status" aria-atomic="true" className="contents">
      {shown ? (
        <span
          data-slot="live-tag"
          data-connection={connection}
          className={cn(
            'inline-flex min-h-(--chip-h) shrink-0 items-center gap-1.5 rounded-chip border px-2 text-xs font-bold',
            live
              ? 'border-transparent bg-primary-fill text-on-primary-fill day:border-primary-text'
              : 'border-border bg-raised text-muted-foreground',
          )}
        >
          <svg
            viewBox="0 0 8 8"
            aria-hidden="true"
            focusable="false"
            className={cn('size-2', live && 'animate-live')}
          >
            {live ? (
              <circle cx="4" cy="4" r="4" fill="currentColor" />
            ) : (
              <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            )}
          </svg>
          {live ? LIVE_TAG : connection === 'connecting' ? CONNECTING_TAG : RECONNECTING_TAG}
        </span>
      ) : null}
    </span>
  );
}
