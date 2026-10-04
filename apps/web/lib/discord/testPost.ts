import { z } from 'zod';
import { KUSTOM_USERNAME } from './embeds';

/**
 * The test post (M14.20): one message to a webhook the admin just connected or pasted, so the page
 * can say `Done · test post sent <time ago>` -- or show Discord's reason when it did not land.
 *
 * Its own small POST rather than `postWebhookPayload`, for one reason: the admin needs **Discord's
 * reason** (`Unknown Webhook`, `Missing Access`), which lives in the error body that the night's
 * posting path deliberately never reads. Same rules otherwise: never throws, never logs or returns
 * the URL, one attempt with a timeout (the admin is waiting on a redirect).
 */

/** Product's sentence (STRATEGY §3.2 step 2). */
export const TEST_POST_TEXT = 'Kustom is connected. Teams and results will show up here.';

export const TEST_POST_TIMEOUT_MS = 5_000;

/** Discord's error body: `{ "message": "Unknown Webhook", "code": 10015 }`. */
const discordErrorSchema = z.object({ message: z.string().min(1).max(300) });

export type TestPostOutcome = { ok: true } | { ok: false; reason: string };

/**
 * The test post's body (05-design 10.10): the same sentence as ever, now sent as `Kustom` with
 * the avatar when the site has a public address, so the first thing a group sees is the identity
 * every later post uses. Content only, no embed, no pings. Pure.
 */
export function testPostBody(avatarUrl?: string | undefined) {
  return {
    username: KUSTOM_USERNAME,
    ...(avatarUrl === undefined ? {} : { avatar_url: avatarUrl }),
    content: TEST_POST_TEXT,
    allowed_mentions: { parse: [] as string[] },
  };
}

export async function sendTestPost(
  webhookUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; avatarUrl?: string | undefined } = {},
): Promise<TestPostOutcome> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No pings, whatever the text ever becomes.
      body: JSON.stringify(testPostBody(options.avatarUrl)),
      signal: AbortSignal.timeout(options.timeoutMs ?? TEST_POST_TIMEOUT_MS),
      // A 3xx must never carry the webhook token off discord.com; a refused redirect throws.
      redirect: 'error',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { ok: false, reason: timedOut ? "Discord didn't answer in time." : "Couldn't reach Discord." };
  }

  if (response.ok) {
    await response.text().catch(() => '');
    return { ok: true };
  }

  let message: string | null = null;
  try {
    const parsed = discordErrorSchema.safeParse(await response.json());
    if (parsed.success) message = parsed.data.message;
  } catch {
    // Not JSON; the status says enough.
  }
  return {
    ok: false,
    reason: message ? `Discord said: ${message}` : `Discord said no (HTTP ${response.status}).`,
  };
}
