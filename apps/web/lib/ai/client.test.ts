import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import {
  type AiLogEvent,
  type AiRequest,
  AiTransportError,
  aiClientFromEnv,
  anthropicTransport,
  createAiClient,
  DEEPSEEK_ANTHROPIC_BASE_URL,
  deepseekTransport,
  fakeReply,
  mockTransport,
  parseMessage,
  recordedTransport,
} from './client';
import recordedDeepseek from './fixtures/deepseek-messages.json';
import recorded from './fixtures/messages.json';
import { AI_MODELS, costUsd, memoryMeter, memoryMeterState, memorySpend } from './meter';

/** M16.3: the one door to the model, mocked; and the guard that it is the only one. */

const GROUP = '20000000-0000-4000-8000-000000000001';
const OPEN: AiGate = { premium: true, linesEnabled: true, premiumChangedAt: '2026-10-01T00:00:00Z' };
const NOW = new Date('2026-10-20T20:00:00Z');
const SECRET_PROMPT = 'F1: game | SECRET-PROMPT-TEXT';
const REQUEST: AiRequest = {
  model: 'claude-haiku-4-5-20251001',
  system: 'system rules',
  user: SECRET_PROMPT,
  maxTokens: 150,
};

function setup(
  options: { gate?: AiGate | null; transport?: ReturnType<typeof mockTransport>; timeoutMs?: number } = {},
) {
  const state = memoryMeterState({ [GROUP]: {} });
  const transport =
    options.transport ??
    mockTransport(() => fakeReply('{P1} had 9 kills.', { inputTokens: 2_000, outputTokens: 80 }));
  const logs: AiLogEvent[] = [];
  const client = createAiClient({
    transport,
    meter: memoryMeter(state),
    readGate: async () => (options.gate === undefined ? OPEN : options.gate),
    now: () => NOW,
    log: (event) => logs.push(event),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { client, state, transport, logs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAiClient', () => {
  it('reserves, calls, settles at the real cost and logs ids and numbers only', async () => {
    const { client, state, transport, logs } = setup();
    const result = await client.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    expect(result).toMatchObject({ ok: true, costUsd: 0.0024 });
    expect(transport.requests).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ outcome: 'ok', costUsd: 0.0024 });
    expect(memorySpend(state, GROUP, NOW)).toBe(0.0024);
    expect(logs).toEqual([
      {
        event: 'ai_call',
        groupId: GROUP,
        model: 'claude-haiku-4-5-20251001',
        requestId: 'msg_fake',
        inputTokens: 2_000,
        outputTokens: 80,
        costUsd: 0.0024,
      },
    ]);
  });

  it('makes no call when the gate is closed or unreadable', async () => {
    for (const gate of [null, { ...OPEN, premium: false }, { ...OPEN, linesEnabled: false }]) {
      const { client, transport, state } = setup({ gate });
      expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
        ok: false,
        refused: 'gate_closed',
        costUsd: 0,
      });
      expect(transport.requests).toHaveLength(0);
      expect(state.ledger).toHaveLength(0);
    }
  });

  it('makes no call when the meter refuses (kill switch, caps) or cannot be reached', async () => {
    const { client, transport, state } = setup();
    state.callsEnabled = false;
    expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      refused: 'kill_switch',
    });
    state.callsEnabled = true;
    state.groups.set(GROUP, { premium: true, linesEnabled: true, capUsd: 0 });
    expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      refused: 'group_cap',
    });
    expect(transport.requests).toHaveLength(0);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = createAiClient({
      transport,
      meter: {
        reserve: async () => {
          throw new Error('db down');
        },
        settle: async () => {},
      },
      readGate: async () => OPEN,
      log: () => {},
    });
    expect(await broken.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      refused: 'meter_unavailable',
    });
    expect(transport.requests).toHaveLength(0);
  });

  it('a timeout keeps the worst case on the ledger and is retryable', async () => {
    const hang = mockTransport(
      (_request, _call) =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new AiTransportError('connection')), 200);
        }),
    );
    const { client, state } = setup({ transport: hang, timeoutMs: 10 });
    const result = await client.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    expect(result).toMatchObject({ ok: false, error: 'timeout', retryable: true });
    expect(state.ledger[0]?.outcome).toBe('timeout');
    expect(state.ledger[0]?.costUsd).toBe(state.ledger[0]?.reservedUsd);
  });

  it.each([
    ['rate_limit', true, 0],
    ['server', true, 0],
    ['client', false, 0],
  ] as const)('%s: retryable %s, billed %s', async (kind, retryable, billed) => {
    const failing = mockTransport(() => {
      throw new AiTransportError(kind, kind === 'client' ? 400 : null);
    });
    const { client, state, logs } = setup({ transport: failing });
    expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      ok: false,
      error: kind,
      retryable,
      costUsd: billed,
    });
    expect(state.ledger[0]?.costUsd).toBe(billed);
    expect(logs[0]?.event).toBe('ai_call_failed');
  });

  it('a malformed answer keeps the whole reservation: it may have been billed', async () => {
    const failing = mockTransport(() => {
      throw new AiTransportError('malformed');
    });
    const { client, state } = setup({ transport: failing });
    const result = await client.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    expect(result).toMatchObject({ ok: false, error: 'malformed', retryable: false });
    const row = state.ledger[0];
    expect(row?.costUsd).toBeGreaterThan(0);
    expect(row?.costUsd).toBe(row?.reservedUsd);
    expect(result.costUsd).toBe(row?.reservedUsd);
  });

  it('an unknown throw is treated as malformed, never rethrown, and keeps the reservation', async () => {
    const weird = mockTransport(() => {
      throw new TypeError('boom');
    });
    const { client, state } = setup({ transport: weird });
    expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      error: 'malformed',
    });
    expect(state.ledger[0]?.costUsd).toBe(state.ledger[0]?.reservedUsd);
  });

  it('never logs the prompt, the key or the reply text (default logger)', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => lines.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => lines.push(args.join(' ')));
    const state = memoryMeterState({ [GROUP]: {} });
    const client = createAiClient({
      transport: mockTransport(() => fakeReply('SECRET-REPLY-TEXT')),
      meter: memoryMeter(state),
      readGate: async () => OPEN,
      now: () => NOW,
    });
    await client.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    const failing = createAiClient({
      transport: mockTransport(() => {
        throw new AiTransportError('server', 529);
      }),
      meter: memoryMeter(state),
      readGate: async () => OPEN,
      now: () => NOW,
    });
    await failing.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    const all = lines.join('\n');
    expect(all).toContain('request=msg_fake');
    expect(all).toContain('status=529');
    expect(all).not.toContain('SECRET-PROMPT-TEXT');
    expect(all).not.toContain('SECRET-REPLY-TEXT');
    expect(all).not.toContain('system rules');
  });
});

