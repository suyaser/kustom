'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SIGN_IN_LABEL, SIGN_OUT_LABEL } from '@/lib/shellCopy';

/** The session-checked read the island asks (M13.5): 200 with a session, 401 or 403 without. */
export const SESSION_PROBE_URL = '/api/groups/mine';

export type KustomSessionState = 'signed-out' | 'signed-in';

/** Whether a `document.cookie` string carries a Supabase auth cookie (`sb-<ref>-auth-token…`). */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((part) => part.trim().startsWith('sb-'));
}

/**
 * The account control in the bare shell's top bar (STRATEGY 2.5). Signed out: `Sign in`, back to
 * `/`, which sends a member on to their group and keeps everybody else on the landing page.
 * Signed in (a visitor in no group, or anyone on `/about`, `/how`, `/download`): `Sign out`. Both
 * are forms, so they work with JavaScript off. Secondary, not primary: the landing page's one
 * primary action is `Create your group`.
 *
 * **A client island (M19.18).** Reading the session on the server made every Kustom page
 * `force-dynamic`, so `/download` and `/how` were a function invocation per hit instead of a CDN
 * file. The page now ships `Sign in`, and after hydration the island asks the server who this is:
 *
 * - No `sb-` cookie (every first-time visitor): no request at all, `Sign in` stays. The same gate
 *   the server's `currentSessionPlayer` uses before it spends a round trip.
 * - A `sb-` cookie: `GET /api/groups/mine`, the existing session-checked read (M13.5). 200 means a
 *   verified session with a Discord identity, so `Sign out`; 401, 403 or any failure reads as
 *   signed out, exactly as `currentSessionPlayer` maps them. Only the status is read, never the
 *   body, so no schema (and no zod) comes into this bundle.
 *
 * No layout shift when the label turns: both words sit in one grid cell and the button is as wide
 * as the longer one; the word not in use is `invisible` and `aria-hidden`, so the accessible name is
 * only ever the visible word.
 */
export function KustomSignIn({ here = '/' }: { here?: string }) {
  const [state, setState] = useState<KustomSessionState>('signed-out');

  useEffect(() => {
    if (!hasSessionCookie(document.cookie)) return;
    const controller = new AbortController();
    fetch(SESSION_PROBE_URL, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => setState(response.ok ? 'signed-in' : 'signed-out'))
      .catch(() => {
        // Offline, or the page is leaving: the server would read this as anonymous too.
      });
    return () => controller.abort();
  }, []);

  const signedIn = state === 'signed-in';
  return (
    <form action={signedIn ? '/auth/signout' : '/auth/signin'} method="post" data-session={state}>
      <input type="hidden" name="next" value={here} />
      <Button type="submit" variant="secondary" className="inline-grid cursor-pointer">
        <span
          aria-hidden={signedIn}
          className={signedIn ? 'invisible col-start-1 row-start-1' : 'col-start-1 row-start-1'}
        >
          {SIGN_IN_LABEL}
        </span>
        <span
          aria-hidden={!signedIn}
          className={signedIn ? 'col-start-1 row-start-1' : 'invisible col-start-1 row-start-1'}
        >
          {SIGN_OUT_LABEL}
        </span>
      </Button>
    </form>
  );
}
