/**
 * The companion's client for `apps/web`'s `/api/companion/*` routes.
 *
 * Every call carries the bearer token, sends and receives JSON, and reads the one response envelope the API
 * uses (`apps/web/lib/http.ts`): `{ ok: true, ... }` on success, `{ ok: false, error, issues? }` on failure.
 * Success bodies are parsed with the caller's zod schema.
 *
 * Retries with backoff on network errors and 5xx, up to `maxAttempts`; never on 4xx (a 4xx is our bug or a
 * revoked token, and re-sending the same thing will not fix it). Nothing here throws to the caller: every
 * outcome is a typed result. Idempotency is the server's job (`partyId`, `gameId`), so a re-send is always safe.
 */

import type { z } from 'zod';
import { z as zod } from 'zod';
import { Backoff, type BackoffOptions, sleep } from './backoff.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';
import { USER_AGENT } from './version.js';

/** One zod issue as the API reports it (`apps/web/lib/http.ts` `apiIssueSchema`). */
export const apiIssueSchema = zod.object({ path: zod.string(), message: zod.string() });
export type ApiIssue = z.infer<typeof apiIssueSchema>;

/** The failure half of the envelope. */
export const apiErrorEnvelopeSchema = zod.object({
  ok: zod.literal(false),
  error: zod.string(),
  issues: zod.array(apiIssueSchema).optional(),
});

export type ApiFailure =
  /** The API refused (4xx, or a 5xx after the last attempt). `error` is the envelope's message or `HTTP <n>`. */
  | {
      readonly ok: false;
      readonly reason: 'http';
      readonly status: number;
      readonly error: string;
      readonly issues: readonly ApiIssue[];
      readonly attempts: number;
    }
  /** No HTTP response on the last attempt: refused, DNS, timeout. */
  | { readonly ok: false; readonly reason: 'network'; readonly message: string; readonly attempts: number }
  /** 2xx, but the body was not JSON. */
  | { readonly ok: false; readonly reason: 'malformed'; readonly status: number; readonly preview: string }
  /** 2xx JSON that did not match the caller's schema. */
  | {
      readonly ok: false;
      readonly reason: 'schema';
      readonly status: number;
      readonly issues: readonly string[];
    };

export type ApiResult<T> = { readonly ok: true; readonly status: number; readonly data: T } | ApiFailure;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  /** Skip the final failure log line; the caller reports the outcome itself (the identity check does). */
  readonly quiet?: boolean;
}

export interface ApiClientOptions {
  readonly apiBase: string;
  /** Omitted for the one route that takes no token (`POST /api/companion/pair`) and for health checks. */
  readonly token?: string;
  /**
   * Called once, with the status, when the API finally answers 401 or 403 to this client's token. 403 is a
   * membership that is gone (M13.8); the host session turns it into a sentence and stops posting.
   */
  readonly onRefused?: (status: 401 | 403) => void;
  readonly logger?: CompanionLogger;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Attempts per call, including the first. Default 4. */
  readonly maxAttempts?: number;
  /** Per-request timeout. Default 15 s. */
  readonly timeoutMs?: number;
  /** Delay between attempts. Default 1 s to 30 s. */
  readonly backoff?: BackoffOptions;
  readonly signal?: AbortSignal;
}

export const API_HEALTH_PATH = '/api/health';

