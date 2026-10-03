import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Session refresh for `/admin` navigations, and nothing else.
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

export const config = {
  matcher: ['/admin/:path*'],
};
