import { rebuildCronResponseSchema } from '@customs/db/schemas';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { runRebuildCron } from '@/lib/ingest/rebuildCron';
import { getServiceClient } from '@/lib/supabase';

// The Supabase service-role client and a shared secret: never edge, never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The plan's ceiling for a function (Vercel Hobby without fluid compute), the same as the window
 * cron's. A fold cannot be stopped halfway through its writes, so no fold *starts* after
 * {@link START_BUDGET_MS}; what is left waits for tomorrow's run.
 */
export const maxDuration = 60;
export const START_BUDGET_MS = 30_000;

/**
 * The daily rebuild (M14.63; decision 2026-10-04): rates every group's backfilled games the
 * morning after they were picked up. Scheduled in `vercel.json` after the 06:00 night boundary.
 *
 * Same door as the other crons: a bearer `CRON_SECRET`, compared in full, 503 while unset. Safe
 * at any cadence: the fold is idempotent and a group with nothing waiting is not touched.
 * The logic, guards included, is `lib/ingest/rebuildCron.ts` over `lib/ingest/rebuild.ts`.
 */
export async function GET(request: Request): Promise<Response> {
  const started = Date.now();
  let secret: string | undefined;
  try {
    secret = readServerEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`cron rebuild: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  if (secret === undefined) {
    return jsonError(503, 'the rebuild cron is not configured');
  }

  const header = request.headers.get('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  const token = rest.join(' ').trim();
  if (scheme?.toLowerCase() !== 'bearer' || token.length === 0) {
    return jsonError(401, 'missing bearer token');
  }
  if (token !== secret) return jsonError(401, 'bad cron secret');

  try {
    const groups = await runRebuildCron(getServiceClient(), {
      elapsedMs: () => Date.now() - started,
      startBudgetMs: START_BUDGET_MS,
    });
    return jsonOk(rebuildCronResponseSchema, { ok: true, groups });
  } catch (error) {
    console.error('cron rebuild failed', error);
    return jsonError(500, 'internal error');
  }
}
