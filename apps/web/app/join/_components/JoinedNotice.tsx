'use client';

import { useSearchParams } from 'next/navigation';
import { JOINED_LINE } from '@/lib/groups/pageCopy';

/**
 * `You're in.` on `/g/<slug>?joined=1` (STRATEGY 3.3): the one line both ways in end on, the one-tap
 * join and a pairing code Kustom used. Drawn by the group layout above every group page, so it does
 * not depend on which page a link lands on. A polite status, not an alert: it is good news.
 *
 * Read on the client from the URL because a layout gets no search params; it renders nothing for
 * every other visit.
 */
export function JoinedNotice() {
  const joined = useSearchParams().get('joined') === '1';
  if (!joined) return null;
  return (
    <div>
      <div className="mx-auto w-full max-w-7xl px-(--gutter) pt-4">
        <p
          role="status"
          className="flex min-h-11 max-w-3xl items-center gap-3 rounded-card border border-border bg-card px-(--card-pad) py-2 font-bold"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-5 shrink-0">
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {JOINED_LINE}
        </p>
      </div>
    </div>
  );
}
