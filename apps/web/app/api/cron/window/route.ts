import { type WindowPostKind, windowPostKindSchema } from '@customs/db';
import { z } from 'zod';
import { NO_GAMES_IN_WINDOW, postClosedWindow } from '@/lib/discord/post';
import { selectWebhookUrl } from '@/lib/discord/webhook';
import { claimWindowPost, markWindowPosted, recordWindowPostFailure } from '@/lib/discord/windowPosts';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { type ClosedWindow, closedWindow } from '@/lib/night';
import { siteOrigin } from '@/lib/siteUrl';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

// The Supabase service-role client, a shared secret and an outbound POST: never edge, never
// cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The week that posts itself, and on the 1st the month (M5.13; the words are M5.10's).
 *
 * **There is no button anywhere in this product that posts the week.** If a friend has to
 * remember to press something on a Sunday it will be pressed twice one week and never again
 * after that. So: Sunday morning, nobody opened anything, and there is a post in the channel
 * that says who won the week.
 *
 * **Sunday, since M5.34** (2026-09-15), and with no change to this file: the schedule fires
 * daily and the day a week closes on is `weekStart`'s answer alone (`lib/night.ts`). There is
 * no day-of-week test anywhere in this route, which is why moving the anchor moved the post.
 *
 * **The door is the one that already exists** — the same bearer `CRON_SECRET`, compared in
 * full, the same 503 when the variable is unset, as `GET /api/cron/sweep` and
 * `GET /api/cron/leaderboard`. The schedule lives outside the app (`04-decisions.md`), so this
 * route is written so the schedule cannot get it wrong: **call it hourly, daily or twice a
 * minute and it posts each window exactly once.**
 *
 * How once is guaranteed: `window_posts`, `(kind, window_start)` primary key, **claimed before
 * the post and stamped after it** (`lib/discord/windowPosts.ts`). A duplicate post is a thing
 * ten friends see; a missed one is a thing they ask about once and the next call fixes.
 *
 * What it considers, every call:
 *
 * - **`last-week`, always.** The most recently closed week and only that one — never a backlog
 *   of every week since March, because the row for the week before it is already there or
 *   never will be. A deployment that was down all Sunday posts last week on Monday, late and
 *   correct: the post's timestamp says when it was sent and its description says which week it
 *   covers.
 * - **`last-month`, on the 1st** — see {@link windowsToConsider}. Week first, so on a Sunday
 *   the 1st the group gets two posts in the order they read in.
 */
export const responseSchema = z.object({
  ok: z.literal(true),
  /** The windows that reached the channel on this call. Usually empty; once a week, one. */
  posted: z.array(windowPostKindSchema),
  /** The ones that did not, and why. Never contains the webhook URL. */
  skipped: z.array(z.object({ kind: windowPostKindSchema, reason: z.string() })),
});

/**
 * How long after a month closes the monthly post is still worth making: one day, which is
 * exactly "on the 1st".
 *
 * A month closes at 06:00 on the 1st in `CUSTOMS_NIGHT_TZ` (M5.9), so the day that follows is
 * the day the closed month is news. It is a freshness rule and not a dedupe one — the dedupe
 * is the table — and it is what keeps the **first ever call**, on a database with a year of
 * history, from posting a month on the 15th because nothing had posted one before.
 *
 * The week has no such rule on purpose: a week's post is worth making late (edge case 3), and
 * there is only ever one week that has most recently closed.
 */
const MONTH_POST_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Which windows this call looks at: the closed week, and the closed month while we are inside
 * the day that follows it.
 *
 * Both come from `closedWindow` (M5.9), so the instant this route writes into `window_posts`
 * and the range the board is read through are computed once, in one place.
 */
export function windowsToConsider(now: Date, timeZone: string): ClosedWindow[] {
  const windows = [closedWindow('last-week', now, timeZone)];
  const month = closedWindow('last-month', now, timeZone);
  const sinceClose = now.getTime() - month.end.getTime();
  if (sinceClose >= 0 && sinceClose < MONTH_POST_WINDOW_MS) windows.push(month);
  return windows;
}

export async function GET(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readServerEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`cron window: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  if (secret === undefined) {
    return jsonError(503, 'the window post is not configured');
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

  const now = new Date();
  /**
   * **The zone decides which week this is** (M5.9, M5.12): a window is a pair of 06:00
   * boundaries in `CUSTOMS_NIGHT_TZ`, and a route that let the post fall back to the built-in
   * default would claim one week in `window_posts`, print another on the board and link to a
   * third. Read the same way the nightly post and `startLobby`'s handler read it.
   */
  const timeZone = nightTimeZone();
  const windows = windowsToConsider(now, timeZone);
  /**
   * Typed as the **response's** kind and filled with the **window's**, which is the one place
   * the two lists are pinned together: a sixth window, or a renamed one, is a typecheck failure
   * here and not a row `window_posts` quietly refuses at 06:00 on a Sunday.
   */
  const posted: WindowPostKind[] = [];
  const skipped: { kind: WindowPostKind; reason: string }[] = [];

  try {
    const client = getServiceClient();

    // Nothing is claimed on a deployment that has no webhook: a row here says "the group has
    // been told", and with nowhere to tell them, writing one would silently eat the first week
    // after somebody finally configures Discord (M5.13, edge case 5).
    if ((await selectWebhookUrl(client)) === null) {
      return jsonOk(responseSchema, {
        ok: true,
        posted: [],
        skipped: windows.map((window) => ({ kind: window.kind, reason: 'no webhook configured' })),
      });
    }

    for (const window of windows) {
      const claim = await claimWindowPost(client, window, now);
      if (!claim.ok) {
        skipped.push({ kind: window.kind, reason: claim.reason });
        continue;
      }

      const outcome = await postClosedWindow(client, window, {
        now,
        timeZone,
        requestOrigin: siteOrigin(request),
      });

      if (outcome.status === 'posted') {
        await markWindowPosted(client, window, now);
        posted.push(window.kind);
        continue;
      }

      const reason = outcome.reason ?? 'the post did not land';
      if (outcome.status === 'skipped' && reason === NO_GAMES_IN_WINDOW) {
        // Nothing happened in this window and nothing ever will: stamp it posted so it is not
        // retried every hour for the next seven days.
        await markWindowPosted(client, window, now, reason);
      } else {
        // A webhook that would not take it is not a posted week. The row keeps `posted_at`
        // null and a later call retries it.
        await recordWindowPostFailure(client, window, reason);
        console.error(`cron window: ${window.kind} did not post: ${reason}`);
      }
      skipped.push({ kind: window.kind, reason });
    }

    return jsonOk(responseSchema, { ok: true, posted, skipped });
  } catch (error) {
    console.error('cron window failed', error);
    return jsonError(500, 'internal error');
  }
}
