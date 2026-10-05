/**
 * The harness `make-goldens.ts` runs the TypeScript engine in (M17.4): the real watchers from `src/`, wired
 * exactly as `src/host.ts` wires them, against
 *  - the fake League client from `@customs/lcu/test-support/fake-lcu` (HTTPS, pinned to its own test
 *    certificate) serving the recorded fixtures, and
 *  - an in-process stand-in for the API: an injected `fetch` that records every request byte for byte and
 *    answers with a canned, schema-valid envelope.
 *
 * Nothing here talks to a real client or a real API. Every clock the watchers take is injected (`clock`),
 * so a golden never carries the wall-clock time it was generated at; the timers the watchers arm never fire
 * on their own (`neverScheduler`), so a recheck or a backfill pass only runs when a scenario asks.
 *
 * Dev-only: imported by `make-goldens.ts` and its test, never by `src/`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EogStatsBlockSchema,
  GameflowPhaseSchema,
  LcuClient,
  LobbySchema,
  RankedStatsSchema,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { ApiClient, type FetchLike } from '../../src/api.js';
import { Backfill } from '../../src/backfill.js';
import { CommandRunner } from '../../src/commandRunner.js';
import type { CompanionHooks, ConnectedContext } from '../../src/connection.js';
import { GameWatcher } from '../../src/gameWatcher.js';
import { composeHooks } from '../../src/hooks.js';
import { LobbyWatcher, type Scheduler } from '../../src/lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from '../../src/log.js';
import { RankSync } from '../../src/rankSync.js';

/** The fake client's lockfile password and the fake API token. Neither may ever appear in a golden. */
export const HARNESS_LCU_PASSWORD = 'golden-harness-lockfile-pw-7Qx2';
export const HARNESS_API_TOKEN = 'golden-harness-token-0123456789abcdefghijklm';
export const HARNESS_API_BASE = 'https://customs.invalid';

/** Fixed ids the stand-in API answers with. */
export const API_LOBBY_ID = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';
export const API_GAME_ID = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
export const API_PLAYER_ID = '0f1e2d3c-4b5a-4697-8877-665544332211';

export function fixtureBody(patch: string, id: string): unknown {
  const read = readFixture(patch, id);
  if (!read.ok) {
    throw new Error(`fixture ${patch}/${id}: ${read.reason}`);
  }
  return read.envelope.body;
}

export const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('16.17', 'current-summoner'));

/** One request the engine made, as it went on the wire. */
export interface Captured {
  readonly target: 'api' | 'lcu';
  readonly method: string;
  /** Path and query, no origin. */
  readonly path: string;
  /** The parsed JSON body, or null when there was none. */
  readonly body: unknown;
  /** The body exactly as sent, or null. Only used to prove JSON-equality survives a parse. */
  readonly rawBody: string | null;
}

export interface ApiAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** Answers one API request; `undefined` falls through to the default answer for the route. */
export type ApiResponder = (request: Captured, index: number) => ApiAnswer | undefined;

export interface Clock {
  now: number;
}

/** A scheduler whose timers never fire: rechecks, retries and the 6-hour timers stay armed and inert. */
export const neverScheduler: Scheduler = () => () => undefined;

export type Part = 'lobby' | 'game' | 'rank' | 'backfill' | 'commands';

export interface HarnessOptions {
  readonly parts: readonly Part[];
  readonly clock: Clock;
  readonly summoner?: Summoner | null;
  readonly phase?: string | null;
  readonly patch?: string;
  readonly lcuRoutes?: Readonly<Record<string, CannedRoute>>;
  readonly lcuHandle?: (method: string, path: string, body: string) => CannedRoute | undefined;
  readonly api?: ApiResponder;
  /** `ranksNeeded` the stand-in answers every lobby post with. Default `[]`. */
  readonly ranksNeeded?: readonly string[];
  /** Ids the backfill scan answers as unknown. Default: none. */
  readonly scanUnknown?: (gameIds: readonly number[]) => readonly number[];
  /** Command envelopes per `GET /api/companion/commands` call, in order; the last repeats. Default `[[]]`. */
  readonly commandPages?: readonly (readonly Record<string, unknown>[])[];
}

