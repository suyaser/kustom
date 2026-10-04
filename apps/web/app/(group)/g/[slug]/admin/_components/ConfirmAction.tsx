'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ACTION_FAILED, CANCEL_LABEL, WORKING_LABEL } from '@/lib/admin/homeCopy';
import { refusalSentence } from '@/lib/groups/apiError';
import { useCommittedRefresh } from '@/lib/useCommittedRefresh';

export interface ConfirmActionProps {
  /** The visible button that opens the confirm. */
  label: string;
  /** `destructive` for remove and demote (05-design 3.5, admin only), `secondary` otherwise. */
  tone: 'destructive' | 'secondary';
  title: string;
  body: string;
  /** The confirming button's verb (`Remove from group`, `Make a new link`). */
  actionLabel: string;
  pendingLabel?: string;
  /** The `/api/admin/*` route and its JSON body; the route checks the session again. */
  url: string;
  payload: Record<string, unknown>;
  /**
   * After a 2xx, with the parsed body (update a link in place). Absent: the page refreshes, so a server
   * component can use this with no function to pass across the boundary. Either way the dialog stays
   * open on its pending label until the refresh (or the promise `onDone` returns) has landed.
   */
  onDone?: (body: unknown) => void | Promise<void>;
}

/**
 * Every admin write behind 05-design 5.13's confirm: verb + object + question, the consequence, the
 * action above Cancel on a phone, **initial focus on Cancel** (Radix's default for AlertDialog), focus
 * returned to the trigger. While pending the action is `aria-disabled` with its `…ing` label and the
 * dialog stays open; a refusal is a `role="alert"` sentence inside the dialog, never a toast, in the
 * route's words (or a friendly one for a 401/403/5xx).
 *
 * **Pending until the screen changes** (M19.3): after a 2xx the page is re-read inside a transition
 * and the dialog closes only once the new screen has committed, so the admin never sees the old row
 * under a closed dialog, and a second press cannot repeat the write.
 */
export function ConfirmAction({
  label,
  tone,
  title,
  body,
  actionLabel,
  pendingLabel = WORKING_LABEL,
  url,
  payload,
  onDone,
}: ConfirmActionProps) {
  const { refresh } = useCommittedRefresh();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const parsed: unknown = await response.json().catch(() => null);
      if (response.ok) {
        await (onDone === undefined ? refresh() : onDone(parsed));
        setOpen(false);
        setPending(false);
        return;
      }
      setError(refusalSentence(response.status, parsed, ACTION_FAILED));
    } catch {
      setError(ACTION_FAILED);
    }
    setPending(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        {/* The trigger stays quiet (secondary + warning icon); red is the dialog's action only (designer). */}
        <Button type="button" variant="secondary">
          {tone === 'destructive' ? <WarningIcon /> : null}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button
            type="button"
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            pending={pending}
            onClick={() => {
              // A second press while pending is dropped (the button is only quiet, never disabled).
              if (!pending) void act();
            }}
          >
            {tone === 'destructive' ? <WarningIcon /> : null}
            {pending ? pendingLabel : actionLabel}
          </Button>
          <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The warning glyph of a destructive trigger; exported for a no-JS twin of one (M14.60). */
export function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3 2 21h20L12 3Zm0 6v5m0 3v.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
