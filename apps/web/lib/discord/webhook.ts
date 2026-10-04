import type { ServiceClient } from '../supabase';
import type { WebhookPayload } from './embeds';

/**
 * The only I/O in `lib/discord`: one POST to the webhook URL in `discord_config`.
 *
 * Rules this file exists to keep (M3.1, "Webhook missing, or Discord refuses the post"):
 *
 * - **It never throws.** Every caller is a lobby hook, and a hook that throws is a night with
 *   no teams on the tonight page. Failures are one log line and a returned status.
 * - **It never loops.** Five seconds a try, one retry on a 5xx or a network error, one wait
 *   on a 429 that tells us how long. Then it gives up: the tonight page is the other surface
 *   and it must not depend on Discord having accepted anything.
 * - **No secret leaves this file.** The webhook URL is a bearer credential (`discord_config`
 *   has no read policy at all); it is never logged, never returned, never put in an error.
 */

/** How long one attempt may take. Discord answers a webhook in well under a second. */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/** Attempts in total, not retries: one try, then one more. */
const MAX_ATTEMPTS = 2;

/** A 429 we will wait out. Anything longer and the post is stale by the time it lands. */
const MAX_RETRY_AFTER_MS = 5_000;

/** How long to wait before the retry of a 5xx or a network error. */
const RETRY_DELAY_MS = 500;

export interface WebhookOutcome {
  /** `posted` — Discord took it. `skipped` — nothing configured. `failed` — it did not land. */
  status: 'posted' | 'skipped' | 'failed';
  /** The HTTP status of the last attempt, when there was one. */
  httpStatus: number | null;
  /** Why it did not land. Never contains the URL. */
  reason: string | null;
  /** How many requests were actually made. One for a 404; two for a retried 5xx. */
  attempts: number;
  /**
   * The created message's id, only when the post asked for it (`wait: true`, M16.4) and Discord
   * returned one. Absent otherwise.
   */
  messageId?: string | null;
}

export interface WebhookOptions {
  /**
   * Whose `discord_config` to post with (M13.3). Required by {@link postToWebhook} (M13.4): every
   * post belongs to exactly one group, and there is no default group to fall back to.
   */
  groupId?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected in tests so a 429 does not cost the suite a second. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /**
   * M16.4: ask Discord for the created message (`?wait=true`) so the result post can be edited
   * once its AI recap lands. Only the result post of a group whose AI lines are on sets it; every
   * other post keeps the plain request.
   */
  wait?: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST one payload. Resolves with what happened; never rejects.
 *
 * `?wait=true` is not used by default: most posts never need the created message back, and asking
 * for it makes Discord hold the connection open for the message to be persisted. The one exception
 * is `wait: true` (M16.4), the result post of a group whose AI recap may edit it later.
 */
export async function postWebhookPayload(
  url: string,
  payload: WebhookPayload,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;

  let lastStatus: number | null = null;
  let lastReason = 'no attempt was made';
  // What actually happened, not the budget: a 404 is tried once and the log line has to say
  // "after 1", or the next person reading it goes looking for a retry that never ran.
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    let response: Response;
    try {
      response = await doFetch(options.wait === true ? withWait(url) : url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
        // A 3xx must never carry the webhook token off discord.com. A refused redirect throws and
        // is handled like a network error below: one retry, then `failed`.
        redirect: 'error',
      });
    } catch (error) {
      // A timeout is an `AbortError` and reads the same as a refused connection from here:
      // nothing landed, and one more try is all we owe it.
      lastReason = error instanceof Error ? error.name : 'network error';
      lastStatus = null;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    lastStatus = response.status;
    const retryAfterMs = response.status === 429 ? await readRetryAfterMs(response) : null;
    if (response.ok && options.wait === true) {
      const messageId = await readMessageId(response);
      return { status: 'posted', httpStatus: response.status, reason: null, attempts: attempt, messageId };
    }
    // Drain the body so the socket is released; nothing here reads it.
    if (response.status !== 429) await response.text().catch(() => '');

    if (response.ok) {
      return { status: 'posted', httpStatus: response.status, reason: null, attempts: attempt };
    }

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      lastReason = 'rate limited';
      await sleep(Math.min(retryAfterMs ?? RETRY_DELAY_MS, MAX_RETRY_AFTER_MS));
      continue;
    }

    lastReason = `HTTP ${response.status}`;
    // A 4xx is our payload or a dead webhook; retrying it changes nothing.
    if (response.status < 500 || attempt >= MAX_ATTEMPTS) break;
    await sleep(RETRY_DELAY_MS);
  }

  return { status: 'failed', httpStatus: lastStatus, reason: lastReason, attempts };
}

