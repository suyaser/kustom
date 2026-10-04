'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ACTION_FAILED,
  CANCEL_LABEL,
  lastResetLine,
  RESET_RATINGS_BODY,
  RESET_RATINGS_CONFIRM_TITLE,
  RESET_RATINGS_LABEL,
  RESET_RATINGS_PENDING,
  resetRatingsFieldLabel,
} from '@/lib/admin/homeCopy';
import { refusalSentence } from '@/lib/groups/apiError';

export interface ResetRatingsCardProps {
  groupId: string;
  slug: string;
  /** `Last reset on 1 Nov.`, already formatted by the server, or null for a group that never reset. */
  lastResetDay: string | null;
  /**
   * Set for an admin who is not the owner (STRATEGY 3.6): the card is drawn with this sentence and a
   * disabled button, and no dialog. `Only the owner can reset ratings.`
   */
  disabledReason?: string | null;
  /** Dev kit only: open the dialog on first paint with this typed text. */
  initialTyped?: string;
  initialOpen?: boolean;
}

/**
 * The owner's `Reset ratings` (STRATEGY 3.6, M14.18), at the bottom of the admin home. The one
 * destructive action in the product, so the one place we ask for typing: the action stays disabled
 * until the group's link is typed exactly, and the route checks the same thing again. A refusal
 * (`Finish tonight's game first.`, a wrong link) is a `role="alert"` sentence inside the dialog, in
 * the route's words; the dialog stays open. The owner gets the live card; an admin sees it disabled
 * with `Only the owner can reset ratings.`; members and the operator never see it (the page decides).
 */
export function ResetRatingsCard({
  groupId,
  slug,
  lastResetDay,
  disabledReason = null,
  initialTyped = '',
  initialOpen = false,
}: ResetRatingsCardProps) {
  const router = useRouter();
  const fieldId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(initialOpen);
  const [typed, setTyped] = useState(initialTyped);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === slug;

  async function reset(): Promise<void> {
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ratings/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ groupId, confirmSlug: typed.trim() }),
      });
      const parsed: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setOpen(false);
        setPending(false);
        setTyped('');
        router.refresh();
        return;
      }
      setError(refusalSentence(response.status, parsed, ACTION_FAILED));
    } catch {
      setError(ACTION_FAILED);
    }
    setPending(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{RESET_RATINGS_LABEL}</CardTitle>
        <CardDescription>
          {RESET_RATINGS_BODY}
          {lastResetDay === null ? null : ` ${lastResetLine(lastResetDay)}`}
        </CardDescription>
      </CardHeader>
      <div className="px-(--card-pad) pb-(--card-pad)">
        {disabledReason !== null ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{disabledReason}</p>
            <Button type="button" variant="secondary" className="w-full md:w-auto" disabled>
              <WarningIcon />
              {RESET_RATINGS_LABEL}
            </Button>
          </div>
        ) : (
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              if (pending) return;
              setOpen(next);
              if (!next) {
                setError(null);
                setTyped('');
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="secondary" className="w-full md:w-auto">
                <WarningIcon />
                {RESET_RATINGS_LABEL}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{RESET_RATINGS_CONFIRM_TITLE}</AlertDialogTitle>
                <AlertDialogDescription>{RESET_RATINGS_BODY}</AlertDialogDescription>
              </AlertDialogHeader>
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void reset();
                }}
              >
                <Label htmlFor={fieldId}>{resetRatingsFieldLabel(slug)}</Label>
                <Input
                  id={fieldId}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby={error === null ? undefined : errorId}
                  aria-invalid={error === null ? undefined : true}
                />
              </form>
              {error === null ? null : (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <AlertDialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  pending={pending}
                  disabled={!matches}
                  onClick={() => void reset()}
                >
                  <WarningIcon />
                  {pending ? RESET_RATINGS_PENDING : RESET_RATINGS_LABEL}
                </Button>
                <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </Card>
  );
}

function WarningIcon() {
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
