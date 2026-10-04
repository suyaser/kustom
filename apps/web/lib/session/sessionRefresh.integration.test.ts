import { randomUUID } from 'node:crypto';
import {
  combineChunks,
  createChunks,
  createServerClient,
  stringFromBase64URL,
  stringToBase64URL,
} from '@supabase/ssr';
import { NextRequest, type NextResponse } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseSessionUser } from '@/lib/adminAuth';
import { type CookieRecord, createAuthClient, readOnlyCookieJar } from '@/lib/supabaseAuth';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { proxy } from '@/proxy';

/**
 * M14.40 (S2): the session survives a public group page.
 *
 * A browser holds a session whose access token has expired and whose refresh token is good. It
 * opens `/g/customs/you` (a page outside the old `/admin`-only refresh) and then, a little later,
 * `/g/customs/admin`. It must still be signed in on the second page.
 *
 * Why "a little later": GoTrue rotates the refresh token on every refresh and lets a spent one be
 * reused only for `refresh_token_reuse_interval` (10 s in `config.toml`), so the second request
 * waits past it.
 *
 * **What the test found (M14.40).** Before the fix the proxy did not refresh on `/g/*`; the page's
 * own `getUser()` refreshed in memory (its jar cannot write) and the rotated token never reached the
 * browser. Even so, the viewer was still signed in on the second request: GoTrue answers a spent
 * refresh token that is the **parent of the session's active one** with the active one ("the client
 * was not able to store the result"), however late. So it was not a sign-out; it was a browser stuck
 * on an expired access token, a refresh round trip on every render, and a session that stayed alive
 * only by that GoTrue rule. The last case below pins the rule, so a GoTrue change that drops it shows
 * up here. The fix is the first case's `Set-Cookie` assertion: the proxy now refreshes on every page
 * and the rotated pair reaches the browser on the page response.
 *
 * Everything is real: a password user in the local `auth.users`, tokens from GoTrue's token
 * endpoint, the real `proxy`, and the page read exactly as `lib/groups/pageSession.ts` does it.
 * Only the clock on the session is wound back (its `expires_at`), which is what the browser-side
 * client uses to decide a token has expired. No token is ever printed.
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();
const REUSE_INTERVAL_S = 10;

if (stack === null || authUsers === null) {
  describe.skip('session refresh on public pages against the local Supabase stack', () => {
    it('needs the local stack (`pnpm db:start`)', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3114';

  const runId = randomUUID().slice(0, 8);
  const email = `m1440-refresh-${runId}@example.invalid`;
  const password = `pw-${randomUUID()}`;
  let userId = '';

  /** What the browser holds between requests. */
  const browser = new Map<string, string>();

  const cookieHeader = () =>
    [...browser].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');

  /** The browser applying a response's `Set-Cookie`s. */
  function absorb(response: NextResponse): void {
    for (const cookie of response.cookies.getAll()) {
      if (cookie.value === '' || cookie.maxAge === 0) browser.delete(cookie.name);
      else browser.set(cookie.name, cookie.value);
    }
  }

  const authCookieNames = (response: NextResponse) =>
    response.cookies
      .getAll()
      .map((c) => c.name)
      .filter((name) => name.startsWith('sb-'));

  /** A server component reading the session: read-only jar, `getUser()`, nothing written back. */
  async function pageViewer(cookies: readonly CookieRecord[]): Promise<string | null> {
    const user = await supabaseSessionUser(createAuthClient(readOnlyCookieJar(cookies)))();
    return user?.id ?? null;
  }

  /** One navigation: the proxy, then the page with the cookies the proxy forwarded to it. */
  async function navigate(path: string): Promise<{ response: NextResponse; viewer: string | null }> {
    const request = new NextRequest(`http://localhost:3114${path}`, { headers: { cookie: cookieHeader() } });
    const response = await proxy(request);
    // `NextResponse.next({ request })` hands the proxy's rewritten request cookies to the page.
    const viewer = await pageViewer(request.cookies.getAll().map(({ name, value }) => ({ name, value })));
    absorb(response);
    return { response, viewer };
  }

  /** Same tokens, but the browser's session now reads as expired (its `expires_at` is past). */
  async function rewindClock(): Promise<void> {
    const key = [...browser.keys()].find((name) => name.startsWith('sb-'))?.replace(/\.\d+$/, '');
    if (!key) throw new Error('the browser holds no auth cookie');
    const raw = await combineChunks(key, (name) => browser.get(name));
    if (raw === null) throw new Error('auth cookie did not combine');
    const session = JSON.parse(stringFromBase64URL(raw.replace(/^base64-/, ''))) as { expires_at: number };
    session.expires_at = Math.floor(Date.now() / 1000) - 120;
    for (const name of [...browser.keys()])
      if (name === key || name.startsWith(`${key}.`)) browser.delete(name);
    for (const chunk of createChunks(key, `base64-${stringToBase64URL(JSON.stringify(session))}`)) {
      browser.set(chunk.name, chunk.value);
    }
  }

  beforeAll(async () => {
    userId = authUsers.createWithPassword(email, password);

    // Sign in through @supabase/ssr itself so the cookies are in exactly the shape the app writes.
    const written = new Map<string, string>();
    const client = createServerClient(stack.url, stack.anonKey, {
      cookies: {
        getAll: () => [...written].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value === '') written.delete(name);
            else written.set(name, value);
          }
        },
      },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);

    for (const [name, value] of written) browser.set(name, value);
    await rewindClock();
  }, 30_000);

  afterAll(() => {
    if (userId) authUsers.remove([userId]);
  });

  describe('session refresh on public pages against the local Supabase stack', () => {
    it('refreshes on /g/<slug>/you, persists the rotated tokens, and is still signed in on /g/<slug>/admin', async () => {
      const first = await navigate('/g/customs/you');
      expect(first.viewer).toBe(userId);
      // The rotated tokens go back to the browser on the page response itself.
      expect(authCookieNames(first.response).length).toBeGreaterThan(0);
      expect(first.response.headers.get('cache-control') ?? '').toMatch(/no-store|private/);

      // Past the reuse interval, an unpersisted rotation would now present a spent token.
      await new Promise((resolve) => setTimeout(resolve, (REUSE_INTERVAL_S + 1) * 1000));

      const second = await navigate('/g/customs/admin');
      expect(second.viewer).toBe(userId);
    }, 40_000);

    it('refreshes on the landing page `/` too, and leaves API routes alone', async () => {
      await rewindClock();
      const landing = await navigate('/');
      expect(landing.viewer).toBe(userId);
      expect(authCookieNames(landing.response).length).toBeGreaterThan(0);

      await rewindClock();
      const before = cookieHeader();
      const api = await proxy(
        new NextRequest('http://localhost:3114/api/me', { headers: { cookie: before } }),
      );
      expect(authCookieNames(api)).toEqual([]);
    });

    it('GoTrue answers a spent parent refresh token with the active one, even past the reuse interval', async () => {
      // A fresh sign-in, so this case does not depend on the cookies above.
      const anon = createServerClient(stack.url, stack.anonKey, {
        cookies: { getAll: () => [], setAll: () => {} },
      });
      const signedIn = await anon.auth.signInWithPassword({ email, password });
      const parent = signedIn.data.session?.refresh_token;
      if (!parent) throw new Error('sign-in returned no session');

      const rotated = await anon.auth.refreshSession({ refresh_token: parent });
      const active = rotated.data.session?.refresh_token;
      expect(active).toBeTruthy();
      expect(active).not.toBe(parent);

      await new Promise((resolve) => setTimeout(resolve, (REUSE_INTERVAL_S + 1) * 1000));

      // The "lost" rotation: the spent parent again.
      const again = await anon.auth.refreshSession({ refresh_token: parent });
      expect(again.error).toBeNull();
      expect(again.data.session?.refresh_token).toBe(active);
    }, 40_000);
  });
}
