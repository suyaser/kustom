/**
 * The command runner (M4.1) against the fake API and a fake League client that plays a lobby: a lobby that
 * exists after `POST /lol-lobby/v2/lobby`, an invitation row after `POST .../invitations`, a side that moves
 * after `POST .../team/TEAM1|TEAM2`. **Every write answer the fake gives is an assumption** (the shape read
 * from the 16.17 client's own UI code, not a capture); the test names say so. The reads (`lobby`,
 * `gameflow-phase`) are the 16.17 fixtures; the Create Custom dialog data (`/lol-game-queues/v1/custom`) is
 * assumed too (no fixture yet): a nameless blind entry 19 like the client's own, a named draft entry 20.
 *
 * The numbered comments are the M4.1 brief's acceptance checks, companion half (7 to 12), plus the gate,
 * the poll cadence and expiry.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LcuClient,
  LOBBY_WRITE_PATHS,
  type Lobby,
  LobbySchema,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import {
  type CannedRoute,
  type FakeLcu,
  type RecordedRequest,
  startFakeLcu,
} from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import {
  COMMANDS_API_PATH,
  CommandRunner,
  type CommandRunnerOptions,
  commandAckPath,
  commandNackPath,
  isStale,
} from './commandRunner.js';
import type { ConnectedContext } from './connection.js';
import { ExecutedStore, executedFilePath } from './executed.js';
import type { Scheduler } from './lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from './log.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PATCH = '16.17';
const TOKEN = 'tok_commands_0123456789abcdefghijklmnopqrstu';
const PASSWORD = 'fake-lockfile-password-9a8b7c';
const ME = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const FRIEND = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';
const OTHER = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const NOW = Date.parse('2026-09-09T20:00:00.000Z');
const ID_A = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';
const ID_B = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5e';
const READ_PATHS = ['/lol-lobby/v2/lobby', '/lol-gameflow/v1/gameflow-phase'];
function fixtureBody(id: string, patch: string = PATCH): unknown {
  const read = readFixture(patch, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));
const lobbyFixture = (id: string): Lobby => LobbySchema.parse(fixtureBody(id));

/** The fake client's lobby state. Mutated by the POST handlers below. */
interface LobbyWorld {
  lobby: Lobby | null;
  phase: string;
  /** Status the team path answers. Default 204. */
  switchStatus: number;
  /** Whether the team path actually moves the local player. Default true. */
  switchMoves: boolean;
}

function member(puuid: string, extra: Partial<Lobby['members'][number]> = {}): Lobby['members'][number] {
  return {
    puuid,
    summonerId: 1,
    isBot: false,
    isLeader: false,
    isSpectator: false,
    teamId: 0,
    ...extra,
  };
}

function lobbyHandler(world: LobbyWorld): (request: RecordedRequest) => CannedRoute | undefined {
  const notFound: CannedRoute = {
    status: 404,
    body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' },
  };
  return (request) => {
    if (request.method === 'GET' && request.path === '/lol-gameflow/v1/gameflow-phase') {
      return { status: 200, body: JSON.stringify(world.phase), contentType: 'application/json' };
    }
    if (request.method === 'GET' && request.path === '/lol-lobby/v2/lobby') {
      return world.lobby ? { status: 200, body: world.lobby } : notFound;
    }
    if (request.method !== 'POST') {
      return undefined;
    }
    if (request.path.startsWith('/lol-lobby/v2/lobby/team/')) {
      if (world.switchStatus !== 204) {
        return {
          status: world.switchStatus,
          body: { errorCode: 'RPC_ERROR', httpStatus: world.switchStatus, message: 'assumed refusal' },
        };
      }
      if (!world.lobby) {
        return notFound;
      }
      const target = request.path.endsWith('/TEAM1') ? 100 : request.path.endsWith('/TEAM2') ? 200 : null;
      if (target !== null && world.switchMoves) {
        const { customTeam100, customTeam200 } = world.lobby.gameConfig;
        const me =
          customTeam100.find((entry) => entry.puuid === ME) ??
          customTeam200.find((entry) => entry.puuid === ME);
        if (me) {
          const others100 = customTeam100.filter((entry) => entry !== me);
          const others200 = customTeam200.filter((entry) => entry !== me);
          world.lobby = {
            ...world.lobby,
            gameConfig: {
              ...world.lobby.gameConfig,
              customTeam100: target === 100 ? [...others100, me] : others100,
              customTeam200: target === 200 ? [...others200, me] : others200,
            },
          };
        }
      }
      // Assumed: 204 with no body.
      return { status: 204, body: null };
    }
    return undefined;
  };
}

