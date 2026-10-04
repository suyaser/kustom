import { NextResponse } from 'next/server';
import { safeNextPath } from '@/lib/authNext';
import { ServerEnvError } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { createAuthClient, requestCookieJar } from '@/lib/supabaseAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where a sign-out lands when the form names no page of ours: the sign-in page, as before M14.7. */
const SIGNED_OUT_PATH = '/admin/login';

/**
 * Ends the session and clears its cookies. POST only: a GET sign-out can be triggered by any
 * image tag on any page.
 *
 * An optional `next` form field (M14.7: More's `Sign out` sends the page it was on) is followed when
 * it is a path on this site (`safeNextPath`, the sign-in's own rule); anything else lands on
 * {@link SIGNED_OUT_PATH}.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = siteOrigin(request);
  let next = SIGNED_OUT_PATH;
  try {
    const candidate = (await request.clone().formData()).get('next');
    next = (typeof candidate === 'string' ? safeNextPath(candidate) : null) ?? SIGNED_OUT_PATH;
  } catch {
    // No body, or not a form: the default.
  }
  const jar = requestCookieJar(request);

  try {
    const client = createAuthClient(jar);
    const { error } = await client.auth.signOut();
    if (error !== null) console.warn(`sign-out: ${error.message}`);
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`sign-out: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  return jar.applyTo(NextResponse.redirect(new URL(next, origin), 303));
}
