import { type WindowPostKind, windowPostKindSchema } from '@customs/db';
import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { NO_GAMES_IN_WINDOW, postClosedWindow } from '@/lib/discord/post';
import { selectWebhookUrl } from '@/lib/discord/webhook';
import { claimWindowPost, markWindowPosted, recordWindowPostFailure } from '@/lib/discord/windowPosts';
import { readServerEnv, ServerEnvError } from '@/lib/env';
import { type GroupRef, listGroups } from '@/lib/groups/list';
import { jsonError, jsonOk } from '@/lib/http';
import { type ClosedWindow, closedWindow } from '@/lib/night';
import { siteOrigin } from '@/lib/siteUrl';
import { getServiceClient, type ServiceClient } from '@/lib/supabase';
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
 * How once is guaranteed: `window_posts`, `(group_id, kind, window_start)` primary key, **claimed
 * before the post and stamped after it** (`lib/discord/windowPosts.ts`). A duplicate post is a
 * thing ten friends see; a missed one is a thing they ask about once and the next call fixes.
 *
 * **Every group, independently** (M13.4). The route loops over `groups`; each gets its own board,
 * its own channel and its own claim rows. One group's webhook failing, or its read throwing, is
 * recorded on that group's line and the loop moves on to the next. A group with no webhook gets
 * no post and **no claim row**, exactly as the single-group deployment did.
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
export const groupResultSchema = z.object({
  groupId: groupIdSchema,
  /** The windows that reached this group's channel on this call. Usually empty; once a week, one. */
  posted: z.array(windowPostKindSchema),
  /** The ones that did not, and why. Never contains the webhook URL. */
  skipped: z.array(z.object({ kind: windowPostKindSchema, reason: z.string() })),
});

export type GroupWindowResult = z.infer<typeof groupResultSchema>;

export const responseSchema = z.object({
  ok: z.literal(true),
  /** One line per group, oldest group first (M13.4). */
  groups: z.array(groupResultSchema),
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
   * third. Read the same way the nightly post and `startLobby`'s handler read it. Global: every
   * group shares the zone and the Sunday week (M13, "What stays global").
   */
  const timeZone = nightTimeZone();
  const windows = windowsToConsider(now, timeZone);

  try {
    const client = getServiceClient();
    const groups = await listGroups(client);
    const results: GroupWindowResult[] = [];
    // One group at a time, in order: each is a handful of reads and at most two posts, and a
    // serial loop keeps Discord's per-webhook rate limit and the log readable.
    for (const group of groups) {
      results.push(await postGroupWindows(client, group, windows, { now, timeZone, request }));
    }
    return jsonOk(responseSchema, { ok: true, groups: results });
  } catch (error) {
    console.error('cron window failed', error);
    return jsonError(500, 'internal error');
  }
}

/**
 * One group's windows: claim, post, stamp. **Never throws**: a group whose read or write fails
 * gets the failure on its own line, its claim (if one was taken) stays unstamped and retryable,
 * and the caller moves on to the next group (M13.4).
 */
export async function postGroupWindows(
  client: ServiceClient,
  group: GroupRef,
  windows: readonly ClosedWindow[],
  context: { now: Date; timeZone: string; request: Request },
): Promise<GroupWindowResult> {
  /**
   * Typed as the **response's** kind and filled with the **window's**, which is the one place
   * the two lists are pinned together: a sixth window, or a renamed one, is a typecheck failure
   * here and not a row `window_posts` quietly refuses at 06:00 on a Sunday.
   */
  const posted: WindowPostKind[] = [];
  const skipped: { kind: WindowPostKind; reason: string }[] = [];
  const { now, timeZone, request } = context;

  try {
    // Nothing is claimed for a group that has no webhook: a row here says "the group has been
    // told", and with nowhere to tell them, writing one would silently eat the first week after
    // somebody finally configures Discord (M5.13, edge case 5).
    if ((await selectWebhookUrl(client, group.id)) === null) {
      return {
        groupId: group.id,
        posted: [],
        skipped: windows.map((window) => ({ kind: window.kind, reason: 'no webhook configured' })),
      };
    }

    for (const window of windows) {
      const claim = await claimWindowPost(client, group.id, window, now);
      if (!claim.ok) {
        skipped.push({ kind: window.kind, reason: claim.reason });
        continue;
      }

      const outcome = await postClosedWindow(client, window, {
        now,
        timeZone,
        requestOrigin: siteOrigin(request),
        groupId: group.id,
      });

      if (outcome.status === 'posted') {
        await markWindowPosted(client, group.id, window, now);
        posted.push(window.kind);
        continue;
      }

      const reason = outcome.reason ?? 'the post did not land';
      if (outcome.status === 'skipped' && reason === NO_GAMES_IN_WINDOW) {
        // Nothing happened in this window and nothing ever will: stamp it posted so it is not
        // retried every hour for the next seven days.
        await markWindowPosted(client, group.id, window, now, reason);
      } else {
        // A webhook that would not take it is not a posted week. The row keeps `posted_at`
        // null and a later call retries it.
        await recordWindowPostFailure(client, group.id, window, reason);
        console.error(`cron window: group ${group.slug}: ${window.kind} did not post: ${reason}`);
      }
      skipped.push({ kind: window.kind, reason });
    }
  } catch (error) {
    // This group's read or write failed. The windows not yet handled are reported as such; a
    // claim already taken stays unstamped, which is what makes the next call retry it.
    console.error(`cron window: group ${group.slug} failed`, error);
    for (const window of windows) {
      if (!posted.includes(window.kind) && !skipped.some((entry) => entry.kind === window.kind)) {
        skipped.push({ kind: window.kind, reason: 'internal error' });
      }
    }
  }

  return { groupId: group.id, posted, skipped };
}
