import type { Database } from '@customs/db';
import { type CookieOptions, createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { readAuthEnv } from './env';

/**
 * The Supabase Auth client for the admin area (`docs/01-architecture.md` "Web").
 *
 * It carries the **anon** key and a cookie jar, never the service role key: it exists only to
 * turn the session cookies into a verified user. Everything the admin pages then read or write
 * goes through the service-role client in `lib/supabase.ts`, after `lib/adminAuth.ts` has said
 * the user is an admin.
 *
 * Cookie plumbing is a parameter rather than a call to `next/headers` so the same code works in
 * a server component (read-only cookies), a route handler (cookies read off the `Request`,
 * written onto the response) and a vitest process (a plain array).
 */

export type AuthClient = SupabaseClient<Database>;

export interface CookieRecord {
  name: string;
  value: string;
}

export interface CookieWrite extends CookieRecord {
  options: CookieOptions;
}

/**
 * What `@supabase/ssr` needs from a request/response pair. `setAll` also receives the
 * no-cache headers a response that sets auth cookies must carry.
 */
export interface CookieJar {
  getAll(): CookieRecord[];
  setAll(cookies: CookieWrite[], headers: Record<string, string>): void;
}

/** A cookie jar that never writes. Server components cannot set cookies; middleware does it. */
export function readOnlyCookieJar(cookies: readonly CookieRecord[]): CookieJar {
  return {
    getAll: () => [...cookies],
    setAll: () => {
      // Deliberately silent: `proxy.ts` refreshes the session on every page navigation (M14.40).
    },
  };
}

export interface RequestCookieJar extends CookieJar {
  /** Copies everything Supabase wrote during the request onto the outgoing response. */
  applyTo<T extends NextResponse>(response: T): T;
}

/**
 * Cookies read from a `Request` header and buffered until a response exists. Route handlers
 * (`/auth/callback`, `/auth/signout`) need this: the sign-in and sign-out cookies are the
 * whole point of those routes.
 */
export function requestCookieJar(request: Request): RequestCookieJar {
  const pending: CookieWrite[] = [];
  const pendingHeaders: Record<string, string> = {};
  const current = new Map<string, string>();
  for (const cookie of parseCookies(request.headers.get('cookie'))) {
    current.set(cookie.name, cookie.value);
  }

  return {
    getAll: () => [...current].map(([name, value]) => ({ name, value })),
    setAll: (cookies, headers) => {
      for (const cookie of cookies) {
        current.set(cookie.name, cookie.value);
        pending.push(cookie);
      }
      Object.assign(pendingHeaders, headers);
    },
    applyTo: (response) => {
      for (const { name, value, options } of pending) {
        response.cookies.set(name, value, options);
      }
      for (const [name, value] of Object.entries(pendingHeaders)) {
        response.headers.set(name, value);
      }
      return response;
    },
  };
}

/**
 * Minimal `Cookie:` header parser. `@supabase/ssr` ships `parseCookieHeader`, but it is a
 * deep import away from being tree-shaken into the browser bundle and this is four lines.
 */
export function parseCookies(header: string | null | undefined): CookieRecord[] {
  if (!header) return [];
  const out: CookieRecord[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length === 0) continue;
    out.push({ name, value: decodeCookieValue(part.slice(eq + 1).trim()) });
  }
  return out;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A per-request auth client. Never cache one: a client holds the session of whoever's cookies
 * built it.
 */
export function createAuthClient(jar: CookieJar): AuthClient {
  const env = readAuthEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies, headers) => {
        jar.setAll(cookies, headers);
      },
    },
  });
}
