'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NO_MORE_SPLITS } from '@/lib/admin/rerollCopy';
import { groupHome } from '@/lib/nav';
import { asSentence, REROLL_FAILED, REROLL_LABEL, REROLL_UNREACHABLE } from '@/lib/tonight/copy';
import { beginTonightPress } from '@/lib/tonight/live';
import { nextRerollSplit } from '@/lib/tonight/state';
import type { SplitChoice } from '@/lib/tonight/types';
import { usePageGroup } from '../_shell/PageGroup';

/**
 * The reroll control on the explanation strip (M3.2's button, M3.4's home for it).
 *
 * One button, one meaning: promote the next split down the list. It names the split it means
 * in the body, exactly as `/admin` does, so a double tap on a slow phone promotes the same
 * split twice — a no-op — instead of skipping one the group never saw.
 *
 * **The page does not write.** This posts to `/api/admin/lobbies/[lobbyId]/reroll`, which
 * re-checks the Supabase session and the group admin membership server-side before anything moves.
 * Being drawn is not permission; a non-admin who forged the markup gets a 403.
 *
 * It is a real `<form>` with a real action, intercepted when JavaScript is running. Submitted
 * as a form — the no-JavaScript fallback — it carries `redirectTo=/` and comes back here with
 * the route's notice in the query string; submitted as JSON, which is the normal path, nothing
 * navigates at all and the promoted split arrives through Realtime like every other change,
 * which is what keeps the strip from scrolling under a thumb.
 *
 * **Quiet while a press is in flight, never `disabled`** (M3.20, the rule `RollControl` and
 * `StartLobby` follow): a disabled control drops the focus to `<body>`. The real attribute is
 * kept for the one permanent case, the last split on the board, where there is nothing left to
 * press and `NO_MORE_SPLITS` says so beside it.
 */
export function RerollControl({ lobbyId, splits }: { lobbyId: string; splits: readonly SplitChoice[] }) {
  const group = usePageGroup();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const next = nextRerollSplit(splits);
  const action = `/api/admin/lobbies/${lobbyId}/reroll`;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    if (next === null) return;
    event.preventDefault();
    // A second press while the first is in flight does nothing: the button is only quiet.
    if (pending) return;
    setPending(true);
    setFailed(null);
    // Tonight holds its renders until this answers: the route's own rows and the answer are one
    // render, not one mid-write and one after (M19.3).
    const press = beginTonightPress();
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, splitId: next.id }),
      });
      const answeredAt = Date.now();
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body));
      }
      // Quiet until the promoted split is on screen (M19.3): `next` comes from these props, so a
      // press before the re-read would post the same `splitId` again.
      await press.answered(answeredAt);
    } catch {
      setFailed(REROLL_UNREACHABLE);
    } finally {
      press.release();
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col items-start gap-2" method="post" action={action} onSubmit={submit}>
      {next === null ? (
        // The last split is on the board, so the group has seen the whole list. The route
        // answers the same sentence to a press that gets through anyway (M3.2).
        <p className="text-sm text-muted-foreground">{NO_MORE_SPLITS}</p>
      ) : (
        <>
          <input type="hidden" name="splitId" value={next.id} />
          {/* Only the form path reads this. The route re-validates it as a path on this site. */}
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="redirectTo" value={groupHome(group)} />
        </>
      )}
      <Button
        type="submit"
        variant="secondary"
        disabled={next === null}
        pending={pending}
        className="w-full sm:w-auto"
      >
        {REROLL_LABEL}
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
 * The API's envelope is `{ ok: false, error }`. The route's sentences are written for `/admin`,
 * lower case with no stop, so each gets a capital and a full stop here (`asSentence`, shared
 * with `RollControl`). Anything else gets a sentence of our own.
 */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) return asSentence(error);
  }
  return REROLL_FAILED;
}
