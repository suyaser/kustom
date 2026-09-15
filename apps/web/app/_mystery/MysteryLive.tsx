'use client';

import { useCallback, useEffect, useState } from 'react';
import { shareMissed, shareSolved } from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import type {
  MysteryClueView,
  MysteryPlayView,
  MysteryResultView,
  MysterySuspect,
} from '@/lib/mystery/types';
import { ensureStoredVisitorId } from '@/lib/mystery/visitor';
import { MysteryView } from './MysteryView';

/**
 * The interactive half of Daily Mystery. The server paints the first state; this
 * attaches the one-guess lock, clue reveals, and a ticking countdown. Community
 * numbers refresh on a return visit because they keep moving all day.
 */

export function MysteryLive({ initial }: { initial: MysteryPageState }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState<MysterySuspect | null>(null);
  const [locking, setLocking] = useState<MysterySuspect | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const closedId = state.kind === 'closed' ? state.result.challengeId : null;

  useEffect(() => {
    if (closedId === null) return;
    const visitorId = ensureStoredVisitorId();
    void refreshResult(closedId, visitorId).then((next) => {
      if (next !== null) setState({ kind: 'closed', result: next });
    });
  }, [closedId]);

  const onSelect = useCallback((suspect: MysterySuspect) => {
    setPending(suspect);
    setLocking(suspect);
    setError(null);
  }, []);

  const onCancelLock = useCallback(() => {
    setLocking(null);
    setPending(null);
  }, []);

  const onReveal = useCallback(async () => {
    if (state.kind !== 'play') return;
    setRevealing(true);
    setError(null);
    try {
      const visitorId = ensureStoredVisitorId();
      const response = await fetch(`/api/daily-mystery/${state.play.challengeId}/clue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousVisitorId: visitorId }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        clue?: MysteryClueView | null;
        cluesRevealed?: number;
        clueCount?: number;
      };
      if (!response.ok || body.ok !== true) {
        setError(body.error ?? 'Could not reveal a clue.');
        return;
      }
      setState({
        kind: 'play',
        play: applyClue(state.play, body.clue ?? null, body.cluesRevealed ?? state.play.cluesRevealed),
      });
    } finally {
      setRevealing(false);
    }
  }, [state]);

  const onConfirmLock = useCallback(async () => {
    if (state.kind !== 'play' || locking === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const visitorId = ensureStoredVisitorId();
      const response = await fetch(`/api/daily-mystery/${state.play.challengeId}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: locking.playerId, anonymousVisitorId: visitorId }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; result?: MysteryResultView };
      if (!response.ok || body.ok !== true || body.result === undefined) {
        setError(body.error ?? 'Could not lock that guess.');
        return;
      }
      setState({ kind: 'closed', result: body.result });
      setLocking(null);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }, [locking, state]);

  const onShare = useCallback(async () => {
    if (state.kind !== 'closed') return;
    const text = state.result.personal.correct
      ? shareSolved(
          state.result.kind,
          state.result.challengeNumber,
          state.result.personal.cluesUsed,
          state.result.personal.percentile,
        )
      : shareMissed(state.result.kind, state.result.challengeNumber);
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
    } catch {
      setShareCopied(false);
    }
  }, [state]);

  return (
    <MysteryView
      state={state}
      pendingId={pending?.playerId ?? null}
      locking={locking}
      revealing={revealing}
      submitting={submitting}
      shareCopied={shareCopied}
      error={error}
      now={now}
      onSelect={onSelect}
      onCancelLock={onCancelLock}
      onConfirmLock={() => void onConfirmLock()}
      onReveal={() => void onReveal()}
      onShare={() => void onShare()}
    />
  );
}

function applyClue(
  play: MysteryPlayView,
  clue: MysteryClueView | null,
  cluesRevealed: number,
): MysteryPlayView {
  const revealed =
    clue === null || play.revealedClues.some((row) => row.order === clue.order)
      ? play.revealedClues
      : [...play.revealedClues, clue].sort((a, b) => a.order - b.order);
  return { ...play, cluesRevealed, revealedClues: revealed };
}

async function refreshResult(challengeId: string, visitorId: string): Promise<MysteryResultView | null> {
  const response = await fetch(
    `/api/daily-mystery/${challengeId}/result?anonymousVisitorId=${encodeURIComponent(visitorId)}`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { ok?: boolean; result?: MysteryResultView };
  return body.ok === true && body.result !== undefined ? body.result : null;
}
