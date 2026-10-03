import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { GROUP_COOKIE_MAX_AGE_S, GROUP_COOKIE_NAME, groupSlugFromPath } from './lib/groups/pageGroup';

/**
 * Two jobs, one per matcher: the session refresh for `/admin` navigations, and the
 * `kustom_group` cookie for group pages (M13.9).
 *
 * `proxy.ts` is Next 16's name for what used to be `middleware.ts`; building with the old name
 * prints a deprecation warning.
 *
 * Server components cannot write cookies, so without this the access token would expire (an
 * hour, by Supabase's default) and an admin would be silently signed out mid-session. This is
 * the one place `@supabase/ssr` can hand the refreshed tokens back to the browser.
 *
 * It does not gate anything: the gate is `app/admin/(dashboard)/layout.tsx` and
 * `lib/adminRoute.ts`, both of which check the session player's admin membership in the request's group
 * server-side with the service role (M13.4). A middleware that decided access would be a second, weaker copy of that rule.
 *
 * `/api/admin/*` is deliberately outside the matcher: those handlers read cookies off the
 * request and answer 401/403 on their own, and they must not depend on middleware having run.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname.startsWith('/g/')) return rememberGroup(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
        },
      },
    });

    // The call is the point: it refreshes an expiring session and writes the new cookies.
    await supabase.auth.getUser();
  } catch (error) {
    // Never fail a page render because the auth server hiccuped; the gate will still say no.
    console.warn('session refresh failed', error);
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
function rememberGroup(request: NextRequest): NextResponse {
  const response = NextResponse.next({ request });
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
  matcher: ['/admin/:path*', '/g/:path*'],
};
