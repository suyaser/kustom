/**
 * Who is looking at a static Kustom page (M19.18, about-static), asked once per page load and
 * shared by every island that needs it: the top bar's `Sign in` / `Sign out` and, on `/about`,
 * `Create your group` and the `Free.` line. Two islands, one request.
 *
 * - No `sb-` cookie (every first-time visitor): no request, `signed-out`. The same gate the
 *   server's `currentSessionPlayer` uses before it spends a round trip.
 * - A `sb-` cookie: `GET /api/groups/mine`, the session-checked read (M13.5). 200 is a verified
 *   session (an unlinked one included, as `currentSessionPlayer` counts it), so `signed-in`; 401,
 *   403, any other status or a failed request is `signed-out`. Only the status is read, never the
 *   body, so no schema (and no zod) comes into the bundle.
 *
 * The answer is kept for the page's life. The session only changes through a full navigation
 * (the sign-in and sign-out forms post to `/auth/*`), which starts a new one.
 */

/** The session-checked read the probe asks (M13.5): 200 with a session, 401 or 403 without. */
export const SESSION_PROBE_URL = '/api/groups/mine';

export type KustomSessionState = 'signed-out' | 'signed-in';

/** Whether a `document.cookie` string carries a Supabase auth cookie (`sb-<ref>-auth-token…`). */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((part) => part.trim().startsWith('sb-'));
}

let pending: Promise<KustomSessionState> | null = null;

/** `signed-in` or `signed-out`, at most one request per page load. Never rejects. */
export function probeSession(): Promise<KustomSessionState> {
  if (!hasSessionCookie(document.cookie)) return Promise.resolve('signed-out');
  pending ??= fetch(SESSION_PROBE_URL, { credentials: 'same-origin', cache: 'no-store' })
    .then((response): KustomSessionState => (response.ok ? 'signed-in' : 'signed-out'))
    // Offline, or the page is leaving: the server would read this as anonymous too.
    .catch((): KustomSessionState => 'signed-out');
  return pending;
}

/** Tests only: forget the answer, as a new page load would. */
export function resetSessionProbe(): void {
  pending = null;
}
