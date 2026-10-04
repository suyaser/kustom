import type { NextResponse } from 'next/server';
import { internalPathSchema } from './admin/formValues';
import { parseCookies } from './supabaseAuth';

/**
 * Where the sign-in round trip remembers the page it started from (M1.11).
 *
 * It used to ride along as `?next=` on the `redirect_to` handed to Supabase. Supabase matches
 * `redirect_to` against an allow-list of **exact** URLs, so `…/auth/callback?next=/admin`
 * matched nothing and the round trip silently fell back to the project's Site URL: signing in
 * on the deployed site landed on somebody's localhost, and the admin area was unreachable.
 *
 * So `redirect_to` is now the bare `<siteOrigin>/auth/callback` — one allow-list entry, no
 * query string — and the destination travels in a cookie instead:
 *
 * - **HttpOnly**: nothing in the browser reads or writes it; the two routes are the only users.
 * - **SameSite=Lax**, not Strict: the callback arrives as a top-level GET navigation from
 *   Supabase, which is cross-site, and Strict would drop the cookie exactly when it is needed.
 *   Lax still keeps it off cross-site subrequests, and the value is a path on this site, never
 *   a credential.
 * - **10 minutes**: an OAuth round trip is seconds. A stale cookie from an abandoned attempt
 *   should not decide where a later sign-in lands.
 * - **Path=/auth/callback**: the only route that reads it, so it is not attached to any other
 *   request on the site.
 *
 * Whatever comes back out is re-validated here before it is used. The cookie is ours, but a
 * value that turns the callback into an open redirect must be impossible even if it were not.
 */

export const NEXT_COOKIE_NAME = 'cn-auth-next';
/** The one route that reads the cookie. Set and clear must agree on this. */
export const NEXT_COOKIE_PATH = '/auth/callback';
/** Ten minutes, in seconds. */
export const NEXT_COOKIE_MAX_AGE_S = 600;
/**
 * Where a sign-in with no usable destination lands: `/`, whose landing sends a member to their own
 * group (M13.9). Never the bare `/admin`, which 308s to the original group's admin and would show an
 * admin of any other group a not-admin page (M14.23 review).
 */
export const DEFAULT_NEXT_PATH = '/';

/** Longer than any page on this site, short enough that a header cannot be stuffed. */
const MAX_NEXT_LENGTH = 512;

/** A newline in a redirect target is a header-splitting attempt, not a page. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A destination we are willing to redirect to, or null.
 *
 * The rule is "a path on this site": a leading `/`, and not `//` or `/\`, both of which browsers
 * read as protocol-relative and would send a signed-in admin to another origin.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NEXT_LENGTH) return null;
  if (hasControlCharacter(trimmed)) return null;
  return internalPathSchema.safeParse(trimmed).success ? trimmed : null;
}

/**
 * The absolute URL to finish the sign-in on: the requested path when it is one of ours,
 * {@link DEFAULT_NEXT_PATH} otherwise. The origin is compared again after resolution, so
 * anything that parses into another origin lands on the default instead of off-site.
 */
export function nextUrl(candidate: string | null | undefined, origin: string): URL {
  const path = safeNextPath(candidate);
  if (path === null) return new URL(DEFAULT_NEXT_PATH, origin);

  try {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin) return new URL(DEFAULT_NEXT_PATH, origin);
    return url;
  } catch {
    return new URL(DEFAULT_NEXT_PATH, origin);
  }
}

export interface NextCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

/** `Secure` on anything but a plain-http origin, which is only ever `next dev` on localhost. */
export function nextCookieOptions(origin: string, maxAge: number = NEXT_COOKIE_MAX_AGE_S): NextCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    path: NEXT_COOKIE_PATH,
    maxAge,
  };
}

/** Writes the destination onto the redirect that starts the OAuth round trip. */
export function rememberNext<T extends NextResponse>(response: T, next: string, origin: string): T {
  response.cookies.set(NEXT_COOKIE_NAME, next, nextCookieOptions(origin));
  return response;
}

/** The destination the sign-in stored, unvalidated. Validation is {@link nextUrl}'s job. */
export function readNextCookie(request: Request): string | null {
  for (const cookie of parseCookies(request.headers.get('cookie'))) {
    if (cookie.name === NEXT_COOKIE_NAME) return cookie.value;
  }
  return null;
}

/**
 * Clears the cookie on the way out of the callback. Unconditional: the round trip is over
 * whether it succeeded, failed, or the cookie was never there.
 */
export function forgetNext<T extends NextResponse>(response: T, origin: string): T {
  response.cookies.set(NEXT_COOKIE_NAME, '', nextCookieOptions(origin, 0));
  return response;
}