export interface Harness {
  readonly context: ConnectedContext;
  readonly hooks: CompanionHooks;
  readonly lcu: FakeLcu;
  readonly configDir: string;
  readonly logger: MemoryLogger;
  readonly clock: Clock;
  readonly lobby: LobbyWatcher | null;
  readonly game: GameWatcher | null;
  readonly rank: RankSync | null;
  readonly backfill: Backfill | null;
  readonly commands: CommandRunner | null;
  /** Every API request so far, in order. */
  readonly apiRequests: readonly Captured[];
  /** Every write the engine sent to the fake client, in order (method other than GET). */
  lcuWrites(): Captured[];
  /** Runs `onConnected` the way the connection machine does, then settles. */
  connect(): Promise<void>;
  /** Waits until every part is idle and no request has been made for a few ticks. */
  settle(): Promise<void>;
  close(): Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseBody(text: string | null): unknown {
  if (text === null || text.length === 0) {
    return null;
  }
  return JSON.parse(text);
}

function defaultAnswer(request: Captured, options: HarnessOptions, commandPolls: number): ApiAnswer {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const path = request.path.split('?')[0] ?? request.path;
  if (request.method === 'POST' && path === '/api/companion/lobby') {
    const members = Array.isArray(body.members) ? body.members.length : 0;
    return {
      status: 200,
      body: {
        ok: true,
        lobbyId: API_LOBBY_ID,
        status: 'open',
        created: true,
        memberCount: members,
        rosterFrozen: false,
        recheckInMs: null,
        ranksNeeded: options.ranksNeeded ?? [],
      },
    };
  }
  if (request.method === 'POST' && path === '/api/companion/game') {
    const participants = Array.isArray(body.participants) ? body.participants.length : 0;
    return {
      status: 200,
      body: {
        ok: true,
        phase: body.phase === 'eog' ? 'eog' : 'in_progress',
        created: true,
        gameId: body.phase === 'eog' ? API_GAME_ID : null,
        lobbyId: typeof body.partyId === 'string' ? API_LOBBY_ID : null,
        participants,
      },
    };
  }
  if (request.method === 'POST' && path === '/api/companion/rank') {
    return { status: 200, body: { ok: true, playerId: API_PLAYER_ID, stored: true } };
  }
  if (request.method === 'POST' && path === '/api/companion/backfill/scan') {
    const ids = Array.isArray(body.gameIds) ? (body.gameIds as number[]) : [];
    return {
      status: 200,
      body: { ok: true, approved: true, unknown: options.scanUnknown?.(ids) ?? [] },
    };
  }
  if (request.method === 'GET' && path === '/api/companion/commands') {
    const pages = options.commandPages ?? [[]];
    const page = pages[Math.min(commandPolls, pages.length - 1)] ?? [];
    return { status: 200, body: { ok: true, commands: page } };
  }
  if (request.method === 'POST' && /^\/api\/companion\/commands\/[^/]+\/(ack|nack)$/.test(path)) {
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { ok: false, error: `golden harness: no route ${request.method} ${path}` } };
}

/** An API client whose `fetch` records the request and answers from the stand-in. */
export function capturingFetch(
  sink: Captured[],
  answer: (request: Captured, index: number) => ApiAnswer,
): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    const rawBody = typeof init.body === 'string' ? init.body : null;
    const request: Captured = {
      target: 'api',
      method: init.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: parseBody(rawBody),
      rawBody,
    };
    const index = sink.length;
    sink.push(request);
    const reply = answer(request, index);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const configDir = mkdtempSync(join(tmpdir(), 'kustom-goldens-'));
  const logger = createMemoryLogger();
  const clock = options.clock;
  const now = (): number => clock.now;
  const apiRequests: Captured[] = [];
  let commandPolls = 0;

  const lcu = await startFakeLcu({
    password: HARNESS_LCU_PASSWORD,
    routes: options.lcuRoutes ?? {},
    ...(options.lcuHandle
      ? { handle: (request) => options.lcuHandle?.(request.method, request.path, request.body) }
      : {}),
  });
  const client = new LcuClient({
    port: lcu.port,
    password: HARNESS_LCU_PASSWORD,
    tls: { mode: 'pinned', ca: lcu.ca },
    timeoutMs: 5_000,
  });
  const context: ConnectedContext = {
    client,
    version:
      options.patch === '16.18'
        ? '16.18.8175716+branch.releases-16-18'
        : '16.17.8104348+branch.releases-16-17',
    patch: options.patch ?? '16.17',
    summoner: options.summoner === undefined ? ownSummoner() : options.summoner,
    phase: options.phase === undefined ? 'Lobby' : options.phase,
  };

  const api = new ApiClient({
    apiBase: HARNESS_API_BASE,
    token: HARNESS_API_TOKEN,
    logger,
    // The production defaults (`host.ts` passes none), except no waiting between attempts.
    backoff: { minMs: 1, maxMs: 2 },
    fetch: capturingFetch(apiRequests, (request, index) => {
      const scripted = options.api?.(request, index);
      const reply = scripted ?? defaultAnswer(request, options, commandPolls);
      if (request.method === 'GET' && request.path.startsWith('/api/companion/commands')) {
        commandPolls += 1;
      }
      return reply;
    }),
  });