/** The webhook URL with `wait=true` added to whatever query it already has. */
function withWait(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('wait', 'true');
    return parsed.toString();
  } catch {
    return url;
  }
}

/** `{ id: "123..." }` from a `?wait=true` answer, or null. Never throws. */
async function readMessageId(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'id' in body) {
      const id = (body as { id: unknown }).id;
      if (typeof id === 'string' && /^\d{1,25}$/.test(id)) return id;
    }
  } catch {
    // An unreadable body: the post landed, it just cannot be edited later.
  }
  return null;
}

/**
 * Discord's 429 body is `{ retry_after: 0.75 }` in seconds; the `retry-after` header is the
 * fallback. An unreadable body is not an error — the caller falls back to its own delay.
 */
async function readRetryAfterMs(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'retry_after' in body) {
      const value = (body as { retry_after: unknown }).retry_after;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 1_000;
    }
  } catch {
    // Not JSON. The header may still say.
  }

  const header = response.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

/**
 * The configured webhook URL of one group, or `null`.
 *
 * The group's row only (M13.3): two groups may share a Discord server with different channels,
 * and one group's channel must never receive another group's teams. One row per group since
 * `0020` (`group_id` is the primary key). The oldest-row-with-a-URL ordering is kept anyway: it is
 * the row `0020` keeps when it collapses a group's extra rows, and it keeps this read correct on a
 * database `0020` has not reached yet (the code ships first; see the M13.4 deploy note).
 */
export async function selectWebhookUrl(client: ServiceClient, groupId: string): Promise<string | null> {
  const { data, error } = await client
    .from('discord_config')
    .select('webhook_url')
    .eq('group_id', groupId)
    .not('webhook_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`discord: reading discord_config failed: ${error.message}`);
    return null;
  }

  const url = data?.webhook_url?.trim();
  return url && url.length > 0 ? url : null;
}

/**
 * Said once per process **per group**, not once per lobby: an unconfigured webhook is not an
 * incident, and a group with no channel yet must not hide another group's first warning.
 */
const warnedAboutMissingWebhook = new Set<string>();

/** Tests only. */
export function resetWebhookWarning(): void {
  warnedAboutMissingWebhook.clear();
}

/**
 * Read the config and post. `label` is what the log line calls this message, and it is the
 * only thing about the message that is ever logged.
 */
export async function postToWebhook(
  client: ServiceClient,
  payload: WebhookPayload,
  label: string,
  options: WebhookOptions & { groupId: string },
): Promise<WebhookOutcome> {
  const groupId = options.groupId;
  const url = await selectWebhookUrl(client, groupId);
  if (url === null) {
    if (!warnedAboutMissingWebhook.has(groupId)) {
      warnedAboutMissingWebhook.add(groupId);
      console.info(
        `discord: no webhook configured for group ${groupId}; skipping its posts until one is set in /admin/discord`,
      );
    }
    return { status: 'skipped', httpStatus: null, reason: 'no webhook configured', attempts: 0 };
  }

  const outcome = await postWebhookPayload(url, payload, options);
  if (outcome.status === 'failed') {
    const tries = outcome.attempts === 1 ? '1 attempt' : `${outcome.attempts} attempts`;
    console.error(`discord: posting the ${label} failed after ${tries}: ${outcome.reason}`);
  }
  return outcome;
}

/**
 * M16.4: replace one message this webhook posted (`PATCH <webhook>/messages/<id>`), used once per
 * game to add the AI recap to the result post. Same rules as {@link postWebhookPayload}: never
 * throws, one try plus one retry on a 5xx or a network error, never follows a redirect, never
 * logs the URL. Mentions stay off (`allowed_mentions.parse` empty).
 */
export async function editWebhookMessage(
  url: string,
  messageId: string,
  payload: WebhookPayload,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  let target: string;
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(messageId)}`;
    target = parsed.toString();
  } catch {
    return { status: 'failed', httpStatus: null, reason: 'bad webhook url', attempts: 0 };
  }

  let lastStatus: number | null = null;
  let lastReason = 'no attempt was made';
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    let response: Response;
    try {
      response = await doFetch(target, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      lastReason = error instanceof Error ? error.name : 'network error';
      lastStatus = null;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }
    lastStatus = response.status;
    await response.text().catch(() => '');
    if (response.ok) return { status: 'posted', httpStatus: response.status, reason: null, attempts };
    lastReason = `HTTP ${response.status}`;
    if (response.status < 500 || attempt >= MAX_ATTEMPTS) break;
    await sleep(RETRY_DELAY_MS);
  }
  return { status: 'failed', httpStatus: lastStatus, reason: lastReason, attempts };
}