interface Command {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  expiresAt?: string;
}

function page(commands: Command[], nextPollInMs?: number): FakeApiResponse {
  return {
    status: 200,
    body: {
      ok: true,
      commands: commands.map((command) => ({
        createdAt: new Date(NOW - 1000).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
        ...command,
      })),
      ...(nextPollInMs === undefined ? {} : { nextPollInMs }),
    },
  };
}

const empty = page([]);
const okAck: FakeApiResponse = { status: 200, body: { ok: true } };

interface Harness {
  api: FakeApi;
  lcu: FakeLcu;
  world: LobbyWorld;
  logger: MemoryLogger;
  runner: CommandRunner;
  context: ConnectedContext;
  configDir: string;
  scheduled: { ms: number; fire: () => void; cancelled: boolean }[];
  clock: { now: number; step: number };
  lcuPosts(): RecordedRequest[];
  lcuRequests(): RecordedRequest[];
  polls(): string[];
  acks(): { path: string; body: unknown }[];
  executed(): ExecutedStore;
}

const harnesses: Harness[] = [];
const allLcuRequests: RecordedRequest[] = [];

async function setup(
  options: {
    apiRoutes?: Record<string, readonly FakeApiResponse[]>;
    world?: Partial<LobbyWorld>;
    runner?: Partial<CommandRunnerOptions>;
    configDir?: string;
    connect?: boolean;
  } = {},
): Promise<Harness> {
  const world: LobbyWorld = {
    lobby: lobbyFixture('lobby'),
    phase: 'None',
    switchStatus: 204,
    switchMoves: true,
    ...options.world,
  };
  const api = await startFakeApi({
    token: TOKEN,
    routes: {
      [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [empty],
      [`GET ${COMMANDS_API_PATH}?clientConnected=false`]: [empty],
      ...options.apiRoutes,
    },
  });
  const lcu = await startFakeLcu({ password: PASSWORD, handle: lobbyHandler(world) });
  const client = new LcuClient({
    port: lcu.port,
    password: PASSWORD,
    tls: { mode: 'pinned', ca: lcu.ca },
    timeoutMs: 2_000,
  });
  const context: ConnectedContext = {
    client,
    version: '16.17.8104348+branch.releases-16-17',
    patch: PATCH,
    summoner: ownSummoner(),
    phase: world.phase,
  };
  const logger = createMemoryLogger();
  logger.addSecret(TOKEN);
  // `step` advances the clock on every read, so a test can play time passing between the poll and the execution.
  const clock = { now: NOW, step: 0 };
  const scheduled: Harness['scheduled'] = [];
  const manual: Scheduler = (fn, ms) => {
    const entry = {
      ms,
      cancelled: false,
      fire: () => {
        if (!entry.cancelled) {
          entry.cancelled = true;
          fn();
        }
      },
    };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const configDir = options.configDir ?? mkdtempSync(join(tmpdir(), 'companion-commands-'));
  const runner = new CommandRunner({
    api: new ApiClient({ apiBase: api.baseUrl, token: TOKEN, logger, maxAttempts: 1, timeoutMs: 3_000 }),
    logger,
    configDir,
    now: () => {
      const value = clock.now;
      clock.now += clock.step;
      return value;
    },
    schedule: manual,
    ackAttempts: 1,
    gate: { switch_side: true },
    ...options.runner,
  });
  const harness: Harness = {
    api,
    lcu,
    world,
    logger,
    runner,
    context,
    configDir,
    scheduled,
    clock,
    lcuPosts: () => lcu.requests.filter((request) => request.method === 'POST'),
    lcuRequests: () => lcu.requests.filter((request) => request.method !== 'WS'),
    polls: () =>
      api.requests
        .filter((request) => request.method === 'GET' && request.path.startsWith(COMMANDS_API_PATH))
        .map((request) => request.path),
    acks: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path.startsWith(COMMANDS_API_PATH))
        .map((request) => ({ path: request.path, body: JSON.parse(request.body) as unknown })),
    executed: () => new ExecutedStore({ configDir }),
  };
  harnesses.push(harness);
  if (options.connect !== false) {
    await runner.hooks().onConnected?.(context);
  }
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.runner.stop();
    allLcuRequests.push(...harness.lcu.requests);
    harness.context.client.close();
    await harness.lcu.close();
    await harness.api.close();
    rmSync(harness.configDir, { recursive: true, force: true });
  }
});

