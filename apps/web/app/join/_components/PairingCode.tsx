'use client';

import {
  type GroupSummary,
  type PairingRequest,
  pairingResponseSchema,
  pairingStatusResponseSchema,
} from '@customs/db/schemas';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { refusalSentence } from '@/lib/groups/apiError';
import {
  COPY_LABEL,
  GET_CODE_LABEL,
  GETTING_CODE_LABEL,
  NEW_CODE_LABEL,
  PAIRING_CODE_LABEL,
  PAIRING_EXPIRED_LINE,
  PAIRING_FAILED,
  PAIRING_TTL_LINE,
} from '@/lib/groups/pageCopy';
import { CopyButton } from './CopyButton';

/** How often the page asks whether Kustom used the code (M13.5: every 3 s). */
export const PAIRING_POLL_MS = 3000;

type PairingState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'waiting'; code: string }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string };

export interface PairingCodeProps {
  /** `{ inviteCode }` on `/join`, `{ groupId }` on the admin's host card (M13.5, M14.12). */
  request: PairingRequest;
  /** Kustom used the code. `/join` moves to the group; the admin card refreshes its checklist. */
  onUsed: (group: GroupSummary) => void;
  /**
   * Ask for a code as soon as the card mounts (`/join`, where the code is the whole point), or wait
   * for `Get a code` (the admin home, so every visit does not mint one).
   */
  autoStart: boolean;
  /**
   * The line that tells them what to do with the code (`/join`'s "type this code where it asks for one:").
   * Drawn above the code while there is one to type, and dropped when it ran out or was refused, so
   * an instruction never dangles over `That code ran out.` (designer round 1).
   */
  instruction?: ReactNode;
  /** `Get a code`'s weight: secondary once the host row is done, so it is not the page's primary. */
  startVariant?: 'default' | 'secondary';
  /** Dev kit only: draw a state with no network. Never passed by a real page. */
  preview?: { kind: 'waiting'; code: string } | { kind: 'expired' } | undefined;
}

/**
 * The six-character pairing code and its life (M13.5, M14.21): ask `POST /api/me/pairing`, show the
 * code large with `Copy`, poll `GET /api/me/pairing/status` every 3 s, and move on when it says
 * `used`. `expired` shows `That code ran out.` and `New code`; any refusal shows the server's sentence
 * in place (never a toast) with the same button. Every request goes through the API route: the page
 * writes nothing itself.
 */
export function PairingCode({
  request,
  onUsed,
  autoStart,
  instruction,
  startVariant = 'default',
  preview,
}: PairingCodeProps) {
  const [state, setState] = useState<PairingState>(
    preview ?? (autoStart ? { kind: 'loading' } : { kind: 'idle' }),
  );
  // The latest `onUsed`, so a parent re-render does not restart the poll.
  const onUsedRef = useRef(onUsed);
  onUsedRef.current = onUsed;
  const requestBody = JSON.stringify(request);
  // Bumped by every new code, so a poll for a replaced code stops.
  const generation = useRef(0);

  const issue = useCallback(async (): Promise<void> => {
    generation.current += 1;
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/me/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setState({ kind: 'failed', message: refusalSentence(response.status, body, PAIRING_FAILED) });
        return;
      }
      const parsed = pairingResponseSchema.safeParse(body);
      setState(
        parsed.success
          ? { kind: 'waiting', code: parsed.data.code }
          : { kind: 'failed', message: PAIRING_FAILED },
      );
    } catch {
      setState({ kind: 'failed', message: PAIRING_FAILED });
    }
  }, [requestBody]);

  useEffect(() => {
    if (preview === undefined && autoStart) void issue();
  }, [autoStart, issue, preview]);

  const waitingCode = state.kind === 'waiting' && preview === undefined ? state.code : null;
  useEffect(() => {
    if (waitingCode === null) return;
    const mine = generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/me/pairing/status?code=${encodeURIComponent(waitingCode)}`, {
          cache: 'no-store',
        });
        if (stopped || mine !== generation.current) return;
        const body: unknown = await response.json().catch(() => null);
        if (stopped || mine !== generation.current) return;
        if (!response.ok) {
          // 404: a newer code replaced this one (another tab), or the session changed. Say so.
          setState({ kind: 'failed', message: refusalSentence(response.status, body, PAIRING_FAILED) });
          return;
        }
        const parsed = pairingStatusResponseSchema.safeParse(body);
        if (parsed.success && parsed.data.status === 'used') {
          stopped = true;
          onUsedRef.current(parsed.data.group);
          return;
        }
        if (parsed.success && parsed.data.status === 'expired') {
          setState({ kind: 'expired' });
          return;
        }
      } catch {
        // A dropped request on a phone is not a refusal: ask again next tick.
      }
      if (!stopped) timer = setTimeout(() => void poll(), PAIRING_POLL_MS);
    };

    timer = setTimeout(() => void poll(), PAIRING_POLL_MS);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [waitingCode]);

  const retry = preview === undefined ? () => void issue() : undefined;

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {instruction}
        <div aria-live="polite">
          <Button
            type="button"
            variant={startVariant}
            pending={state.kind === 'loading'}
            onClick={retry}
            className="w-full md:w-auto"
          >
            {state.kind === 'loading' ? GETTING_CODE_LABEL : GET_CODE_LABEL}
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === 'waiting') {
    return (
      <div className="flex flex-col gap-3">
        {instruction}
        <div className="flex items-center gap-3">
          <p className="num rounded-control border border-border-strong bg-raised px-3 py-2 font-mono text-xl font-semibold tracking-[0.12em]">
            <span className="sr-only">{PAIRING_CODE_LABEL}: </span>
            <span className="select-all">{state.code}</span>
          </p>
          <CopyButton value={state.code} label={COPY_LABEL} />
        </div>
        <p className="text-sm text-muted-foreground">{PAIRING_TTL_LINE}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-base">
        {state.kind === 'expired' ? PAIRING_EXPIRED_LINE : state.message}
      </p>
      <Button type="button" variant="secondary" onClick={retry} className="w-full md:w-auto md:self-start">
        {NEW_CODE_LABEL}
      </Button>
    </div>
  );
}
