'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ACTION_FAILED } from '@/lib/admin/homeCopy';
import { RESTORE_GAME, VOID_GAME } from '@/lib/games/copy';

/**
 * An admin's `Void game` / `Restore` on the game page (M23.1). Only rendered for an admin or the
 * owner (the page decides from the session); `POST /api/admin/games/void` checks again. One tap, no
 * confirm: it is undone by the other button. A real form, so it works without JavaScript (the route
 * sends a form post back to `redirectTo`); with JavaScript it posts JSON, then re-renders the page,
 * or prints the route's refusal (`Finish tonight's game first.`).
 */
export function VoidGame({
  groupId,
  gameId,
  voided,
  redirectTo,
}: {
  groupId: string;
  gameId: string;
  voided: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = voided ? 'restore' : 'void';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/games/void', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, gameId, action }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (response.ok) router.refresh();
      else setError(typeof body?.error === 'string' ? body.error : ACTION_FAILED);
    } catch {
      setError(ACTION_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/api/admin/games/void"
      method="post"
      onSubmit={onSubmit}
      className="flex flex-col items-start"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button
        type="submit"
        aria-disabled={pending ? true : undefined}
        className="-ms-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-bold text-foreground underline underline-offset-3 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:text-muted-foreground"
      >
        {voided ? RESTORE_GAME : VOID_GAME}
      </button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
