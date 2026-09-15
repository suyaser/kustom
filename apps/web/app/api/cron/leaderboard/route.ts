import { z } from 'zod';
import { postNightlyLeaderboard } from '@/lib/discord/post';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

// The Supabase service-role client, a shared secret and an outbound POST: never edge, never
// cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The nightly leaderboard post (M3.5).
 *
 * Same door as `GET /api/cron/sweep`: a bearer `CRON_SECRET`, compared in full, and closed
 * with a 503 when the variable is unset rather than left open because a deployment forgot a
 * value. **The schedule lives outside the app** — a scheduler (Vercel Cron, an uptime pinger,
 * anything that can send a header) calls this at whatever time the group wants the board in
 * the channel. No cron configuration ships with this milestone; the ops task that picks the
 * time is a later one (recorded in `04-decisions.md`).
 *
 * Calling it twice posts twice: there is no dedupe and there should not be one here. The route
 * does exactly what it is asked, which is the property a scheduler needs to be debuggable.
 */
export const responseSchema = z.object({
  ok: z.literal(true),
  /** `posted`, `skipped` (nobody on the board, nobody played, no webhook), or `failed`. */
  status: z.enum(['posted', 'skipped', 'failed']),
  /** Why it did not land, when it did not. Never contains the webhook URL. */
  reason: z.string().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readServerEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`cron leaderboard: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  if (secret === undefined) {
    return jsonError(503, 'the leaderboard post is not configured');
  }

  const header = request.headers.get('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  const token = rest.join(' ').trim();
  if (scheme?.toLowerCase() !== 'bearer' || token.length === 0) {
    return jsonError(401, 'missing bearer token');
  }
  if (token !== secret) {
    return jsonError(401, 'bad cron secret');
  }

  try {
    const outcome = await postNightlyLeaderboard(getServiceClient(), {
      requestOrigin: siteOrigin(request),
      /**
       * **The zone decides which week the post prints** (M5.12, the reviewer 2026-09-10). The
       * board is read through `This week` now, and a week is a pair of 06:00 boundaries in
       * `CUSTOMS_NIGHT_TZ`; without this the post fell back to the built-in default while both
       * pages read the configured zone, so a deployment that set the variable would have got a
       * post naming a different week from the page it links to — most visibly in the six hours
       * either side of a Sunday morning. Read the same way `startLobby`'s handler reads it.
       */
      timeZone: nightTimeZone(),
    });
    return jsonOk(responseSchema, {
      ok: true,
      status: outcome.status,
      reason: outcome.reason,
    });
  } catch (error) {
    console.error('cron leaderboard failed', error);
    return jsonError(500, 'internal error');
  }
}
