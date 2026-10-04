'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { groupHome } from '@/lib/nav';
import { asSentence, ROLL_FAILED, ROLL_LABEL, ROLL_UNREACHABLE } from '@/lib/tonight/copy';
import { requestTonightRefresh } from '@/lib/tonight/live';
import { rollRosterKey } from '@/lib/tonight/state';
import type { MemberView } from '@/lib/tonight/types';
import { usePageGroup } from '../_shell/PageGroup';

/**
 * The admin's `Roll teams` button under the rack (2026-10-03): the only way an `open` lobby
 * gets teams, now that ingest never balances by itself.
 *
 * **The press names the roster on screen.** The body carries `rollRosterKey` over the members
 * this render drew, spectators included, and the route refuses (409) unless that is the roster
 * stored right now — so a press made a moment after somebody left balances nobody instead of the
 * people who are left. A double tap sends the same key twice; the second answers
 * `already_rolled` and nothing is posted again.
 *
 * **The page does not write.** This posts to `/api/admin/lobbies/[lobbyId]/roll`, which
 * re-checks the session and the group admin membership before anything moves. Being drawn is not
 * permission.
 *
 * The same shape as `RerollControl`: a real `<form>` (the no-JavaScript path carries
 * `redirectTo=/` and comes back with the route's notice), intercepted into a JSON post when
 * JavaScript runs. Every answer — teams up, or any refusal — asks the page to re-read
 * (`onSettled`): a 409 is usually the roster having moved, and the admin should be looking at
 * the new one before pressing again. A refusal is printed in the route's own words and is never
 * fatal; the button stays.
 */
export function RollControl({
  lobbyId,
  members,
  hint = null,
  onSettled,
}: {
  lobbyId: string;
  members: readonly MemberView[];
  /** One line above the button (`rollAdminHint`): the rotation preview, or the at-ten line. */
  hint?: string | null | undefined;
  onSettled?: (() => void) | undefined;
}) {
  const group = usePageGroup();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const rosterKey = rollRosterKey(members);
  const action = `/api/admin/lobbies/${lobbyId}/roll`;
  const quiet = pending || rosterKey === '';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || rosterKey === '') return;
    setPending(true);
    setFailed(null);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, rosterKey }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body));
      }
      // Teams up or a refusal, the page is now behind the server: re-read it. Realtime would
      // deliver the teams too; asking keeps the answer from waiting on a socket.
      onSettled?.();
      requestTonightRefresh();
    } catch {
      setFailed(ROLL_UNREACHABLE);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col items-start gap-2" method="post" action={action} onSubmit={submit}>
      <input type="hidden" name="rosterKey" value={rosterKey} />
      {/* Only the form path reads this. The route re-validates it as a path on this site. */}
      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="redirectTo" value={groupHome(group)} />
      {hint === null ? null : <p className="text-sm text-muted-foreground">{hint}</p>}
      {/* Quiet while a press is in flight, **never `disabled`**: a disabled control drops the
          focus to `<body>` (M3.20). `submit` already short-circuits a second press. */}
      <Button type="submit" pending={quiet} className="w-full sm:w-auto">
        {ROLL_LABEL}
      </Button>
      {failed === null ? null : (
        <p className="text-sm font-bold" role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/**
 * The API's envelope is `{ ok: false, error }`, and the route's sentences are lower case with no
 * full stop (`the lobby changed since you looked: …`) because `/admin` prints them inline. Here
 * each stands alone in its slot, so it gets a capital and a stop. Anything else gets ours.
 */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) return asSentence(error.trim());
  }
  return ROLL_FAILED;
}
