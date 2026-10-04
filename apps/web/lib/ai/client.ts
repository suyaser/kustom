import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { type AiEnv, type AiProvider, readAiEnv } from '../env';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import {
  AI_MODELS,
  type AiMeter,
  type AiModel,
  costUsd,
  dbMeter,
  inputTokenUpperBound,
  worstCaseUsd,
} from './meter';

/**
 * The one door to the model (M16.3; brief 4.1 "all model calls behind it, the way `packages/lcu`
 * holds the client"). **Nothing else in the codebase imports `@anthropic-ai/sdk` or names a
 * provider's host**; `client.test.ts` fails the build if anything does.
 *
 * Two providers speak through the same SDK (the user's 2026-10-04 move to DeepSeek): Claude
 * (`anthropic`) and DeepSeek's own API (`deepseek`), whose Anthropic-format endpoint
 * ({@link DEEPSEEK_ANTHROPIC_BASE_URL}) takes the same Messages request. `AI_PROVIDER` and the
 * keys pick one per process (`readAiEnv`), and the feature table names that provider's models.
 *
 * Every call, in order:
 * 1. **The gate** (`lib/premium`): the group is Premium with its AI lines switched on, or no call.
 * 2. **The meter** (`ai_reserve_call`): the call's worst case -- every input byte as a token plus
 *    `max_tokens` of output -- must fit what is left under the group's cap and the global cap, and
 *    the kill switch must be off. Reserved before the call, settled at the real cost after.
 * 3. **The transport**, with a timeout and no SDK retries (a retry is a new, metered call).
 *
 * It never throws and never logs a prompt, a key or a response's text: only the request id, the
 * model, token counts, cost and an error's kind. With no usable key (`DEEPSEEK_API_KEY` or
 * `ANTHROPIC_API_KEY`, see `readAiEnv`) there is no client at all ({@link aiClientFromEnv} returns
 * null) and every AI path is silently absent.
 *
 * Fully mockable: the transport is an interface. {@link anthropicTransport} and
 * {@link deepseekTransport} are the real ones;
 * {@link mockTransport} answers from a function and {@link recordedTransport} replays recorded API
 * responses through the same parser the real one uses.
 */

/** Per call. A recap line is a second or two; anything past this is a hung connection. */
export const AI_TIMEOUT_MS = 20_000;

export interface AiRequest {
  model: AiModel;
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiReply {
  /** The API's message id (`msg_...`), for the ledger and the logs. */
  requestId: string;
  text: string;
  /** Every input token, cache hits included. */
  inputTokens: number;
  /** The part of {@link inputTokens} the provider reported as a cache hit (DeepSeek caches on its own). */
  cachedInputTokens?: number;
  outputTokens: number;
  stopReason: string | null;
}

/** How a call failed. `retryable` kinds may be tried again later; the others will not get better. */
export type AiTransportErrorKind =
  | 'timeout'
  | 'connection'
  | 'rate_limit'
  | 'server'
  | 'client'
  | 'malformed';

const RETRYABLE: ReadonlySet<AiTransportErrorKind> = new Set([
  'timeout',
  'connection',
  'rate_limit',
  'server',
]);

/**
 * Billed or not is unknown: the request may have reached the API and no answer came back
 * (timeout, connection), or an answer came back we could not read (malformed -- also what any
 * unexpected throw inside `send` becomes). The reservation stays: over-counting is the safe side.
 */
const BILL_UNKNOWN: ReadonlySet<AiTransportErrorKind> = new Set(['timeout', 'connection', 'malformed']);

export class AiTransportError extends Error {
  readonly kind: AiTransportErrorKind;
  readonly status: number | null;
  constructor(kind: AiTransportErrorKind, status: number | null = null) {
    super(`ai transport: ${kind}${status === null ? '' : ` (${status})`}`);
    this.name = 'AiTransportError';
    this.kind = kind;
    this.status = status;
  }
}

/** Sends one request. Throws an {@link AiTransportError} (anything else is treated as malformed). */
export interface AiTransport {
  send(request: AiRequest, signal: AbortSignal): Promise<AiReply>;
}

/* ---------------------------------------------------------------------------------------------
 * The API's answer, validated (CLAUDE.md: every boundary has a zod schema)
 * ------------------------------------------------------------------------------------------- */

const tokenCount = z.number().int().nonnegative();

const messageSchema = z.object({
  id: z.string().min(1).max(200),
  // Anthropic always sends `message`; a compatible endpoint that leaves it out is still read.
  type: z.literal('message').optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      cache_creation_input_tokens: tokenCount.nullable().optional(),
      cache_read_input_tokens: tokenCount.nullable().optional(),
      // DeepSeek's own names (its OpenAI-format usage), read too in case its Anthropic endpoint
      // passes them through; `input_tokens` then already counts the hits.
      prompt_cache_hit_tokens: tokenCount.nullable().optional(),
      prompt_cache_miss_tokens: tokenCount.nullable().optional(),
    })
    .loose(),
});

