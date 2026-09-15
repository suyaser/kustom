import { mysteryCronResponseSchema } from '@customs/db/schemas';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { ensureTodayMystery } from '@/lib/mystery/ensure';
import { civilDayKey } from '@/lib/night';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Make sure today's challenge exists before the first friend opens the site (M5.32).
 * Safe at any cadence: unique on `day`, a second call is a no-op.
 *
 * **One route for both games** (M8.4): which of the two today is comes from the same
 * `civilDayKey` the first lazy GET would use, so the cron and a visitor cannot disagree
 * about it, and there is no per-kind schedule to keep in step with anything.
 */
export async function GET(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readServerEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`cron mystery: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  if (secret === undefined) {
    return jsonError(503, 'the mystery cron is not configured');
  }

  const header = request.headers.get('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  const token = rest.join(' ').trim();
  if (scheme?.toLowerCase() !== 'bearer' || token.length === 0) {
    return jsonError(401, 'missing bearer token');
  }
  if (token !== secret) return jsonError(401, 'bad cron secret');

  const now = new Date();
  const timeZone = nightTimeZone();
  const day = civilDayKey(now, timeZone);
  const before = await ensureTodayMystery(getServiceClient(), now, timeZone);
  // ensureTodayMystery creates if missing; a second call returns the same row.
  const row = before;
  return jsonOk(mysteryCronResponseSchema, {
    ok: true,
    status: row === null ? 'empty' : 'exists',
    challengeId: row?.id ?? null,
    // Which of the two games today turned out to be (M8.4). Stored, so a day that fell back
    // reads `mystery` here and in the database alike.
    kind: row === null ? null : row.kind === 'award' ? 'award' : 'mystery',
    day,
  });
}