export const healthResponseSchema = zod.object({
  ok: zod.literal(true),
  service: zod.literal('customs-night'),
});

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export class ApiClient {
  readonly apiBase: string;
  private readonly authorization: string | undefined;
  private readonly onRefused: ((status: 401 | 403) => void) | undefined;
  private refusedReported = false;
  private readonly logger: CompanionLogger;
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffOptions: BackoffOptions;
  private readonly signal: AbortSignal | undefined;

  constructor(options: ApiClientOptions) {
    this.apiBase = options.apiBase.replace(/\/+$/, '');
    this.authorization = options.token === undefined ? undefined : `Bearer ${options.token}`;
    this.onRefused = options.onRefused;
    this.logger = options.logger ?? createMemoryLogger();
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.backoffOptions = { minMs: 1_000, maxMs: 30_000, ...options.backoff };
    this.signal = options.signal;
  }

  get<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>> {
    return this.request('GET', path, undefined, schema);
  }

  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<ApiResult<T>> {
    return this.request('POST', path, body, schema);
  }

  /** `GET /api/health`: reachability only, says nothing about the token. Null when fine, else a reason. */
  async health(): Promise<string | null> {
    const result = await this.request('GET', API_HEALTH_PATH, undefined, healthResponseSchema, 1);
    if (result.ok) {
      return null;
    }
    return describeFailure(result);
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    maxAttempts: number = this.maxAttempts,
    options: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const endpoint = `${method} ${path}`;
    const url = `${this.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
    const backoff = new Backoff(this.backoffOptions);
    let last: ApiFailure | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.signal?.aborted) {
        return last ?? { ok: false, reason: 'network', message: 'aborted', attempts: attempt - 1 };
      }
      const outcome = await this.once(method, url, body, schema, attempt);
      if (outcome.ok) {
        this.logger.debug('api ok', { endpoint, status: outcome.status, attempt });
        return outcome;
      }
      last = outcome;
      const retryable = outcome.reason === 'network' || (outcome.reason === 'http' && outcome.status >= 500);
      if (!retryable || attempt === maxAttempts) {
        break;
      }
      const delayMs = backoff.next();
      this.logger.warn('api call failed, retrying', {
        endpoint,
        attempt,
        maxAttempts,
        delayMs,
        ...failureFields(outcome),
      });
      await sleep(delayMs, this.signal);
    }

    const failure = last ?? { ok: false, reason: 'network', message: 'no attempt made', attempts: 0 };
    if (
      failure.reason === 'http' &&
      (failure.status === 401 || failure.status === 403) &&
      this.onRefused !== undefined &&
      !this.refusedReported
    ) {
      this.refusedReported = true;
      try {
        this.onRefused(failure.status);
      } catch (error) {
        this.logger.error('onRefused threw', errorFields(error));
      }
    }
    if (options.quiet) {
      return failure;
    }
    const fields = { endpoint, ...failureFields(failure) };
    if (failure.reason === 'http' && failure.status === 401) {
      this.logger.error('api rejected the companion token; mint a new one on the admin page', fields);
    } else {
      this.logger.warn('api call failed', fields);
    }
    return failure;
  }

  private async once<T>(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    schema: z.ZodType<T>,
    attempt: number,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      ...(this.authorization === undefined ? {} : { authorization: this.authorization }),
      accept: 'application/json',
      'user-agent': USER_AGENT,
    };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      const fields = errorFields(error);
      // Node's `fetch failed` carries the real reason (ECONNREFUSED, ENOTFOUND, a timeout) in `cause`.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
      const causeCode = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
      const detail = causeCode ?? (cause?.message && cause.message.length > 0 ? cause.message : undefined);
      return {
        ok: false,
        reason: 'network',
        message: detail ? `${String(fields.error)}: ${detail}` : String(fields.error),
        attempts: attempt,
      };
    }

    const status = response.status;
    const text = await readText(response);
    let json: unknown;
    let isJson = true;
    try {
      json = text.trim().length === 0 ? null : JSON.parse(text);
    } catch {
      isJson = false;
    }

    if (status < 200 || status >= 300) {
      const envelope = isJson ? apiErrorEnvelopeSchema.safeParse(json) : undefined;
      return {
        ok: false,
        reason: 'http',
        status,
        error: envelope?.success ? envelope.data.error : `HTTP ${status}`,
        issues: envelope?.success ? (envelope.data.issues ?? []) : [],
        attempts: attempt,
      };
    }
    if (!isJson) {
      return { ok: false, reason: 'malformed', status, preview: text.slice(0, 120) };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, reason: 'schema', status, issues: issuesOf(parsed.error) };
    }
    return { ok: true, status, data: parsed.data };
  }
}

/** Log fields for a failure. Never includes a body. */
export function failureFields(failure: ApiFailure): Record<string, unknown> {
  switch (failure.reason) {
    case 'http':
      return {
        reason: failure.reason,
        status: failure.status,
        error: failure.error,
        ...(failure.issues.length > 0
          ? { issues: failure.issues.map((issue) => `${issue.path}: ${issue.message}`) }
          : {}),
      };
    case 'network':
      return { reason: failure.reason, message: failure.message };
    case 'malformed':
      return { reason: failure.reason, status: failure.status, preview: failure.preview };
    case 'schema':
      return { reason: failure.reason, status: failure.status, issues: failure.issues };
  }
}

export function describeFailure(failure: ApiFailure): string {
  switch (failure.reason) {
    case 'http':
      return `HTTP ${failure.status} ${failure.error}`;
    case 'network':
      return failure.message;
    case 'malformed':
      return `HTTP ${failure.status} with a non-JSON body`;
    case 'schema':
      return `unexpected response shape: ${failure.issues.join('; ')}`;
  }
}

/** A health check for the first-run prompt: any `apiBase`, no token needed. */
export function healthCheck(fetchImpl?: FetchLike): (apiBase: string) => Promise<string | null> {
  return async (apiBase) => {
    const options: ApiClientOptions = { apiBase, maxAttempts: 1, timeoutMs: 8_000 };
    const client = new ApiClient(fetchImpl ? { ...options, fetch: fetchImpl } : options);
    return client.health();
  };
}
