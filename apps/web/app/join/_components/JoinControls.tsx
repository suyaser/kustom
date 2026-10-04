'use client';

import { type GroupSummary, joinGroupResponseSchema } from '@customs/db/schemas';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { welcomeHref } from '@/lib/board/hrefs';
import { refusalSentence } from '@/lib/groups/apiError';
import { JOIN_FAILED, JOINING_LABEL, joinButtonLabel } from '@/lib/groups/pageCopy';
import { PairingCode } from './PairingCode';

/** Where a new member lands: the group's tonight page, which says `You're in.` (STRATEGY 3.3). */
export function joinedHref(group: Pick<GroupSummary, 'slug'>): Route {
  return `/g/${encodeURIComponent(group.slug)}?joined=1` as Route;
}

/**
 * `Join <Group>` for a signed-in, linked visitor (M13.13): `POST /api/groups/join`, then the group's
 * tonight page with `?joined=1`. A refusal (the link rotated while the page sat open) is printed under
 * the button as the route words it.
 */
export function JoinButton({ code, group }: { code: string; group: GroupSummary }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function join(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = joinGroupResponseSchema.safeParse(body);
      if (response.ok && parsed.success) {
        router.push(joinedHref(parsed.data.group));
        return;
      }
      setError(refusalSentence(response.status, body, JOIN_FAILED));
    } catch {
      setError(JOIN_FAILED);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        pending={pending}
        onClick={() => void join()}
        aria-describedby={error === null ? undefined : errorId}
        className="w-full md:w-auto md:self-start"
      >
        {pending ? JOINING_LABEL : joinButtonLabel(group.name)}
      </Button>
      {error === null ? null : (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The `I have Kustom` card's code: asked for on arrival, and on `used` straight to the group. */
export function JoinPairing({
  code,
  instruction,
  preview,
}: {
  code: string;
  instruction?: ReactNode;
  preview?: { kind: 'waiting'; code: string } | { kind: 'expired' } | undefined;
}) {
  const router = useRouter();
  return (
    <PairingCode
      request={{ inviteCode: code }}
      autoStart
      instruction={instruction}
      preview={preview}
      onUsed={(group) => router.push(welcomeHref(group))}
    />
  );
}
