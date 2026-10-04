'use client';

import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ACTION_FAILED } from '@/lib/admin/homeCopy';
import {
  discordTestFailed,
  SAVE_AND_TEST,
  SAVING_AND_TESTING,
  SEND_TEST,
  SENDING_TEST,
  TEST_SENT,
  WEBHOOK_HOWTO,
  WEBHOOK_INVALID,
  WEBHOOK_LABEL,
  WEBHOOK_PLACEHOLDER,
} from '@/lib/admin/sectionCopy';
import { errorSentence, refusalSentence } from '@/lib/groups/apiError';
import { useCommittedRefresh } from '@/lib/useCommittedRefresh';

/**
 * The paste fallback (STRATEGY 3.2 step 2; M14.20): `Webhook link` with the how-to, and `Save and send
 * a test post`, which is `POST /api/admin/discord-config { …, sendTestPost: true }`. The route saves,
 * sends the test post and records it; the page refreshes and shows the state from the database. A
 * failed test keeps the save and prints Discord's reason in place.
 */
export function PasteWebhookForm({ groupId }: { groupId: string }) {
  const { refresh } = useCommittedRefresh();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { field: useId(), hint: useId(), error: useId() };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/discord-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          groupId,
          // No guildId: the route reads the server and channel from Discord for a pasted link.
          webhookUrl: url.trim(),
          sendTestPost: true,
          // The voice split is gone (M4.4 dropped); the results channel is whatever this link posts to.
          resultsChannelId: null,
          lobbyVoiceChannelId: null,
          blueVoiceChannelId: null,
          redVoiceChannelId: null,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const test = (body as { testPost?: { posted: boolean; testPostError: string | null } } | null)
          ?.testPost;
        if (test !== undefined && !test.posted) setError(discordTestFailed(test.testPostError ?? ''));
        else setUrl('');
        // Pending until the saved state is on screen (M19.3).
        await refresh();
      } else {
        setError(pasteRefusal(response.status, body));
      }
    } catch {
      setError(ACTION_FAILED);
    }
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
      <Label htmlFor={ids.field}>{WEBHOOK_LABEL}</Label>
      <p id={ids.hint} className="text-sm text-muted-foreground">
        {WEBHOOK_HOWTO}
      </p>
      <Input
        id={ids.field}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={WEBHOOK_PLACEHOLDER}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? ids.hint : `${ids.hint} ${ids.error}`}
        className="font-mono text-sm"
      />
      {error === null ? null : (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" pending={pending} className="w-full md:w-auto md:self-start">
        {pending ? SAVING_AND_TESTING : SAVE_AND_TEST}
      </Button>
    </form>
  );
}

/** `Send a test post` (M14.20, `POST /api/admin/discord/test`): the result in place, then a refresh. */
export function SendTestButton({ groupId }: { groupId: string }) {
  const { refresh } = useCommittedRefresh();
  const [state, setState] = useState<
    { kind: 'idle' | 'pending' | 'sent' } | { kind: 'failed'; message: string }
  >({
    kind: 'idle',
  });

  async function send(): Promise<void> {
    if (state.kind === 'pending') return;
    setState({ kind: 'pending' });
    try {
      const response = await fetch('/api/admin/discord/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ groupId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setState({ kind: 'failed', message: refusalSentence(response.status, body, ACTION_FAILED) });
        return;
      }
      const result = body as { posted?: boolean; testPostError?: string | null } | null;
      // Pending until the page shows the recorded test (M19.3), then the result in place.
      await refresh();
      setState(
        result?.posted === true
          ? { kind: 'sent' }
          : { kind: 'failed', message: discordTestFailed(result?.testPostError ?? '') },
      );
    } catch {
      setState({ kind: 'failed', message: ACTION_FAILED });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        pending={state.kind === 'pending'}
        onClick={() => void send()}
        className="w-full md:w-auto md:self-start"
      >
        {state.kind === 'pending' ? SENDING_TEST : state.kind === 'sent' ? TEST_SENT : SEND_TEST}
      </Button>
      <span role="status" className="sr-only">
        {state.kind === 'sent' ? TEST_SENT : ''}
      </span>
      {state.kind === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The paste's refusal, in place. A 400 that names fields is the shape check (the link is not a
 * webhook URL at all): {@link WEBHOOK_INVALID}. A 400 with only a sentence is Discord not recognising
 * the link, and a 502 is Discord not answering: both are the route's own friendly words (M14.20 fix).
 * Everything else goes through `refusalSentence` (401, 403, 500).
 */
export function pasteRefusal(status: number, body: unknown): string {
  const hasIssues = typeof body === 'object' && body !== null && 'issues' in body;
  if (status === 400) return hasIssues ? WEBHOOK_INVALID : (errorSentence(body) ?? WEBHOOK_INVALID);
  if (status === 502) return errorSentence(body) ?? ACTION_FAILED;
  return refusalSentence(status, body, ACTION_FAILED);
}
