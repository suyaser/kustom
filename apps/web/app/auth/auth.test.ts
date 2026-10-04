import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NEXT_COOKIE_NAME } from '@/lib/authNext';
import type { RequestCookieJar } from '@/lib/supabaseAuth';
import { handleAuthCallback } from './callback/handler';
import { POST as signIn } from './signin/route';

/**
 * The sign-in round trip (M1.11).
 *
 * The bug this file exists for: `redirect_to` used to carry `?next=`, Supabase matches
 * `redirect_to` against an allow-list of exact URLs, so nothing matched and the round trip
 * ended on the project's Site URL — somebody's localhost — instead of the deployed site.
 *
 * The sign-in half runs the real route: `signInWithOAuth` in the PKCE flow builds the provider
 * URL locally, so the `redirect_to` asserted below is the one Supabase would really be handed.
 * The callback half runs the real handler with the code exchange injected, since no test can
 * drive Discord.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-tests',
  NEXT_PUBLIC_SITE_URL: undefined,
} satisfies Record<string, string | undefined>;

const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ORIGIN = 'https://kustom-delta.vercel.app';

function signInRequest(next?: string | null): Request {
  const body = new URLSearchParams();
  if (typeof next === 'string') body.set('next', next);
  return new Request(`${ORIGIN}/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/** The `redirect_to` Supabase is handed, read out of the provider URL the route redirects to. */
function redirectTo(response: Response): string {
  const location = response.headers.get('location');
  if (location === null) throw new Error('no Location header');
  const value = new URL(location).searchParams.get('redirect_to');
  if (value === null) throw new Error(`no redirect_to in ${location}`);
  return value;
}

describe('POST /auth/signin', () => {
  it('hands Supabase a redirect_to with no query string at all', async () => {
    const response = await signIn(signInRequest('/admin/tokens'));

    expect(response.status).toBe(303);
    const target = redirectTo(response);
    expect(target).toBe(`${ORIGIN}/auth/callback`);
    // The whole bug, as one assertion: one exact URL is all the allow-list needs.
    expect(target).not.toContain('?');
    expect(target).not.toContain('next');
  });

  it('remembers where to land in a short-lived HttpOnly, same-site cookie', async () => {
    const response = await signIn(signInRequest('/admin/tokens'));

    const cookie = response.cookies.get(NEXT_COOKIE_NAME);
    expect(cookie?.value).toBe('/admin/tokens');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/auth/callback');
    expect(cookie?.maxAge).toBe(600);
    // Secure, because this origin is https. The header is what the browser actually sees.
    const header = response.headers.getSetCookie().find((line) => line.startsWith(`${NEXT_COOKIE_NAME}=`));
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
  });

  it('stores / for a foreign destination or no form at all', async () => {
    for (const next of ['https://example.com/x', '//example.com/x', 'admin', '', null]) {
      const response = await signIn(signInRequest(next));
      expect(response.cookies.get(NEXT_COOKIE_NAME)?.value).toBe('/');
      expect(redirectTo(response)).toBe(`${ORIGIN}/auth/callback`);
    }
  });

  it('still writes the PKCE verifier the callback needs', async () => {
    const response = await signIn(signInRequest('/admin'));
    const names = response.headers.getSetCookie().map((line) => line.split('=')[0]);
    expect(names.some((name) => name?.includes('code-verifier'))).toBe(true);
  });
});

describe('GET /auth/callback', () => {
  const ok = { error: null } as const;

  function callbackRequest(query: string, next?: string): Request {
    const headers: Record<string, string> = {};
    if (next !== undefined) headers.cookie = `${NEXT_COOKIE_NAME}=${encodeURIComponent(next)}`;
    return new Request(`${ORIGIN}/auth/callback${query}`, { headers });
  }

  /** An exchange that succeeds and writes the session cookies, the way Supabase's does. */
  function exchange(result: { error: { message: string } | null } = ok) {
    return vi.fn(async (_code: string, jar: RequestCookieJar) => {
      jar.setAll([{ name: 'sb-access-token', value: 'session', options: { path: '/' } }], {});
      return result;
    });
  }

  function location(response: Response): URL {
    const value = response.headers.get('location');
    if (value === null) throw new Error('no Location header');
    return new URL(value);
  }

  /** The cookie is cleared by being set empty and expired, so the browser drops it. */
  function expectCookieCleared(response: { cookies: { get: (name: string) => unknown } }): void {
    const cookie = response.cookies.get(NEXT_COOKIE_NAME) as
      | { value: string; maxAge?: number; path?: string }
      | undefined;
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.path).toBe('/auth/callback');
  }

  it('lands on the page the sign-in started from, and clears the cookie', async () => {
    const exchangeCode = exchange();
    const response = await handleAuthCallback(callbackRequest('?code=abc', '/admin/tokens'), {
      exchangeCode,
    });

    expect(exchangeCode).toHaveBeenCalledWith('abc', expect.anything());
    expect(location(response).toString()).toBe(`${ORIGIN}/admin/tokens`);
    expectCookieCleared(response);
    // The session itself is on the redirect, or the admin arrives signed out.
    expect(response.cookies.get('sb-access-token')?.value).toBe('session');
  });

  it('lands on / with no cookie at all', async () => {
    const response = await handleAuthCallback(callbackRequest('?code=abc'), { exchangeCode: exchange() });

    expect(location(response).toString()).toBe(`${ORIGIN}/`);
  });

  it('ignores a destination that is not a path on this site', async () => {
    for (const next of ['https://example.com/x', '//example.com/x', '/\\example.com/x', 'admin']) {
      const response = await handleAuthCallback(callbackRequest('?code=abc', next), {
        exchangeCode: exchange(),
      });
      expect(location(response).toString()).toBe(`${ORIGIN}/`);
    }
  });

  it('sends a provider error to the login page without exchanging anything', async () => {
    const exchangeCode = exchange();
    const response = await handleAuthCallback(
      callbackRequest('?error=access_denied&error_description=you+said+no', '/admin/tokens'),
      { exchangeCode },
    );

    expect(exchangeCode).not.toHaveBeenCalled();
    const url = location(response);
    expect(url.pathname).toBe('/admin/login');
    expect(url.searchParams.get('error')).toBe('you said no');
    expectCookieCleared(response);
  });

  it('sends a missing code and a failed exchange to the login page, cookie cleared', async () => {
    const missing = await handleAuthCallback(callbackRequest('', '/admin/tokens'), {
      exchangeCode: exchange(),
    });
    expect(location(missing).searchParams.get('error')).toBe('Discord did not send a code');
    expectCookieCleared(missing);

    const failed = await handleAuthCallback(callbackRequest('?code=stale', '/admin/tokens'), {
      exchangeCode: exchange({ error: { message: 'code verifier could not be found' } }),
    });
    expect(location(failed).pathname).toBe('/admin/login');
    expect(location(failed).searchParams.get('error')).toBe('code verifier could not be found');
    expectCookieCleared(failed);
  });
});
