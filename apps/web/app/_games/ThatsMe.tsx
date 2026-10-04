'use client';

import { type MouseEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LINK_OFFLINE, PICK_YOURSELF, THATS_ME } from '@/lib/tonight/copy';

/**
 * `That's me` on the game page (M14.34's contract; the M14.16 page): a signed-in visitor with no
 * player row picks themselves out of this game's ten, if `claimableSeats` offers them (tonight's
 * lobby or a game that ended in the last 12 hours). `POST /api/me/link` decides; this only draws.
 *
 * With JavaScript: a fetch, then a full navigation to the You tab's welcome card. Without: the form
 * posts and the route redirects to the same URL (`redirectTo`).
 */

const LINK_ACTION = '/api/me/link';

/** An object so a test can stand in for the browser's `location`. */
export const gameLinkLanding = {
  go(href: string): void {
    window.location.assign(href);
  },
};

export interface ClaimSeat {
  puuid: string;
  name: string;
}

export function ThatsMe({
  seats,
  groupId,
  welcome,
}: {
  seats: readonly ClaimSeat[];
  groupId: string;
  /** `welcomeHref(group)`: where a successful link lands, with and without JavaScript. */
  welcome: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const titleId = useId();
  if (seats.length === 0) return null;

  async function submit(event: MouseEvent<HTMLButtonElement>, puuid: string): Promise<void> {
    event.preventDefault();
    setFailed(null);
    setPending(puuid);
    try {
      const response = await fetch(LINK_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, puuid }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body));
        setPending(null);
        return;
      }
      gameLinkLanding.go(welcome);
    } catch {
      setFailed(LINK_OFFLINE);
      setPending(null);
    }
  }

  return (
    <section aria-labelledby={titleId} className="rounded-card border border-border bg-card">
      <p id={titleId} className="px-(--card-pad) pt-(--card-pad) pb-2 text-sm text-pretty">
        {PICK_YOURSELF}
      </p>
      <ul className="divide-y divide-border border-t border-border">
        {seats.map((seat) => (
          <li key={seat.puuid} className="flex items-center justify-between gap-3 px-(--card-pad) py-1.5">
            <span className="min-w-0 font-bold [overflow-wrap:break-word]">{seat.name}</span>
            <form method="post" action={LINK_ACTION} className="shrink-0">
              <input type="hidden" name="puuid" value={seat.puuid} />
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="redirectTo" value={welcome} />
              <Button
                type="submit"
                variant="secondary"
                className="whitespace-nowrap"
                aria-disabled={pending !== null}
                data-pending={pending === seat.puuid ? '' : undefined}
                onClick={(event) => void submit(event, seat.puuid)}
              >
                {THATS_ME}
                <span className="sr-only">{`: ${seat.name}`}</span>
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {failed === null ? null : (
        <p role="alert" className="px-(--card-pad) pb-3 text-sm text-destructive">
          {failed}
        </p>
      )}
    </section>
  );
}

function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return LINK_OFFLINE;
}
