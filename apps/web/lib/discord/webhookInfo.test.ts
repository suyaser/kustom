import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lookupWebhook,
  parseWebhookLink,
  WEBHOOK_INFO_TIMED_OUT,
  WEBHOOK_INFO_UNREACHABLE,
  WEBHOOK_NOT_RECOGNISED,
} from './webhookInfo';

const ID = '223456789012345678';
const TOKEN = 'WebhookToken_abcdefghijklmnopqrstuvwxyz-0123';
const GUILD = '323456789012345678';
const CHANNEL = '423456789012345678';
const HOOK_URL = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

function fakeFetch(answer: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

let logged: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  // No outcome may log the token (the URL is a bearer credential).
  for (const line of logged) expect(line).not.toContain(TOKEN);
  logged = [];
});
function captureLogs(): void {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
}

describe('parseWebhookLink', () => {
  it('reads the id and token from the shapes Discord hands out', () => {
    for (const link of [
      HOOK_URL,
      `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`,
      `https://ptb.discord.com/api/v10/webhooks/${ID}/${TOKEN}/`,
      `  ${HOOK_URL}?wait=true  `,
    ]) {
      expect(parseWebhookLink(link)).toEqual({ id: ID, token: TOKEN });
    }
  });

  it('refuses anything else', () => {
    for (const link of [
      'https://evil.example/api/webhooks/1/2',
      `https://discord.com/api/webhooks/123/${TOKEN}`,
      `https://discord.com/api/webhooks/${ID}/short`,
      `https://discord.com/api/webhooks/${ID}/${TOKEN}/slack`,
      `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    ]) {
      expect(parseWebhookLink(link)).toBeNull();
    }
  });
});

describe('lookupWebhook', () => {
  it('returns the server, the channel and the URL rebuilt from the parts', async () => {
    const discord = fakeFetch(() =>
      Response.json({ type: 1, id: ID, guild_id: GUILD, channel_id: CHANNEL, name: 'Kustom', token: TOKEN }),
    );
    const outcome = await lookupWebhook(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}?x=1`, {
      fetchImpl: discord.impl,
    });
    expect(outcome).toEqual({ ok: true, webhookUrl: HOOK_URL, guildId: GUILD, channelId: CHANNEL });
    expect(discord.calls).toHaveLength(1);
    expect(discord.calls[0]?.url).toBe(HOOK_URL);
    expect(discord.calls[0]?.init?.method).toBe('GET');
    expect(discord.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    // A 3xx must never take the token off discord.com.
    expect(discord.calls[0]?.init?.redirect).toBe('error');
  });

  it('is a 502 when Discord answers with a redirect (fetch refuses it and throws)', async () => {
    captureLogs();
    // What fetch does with `redirect: 'error'` and a 3xx; following it would be the bug.
    const discord = fakeFetch((_url, init) => {
      if (init?.redirect === 'error') {
        throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      }
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
    });
    expect(await lookupWebhook(HOOK_URL, { fetchImpl: discord.impl })).toEqual({
      ok: false,
      status: 502,
      reason: WEBHOOK_INFO_UNREACHABLE,
    });
    expect(discord.calls).toHaveLength(1);
  });

  it('is a 400 with the friendly sentence when Discord does not know the webhook', async () => {
    captureLogs();
    const discord = fakeFetch(() =>
      Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }),
    );
    const outcome = await lookupWebhook(HOOK_URL, { fetchImpl: discord.impl });
    expect(outcome).toEqual({ ok: false, status: 400, reason: WEBHOOK_NOT_RECOGNISED });
    expect(logged.join('\n')).toContain('HTTP 404');
  });

  it('is a 502 when Discord does not answer in time', async () => {
    captureLogs();
    const discord = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const outcome = await lookupWebhook(HOOK_URL, { fetchImpl: discord.impl, timeoutMs: 20 });
    expect(outcome).toEqual({ ok: false, status: 502, reason: WEBHOOK_INFO_TIMED_OUT });
  });

  it('is a 502 when Discord cannot be reached or answers 5xx', async () => {
    captureLogs();
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await lookupWebhook(HOOK_URL, { fetchImpl: down.impl })).toEqual({
      ok: false,
      status: 502,
      reason: WEBHOOK_INFO_UNREACHABLE,
    });
    const broken = fakeFetch(() => new Response('oops', { status: 503 }));
    expect(await lookupWebhook(HOOK_URL, { fetchImpl: broken.impl })).toEqual({
      ok: false,
      status: 502,
      reason: WEBHOOK_INFO_UNREACHABLE,
    });
  });

  it('is a 400 for an answer of the wrong shape, not JSON, or for another webhook', async () => {
    captureLogs();
    for (const answer of [
      () => Response.json({ id: ID, channel_id: CHANNEL }), // no guild_id
      () => Response.json({ id: ID, guild_id: 'not-a-snowflake', channel_id: CHANNEL }),
      () => new Response('<html>', { status: 200 }),
      () => Response.json({ id: '999456789012345678', guild_id: GUILD, channel_id: CHANNEL }),
    ]) {
      const discord = fakeFetch(answer);
      expect(await lookupWebhook(HOOK_URL, { fetchImpl: discord.impl })).toEqual({
        ok: false,
        status: 400,
        reason: WEBHOOK_NOT_RECOGNISED,
      });
    }
  });

  it('does not ask Discord about a link it cannot parse', async () => {
    const discord = fakeFetch(() => Response.json({}));
    expect(await lookupWebhook('https://discord.com/api/webhooks/1/2', { fetchImpl: discord.impl })).toEqual({
      ok: false,
      status: 400,
      reason: WEBHOOK_NOT_RECOGNISED,
    });
    expect(discord.calls).toHaveLength(0);
  });
});