describe('aiClientFromEnv', () => {
  const service = {} as ServiceClient;

  it('is null without a key, so every AI path is silently absent', () => {
    expect(aiClientFromEnv(service, {})).toBeNull();
    expect(aiClientFromEnv(service, { ANTHROPIC_API_KEY: '' })).toBeNull();
    expect(aiClientFromEnv(service, { ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });

  it('builds a client when a key is set (no call is made by building it)', () => {
    expect(aiClientFromEnv(service, { ANTHROPIC_API_KEY: 'sk-ant-test' })).not.toBeNull();
    expect(aiClientFromEnv(service, { DEEPSEEK_API_KEY: 'sk-ds-test' })).not.toBeNull();
    expect(aiClientFromEnv(service, { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-ds' })).not.toBeNull();
  });

  it('is null when the chosen provider has no key, or the provider is a typo', () => {
    expect(aiClientFromEnv(service, { AI_PROVIDER: 'deepseek', ANTHROPIC_API_KEY: 'sk-ant' })).toBeNull();
    expect(aiClientFromEnv(service, { AI_PROVIDER: 'deepsek', DEEPSEEK_API_KEY: 'sk-ds' })).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------
 * DeepSeek (the user's 2026-10-04 move): the same SDK at DeepSeek's Anthropic-format endpoint
 * ------------------------------------------------------------------------------------------- */

function capturingFetch(responses: readonly unknown[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: unknown, init?: { body?: unknown; headers?: HeadersInit }) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responses[calls.length - 1] ?? responses[0]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('the DeepSeek transport', () => {
  const signal = new AbortController().signal;
  const DS_REQUEST: AiRequest = {
    model: 'deepseek-v4-pro',
    system: 'system rules',
    user: SECRET_PROMPT,
    maxTokens: 150,
  };

  it('pins the request: DeepSeek host, x-api-key, the Messages body, thinking off, temperature', async () => {
    const { calls, fetchImpl } = capturingFetch(recordedDeepseek);
    await deepseekTransport('sk-ds-test', { fetch: fetchImpl }).send(DS_REQUEST, signal);
    expect(DEEPSEEK_ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(calls[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(calls[0]?.headers.get('x-api-key')).toBe('sk-ds-test');
    expect(calls[0]?.body).toEqual({
      model: 'deepseek-v4-pro',
      max_tokens: 150,
      system: 'system rules',
      messages: [{ role: 'user', content: SECRET_PROMPT }],
      thinking: { type: 'disabled' },
      temperature: 0.7,
    });
  });

  it('never omits thinking off for a DeepSeek model (DeepSeek thinks by default)', async () => {
    const deepseekModels = Object.entries(AI_MODELS).filter(([, model]) => model.provider === 'deepseek');
    expect(deepseekModels.length).toBeGreaterThan(0);
    for (const [id, model] of deepseekModels) {
      expect(model.thinkingOff).toEqual({ type: 'disabled' });
      const { calls, fetchImpl } = capturingFetch(recordedDeepseek);
      await deepseekTransport('sk', { fetch: fetchImpl }).send(
        { ...DS_REQUEST, model: id as AiRequest['model'] },
        signal,
      );
      expect(calls[0]?.body.thinking).toEqual({ type: 'disabled' });
    }
  });

  it('parses recorded DeepSeek replies, cache hits included, and prices them', async () => {
    const transport = recordedTransport(recordedDeepseek);
    const first = await transport.send(DS_REQUEST, signal);
    const second = await transport.send(DS_REQUEST, signal);
    expect(first).toEqual({
      requestId: '0236c5b1-854c-4e3e-bf28-0ee10877c7c3',
      text: '{P2} took 9 kills on Lee Sin and never once saw a death screen.',
      inputTokens: 864,
      outputTokens: 13,
      stopReason: 'end_turn',
    });
    // Anthropic's usage semantics: input_tokens (96) excludes the cache read (768).
    expect(second).toMatchObject({ inputTokens: 864, cachedInputTokens: 768, outputTokens: 15 });
    expect(costUsd('deepseek-v4-pro', second)).toBeLessThan(costUsd('deepseek-v4-pro', first));
  });

  it('refuses a model of the other provider without a request (DeepSeek would remap claude-*)', async () => {
    const { calls, fetchImpl } = capturingFetch(recordedDeepseek);
    await expect(
      deepseekTransport('sk', { fetch: fetchImpl }).send(
        { ...DS_REQUEST, model: 'claude-sonnet-5-5' },
        signal,
      ),
    ).rejects.toMatchObject({ kind: 'client' });
    const claude = capturingFetch(recorded);
    await expect(
      anthropicTransport('sk', { fetch: claude.fetchImpl }).send(DS_REQUEST, signal),
    ).rejects.toMatchObject({ kind: 'client' });
    expect(calls).toHaveLength(0);
    expect(claude.calls).toHaveLength(0);
  });

  it('reads a reply robustly: no type, a thinking block, DeepSeek usage names', () => {
    const reply = parseMessage({
      id: 'abc-123',
      content: [
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: '{P1} had 9 kills.' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 900,
        output_tokens: 7,
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 100,
      },
    });
    expect(reply).toEqual({
      requestId: 'abc-123',
      text: '{P1} had 9 kills.',
      inputTokens: 900,
      cachedInputTokens: 800,
      outputTokens: 7,
      stopReason: 'end_turn',
    });
  });
});

describe('parsing the API answer', () => {
  it('replays a recorded response through the real parser', async () => {
    const transport = recordedTransport(recorded);
    const { client } = setup({ transport });
    const result = await client.complete({ groupId: GROUP, lineId: null, request: REQUEST });
    expect(result).toMatchObject({
      ok: true,
      reply: {
        requestId: 'msg_01RecordedGameLine',
        text: '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
        inputTokens: 1_164,
        outputTokens: 31,
      },
    });
    // Past the last recording it behaves like a dropped connection.
    expect(await client.complete({ groupId: GROUP, lineId: null, request: REQUEST })).toMatchObject({
      error: 'connection',
    });
  });

  it('turns Sonnet 5.5 thinking off with between_tools (the API refuses disabled), Haiku sends none', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(recorded[0]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const transport = anthropicTransport('sk-test', { fetch: fakeFetch });
    const signal = new AbortController().signal;
    await transport.send({ ...REQUEST, model: 'claude-sonnet-5-5' }, signal);
    await transport.send({ ...REQUEST, model: 'claude-haiku-4-5-20251001' }, signal);
    expect(bodies[0]?.thinking).toEqual({ type: 'between_tools' });
    expect(bodies[1]).not.toHaveProperty('thinking');
    // Claude keeps its default temperature.
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(bodies[1]).not.toHaveProperty('temperature');
  });

  it('rejects a malformed answer', () => {
    expect(() => parseMessage({ id: 'x', type: 'message', content: [] })).toThrow(AiTransportError);
    expect(() => parseMessage(null)).toThrow(AiTransportError);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The static guard: one module talks to the model
 * ------------------------------------------------------------------------------------------- */

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ['node_modules', '.next', 'dist', 'target', '.git', 'fixtures'].includes(name)
        ? []
        : sources(path);
    }
    return /\.(ts|tsx|mts|cts|js|mjs|rs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every model call goes through lib/ai/client.ts', () => {
  const roots = ['apps', 'packages'].map((dir) => join(REPO_ROOT, dir));
  const files = roots.flatMap(sources);
  const client = join(WEB_ROOT, 'lib/ai/client.ts');

  it('nothing else imports the Anthropic SDK', () => {
    const importers = files
      .filter((path) => path !== client)
      .filter((path) => /['"]@anthropic-ai\/sdk(?:\/[^'"]*)?['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO_ROOT, path));
    expect(importers).toEqual([]);
  });

  it("nothing names the API's host", () => {
    const callers = files
      .filter((path) => /api\.anthropic\.com/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO_ROOT, path));
    expect(callers).toEqual([]);
  });

  it("only the client names DeepSeek's host", () => {
    const callers = files
      .filter((path) => path !== client)
      .filter((path) => /api\.deepseek\.com/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO_ROOT, path));
    expect(callers).toEqual([]);
    expect(readFileSync(client, 'utf8')).toMatch(/api\.deepseek\.com/);
  });

  it('the guard sees the client itself', () => {
    expect(files).toContain(client);
    expect(readFileSync(client, 'utf8')).toMatch(/from '@anthropic-ai\/sdk'/);
  });
});