/**
 * A Messages API response (Anthropic's, or DeepSeek's Anthropic-format one) to an {@link AiReply}:
 * the text blocks joined (thinking blocks, if a model sends any, are dropped), the usage summed.
 * Every input token is counted; only tokens reported as a cache hit are marked cached, and the
 * total is never below what either naming says, so a reading error over-counts, never under.
 */
export function parseMessage(raw: unknown): AiReply {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) throw new AiTransportError('malformed');
  const message = parsed.data;
  const usage = message.usage;
  const text = message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  const anthropicTotal =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const deepseekTotal = (usage.prompt_cache_hit_tokens ?? 0) + (usage.prompt_cache_miss_tokens ?? 0);
  const inputTokens = Math.max(anthropicTotal, deepseekTotal);
  const cached = Math.min(inputTokens, usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0);
  return {
    requestId: message.id,
    text,
    inputTokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    outputTokens: usage.output_tokens,
    stopReason: message.stop_reason ?? null,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Transports
 * ------------------------------------------------------------------------------------------- */

function transportErrorOf(error: unknown): AiTransportError {
  if (error instanceof AiTransportError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiTransportError('timeout');
  if (error instanceof Anthropic.APIUserAbortError) return new AiTransportError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new AiTransportError('connection');
  if (error instanceof Anthropic.RateLimitError) return new AiTransportError('rate_limit', 429);
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    // 529 is "overloaded"; 408 and 409 are the API's own "try again".
    if (status !== null && (status >= 500 || status === 408 || status === 409)) {
      return new AiTransportError('server', status);
    }
    return new AiTransportError('client', status);
  }
  if (error instanceof Error && error.name === 'AbortError') return new AiTransportError('timeout');
  return new AiTransportError('malformed');
}

/**
 * DeepSeek's Anthropic-format endpoint (https://api-docs.deepseek.com/guides/anthropic_api, read
 * 2026-10-04): the SDK posts to `<this>/v1/messages` with `x-api-key`. It takes `model`,
 * `max_tokens`, `system`, `messages` and `thinking` (`budget_tokens` ignored), and ignores
 * `cache_control` (DeepSeek caches repeated prefixes on its own).
 */
export const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';

/** DeepSeek's model list (OpenAI format, `GET /models`), read only by the eval script. */
const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

interface TransportOptions {
  fetch?: typeof fetch;
}

/** The Messages request for one call: the same shape for both providers, thinking off per model. */
export function messagesBody(request: AiRequest) {
  const { thinkingOff, temperature } = AI_MODELS[request.model];
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: 'user' as const, content: request.user }],
    // Sonnet 5.5 refuses `{ type: 'disabled' }` with a 400 and takes `between_tools` (M16.8);
    // DeepSeek thinks by default and takes `disabled`; Haiku 4.5 sends nothing.
    ...(thinkingOff === null ? {} : { thinking: { ...thinkingOff } }),
    ...(temperature === null ? {} : { temperature }),
  };
}

function messagesTransport(
  provider: AiProvider,
  apiKey: string,
  baseURL: string | undefined,
  options: TransportOptions,
): AiTransport {
  const sdk = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: AI_TIMEOUT_MS,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    async send(request, signal) {
      // A model of the other provider would be silently remapped (DeepSeek maps any claude-* name
      // to its own model) or refused: never sent, never billed.
      if (AI_MODELS[request.model].provider !== provider) throw new AiTransportError('client');
      try {
        const message = await sdk.messages.create(messagesBody(request), { signal });
        return parseMessage(message);
      } catch (error) {
        throw transportErrorOf(error);
      }
    },
  };
}