  const has = (part: Part): boolean => options.parts.includes(part);
  // Wired as `src/host.ts` wires them; only the parts a scenario names are built.
  // Backfill posts through the game watcher's queue, so it brings the game watcher with it.
  const game =
    has('game') || has('backfill')
      ? new GameWatcher({ api, logger, configDir, now, schedule: neverScheduler })
      : null;
  const commands = has('commands')
    ? new CommandRunner({ api, logger, configDir, now, schedule: neverScheduler })
    : null;
  let rank: RankSync | null = null;
  const lobby = has('lobby')
    ? new LobbyWatcher({
        api,
        logger,
        schedule: neverScheduler,
        lookupIntervalMs: 0,
        onResponse: (response) => rank?.needed(response.ranksNeeded),
      })
    : null;
  rank = has('rank')
    ? new RankSync({
        api,
        logger,
        now,
        schedule: neverScheduler,
        callIntervalMs: 0,
        ...(lobby ? { names: lobby.knownNames } : {}),
      })
    : null;
  const backfill =
    has('backfill') && game
      ? new Backfill({
          api,
          logger,
          configDir,
          sink: game,
          now,
          schedule: neverScheduler,
          detailIntervalMs: 0,
        })
      : null;

  // `host.ts` order: lobby, game, rank, backfill, commands (the logging hooks post nothing).
  const parts: CompanionHooks[] = [];
  for (const part of [lobby, game, rank, backfill, commands]) {
    if (part !== null) {
      parts.push(part.hooks());
    }
  }
  // `host.ts` replays the queue before the client is even connected.
  game?.start();
  const hooks = composeHooks(logger, ...parts);

  const idle = async (): Promise<void> => {
    await Promise.all([
      lobby?.settled(10_000),
      game?.settled(10_000),
      rank?.settled(10_000),
      backfill?.settled(20_000),
      commands?.settled(10_000),
    ]);
  };

  const harness: Harness = {
    context,
    hooks,
    lcu,
    configDir,
    logger,
    clock,
    lobby,
    game,
    rank,
    backfill,
    commands,
    apiRequests,
    lcuWrites: () =>
      lcu.requests
        .filter((request) => request.method !== 'GET')
        .map((request) => ({
          target: 'lcu' as const,
          method: request.method,
          path: request.path,
          body: parseBody(request.body.length > 0 ? request.body : null),
          rawBody: request.body.length > 0 ? request.body : null,
        })),
    async connect() {
      await hooks.onConnected?.(context);
      await harness.settle();
    },
    async settle() {
      let stable = 0;
      let seen = -1;
      while (stable < 4) {
        await idle();
        await pause(10);
        const count = apiRequests.length + lcu.requests.length;
        stable = count === seen ? stable + 1 : 0;
        seen = count;
      }
    },
    async close() {
      lobby?.stop();
      rank?.stop();
      backfill?.stop();
      commands?.stop();
      game?.stop();
      client.close();
      await lcu.close();
      rmSync(configDir, { recursive: true, force: true });
    },
  };
  return harness;
}

/** One line of `ws-events.ndjson`. */
export interface RecordedEvent {
  readonly ts: string;
  readonly uri?: string;
  readonly eventType?: 'Create' | 'Update' | 'Delete';
  readonly data?: unknown;
  readonly dropped?: boolean;
  readonly redacted?: boolean;
}

const RANKED_STATS_URI_PREFIX = '/lol-ranked/v1/cached-ranked-stats/';

/**
 * Routes one recorded event to the hooks exactly as `ConnectionMachine.dispatch` (`src/connection.ts`) does:
 * the four URIs the watchers read, `Delete`/null as a withdrawal, a payload that fails its schema dropped.
 * Returns whether a hook ran.
 */
export async function dispatchRecorded(
  hooks: CompanionHooks,
  context: ConnectedContext,
  event: RecordedEvent,
): Promise<boolean> {
  if (event.dropped || event.redacted || event.uri === undefined || event.eventType === undefined) {
    return false;
  }
  const { uri, eventType } = event;
  const data = event.data ?? null;
  if (uri.startsWith(RANKED_STATS_URI_PREFIX)) {
    const puuid = uri.slice(RANKED_STATS_URI_PREFIX.length);
    if (eventType === 'Delete' || data === null || puuid.length === 0) return false;
    const parsed = RankedStatsSchema.safeParse(data);
    if (!parsed.success) return false;
    await hooks.onRankedStats?.({ puuid, stats: parsed.data }, context);
    return true;
  }
  switch (uri) {
    case '/lol-lobby/v2/lobby': {
      if (eventType === 'Delete' || data === null) {
        await hooks.onLobbyEvent?.({ eventType, lobby: null }, context);
        return true;
      }
      const parsed = LobbySchema.safeParse(data);
      if (!parsed.success) return false;
      await hooks.onLobbyEvent?.({ eventType, lobby: parsed.data }, context);
      return true;
    }
    case '/lol-gameflow/v1/gameflow-phase': {
      const parsed = GameflowPhaseSchema.safeParse(data);
      if (!parsed.success) return false;
      await hooks.onGameflowPhase?.(parsed.data, context);
      return true;
    }
    case '/lol-end-of-game/v1/eog-stats-block': {
      if (eventType === 'Delete' || data === null) {
        await hooks.onEogBlock?.({ eventType, block: null }, context);
        return true;
      }
      const parsed = EogStatsBlockSchema.safeParse(data);
      if (!parsed.success) return false;
      await hooks.onEogBlock?.({ eventType, block: parsed.data }, context);
      return true;
    }
    default:
      return false;
  }
}
