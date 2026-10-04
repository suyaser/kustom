import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { GROUP_COOKIE_MAX_AGE_S, GROUP_COOKIE_NAME, groupSlugFromPath } from './lib/groups/pageGroup';

/**
 * Two jobs: keep the Supabase session's cookies fresh on every page navigation, and the
 * `kustom_group` cookie on group pages (M13.9).
 *
 * `proxy.ts` is Next 16's name for what used to be `middleware.ts`; building with the old name
 * prints a deprecation warning.
 *
 * **Why every page (M14.40).** Server components cannot write cookies, so when one reads the
 * session after the access token expired (an hour, by Supabase's default) its `@supabase/ssr`
 * client refreshes in memory and the rotated refresh token is dropped. Until M14.40 only `/admin`,
 * `/new` and `/join` were refreshed here; every `/g/*` page and `/`, `/about`, `/ops` read the
 * session without ever renewing it. That did not sign anyone out -- GoTrue hands the active token
 * back to a client that presents its spent parent ("the client was not able to store the result"),
 * which `lib/session/sessionRefresh.integration.test.ts` pins -- but it left the browser on an
 * expired token for good, so every render paid a refresh round trip, and staying signed in leant on
 * that one GoTrue rule. This is the one place the refreshed tokens can reach the browser.
 *
 * **Cheap on purpose.** The matcher leaves out `/api/*` (handlers read cookies off the request and
 * answer 401/403 on their own; they must not depend on the proxy having run), `/auth/*` (the
 * sign-in, callback and sign-out handlers write the auth cookies themselves), `/og/*`, `_next/*`
 * and static files by extension (images, fonts, icons, robots/sitemap; not `.rsc`, so a client-side
 * navigation that carries one still refreshes). A request with no `sb-` cookie touches no network. And it
 * calls `getSession()`, not `getUser()`: that reads the cookie and goes to GoTrue **only** when the
 * token has expired, then writes the rotated pair onto the response. Verifying the user is not this
 * file's job.
 *
 * It does not gate anything: the gates are server-side in the pages (`lib/groups/pageSession.ts`,
 * `app/admin/(dashboard)/layout.tsx`) and `lib/adminRoute.ts`, which verify the session with
 * `getUser()` and check membership with the service role (M13.4). A proxy that decided access
 * would be a second, weaker copy of that rule. Tokens are never logged.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = refreshesSession(request) ? await refreshSession(request) : NextResponse.next({ request });
  return request.nextUrl.pathname.startsWith('/g/') ? rememberGroup(request, response) : response;
}

/** Paths the matcher already leaves out, checked again so calling `proxy` directly agrees with it. */
export const STATIC_FILE = 'png|jpe?g|gif|webp|avif|svg|ico|txt|xml|woff2?|ttf|css|js|map|webmanifest';
const NOT_A_PAGE = new RegExp(`^/(?:api|auth|og|_next)(?:/|$)|\\.(?:${STATIC_FILE})$`, 'i');

/** A page navigation that carries a Supabase auth cookie. */
export function refreshesSession(request: NextRequest): boolean {
  if (NOT_A_PAGE.test(request.nextUrl.pathname)) return false;
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          // The page renders after this, so it reads the fresh tokens and never refreshes itself.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // `Cache-Control: private, no-store` and friends: a response that sets auth cookies
          // must never be cached by a CDN.
          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
        },
      },
    });

    // The call is the point: an expired session is refreshed and its new cookies written above.
    await supabase.auth.getSession();
  } catch {
    // Never fail a page render because the auth server hiccuped; the page's gate still decides.
    // The error is not logged: auth-js errors can quote the request, and the request carries tokens.
    console.warn('session refresh failed');
  }

  return response;
}

/**
 * "The last group they opened" (M13.9): written on every group page so `/` can send a signed-in
 * member back to it. Set here rather than by a client component so it needs no JavaScript and
 * costs no round trip. It is a hint, never a credential: `/` only follows it for a session whose
 * player is a member of that group (`lib/groups/landing.ts`), so an unknown slug written by a
 * 404 is harmless.
 *
 * `HttpOnly` (nothing in the browser reads it), `SameSite=Lax`, a year, the whole site. Not
 * rewritten when it already says this group, so a night of re-reads sends no `Set-Cookie`.
 */
function rememberGroup(request: NextRequest, response = NextResponse.next({ request })): NextResponse {
  const slug = groupSlugFromPath(request.nextUrl.pathname);
  if (slug === null || request.cookies.get(GROUP_COOKIE_NAME)?.value === slug) return response;
  response.cookies.set(GROUP_COOKIE_NAME, slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: GROUP_COOKIE_MAX_AGE_S,
  });
  return response;
}

export const config = {
  // Every page (M14.40). Not `/api`, `/auth`, `/og`, `_next` or a file: see the comment on `proxy`.
  // Next needs a literal here, so the extension list is spelled out again: keep it in step with STATIC_FILE.
  matcher: [
    '/((?!api/|api$|auth/|og/|_next/|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|txt|xml|woff2?|ttf|css|js|map|webmanifest)$).*)',
  ],
};