/** The real Claude transport: the official SDK, no SDK retries, our timeout. */
export function anthropicTransport(apiKey: string, options: TransportOptions = {}): AiTransport {
  return messagesTransport('anthropic', apiKey, undefined, options);
}

/** The real DeepSeek transport: the same SDK at {@link DEEPSEEK_ANTHROPIC_BASE_URL}. */
export function deepseekTransport(apiKey: string, options: TransportOptions = {}): AiTransport {
  return messagesTransport('deepseek', apiKey, DEEPSEEK_ANTHROPIC_BASE_URL, options);
}

/** The real transport for an AI environment. */
export function aiTransportFor(env: AiEnv, options: TransportOptions = {}): AiTransport {
  return env.provider === 'deepseek'
    ? deepseekTransport(env.apiKey, options)
    : anthropicTransport(env.apiKey, options);
}

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(200) }).loose()),
});

/**
 * The provider's live model ids (eval script only, never production): DeepSeek's `GET /models`,
 * or the Anthropic SDK's model list. Throws on any failure; never logs the key.
 */
export async function listProviderModels(env: AiEnv, options: TransportOptions = {}): Promise<string[]> {
  const doFetch = options.fetch ?? fetch;
  if (env.provider === 'deepseek') {
    const response = await doFetch(DEEPSEEK_MODELS_URL, {
      headers: { authorization: `Bearer ${env.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`model list: HTTP ${response.status}`);
    const parsed = modelListSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('model list: malformed answer');
    return parsed.data.data.map((model) => model.id);
  }
  const sdk = new Anthropic({ apiKey: env.apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS, fetch: doFetch });
  const page = await sdk.models.list();
  return page.data.map((model) => model.id);
}

/** A transport that answers from a function: return a reply, or throw an {@link AiTransportError}. */
export function mockTransport(
  answer: (request: AiRequest, call: number) => AiReply | Promise<AiReply>,
): AiTransport & {
  requests: AiRequest[];
} {
  const requests: AiRequest[] = [];
  return {
    requests,
    async send(request, signal) {
      if (signal.aborted) throw new AiTransportError('timeout');
      requests.push(request);
      return answer(request, requests.length);
    },
  };
}

/**
 * Replays recorded Messages API responses (raw JSON, as the API sent them) in order, through
 * {@link parseMessage}. Past the last one it fails like a dropped connection.
 */
export function recordedTransport(responses: readonly unknown[]): AiTransport & { requests: AiRequest[] } {
  let index = 0;
  return mockTransport(() => {
    const raw = responses[index];
    index += 1;
    if (raw === undefined) throw new AiTransportError('connection');
    return parseMessage(raw);
  });
}

/** A reply as a test or local dev writes one. */
export function fakeReply(
  text: string,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): AiReply {
  return {
    requestId: 'msg_fake',
    text,
    inputTokens: usage.inputTokens ?? 1_500,
    outputTokens: usage.outputTokens ?? 40,
    stopReason: 'end_turn',
  };
}

/* ---------------------------------------------------------------------------------------------
 * The client
 * ------------------------------------------------------------------------------------------- */

export type AiCallRefusal =
  | 'gate_closed'
  | 'meter_unavailable'
  | 'kill_switch'
  | 'not_premium'
  | 'lines_off'
  | 'group_cap'
  | 'global_cap'
  | 'no_group';

export type AiCallResult =
  | { ok: true; reply: AiReply; costUsd: number }
  /** Refused before any call: nothing was spent. */
  | { ok: false; refused: AiCallRefusal; retryable: false; costUsd: 0 }
  /** The call was made and failed. `costUsd` is what the ledger now holds for it. */
  | { ok: false; error: AiTransportErrorKind; retryable: boolean; costUsd: number };

/** One structured log line per call. Never a prompt, a key or a response's text. */
export interface AiLogEvent {
  event: 'ai_call' | 'ai_call_failed' | 'ai_call_refused';
  groupId: string;
  model: AiModel;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  reason?: string;
  status?: number | null;
}

export interface AiClientDeps {
  transport: AiTransport;
  meter: AiMeter;
  /** `readAiGate` in production; a fixed gate in tests. */
  readGate: (groupId: string) => Promise<AiGate | null>;
  now?: () => Date;
  timeoutMs?: number;
  log?: (event: AiLogEvent) => void;
}

export interface AiCallInput {
  groupId: string;
  /** The `ai_lines` row the call is for, recorded on the ledger. */
  lineId: string | null;
  request: AiRequest;
}

export interface AiClient {
  complete(input: AiCallInput): Promise<AiCallResult>;
}

function defaultLog(event: AiLogEvent): void {
  const parts = [`ai: ${event.event}`, `group=${event.groupId}`, `model=${event.model}`];
  if (event.requestId !== undefined) parts.push(`request=${event.requestId}`);
  if (event.inputTokens !== undefined) parts.push(`in=${event.inputTokens}`);
  if (event.outputTokens !== undefined) parts.push(`out=${event.outputTokens}`);
  if (event.costUsd !== undefined) parts.push(`cost=$${event.costUsd.toFixed(6)}`);
  if (event.reason !== undefined) parts.push(`reason=${event.reason}`);
  if (event.status !== undefined && event.status !== null) parts.push(`status=${event.status}`);
  console.info(parts.join(' '));
}

export function createAiClient(deps: AiClientDeps): AiClient {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? AI_TIMEOUT_MS;
  const log = deps.log ?? defaultLog;

  return {
    async complete({ groupId, lineId, request }) {
      const model = request.model;
      const refuse = (refused: AiCallRefusal): AiCallResult => {
        log({ event: 'ai_call_refused', groupId, model, reason: refused });
        return { ok: false, refused, retryable: false, costUsd: 0 };
      };

      if (!aiGateOpen(await deps.readGate(groupId))) return refuse('gate_closed');

      const worstCase = worstCaseUsd(
        model,
        inputTokenUpperBound(request.system, request.user),
        request.maxTokens,
      );
      let callId: string;
      try {
        const reservation = await deps.meter.reserve({
          groupId,
          lineId,
          model,
          worstCaseUsd: worstCase,
          now: now(),
        });
        if (!reservation.ok) return refuse(reservation.reason);
        callId = reservation.callId;
      } catch (error) {
        console.error('ai: meter unavailable', error instanceof Error ? error.message : 'unknown error');
        return refuse('meter_unavailable');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const reply = await deps.transport.send(request, controller.signal);
        const cost = costUsd(model, reply);
        await settleQuietly(deps.meter, callId, {
          outcome: 'ok',
          costUsd: cost,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          requestId: reply.requestId,
        });
        log({
          event: 'ai_call',
          groupId,
          model,
          requestId: reply.requestId,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          costUsd: cost,
        });
        return { ok: true, reply, costUsd: cost };
      } catch (thrown) {
        const error = controller.signal.aborted ? new AiTransportError('timeout') : transportErrorOf(thrown);
        // A request that may have reached the API keeps its worst case on the ledger: the bill is
        // unknown, and the cap must not be overshot by what we cannot see.
        const cost = BILL_UNKNOWN.has(error.kind) ? worstCase : 0;
        await settleQuietly(deps.meter, callId, {
          outcome: error.kind === 'timeout' ? 'timeout' : 'error',
          costUsd: cost,
          inputTokens: null,
          outputTokens: null,
          requestId: null,
        });
        log({
          event: 'ai_call_failed',
          groupId,
          model,
          reason: error.kind,
          status: error.status,
          costUsd: cost,
        });
        return { ok: false, error: error.kind, retryable: RETRYABLE.has(error.kind), costUsd: cost };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function settleQuietly(meter: AiMeter, callId: string, input: Parameters<AiMeter['settle']>[1]) {
  try {
    await meter.settle(callId, input);
  } catch (error) {
    // The reservation stays on the ledger at its worst case: over-counted, never under.
    console.error('ai: settle failed', error instanceof Error ? error.message : 'unknown error');
  }
}

/**
 * The production client, or **null when no usable key is set** (`readAiEnv`: `AI_PROVIDER`,
 * `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`) -- the quiet off state: every caller treats null as
 * "no AI here" and moves on.
 */
export function aiClientFromEnv(
  service: ServiceClient,
  source: Readonly<Record<string, string | undefined>> = process.env,
): AiClient | null {
  const env = readAiEnv(source);
  if (env === null) return null;
  return createAiClient({
    transport: aiTransportFor(env),
    meter: dbMeter(service),
    readGate: (groupId) => readAiGate(service, groupId),
  });
}
