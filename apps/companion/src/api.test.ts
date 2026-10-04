import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiClient, describeFailure, healthCheck } from './api.js';
import { createMemoryLogger } from './log.js';
import { type FakeApi, startFakeApi } from './test-support/fake-api.js';

const TOKEN = 'tok_test_0123456789';
const okSchema = z.object({ ok: z.literal(true), value: z.number() });

let fake: FakeApi | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

function client(api: FakeApi, overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  const logger = createMemoryLogger();
  const instance = new ApiClient({
    apiBase: api.baseUrl,
    token: TOKEN,
    logger,
    backoff: { minMs: 5, maxMs: 20 },
    timeoutMs: 2_000,
    ...overrides,
  });
  return { client: instance, logger };
}

describe('ApiClient', () => {
  it('sends the bearer token and JSON, and parses the success envelope', async () => {
    fake = await startFakeApi({
      token: TOKEN,
      routes: { 'POST /api/companion/thing': [{ status: 200, body: { ok: true, value: 7 } }] },
    });
    const { client: api } = client(fake);
    const result = await api.post('/api/companion/thing', { partyId: 'p1' }, okSchema);
    expect(result).toEqual({ ok: true, status: 200, data: { ok: true, value: 7 } });
    const request = fake.requests[0];
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.body).toBe('{"partyId":"p1"}');
    expect(request?.userAgent).toMatch(/^customs-night-companion\//);
  });

  it('retries a 5xx with backoff and succeeds', async () => {
    fake = await startFakeApi({
      routes: {
        'POST /api/companion/thing': [
          { status: 503, body: { ok: false, error: 'try later' } },
          { status: 500, body: 'oops', contentType: 'text/html' },
          { status: 200, body: { ok: true, value: 1 } },
        ],
      },
    });
    const { client: api, logger } = client(fake);
    const result = await api.post('/api/companion/thing', {}, okSchema);
    expect(result.ok).toBe(true);
    expect(fake.requests).toHaveLength(3);
    const retries = logger.lines.filter((line) => line.message === 'api call failed, retrying');
    expect(retries).toHaveLength(2);
    expect(retries[0]?.fields).toMatchObject({ status: 503, error: 'try later', attempt: 1 });
    expect(retries[1]?.fields).toMatchObject({ status: 500, error: 'HTTP 500', attempt: 2 });
  });

  it('retries a dropped connection and gives up after maxAttempts without throwing', async () => {
    fake = await startFakeApi({
      routes: { 'POST /api/companion/thing': [{ status: 0, body: null, drop: true }] },
    });
    const { client: api } = client(fake, { maxAttempts: 3 });
    const result = await api.post('/api/companion/thing', {}, okSchema);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'network', attempts: 3 });
    expect(fake.requests).toHaveLength(3);
  });

  it('does not retry a 4xx and surfaces the envelope error and issues', async () => {
    fake = await startFakeApi({
      routes: {
        'POST /api/companion/thing': [
          {
            status: 400,
            body: {
              ok: false,
              error: 'request body failed validation',
              issues: [{ path: 'members', message: 'Required' }],
            },
          },
        ],
      },
    });
    const { client: api, logger } = client(fake);
    const result = await api.post('/api/companion/thing', {}, okSchema);
    expect(result).toEqual({
      ok: false,
      reason: 'http',
      status: 400,
      error: 'request body failed validation',
      issues: [{ path: 'members', message: 'Required' }],
      attempts: 1,
    });
    expect(fake.requests).toHaveLength(1);
    expect(logger.lines.some((line) => line.message === 'api call failed, retrying')).toBe(false);
  });

  it('logs a 401 as a token problem and does not retry', async () => {
    fake = await startFakeApi({ token: 'other-token' });
    const { client: api, logger } = client(fake);
    const result = await api.get('/api/companion/thing', okSchema);
    expect(result).toMatchObject({
      ok: false,
      reason: 'http',
      status: 401,
      error: 'unknown companion token',
    });
    expect(fake.requests).toHaveLength(1);
    const line = logger.lines.find((entry) => entry.level === 'error');
    expect(line?.message).toContain('token');
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN);
  });

  it('reports a 2xx that does not match the schema, and a non-JSON 2xx', async () => {
    fake = await startFakeApi({
      routes: {
        'GET /api/companion/a': [{ status: 200, body: { ok: true, value: 'seven' } }],
        'GET /api/companion/b': [{ status: 200, body: '<html>', contentType: 'text/html' }],
      },
    });
    const { client: api } = client(fake);
    const a = await api.get('/api/companion/a', okSchema);
    expect(a).toMatchObject({ ok: false, reason: 'schema', status: 200 });
    const b = await api.get('/api/companion/b', okSchema);
    expect(b).toMatchObject({ ok: false, reason: 'malformed', status: 200, preview: '<html>' });
    expect(describeFailure(b as Exclude<typeof b, { ok: true }>)).toContain('non-JSON');
  });

  it('answers the health check without a token and reports an unreachable origin', async () => {
    fake = await startFakeApi();
    expect(await healthCheck()(fake.baseUrl)).toBeNull();
    const port = fake.port;
    await fake.close();
    fake = undefined;
    const problem = await healthCheck()(`http://127.0.0.1:${port}`);
    expect(problem).not.toBeNull();
  });

  it('sends no authorization header when it has no token (the pair route)', async () => {
    fake = await startFakeApi({
      routes: { 'POST /api/companion/pair': [{ status: 200, body: { ok: true, value: 1 } }] },
    });
    const instance = new ApiClient({ apiBase: fake.baseUrl, logger: createMemoryLogger(), timeoutMs: 2_000 });
    await instance.post('/api/companion/pair', { code: 'K7QM4X' }, okSchema);
    expect(fake.requests[0]?.authorization).toBeUndefined();
  });

  it('reports a 403 once through onRefused, and a 401 too, but never a 404', async () => {
    fake = await startFakeApi({
      routes: {
        'GET /api/companion/a': [{ status: 403, body: { ok: false, error: 'no longer a member' } }],
        'GET /api/companion/b': [{ status: 404, body: { ok: false, error: 'nope' } }],
      },
    });
    const seen: number[] = [];
    const { client: api } = client(fake, { onRefused: (status) => seen.push(status) });
    await api.get('/api/companion/a', okSchema);
    await api.get('/api/companion/a', okSchema);
    await api.get('/api/companion/b', okSchema);
    expect(seen).toEqual([403]);
  });

  it('sends nothing once its session is stopped (a group switch cannot be followed by an old-token post)', async () => {
    fake = await startFakeApi({
      routes: { 'POST /api/companion/game': [{ status: 200, body: { ok: true, value: 1 } }] },
    });
    const stop = new AbortController();
    const { client: api } = client(fake, { signal: stop.signal });
    stop.abort();
    const result = await api.post('/api/companion/game', { gameId: 1 }, okSchema);
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect(fake.requests).toHaveLength(0);
  });
});
