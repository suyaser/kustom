import type { ClosedWindow } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Who has already been told about which window (M5.13).
 *
 * `GET /api/cron/window` is called by something outside the app on a schedule nobody in this
 * repo controls, so it is written to be safe at any cadence: hourly, daily or twice a minute,
 * each window posts **exactly once**. Everything that makes that true is here and in
 * `window_posts` (migration `0011`), whose primary key `(kind, window_start)` is the actual
 * decider — two calls in the same second race on one insert and Postgres picks the winner.
 *
 * **Claim first, post second.** A duplicate post is a thing ten friends see in the channel; a
 * missed one is a thing they ask about once and a later call fixes. So the route claims a
 * window here and only builds an embed if the claim landed.
 *
 * **A failed post is not a posted week.** The claim row is written with `posted_at` null and
 * only stamped once Discord has taken the message, so a webhook that was down when the week
 * closed is retried by a later call. The retry is a **lease plus a compare-and-swap**, not a
 * bare "posted_at is null": the second of two calls that arrive while the first is still
 * talking to Discord must post nothing, so a claim is only taken over once it is
 * {@link WINDOW_POST_RETRY_MS} old, and the takeover is conditioned on the `claimed_at` it
 * read, so two retriers cannot both win.
 *
 * The clock is the **route's**, injected, and never `now()` in the database: an integration
 * test drives this on a faked Sunday, and a lease measured half in one clock and half in
 * another is a lease that fires at the wrong time on exactly the day it matters.
 *
 * **Nothing here reads a calendar.** The key is `closedWindow`'s and the day a week closes on
 * is `weekStart`'s, so M5.34 moved the post from Monday to Sunday without touching this file.
 */

/**
 * How long a claim holds before another call may retry it.
 *
 * Ten minutes: long enough that no post is still in flight (the webhook client gives up after
 * two five-second attempts), short enough that a Discord outage at 06:00 on a Sunday is
 * recovered by the next hourly call rather than the next week.
 */
export const WINDOW_POST_RETRY_MS = 10 * 60 * 1_000;

/** Why this call is not the one that posts. Every string is safe to return to a scheduler. */
export type WindowClaim =
  | { ok: true; attempts: number }
  | { ok: false; reason: 'already posted' | 'a post for this window is already in flight' };

/**
 * Take this window, or say who has it.
 *
 * `upsert(..., { ignoreDuplicates: true })` is PostgREST's `on conflict do nothing`: the
 * insert either returns the row it wrote or returns nothing at all, and "nothing at all" is
 * the only signal that matters — it means somebody else got here first, and this call reads
 * the row to find out whether that was a post that landed or one that did not.
 */
export async function claimWindowPost(
  client: ServiceClient,
  window: ClosedWindow,
  now: Date,
): Promise<WindowClaim> {
  const claimedAt = now.toISOString();

  const { data: inserted, error } = await client
    .from('window_posts')
    .upsert(
      { kind: window.kind, window_start: window.key, claimed_at: claimedAt, attempts: 1 },
      { onConflict: 'kind,window_start', ignoreDuplicates: true },
    )
    .select('attempts');
  if (error) throw new Error(`window post: claiming ${window.kind} failed: ${error.message}`);
  if ((inserted ?? []).length > 0) return { ok: true, attempts: 1 };

  const { data: existing, error: readError } = await client
    .from('window_posts')
    .select('claimed_at, posted_at, attempts')
    .eq('kind', window.kind)
    .eq('window_start', window.key)
    .maybeSingle();
  if (readError) throw new Error(`window post: reading ${window.kind} failed: ${readError.message}`);
  // Gone between the upsert and the read: nothing has posted it, so the next call will claim
  // it cleanly. Saying "in flight" here is a lie for one call and costs one cron interval.
  if (existing === null) return { ok: false, reason: 'a post for this window is already in flight' };
  if (existing.posted_at !== null) return { ok: false, reason: 'already posted' };

  const heldForMs = now.getTime() - Date.parse(existing.claimed_at);
  if (heldForMs < WINDOW_POST_RETRY_MS) {
    return { ok: false, reason: 'a post for this window is already in flight' };
  }

  const attempts = existing.attempts + 1;
  const { data: won, error: casError } = await client
    .from('window_posts')
    .update({ claimed_at: claimedAt, attempts })
    .eq('kind', window.kind)
    .eq('window_start', window.key)
    .is('posted_at', null)
    // The compare-and-swap: only the call that still sees the claim it read may take it.
    .eq('claimed_at', existing.claimed_at)
    .select('attempts');
  if (casError) throw new Error(`window post: retrying ${window.kind} failed: ${casError.message}`);
  if ((won ?? []).length === 0) {
    return { ok: false, reason: 'a post for this window is already in flight' };
  }

  return { ok: true, attempts };
}

/**
 * The post landed — or the window had nothing to post and never will, which is the same row
 * with a `reason`.
 *
 * An empty week is stamped **posted** on purpose (M5.13, edge case 2): left unstamped it would
 * be retried every hour for seven days, and there is nothing there to find.
 */
export async function markWindowPosted(
  client: ServiceClient,
  window: ClosedWindow,
  now: Date,
  reason: string | null = null,
): Promise<void> {
  const { error } = await client
    .from('window_posts')
    .update({ posted_at: now.toISOString(), reason })
    .eq('kind', window.kind)
    .eq('window_start', window.key);
  if (error) throw new Error(`window post: stamping ${window.kind} failed: ${error.message}`);
}

/**
 * The post did not land. `posted_at` stays null — that is what makes the next call retry it —
 * and the reason is kept so somebody reading the table later knows what happened.
 *
 * `reason` is a {@link import('./webhook').WebhookOutcome} reason (`HTTP 500`, `TimeoutError`)
 * and never contains the webhook URL, by that module's rule.
 */
export async function recordWindowPostFailure(
  client: ServiceClient,
  window: ClosedWindow,
  reason: string,
): Promise<void> {
  const { error } = await client
    .from('window_posts')
    .update({ reason })
    .eq('kind', window.kind)
    .eq('window_start', window.key)
    .is('posted_at', null);
  if (error) console.error(`window post: recording the failure of ${window.kind}: ${error.message}`);
}
