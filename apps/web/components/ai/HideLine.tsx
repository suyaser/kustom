'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { HIDDEN_NOTICE, HIDE_FAILED, HIDE_LABEL } from '@/lib/ai/recapCopy';

/**
 * An admin's `Hide` on an AI line (M16.4; brief 1.5, D8): one tap, no confirm, and the line is
 * gone for everybody (`Hidden. It won't come back.`). Only ever rendered for an admin or the owner
 * (the page decides from the session); `POST /api/admin/ai/hide` checks again.
 *
 * A real form, so it works before hydration and without JavaScript (the route sends a form post
 * back to `redirectTo`); with JavaScript it posts JSON and swaps the line for the confirmation in
 * place. The line's own markup is the server's `children`.
 */
export function HideLine({
  groupId,
  lineId,
  redirectTo,
  children,
}: {
  groupId: string;
  lineId: string;
  redirectTo?: string | undefined;
  children: ReactNode;
}) {
  const [state, setState] = useState<'shown' | 'pending' | 'hidden' | 'failed'>('shown');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    try {
      const response = await fetch('/api/admin/ai/hide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, lineId }),
      });
      setState(response.ok ? 'hidden' : 'failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'hidden') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {HIDDEN_NOTICE}
      </p>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <form
        action="/api/admin/ai/hide"
        method="post"
        onSubmit={onSubmit}
        className="flex shrink-0 flex-col items-end"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="lineId" value={lineId} />
        {redirectTo === undefined ? null : <input type="hidden" name="redirectTo" value={redirectTo} />}
        <button
          type="submit"
          aria-disabled={state === 'pending' ? true : undefined}
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-bold text-foreground underline underline-offset-3 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:text-muted-foreground"
        >
          {HIDE_LABEL}
        </button>
        {state === 'failed' ? (
          <p role="alert" className="text-xs text-destructive">
            {HIDE_FAILED}
          </p>
        ) : null}
      </form>
    </div>
  );
}
