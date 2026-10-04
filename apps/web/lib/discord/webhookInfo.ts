import { discordWebhookInfoSchema } from '@customs/db/schemas';
import { webhookUrlFrom } from './connect';

/**
 * Paste-a-webhook (M14.20 follow-up): a pasted webhook link carries no server id, and
 * `discord_config.guild_id` is NOT NULL. So the paste route asks Discord:
 * `GET https://discord.com/api/webhooks/<id>/<token>` needs no auth and answers with the webhook's
 * `guild_id` and `channel_id`.
 *
 * Same rules as the rest of `lib/discord`: never throws, one attempt with a timeout, and the URL
 * (a bearer credential) is never logged, returned in a reason, or put in an error. The URL that is
 * stored is rebuilt from the parsed id and token, never taken as pasted.
 */

/** Like the OAuth exchange (M14.20): the admin is waiting on the save. */
export const WEBHOOK_INFO_TIMEOUT_MS = 10_000;

/** A link we could not parse, or one Discord does not know (4xx, or an answer of the wrong shape). */
export const WEBHOOK_NOT_RECOGNISED =
  "Discord didn't recognise that webhook link. Copy it again from the channel's settings.";

/** Discord did not answer within the timeout. */
export const WEBHOOK_INFO_TIMED_OUT = "Discord didn't answer in time. Try saving again in a minute.";

/** The network failed, or Discord answered 5xx. */
export const WEBHOOK_INFO_UNREACHABLE = "Couldn't reach Discord. Try saving again in a minute.";

const WEBHOOK_LINK =
  /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord\.com|discordapp\.com)\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{20,200})\/?(?:\?[^#]*)?$/;

/** The id and token of a pasted webhook link, or null when it is not shaped like one. */
export function parseWebhookLink(link: string): { id: string; token: string } | null {
  const match = WEBHOOK_LINK.exec(link.trim());
  return match ? { id: match[1] as string, token: match[2] as string } : null;
}

export type WebhookInfoOutcome =
  | { ok: true; webhookUrl: string; guildId: string; channelId: string }
  | {
      ok: false;
      /** 400 for a link Discord does not know; 502 when Discord could not be asked. */
      status: 400 | 502;
      reason: string;
    };

export async function lookupWebhook(
  link: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<WebhookInfoOutcome> {
  const parts = parseWebhookLink(link);
  if (parts === null) return { ok: false, status: 400, reason: WEBHOOK_NOT_RECOGNISED };
  const webhookUrl = webhookUrlFrom(parts);

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(webhookUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_INFO_TIMEOUT_MS),
      // A 3xx must never carry the token off discord.com; a refused redirect throws and reads as unreachable.
      redirect: 'error',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    console.error(`discord paste: webhook lookup did not complete (${timedOut ? 'timeout' : 'network'})`);
    return { ok: false, status: 502, reason: timedOut ? WEBHOOK_INFO_TIMED_OUT : WEBHOOK_INFO_UNREACHABLE };
  }

  if (!response.ok) {
    await response.text().catch(() => '');
    console.error(`discord paste: webhook lookup refused (HTTP ${response.status})`);
    return response.status >= 500
      ? { ok: false, status: 502, reason: WEBHOOK_INFO_UNREACHABLE }
      : { ok: false, status: 400, reason: WEBHOOK_NOT_RECOGNISED };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error('discord paste: webhook lookup answer was not JSON');
    return { ok: false, status: 400, reason: WEBHOOK_NOT_RECOGNISED };
  }
  const parsed = discordWebhookInfoSchema.safeParse(body);
  // A webhook that is not the one we asked for is not one we will store.
  if (!parsed.success || parsed.data.id !== parts.id) {
    // The paths only: the body echoes the token.
    const paths = parsed.success ? 'id' : parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    console.error(`discord paste: unexpected webhook lookup answer (${paths})`);
    return { ok: false, status: 400, reason: WEBHOOK_NOT_RECOGNISED };
  }

  return { ok: true, webhookUrl, guildId: parsed.data.guild_id, channelId: parsed.data.channel_id };
}
