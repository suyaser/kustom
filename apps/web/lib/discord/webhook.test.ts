import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookPayload } from './embeds';
import { postWebhookPayload, resetWebhookWarning, WEBHOOK_TIMEOUT_MS } from './webhook';

/**
 * The one piece of I/O in `lib/discord`, against a real HTTP server on a real socket: a fake
 * `fetch` would prove nothing about a timeout or a socket that never answers.
 *
 * The properties, all of them from M3.1's "Webhook missing, or Discord refuses the post":
 * one retry and no more, a 429 waited out once, and never a thrown error.
 */

const PAYLOAD: WebhookPayload = {
  username: 'Kustom',
  embeds: [{ color: 1, title: 'Teams are set' }],
};

interface Recorded {
  method: string;
  path: string;
  contentType: string | undefined;
  body: unknown;
}

class FakeDiscord {
  readonly requests: Recorded[] = [];
  private server: Server | null = null;
  private handler: (request: IncomingMessage, response: ServerResponse, count: number) => void = (
    _request,
    response,
  ) => {
    response.writeHead(204).end();
  };

  async start(): Promise<string> {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        this.requests.push({
          method: request.method ?? '',
          path: request.url ?? '',
          contentType: request.headers['content-type'],
          body: raw.length > 0 ? JSON.parse(raw) : null,
        });
        this.handler(request, response, this.requests.length);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/webhook`;
  }

  answer(handler: (request: IncomingMessage, response: ServerResponse, count: number) => void): void {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}

describe('postWebhookPayload', () => {
  let discord: FakeDiscord;
  let url: string;
  const slept: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
  };

  beforeEach(async () => {
    discord = new FakeDiscord();
    url = await discord.start();
    slept.length = 0;
    resetWebhookWarning();
  });

  afterEach(async () => {
    await discord.stop();
    vi.restoreAllMocks();
  });

  it('posts the payload as JSON, once, and says it landed', async () => {
    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(outcome).toEqual({ status: 'posted', httpStatus: 204, reason: null, attempts: 1 });
    expect(discord.requests).toHaveLength(1);
    expect(discord.requests[0]?.method).toBe('POST');
    expect(discord.requests[0]?.contentType).toBe('application/json');
    expect(discord.requests[0]?.body).toEqual(PAYLOAD);
  });

  it('retries a 500 exactly once, then gives up without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    discord.answer((_request, response) => response.writeHead(500).end('nope'));

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(outcome).toEqual({ status: 'failed', httpStatus: 500, reason: 'HTTP 500', attempts: 2 });
    expect(discord.requests).toHaveLength(2);
    expect(slept).toEqual([500]);
  });

  it('a 500 that recovers on the second try is a posted message', async () => {
    discord.answer((_request, response, count) =>
      count === 1 ? response.writeHead(502).end('bad gateway') : response.writeHead(204).end(),
    );

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(outcome).toMatchObject({ status: 'posted', attempts: 2 });
    expect(discord.requests).toHaveLength(2);
  });

  it('waits out one 429, for exactly as long as Discord asked', async () => {
    discord.answer((_request, response, count) => {
      if (count > 1) return response.writeHead(204).end();
      response
        .writeHead(429, { 'content-type': 'application/json' })
        .end(JSON.stringify({ retry_after: 0.75 }));
    });

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(outcome).toMatchObject({ status: 'posted', attempts: 2 });
    expect(slept).toEqual([750]);
  });

  it('falls back to the retry-after header, and never waits longer than five seconds', async () => {
    discord.answer((_request, response, count) => {
      if (count > 1) return response.writeHead(204).end();
      response.writeHead(429, { 'retry-after': '600' }).end('rate limited');
    });

    await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(slept).toEqual([5_000]);
  });

  it('does not retry a 404: a dead webhook stays dead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    discord.answer((_request, response) => response.writeHead(404).end('unknown webhook'));

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    // `attempts` is what happened, not the budget: the log line says "after 1 attempt".
    expect(outcome).toEqual({ status: 'failed', httpStatus: 404, reason: 'HTTP 404', attempts: 1 });
    expect(discord.requests).toHaveLength(1);
  });

  it('gives up on a server that never answers, and returns rather than throws', async () => {
    discord.answer(() => {
      // Hold the request open: this is the timeout case, not an error case.
    });

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep, timeoutMs: 100 });

    expect(outcome.status).toBe('failed');
    expect(outcome.httpStatus).toBeNull();
    expect(discord.requests).toHaveLength(2);
  });

  it('never follows a redirect: it is a network error, retried once, then failed', async () => {
    // A 307 keeps the method and body, so following it would hand the payload (and, off
    // discord.com, the token in the URL) to wherever `location` points.
    discord.answer((_request, response) => response.writeHead(307, { location: '/stolen' }).end());

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep });

    expect(outcome).toEqual({ status: 'failed', httpStatus: null, reason: 'TypeError', attempts: 2 });
    expect(discord.requests.map((request) => request.path)).toEqual(['/webhook', '/webhook']);
    expect(slept).toEqual([500]);
  });

  it('returns a failure for a host that is not there, and throws nothing', async () => {
    await discord.stop();

    const outcome = await postWebhookPayload(url, PAYLOAD, { sleep, timeoutMs: 500 });

    expect(outcome.status).toBe('failed');
    expect(outcome.attempts).toBe(2);
  });

  it('defaults to a five second budget', () => {
    expect(WEBHOOK_TIMEOUT_MS).toBe(5_000);
  });
});
