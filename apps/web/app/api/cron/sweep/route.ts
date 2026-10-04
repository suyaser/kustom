import { z } from 'zod';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { withLiveSignal } from '@/lib/live/bump';
import { sweepIdleLobbies } from '@/lib/lobbyState';
import { getServiceClient } from '@/lib/supabase';

// The Supabase service-role client and a shared secret: never edge, never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The scheduled half of the two-hour idle sweep (M2.5, M5.11).
 *
 * The sweep's real home is the start of every companion lobby and game post: while anybody is
 * playing, the lobby that went stale is swept by the next post that arrives. This route is
 * for the other case — everybody closed the client and nothing will post again tonight — so a
 * scheduler (Vercel Cron, an uptime pinger, anything that can send a header) can move those
 * lobbies on without a companion.
 *
 * Two kinds of stale, counted together in `swept`: an `open` or `balanced` lobby two hours
 * unmentioned becomes `abandoned`, and an `in_game` one becomes `dropped` — a game that never
 * reported a result. The second is the one that has to happen without a companion post,
 * because the row it unblocks is exactly the row that was swallowing that party's posts
 * (M5.11).
 *
 * Auth is a bearer `CRON_SECRET`, compared in full. With the variable unset the route is
 * closed: 503, no sweep. That is deliberate — an unauthenticated endpoint that writes rows is
 * not something to leave lying around because a deployment forgot a variable.
 */
export const responseSchema = z.object({
  ok: z.literal(true),
  /** How many lobbies this sweep gave up on, `abandoned` and `dropped` together. Usually zero. */
  swept: z.number().int().nonnegative(),
});

export async function GET(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readServerEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`cron sweep: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  if (secret === undefined) {
    return jsonError(503, 'sweep is not configured');
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
    const client = getServiceClient();
    // Each group with a lobby swept hears it once, after the sweep's writes, and also when the
    // sweep throws after its first statement (M19.9).
    const swept = await withLiveSignal(client, (live) => sweepIdleLobbies(client, new Date(), live));
    return jsonOk(responseSchema, { ok: true, swept });
  } catch (error) {
    console.error('cron sweep failed', error);
    return jsonError(500, 'internal error');
  }
}