const switchSide = (targetSide: 100 | 200, id = ID_A): Command => ({
  id,
  kind: 'switch_side',
  payload: { targetSide },
});

function expectNack(h: Harness, id: string, prefix: string, retryable = false): void {
  const nacks = h.acks().filter((ack) => ack.path === commandNackPath(id));
  expect(nacks).toHaveLength(1);
  const body = nacks[0]?.body as { error: string; retryable: boolean };
  expect(body.error.startsWith(prefix), `nack "${body.error}" should start with "${prefix}"`).toBe(true);
  expect(body.retryable).toBe(retryable);
}

function expectAck(h: Harness, id: string, result: unknown): void {
  const acks = h.acks().filter((ack) => ack.path === commandAckPath(id));
  expect(acks).toHaveLength(1);
  expect(acks[0]?.body).toEqual({ result });
}

describe('CommandRunner: polling', () => {
  it('polls with clientConnected=false while the client is away (slow cadence) and =true once connected (5 s, or the server dial)', async () => {
    const h = await setup({
      connect: false,
      apiRoutes: { [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([], 7_000), empty] },
    });
    h.runner.start();
    await h.runner.settled();
    expect(h.polls()).toEqual([`${COMMANDS_API_PATH}?clientConnected=false`]);
    expect(h.scheduled.at(-1)?.ms).toBe(60_000);

    await h.runner.hooks().onConnected?.(h.context);
    await h.runner.settled();
    expect(h.polls()).toEqual([
      `${COMMANDS_API_PATH}?clientConnected=false`,
      `${COMMANDS_API_PATH}?clientConnected=true`,
    ]);
    // The server said 7 s; the companion holds no interval of its own.
    expect(h.scheduled.at(-1)?.ms).toBe(7_000);
    h.scheduled.at(-1)?.fire();
    await h.runner.settled();
    expect(h.polls()).toHaveLength(3);
    expect(h.scheduled.at(-1)?.ms).toBe(5_000);

    await h.runner.hooks().onDisconnected?.('socket_closed');
    h.scheduled.at(-1)?.fire();
    await h.runner.settled();
    expect(h.polls().at(-1)).toBe(`${COMMANDS_API_PATH}?clientConnected=false`);
    expect(h.scheduled.at(-1)?.ms).toBe(60_000);
    expect(h.lcuRequests()).toEqual([]);
  });

  it('logs a failing poll once at warn, then at debug, and says when it answers again', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          { status: 404, body: { ok: false, error: 'not deployed' } },
          { status: 404, body: { ok: false, error: 'not deployed' } },
          empty,
        ],
      },
    });
    await h.runner.pollNow();
    await h.runner.pollNow();
    await h.runner.pollNow();
    const warns = h.logger.lines.filter(
      (line) => line.level === 'warn' && line.message.includes('poll failed'),
    );
    expect(warns).toHaveLength(1);
    expect(h.logger.lines.some((line) => line.message === 'command poll is answering again')).toBe(true);
  });
});

