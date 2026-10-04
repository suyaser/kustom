/**
 * "Saying who you are, on every start" against the fake API (M2.3, check 13).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import { announceIdentity, checkIdentity, identityLine, TOKEN_REFUSED_SENTENCE } from './identity.js';
import { createMemoryLogger } from './log.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const TOKEN = 'tok_identity_0123456789abcdef';
const PUUID = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const PLAYER_ID = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';

const apis: FakeApi[] = [];

afterEach(async () => {
  for (const api of apis.splice(0)) {
    await api.close();
  }
});

async function setup(me: readonly FakeApiResponse[], token = TOKEN) {
  const fake = await startFakeApi({ token: TOKEN, routes: { 'GET /api/companion/me': me } });
  apis.push(fake);
  const logger = createMemoryLogger();
  const api = new ApiClient({ apiBase: fake.baseUrl, token, logger, maxAttempts: 4, timeoutMs: 2_000 });
  return { fake, logger, api };
}

describe('checkIdentity', () => {
  it('prints "signed in as <displayName>" exactly once for a right token, after exactly one GET', async () => {
    const h = await setup([
      { status: 200, body: { ok: true, puuid: PUUID, playerId: PLAYER_ID, displayName: 'PRT Empty' } },
    ]);
    const outcome = await checkIdentity(h.api);
    announceIdentity(outcome, h.logger);
    expect(outcome).toEqual({
      status: 'ok',
      puuid: PUUID,
      playerId: PLAYER_ID,
      displayName: 'PRT Empty',
      group: null,
    });
    expect(h.fake.requests.filter((request) => request.path === '/api/companion/me')).toHaveLength(1);
    const lines = h.logger.lines.filter((line) => line.message === 'signed in as PRT Empty');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(JSON.stringify(h.logger.lines)).not.toContain(TOKEN);
  });

  it("reads the token's group when the server says it (M14.12), and is null when it does not", async () => {
    const group = { id: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };
    const h = await setup([
      { status: 200, body: { ok: true, puuid: PUUID, playerId: PLAYER_ID, displayName: 'Ana', group } },
    ]);
    const outcome = await checkIdentity(h.api);
    expect(outcome).toMatchObject({ status: 'ok', group });
  });

  it('falls back to the puuid when the display name is still null', () => {
    expect(
      identityLine({ status: 'ok', puuid: PUUID, playerId: PLAYER_ID, displayName: null, group: null }),
    ).toBe(`signed in as player ${PUUID} (no display name yet)`);
  });

  it('prints one plain sentence naming the admin page on 401, with no stack trace, and does not retry', async () => {
    const h = await setup([{ status: 401, body: { ok: false, error: 'unknown companion token' } }], 'wrong');
    const outcome = await checkIdentity(h.api);
    announceIdentity(outcome, h.logger);
    expect(outcome).toEqual({ status: 'refused', httpStatus: 401, error: 'unknown companion token' });
    expect(h.fake.requests).toHaveLength(1);
    const sentence = h.logger.lines.filter((line) => line.message === TOKEN_REFUSED_SENTENCE);
    expect(sentence).toHaveLength(1);
    expect(sentence[0]?.fields.stack).toBeUndefined();
    expect(JSON.stringify(h.logger.lines)).not.toContain('stack');
    // Exactly one admin-page sentence across every logger, the API client's own 401 line included.
    expect(h.logger.lines.filter((line) => line.message.includes('admin page'))).toHaveLength(1);
  });

  it('a 404 on /api/companion/me (wrong apiBase or an old deploy) is "not answering", never "mint a new token"', async () => {
    const h = await setup([{ status: 404, body: { ok: false, error: 'not found' } }]);
    const outcome = await checkIdentity(h.api);
    announceIdentity(outcome, h.logger);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'HTTP 404 not found' });
    expect(h.logger.lines.filter((line) => line.message.includes('admin page'))).toHaveLength(0);
    expect(h.logger.lines.at(-1)?.message).toContain('HTTP 404');
    expect(
      (await checkIdentity((await setup([{ status: 403, body: { ok: false, error: 'no' } }])).api)).status,
    ).toBe('refused');
  });

  it('says the API is not answering on a 5xx or a dropped connection, in one attempt', async () => {
    const down = await setup([{ status: 503, body: { ok: false, error: 'maintenance' } }]);
    const outcome = await checkIdentity(down.api);
    expect(outcome.status).toBe('unavailable');
    expect(down.fake.requests).toHaveLength(1);
    announceIdentity(outcome, down.logger);
    expect(down.logger.lines.at(-1)?.message).toContain('not answering yet');

    const dropped = await setup([{ status: 0, body: null, drop: true }]);
    expect((await checkIdentity(dropped.api)).status).toBe('unavailable');
  });
});
