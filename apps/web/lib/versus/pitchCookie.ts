import 'server-only';
import { cookies } from 'next/headers';
import { PITCH_COOKIE } from './pitchDismiss';

/**
 * The You-vs-them pitch's dismissal cookie from the request (fix-result-cls), for the pages that
 * draw the pitch. Outside a request (a page function called by a test) there is no cookie: not
 * dismissed, never a throw.
 */
export async function readPitchCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(PITCH_COOKIE)?.value;
  } catch (error) {
    // Next's own control flow (dynamic usage, postpone) carries a digest: never swallowed.
    if (typeof error === 'object' && error !== null && 'digest' in error) throw error;
    return undefined;
  }
}