describe('CommandRunner: execute once', () => {
  it('check 7: a lost ack is re-sent from the record on the next poll with the identical result and no client call', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([switchSide(200)]),
          page([switchSide(200)]),
          empty,
        ],
        [`POST ${commandAckPath(ID_A)}`]: [{ status: 500, body: '', drop: true }, okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expect(h.acks()).toHaveLength(1);
    // Written before the ack was even attempted.
    expect(h.executed().get(ID_A)?.outcome).toBe('done');

    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expect(h.acks()).toHaveLength(2);
    expect(h.acks()[0]?.body).toEqual(h.acks()[1]?.body);
    expect(h.logger.lines.some((line) => line.message.includes('re-sending its outcome'))).toBe(true);
  });

  it('check 8: across a restart the file is what stops the second execution', async () => {
    const first = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [{ status: 500, body: '', drop: true }],
      },
    });
    await first.runner.pollNow();
    expect(first.lcuPosts()).toHaveLength(1);
    expect(existsSync(executedFilePath(first.configDir))).toBe(true);
    const saved = readFileSync(executedFilePath(first.configDir), 'utf8');
    first.runner.stop();

    // A new process, same config directory, a client whose player is still on 100 (so a re-run *would* POST).
    const keep = mkdtempSync(join(tmpdir(), 'companion-commands-restart-'));
    const second = await setup({
      configDir: keep,
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(executedFilePath(keep), saved);
    await second.runner.pollNow();
    expect(second.lcuRequests()).toEqual([]);
    expectAck(second, ID_A, { side: 200 });
  });

  it('treats a 409 on the ack as already recorded and a 404 as nothing more to do', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([switchSide(200, ID_A), { id: ID_B, kind: 'start_queue', payload: {} }]),
          empty,
        ],
        [`POST ${commandAckPath(ID_A)}`]: [{ status: 409, body: { ok: false, error: 'already acked' } }],
        [`POST ${commandNackPath(ID_B)}`]: [{ status: 404, body: { ok: false, error: 'unknown command' } }],
      },
    });
    await h.runner.pollNow();
    expect(h.acks().map((ack) => ack.path)).toEqual([commandAckPath(ID_A), commandNackPath(ID_B)]);
    expect(
      h.logger.lines.some(
        (line) => line.level === 'debug' && line.message.includes('already had this outcome'),
      ),
    ).toBe(true);
    expect(
      h.logger.lines.some(
        (line) => line.level === 'warn' && line.message.includes('does not know this command'),
      ),
    ).toBe(true);
    expect(h.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
  });

  it('a retryable nack (not_connected) is not recorded, so a later delivery runs for real', async () => {
    const h = await setup({
      connect: false,
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=false`]: [page([switchSide(200)]), empty],
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expectNack(h, ID_A, 'not_connected', true);
    expect(h.executed().has(ID_A)).toBe(false);
    await h.runner.hooks().onConnected?.(h.context);
    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expectAck(h, ID_A, { side: 200 });
  });
});

describe('CommandRunner: the gate (check 10)', () => {
  it('with a kind flagged off: nack endpoint_unverified, no client call at all, one log line naming the row', async () => {
    const h = await setup({
      // Switch side is verified for real (16.18) since M4.1's live run; override the gate off here to
      // exercise the flagged-off path.
      runner: { gate: { switch_side: false } },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    expect(h.runner.isEnabled('switch_side')).toBe(false);
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(
      h,
      ID_A,
      'endpoint_unverified: Switch side (POST /lol-lobby/v2/lobby/team/{team}) is not verified',
    );
    const lines = h.logger.lines.filter((line) => line.message.includes('not verified on this patch'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.verify).toBe('Switch side (POST /lol-lobby/v2/lobby/team/{team})');
    // Recorded, so a re-delivery re-nacks from the file without re-evaluating anything.
    expect(h.executed().get(ID_A)?.outcome).toBe('failed');
  });
});

describe('CommandRunner: expiry and malformed rows', () => {
  it('nacks expired when the command was held longer than its TTL after the poll (the PC slept), with no client call', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([
            {
              ...switchSide(200, ID_A),
              createdAt: new Date(NOW - 1000).toISOString(),
              expiresAt: new Date(NOW + 60_000).toISOString(),
            },
          ]),
          empty,
        ],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    // The poll reads the clock once (receipt); the next read, at execution, is 61 s later than a 61 s TTL.
    h.clock.step = 61_001;
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(h, ID_A, 'expired: held for longer than its TTL');
  });

  it('a PC clock ten minutes ahead of the server never fails a fresh command (expiresAt is not compared locally)', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    // The page's expiresAt is NOW + 60 s; this PC thinks it is NOW + 10 min.
    h.clock.now = NOW + 10 * 60_000;
    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expectAck(h, ID_A, { side: 200 });
  });

  it('isStale compares local elapsed time with the server-side TTL and never trusts a bad or missing TTL', () => {
    const command = {
      createdAt: '2026-09-09T20:00:00.000Z',
      expiresAt: '2026-09-09T20:01:00.000Z',
    };
    expect(isStale(command, NOW, NOW + 59_000)).toBe(false);
    expect(isStale(command, NOW, NOW + 60_000)).toBe(false);
    expect(isStale(command, NOW, NOW + 60_001)).toBe(true);
    // Skew-free: the receipt instant can be anything.
    expect(isStale(command, NOW + 3_600_000, NOW + 3_600_000 + 30_000)).toBe(false);
    expect(isStale({ ...command, expiresAt: command.createdAt }, NOW, NOW + 999_999)).toBe(false);
    expect(isStale({ ...command, createdAt: 'not a date' }, NOW, NOW + 999_999)).toBe(false);
  });

  it('nacks malformed_payload for an unknown kind and for a payload that fails its schema, and goes on to the next row', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([
            { id: ID_A, kind: 'start_queue', payload: {} },
            { id: ID_B, kind: 'switch_side', payload: { targetSide: 300 } },
          ]),
          empty,
        ],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
        [`POST ${commandNackPath(ID_B)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(h, ID_A, 'malformed_payload: unknown kind "start_queue"');
    expectNack(h, ID_B, 'malformed_payload: targetSide');
  });

  it('M22.11: create_lobby and invite are unknown kinds now: a logged malformed_payload nack, no client call', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([
            { id: ID_A, kind: 'create_lobby', payload: { lobbyName: 'n', lobbyPassword: '4821' } },
            { id: ID_B, kind: 'invite', payload: { puuid: OTHER, summonerId: null } },
          ]),
          empty,
        ],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
        [`POST ${commandNackPath(ID_B)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(h, ID_A, 'malformed_payload: unknown kind "create_lobby"');
    expectNack(h, ID_B, 'malformed_payload: unknown kind "invite"');
  });

  it('nacks wrong_phase in champion select with no client call (check 9)', async () => {
    const h = await setup({
      world: { phase: 'ChampSelect', lobby: lobbyFixture('lobby') },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.hooks().onGameflowPhase?.('ChampSelect', h.context);
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(h, ID_A, 'wrong_phase: ChampSelect');
  });
});

describe('CommandRunner: switch_side', () => {
  it('reads the side, POSTs the team path for the target with no body, re-reads and acks the new side (assumed: 204 and it moves)', async () => {
    const h = await setup({
      world: { lobby: lobbyFixture('lobby'), phase: 'Lobby' },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts().map((request) => [request.path, request.body])).toEqual([
      ['/lol-lobby/v2/lobby/team/TEAM2', ''],
    ]);
    expectAck(h, ID_A, { side: 200 });
    expect(h.world.lobby?.gameConfig.customTeam200.map((entry) => entry.puuid)).toEqual([ME]);
  });

  it('nacks client_rejected when the team path refuses, and when it answers but nobody moved', async () => {
    const refused = await setup({
      world: { lobby: lobbyFixture('lobby'), switchStatus: 404 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await refused.runner.pollNow();
    expect(refused.lcuPosts().map((request) => request.path)).toEqual(['/lol-lobby/v2/lobby/team/TEAM2']);
    expectNack(refused, ID_A, 'client_rejected: /lol-lobby/v2/lobby/team/TEAM2 answered 404 assumed refusal');
    expect(refused.world.lobby?.gameConfig.customTeam100.map((entry) => entry.puuid)).toEqual([ME]);

    const stuck = await setup({
      world: { lobby: lobbyFixture('lobby'), switchMoves: false },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await stuck.runner.pollNow();
    expectNack(
      stuck,
      ID_A,
      'client_rejected: /lol-lobby/v2/lobby/team/TEAM2 answered 204 but the local player is still on 100',
    );
  });

  it('check 9: already on the target side -> done with zero POSTs; target side holding five -> side_full with zero POSTs; a spectator -> not_on_a_team', async () => {
    const base = lobbyFixture('lobby');
    const full: Lobby = {
      ...base,
      gameConfig: {
        ...base.gameConfig,
        customTeam200: ['b1', 'b2', 'b3', 'b4']
          .map((name) =>
            member('', {
              isBot: true,
              summonerId: 0,
              botChampionId: 1,
              botDifficulty: 'EASY',
              summonerName: name,
            }),
          )
          .concat([member(FRIEND)]),
      },
    };
    const spectating: Lobby = {
      ...base,
      localMember: { ...base.localMember, isSpectator: true },
      members: [{ ...base.localMember, isSpectator: true }],
      gameConfig: {
        ...base.gameConfig,
        customTeam100: [],
        customSpectators: [{ ...base.localMember, isSpectator: true }],
      },
    };
    const already = await setup({
      world: { lobby: base },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(100)]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await already.runner.pollNow();
    expect(already.lcuPosts()).toEqual([]);
    expectAck(already, ID_A, { side: 100 });

    const blocked = await setup({
      world: { lobby: full },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await blocked.runner.pollNow();
    expect(blocked.lcuPosts()).toEqual([]);
    expectNack(blocked, ID_A, 'side_full: side 200 holds 5');

    const spectator = await setup({
      world: { lobby: spectating },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await spectator.runner.pollNow();
    expect(spectator.lcuPosts()).toEqual([]);
    expectNack(spectator, ID_A, 'not_on_a_team: spectator');
  });

  it('nacks no_lobby and not_custom_lobby', async () => {
    const base = lobbyFixture('lobby');
    for (const [lobby, prefix] of [
      [null, 'no_lobby'],
      [{ ...base, gameConfig: { ...base.gameConfig, isCustom: false } }, 'not_custom_lobby'],
    ] as const) {
      const h = await setup({
        world: { lobby },
        apiRoutes: {
          [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([switchSide(200)]), empty],
          [`POST ${commandNackPath(ID_A)}`]: [okAck],
        },
      });
      await h.runner.pollNow();
      expect(h.lcuPosts()).toEqual([]);
      expectNack(h, ID_A, prefix);
    }
  });
});

describe('the Riot line (check 11)', () => {
  it('across this whole file the client saw no POST outside the allow-list and no GET outside the two reads', () => {
    for (const request of allLcuRequests) {
      if (request.method === 'POST') {
        expect(LOBBY_WRITE_PATHS, `POST ${request.path}`).toContain(request.path);
      } else if (request.method === 'GET') {
        expect(READ_PATHS, `GET ${request.path}`).toContain(request.path);
      } else {
        throw new Error(`unexpected ${request.method} ${request.path}`);
      }
    }
    expect(allLcuRequests.length).toBeGreaterThan(0);
  });

  it('no companion source POSTs to the League client itself, names a gameplay path, or knows port 2999', () => {
    const src = fileURLToPath(new URL('./', import.meta.url));
    const files = readdirSync(src)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => [name, readFileSync(join(src, name), 'utf8')] as const);
    expect(files.length).toBeGreaterThan(10);
    for (const [name, text] of files) {
      // The League client is `context.client` / `client`; the API client is `this.api`. Only GETs on the former.
      expect(text, `${name} writes to the League client directly`).not.toMatch(
        /\bclient\.(post|put|delete|patch|raw|request)\(/,
      );
      expect(text, `${name} names a gameplay path`).not.toMatch(
        /['"`]\/lol-champ-select|['"`]\/lol-lobby-team-builder|['"`]\/lol-matchmaking|\/lobby\/matchmaking|['"`]\/lol-gameflow\/v1\/session\/|['"`]\/lol-login|['"`]\/riotclient/,
      );
      expect(text, `${name} knows the in-game server`).not.toMatch(/2999|liveclientdata/);
    }
  });
});
