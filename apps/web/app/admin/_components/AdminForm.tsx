'use client';

import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState, useTransition } from 'react';
import { type AdminFormKind, adminError, adminNotice, mintedToken } from '@/lib/admin/notices';
import { type GroupAnswer, MintedToken, useAnswerSink } from './AdminAnswerGroup';

/**
 * Every write on `/admin`, in place (M3.20). The user, 2026-09-09: *"experience sucks, page
 * refreshes on any button I press."*
 *
 * It is a **real `<form>` with a real action**, intercepted when JavaScript is running — the
 * same shape the tonight page's reroll control has had since M3.4:
 *
 *   - With JavaScript, the submit is cancelled and the same values are posted as JSON to the
 *     same route. Nothing navigates, the URL never changes, no document loads, and the answer
 *     is rendered **beside the control that was pressed**. `router.refresh()` then re-reads the
 *     server components so the row shows what was just written; React reconciles in place, so
 *     the focus stays on the button.
 *   - Without JavaScript, the browser posts the form and the route's 303 carries `?notice=`
 *     back to the page, exactly as before. That path is untouched, and so are the routes.
 *
 * The JSON body is `Object.fromEntries(new FormData(form))`: every value is the string the form
 * post would have sent, and an unchecked checkbox is absent in both. So the two paths hand the
 * route's zod schema the same object, and there is one thing to validate rather than two.
 */

export interface AdminFormProps {
  /** The route this posts to. Also the plain form's `action`, for the no-JS path. */
  action: string;
  /** Which family of sentences the answer belongs to (`lib/admin/notices.ts`). */
  kind: AdminFormKind;
  children: ReactNode;
  className?: string;
  /** The sentence for a network failure, where the route never answered. */
  fallbackError?: string;
  /**
   * The group every `/api/admin/*` and `/api/me/*` body names (M13.4), sent as a hidden field so
   * the JSON path and the no-JS form path carry it alike. The original group until M13.14 moves
   * the admin pages under `/g/<slug>/admin` and passes the slug's group.
   */
  groupId?: string;
}

/** The same shape the group holds, so a form can hand its answer up unchanged. */
type Answer = GroupAnswer;

export function AdminForm({
  action,
  kind,
  children,
  className,
  fallbackError,
  groupId = ORIGINAL_GROUP_ID,
}: AdminFormProps) {
  const router = useRouter();
  const sink = useAnswerSink();
  const [inlineAnswer, setInlineAnswer] = useState<Answer | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  // A group above me outlives this form, so it holds the answer; without one, I do.
  const answer = sink === null ? inlineAnswer : null;
  const setAnswer = (next: Answer | null): void => {
    // `null` travels too: it is how the sentence from the **last** press is cleared, so
    // pressing a refused control twice re-announces the refusal instead of leaving the same
    // node saying the same thing (reviewer, 2026-09-10).
    if (sink === null) setInlineAnswer(next);
    else sink(next);
  };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // A second press while one is in flight is dropped here rather than by disabling the
    // button: a control that disables itself loses focus, and M3.20 is about the focus staying
    // where the keyboard left it.
    if (pending) return;

    const values: Record<string, string> = {};
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === 'string') values[key] = value;
    }

    setPending(true);
    setAnswer(null);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        // The route's own sentence, never one of ours: it owns the rule it just refused.
        setAnswer({ ok: false, text: adminError(body, fallbackError ?? 'that did not save'), token: null });
        return;
      }

      setAnswer({ ok: true, text: adminNotice(kind, values, body), token: mintedToken(body) });
      // Re-read this page's server components so the row shows what was written. It is not a
      // navigation: no document load, no scroll, and the pressed control keeps focus.
      startTransition(() => router.refresh());
    } catch {
      setAnswer({ ok: false, text: fallbackError ?? 'that did not reach the server', token: null });
    } finally {
      setPending(false);
    }
  }

  return (
    <form method="post" action={action} onSubmit={submit} className={className}>
      <input type="hidden" name="groupId" value={groupId} />
      {children}
      {/* With a group above, the sentence is the group's: this form may not survive its own
          success (`AdminAnswerGroup`). Without one, the control is still here afterwards and
          the sentence belongs beside it. */}
      {answer === null ? null : (
        <p className={answer.ok ? 'admin-notice' : 'admin-error'} role={answer.ok ? 'status' : 'alert'}>
          {answer.text}
        </p>
      )}
      {answer?.token == null ? null : <MintedToken token={answer.token} />}
    </form>
  );
}
