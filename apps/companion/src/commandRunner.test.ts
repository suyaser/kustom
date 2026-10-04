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
const PENDING_FRIEND = 'ae4f66e8-0000-4000-8000-000000000000';
const OTHER = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const OTHER_SUMMONER_ID = '52699007';
const NOW = Date.parse('2026-09-09T20:00:00.000Z');
const ID_A = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';
const ID_B = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5e';
const LOBBY_PASSWORD = '4821';
const READ_PATHS = [
  '/lol-lobby/v2/lobby',
  '/lol-gameflow/v1/gameflow-phase',
  '/lol-game-queues/v1/custom',
  '/lol-game-queues/v1/queues',
];
/** Assumed: the dialog data for 16.17 (shape per the client's OpenAPI document). */
const ASSUMED_CUSTOM_QUEUES = {
  queueAvailability: 'Available',
  subcategories: [
    {
      mapId: 11,
      gameMode: 'CLASSIC',
      numPlayersPerTeam: 5,
      mutators: [
        { id: 19, name: '', pickMode: '', banMode: '' },
        {
          id: 20,
          name: 'GAME_CFG_DRAFT_STD',
          pickMode: 'DraftModeSinglePickStrategy',
          banMode: 'StandardBanStrategy',
        },
      ],
    },
  ],
};
/**
 * Assumed: `/lol-game-queues/v1/queues` naming the same two ids `ASSUMED_CUSTOM_QUEUES` offers, in the shape
 * the real 16.18 capture has (`GameQueueSchema`). Content does not matter to these hand-crafted tests (the
 * dialog mutators above already carry words), but the production `create_lobby` executor fetches this GET
 * unconditionally now (Bug 2 fix), so the fake client must answer it.
 */
const ASSUMED_GAME_QUEUES = [
  {
    id: 19,
    name: 'SR Blind Pick Custom',
    gameMode: 'CLASSIC',
    mapId: 11,
    isCustom: true,
    category: 'Custom',
  },
  {
    id: 20,
    name: 'SR Draft Pick Custom',
    gameMode: 'CLASSIC',
    mapId: 11,
    isCustom: true,
    category: 'Custom',
  },
];

function fixtureBody(id: string, patch: string = PATCH): unknown {
  const read = readFixture(patch, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));
const lobbyFixture = (id: string): Lobby => LobbySchema.parse(fixtureBody(id));

function pendingPuuid(lobby: Lobby): string {
  const row = lobby.invitations?.find((invitation) => invitation.state === 'Pending');
  if (!row) {
    throw new Error('fixture has no Pending invitation');
  }
  return row.toPuuid;
}

/** The fake client's lobby state. Mutated by the POST handlers below. */
interface LobbyWorld {
  lobby: Lobby | null;
  phase: string;
  /** Status the team path answers. Default 204. */
  switchStatus: number;
  /** Answer for `[{ toSummonerId }]` invites. Default 200. */
  inviteBySummonerIdStatus: number;
  /** Whether the team path actually moves the local player. Default true. */
  switchMoves: boolean;
  /** What `/lol-game-queues/v1/custom` answers. Default the assumed dialog data. */
  customQueues: unknown;
  /** What `/lol-game-queues/v1/queues` answers. Default the assumed queue list, naming the same ids. */
  gameQueues: unknown;
  /** Status for `/lol-game-queues/v1/queues`. Default 200. */
  gameQueuesStatus: number;
  createStatus: number;
  /** How many lobby GETs after a successful create are dropped (the client dying right after the POST). */
  dropLobbyReadsAfterCreate: number;
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
    if (request.method === 'GET' && request.path === '/lol-game-queues/v1/custom') {
      return { status: 200, body: world.customQueues };
    }
    if (request.method === 'GET' && request.path === '/lol-game-queues/v1/queues') {
      if (world.gameQueuesStatus !== 200) {
        return {
          status: world.gameQueuesStatus,
          body: { errorCode: 'RPC_ERROR', httpStatus: world.gameQueuesStatus, message: 'assumed refusal' },
        };
      }
      return { status: 200, body: world.gameQueues };
    }
    if (request.method === 'GET' && request.path === '/lol-lobby/v2/lobby') {
      if (world.lobby?.partyId === 'party-created-0001' && world.dropLobbyReadsAfterCreate > 0) {
        world.dropLobbyReadsAfterCreate -= 1;
        return { status: 0, body: null, drop: true };
      }
      return world.lobby ? { status: 200, body: world.lobby } : notFound;
    }
    if (request.method !== 'POST') {
      return undefined;
    }
    if (request.path === '/lol-lobby/v2/lobby') {
      if (world.createStatus !== 200) {
        return {
          status: world.createStatus,
          body: { errorCode: 'RPC_ERROR', httpStatus: world.createStatus, message: 'assumed refusal' },
        };
      }
      const body = JSON.parse(request.body) as { customGameLobby: { lobbyName: string } };
      const base = lobbyFixture('lobby');
      // Assumed: the client answers the new lobby, with the name from the body and the creator on blue.
      world.lobby = {
        ...base,
        partyId: 'party-created-0001',
        gameConfig: { ...base.gameConfig, customLobbyName: body.customGameLobby.lobbyName },
        invitations: [],
      };
      return { status: 200, body: world.lobby };
    }
    if (request.path === '/lol-lobby/v2/lobby/invitations') {
      if (!world.lobby) {
        return notFound;
      }
      const rows = JSON.parse(request.body) as { toSummonerId?: number; toPuuid?: string }[];
      const row = rows[0] ?? {};
      if (row.toSummonerId !== undefined && world.inviteBySummonerIdStatus !== 200) {
        return {
          status: world.inviteBySummonerIdStatus,
          body: {
            errorCode: 'RPC_ERROR',
            httpStatus: world.inviteBySummonerIdStatus,
            message: 'assumed refusal',
          },
        };
      }
      const toPuuid = row.toPuuid ?? (row.toSummonerId === Number(OTHER_SUMMONER_ID) ? OTHER : 'unknown');
      world.lobby = {
        ...world.lobby,
        invitations: [
          ...(world.lobby.invitations ?? []),
          {
            invitationId: '',
            invitationType: 'invalid',
            state: 'Pending',
            timestamp: String(NOW),
            toPuuid,
            toSummonerId: row.toSummonerId ?? 0,
          },
        ],
      };
      // Assumed: a 200 with an array of the invitations just sent.
      return { status: 200, body: rows };
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
    lobby: null,
    phase: 'None',
    switchStatus: 204,
    inviteBySummonerIdStatus: 200,
    switchMoves: true,
    customQueues: ASSUMED_CUSTOM_QUEUES,
    gameQueues: ASSUMED_GAME_QUEUES,
    gameQueuesStatus: 200,
    createStatus: 200,
    dropLobbyReadsAfterCreate: 0,
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
    gate: { create_lobby: true, invite: true, switch_side: true },
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

const createLobby = (id = ID_A, overrides: Partial<Command> = {}): Command => ({
  id,
  kind: 'create_lobby',
  payload: { lobbyName: 'Customs 09 Sep #1', lobbyPassword: LOBBY_PASSWORD },
  ...overrides,
});
const invite = (puuid = OTHER, summonerId: string | null = OTHER_SUMMONER_ID, id = ID_A): Command => ({
  id,
  kind: 'invite',
  payload: { puuid, summonerId },
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

describe('CommandRunner: create_lobby', () => {
  it('reads the lobby, POSTs the reference body once, re-reads, acks { partyId, lobbyName } and remembers the password (assumed: POST answers the lobby)', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuRequests().map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /lol-lobby/v2/lobby',
      'GET /lol-game-queues/v1/custom',
      'GET /lol-game-queues/v1/queues',
      'POST /lol-lobby/v2/lobby',
      'GET /lol-lobby/v2/lobby',
    ]);
    // The 16.17 client dialog's body, draft (docs/04, 2026-09-09), ids from the dialog data: never isCustom.
    expect(JSON.parse(h.lcuPosts()[0]?.body ?? '')).toEqual({
      customGameLobby: {
        configuration: {
          gameMode: 'CLASSIC',
          gameMutator: '',
          gameServerRegion: '',
          mapId: 11,
          mutators: { id: 20 },
          spectatorPolicy: 'AllAllowed',
          spectatorDelayEnabled: true,
          teamSize: 5,
          hidePublicly: false,
          aramMapMutator: 'NONE',
        },
        lobbyName: 'Customs 09 Sep #1',
        hidePublicly: false,
        lobbyPassword: LOBBY_PASSWORD,
      },
      queueId: 20,
    });
    expectAck(h, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
    expect(h.runner.passwordFor('party-created-0001')).toBe(LOBBY_PASSWORD);
    expect(h.runner.passwordFor('someone-elses-party')).toBeNull();
    expect(h.executed().get(ID_A)).toMatchObject({
      outcome: 'done',
      result: { partyId: 'party-created-0001' },
    });
    // Check 12: the password is a deliberate debug; nothing at info or above carries it, nor the token.
    for (const line of h.logger.lines) {
      const text = JSON.stringify(line);
      expect(text).not.toContain(TOKEN);
      if (line.level !== 'debug') {
        expect(text, `${line.level} "${line.message}" carries the lobby password`).not.toContain(
          LOBBY_PASSWORD,
        );
      }
    }
    expect(
      h.logger.lines.some((line) => line.level === 'debug' && JSON.stringify(line).includes(LOBBY_PASSWORD)),
    ).toBe(true);
  });

  /**
   * The regression test for Bugs 1 and 2 (reviewer-caught, 2026-09-13): drives the real production
   * `create_lobby` executor off the actual 16.18 `--verify-commands` capture of both
   * `/lol-game-queues/v1/custom` (`custom-game-queues.json`, wordless mutators, `gameServerRegions: null`)
   * and `/lol-game-queues/v1/queues` (`game-queues.json`, which names them), never invented dialog data. Before
   * the fix this nacked twice over: `CustomGameQueuesSchema.safeParse` rejected the real body outright (Bug
   * 1), and even patched, `customLobbyIdsFor` found no draft entry because the dialog itself names nothing
   * (Bug 2). After the fix it resolves queueId/mutators.id 3110 with no human input.
   */
  it('resolves queueId 3110 for draft and creates the lobby, off the real 16.18 custom-game-queues.json + game-queues.json fixtures', async () => {
    const dialogFixture = fixtureBody('custom-game-queues', '16.18');
    const queuesFixture = fixtureBody('game-queues', '16.18');
    const h = await setup({
      world: { customQueues: dialogFixture, gameQueues: queuesFixture },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuRequests().map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /lol-lobby/v2/lobby',
      'GET /lol-game-queues/v1/custom',
      'GET /lol-game-queues/v1/queues',
      'POST /lol-lobby/v2/lobby',
      'GET /lol-lobby/v2/lobby',
    ]);
    const posted = JSON.parse(h.lcuPosts()[0]?.body ?? '') as {
      customGameLobby: { configuration: { mutators: { id: number } } };
      queueId: number;
    };
    expect(posted.queueId).toBe(3110);
    expect(posted.customGameLobby.configuration.mutators.id).toBe(3110);
    expectAck(h, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
  });

  it('M17.17: pickType blind resolves queueId 3100 off the same fixtures; an explicit draft and an old payload both send 3110', async () => {
    const dialogFixture = fixtureBody('custom-game-queues', '16.18');
    const queuesFixture = fixtureBody('game-queues', '16.18');
    const sent: Record<string, number> = {};
    for (const [label, payload] of [
      ['blind', { lobbyName: 'Customs 09 Sep #1', lobbyPassword: LOBBY_PASSWORD, pickType: 'blind' }],
      ['draft', { lobbyName: 'Customs 09 Sep #1', lobbyPassword: LOBBY_PASSWORD, pickType: 'draft' }],
      ['old', { lobbyName: 'Customs 09 Sep #1', lobbyPassword: LOBBY_PASSWORD }],
    ] as const) {
      const h = await setup({
        world: { customQueues: dialogFixture, gameQueues: queuesFixture },
        apiRoutes: {
          [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby(ID_A, { payload })]), empty],
          [`POST ${commandAckPath(ID_A)}`]: [okAck],
        },
      });
      await h.runner.pollNow();
      const posted = JSON.parse(h.lcuPosts()[0]?.body ?? '') as {
        customGameLobby: { configuration: { mutators: { id: number } } };
        queueId: number;
      };
      expect(posted.customGameLobby.configuration.mutators.id).toBe(posted.queueId);
      sent[label] = posted.queueId;
    }
    expect(sent).toEqual({ blind: 3100, draft: 3110, old: 3110 });
  });

  it('nacks client_rejected with the dialog list, and posts nothing, when neither the dialog nor the queue list names a draft entry', async () => {
    const h = await setup({
      world: {
        customQueues: {
          subcategories: [{ mapId: 11, gameMode: 'CLASSIC', mutators: [{ id: 19 }, { id: 20 }] }],
        },
        // Nothing here names id 20 as draft either, so the join (Bug 2 fix) still finds nothing.
        gameQueues: [],
      },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts()).toEqual([]);
    expectNack(
      h,
      ID_A,
      "client_rejected: /lol-game-queues/v1/custom lists no draft entry for Summoner's Rift (it has: 19, 20); no lobby created",
    );
    expect(h.world.lobby).toBeNull();

    const noRift = await setup({
      world: { customQueues: { subcategories: [] } },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await noRift.runner.pollNow();
    expect(noRift.lcuPosts()).toEqual([]);
    expectNack(
      noRift,
      ID_A,
      "client_rejected: /lol-game-queues/v1/custom lists no Summoner's Rift classic subcategory",
    );
  });

  it('nacks client_rejected, without ever POSTing, when the queue list GET fails (Bug 2: names come only from the join)', async () => {
    const h = await setup({
      world: { gameQueuesStatus: 404 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts()).toEqual([]);
    expectNack(h, ID_A, 'client_rejected: /lol-game-queues/v1/queues answered 404 assumed refusal');
  });

  it('nacks already_in_lobby with the partyId and never dissolves the lobby (check 9)', async () => {
    const h = await setup({
      world: { lobby: lobbyFixture('lobby') },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts()).toEqual([]);
    expectNack(h, ID_A, 'already_in_lobby: partyId=e3c69392-a134-43cb-97ae-8add18c72494');
    expect(h.world.lobby?.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
  });

  it('a client that dies right after a 2xx POST: one more read, then a recorded non-retryable client_rejected (never not_connected)', async () => {
    const h = await setup({
      world: { dropLobbyReadsAfterCreate: 2 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([createLobby()]),
          page([createLobby()]),
          empty,
        ],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuRequests().map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /lol-lobby/v2/lobby',
      'GET /lol-game-queues/v1/custom',
      'GET /lol-game-queues/v1/queues',
      'POST /lol-lobby/v2/lobby',
      'GET /lol-lobby/v2/lobby',
      'GET /lol-lobby/v2/lobby',
    ]);
    expectNack(h, ID_A, 'client_rejected: create answered 200 but the lobby could not be read back', false);
    expect(h.executed().get(ID_A)?.outcome).toBe('failed');
    expect(h.logger.lines.some((line) => line.message.includes('reading once more'))).toBe(true);
    // Re-offered anyway (a server that ignores the record): re-nacked from the file, no client call, and the
    // lobby that exists is not touched.
    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expect(h.acks().filter((ack) => ack.path === commandNackPath(ID_A))).toHaveLength(2);
    expect(h.world.lobby?.partyId).toBe('party-created-0001');

    // The read-back failing once and answering the second time is a success with the password remembered.
    const flaky = await setup({
      world: { dropLobbyReadsAfterCreate: 1 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await flaky.runner.pollNow();
    expectAck(flaky, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
    expect(flaky.runner.passwordFor('party-created-0001')).toBe(LOBBY_PASSWORD);
  });

  it('nacks client_rejected with the status and message, never a body, when the client refuses (assumed 400)', async () => {
    const h = await setup({
      world: { createStatus: 400 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expectNack(h, ID_A, 'client_rejected: /lol-lobby/v2/lobby answered 400 assumed refusal');
    expect(h.lcuPosts()).toHaveLength(1);
  });
});

describe('CommandRunner: execute once', () => {
  it('check 7: a lost ack is re-sent from the record on the next poll with the identical result and no client call', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([createLobby()]),
          page([createLobby()]),
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
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [{ status: 500, body: '', drop: true }],
      },
    });
    await first.runner.pollNow();
    expect(first.lcuPosts()).toHaveLength(1);
    expect(existsSync(executedFilePath(first.configDir))).toBe(true);
    const saved = readFileSync(executedFilePath(first.configDir), 'utf8');
    first.runner.stop();

    // A new process, same config directory, a client with no lobby (so a re-run *would* create one).
    const keep = mkdtempSync(join(tmpdir(), 'companion-commands-restart-'));
    const second = await setup({
      configDir: keep,
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(executedFilePath(keep), saved);
    await second.runner.pollNow();
    expect(second.lcuRequests()).toEqual([]);
    expectAck(second, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
  });

  it('treats a 409 on the ack as already recorded and a 404 as nothing more to do', async () => {
    const h = await setup({
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([createLobby(ID_A), createLobby(ID_B)]),
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
        [`GET ${COMMANDS_API_PATH}?clientConnected=false`]: [page([createLobby()]), empty],
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
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
    expectAck(h, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
  });
});

describe('CommandRunner: the gate (check 10)', () => {
  it('with a kind flagged off: nack endpoint_unverified, no client call at all, one log line naming the row', async () => {
    const h = await setup({
      // The three kinds are verified for real (16.18) since M4.1's live run; override the gate off here to
      // exercise the flagged-off path.
      runner: { gate: { create_lobby: false, invite: false, switch_side: false } },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([createLobby(ID_A), invite(OTHER, OTHER_SUMMONER_ID, ID_B)]),
          empty,
        ],
        [`POST ${commandNackPath(ID_A)}`]: [okAck],
        [`POST ${commandNackPath(ID_B)}`]: [okAck],
      },
    });
    expect(h.runner.isEnabled('create_lobby')).toBe(false);
    expect(h.runner.isEnabled('invite')).toBe(false);
    expect(h.runner.isEnabled('switch_side')).toBe(false);
    await h.runner.pollNow();
    expect(h.lcuRequests()).toEqual([]);
    expectNack(
      h,
      ID_A,
      'endpoint_unverified: Create custom lobby (POST /lol-lobby/v2/lobby) is not verified',
    );
    expectNack(h, ID_B, 'endpoint_unverified: Invite (POST /lol-lobby/v2/lobby/invitations) is not verified');
    const lines = h.logger.lines.filter((line) => line.message.includes('not verified on this patch'));
    expect(lines).toHaveLength(2);
    expect(lines[0]?.fields.verify).toBe('Create custom lobby (POST /lol-lobby/v2/lobby)');
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
            createLobby(ID_A, {
              createdAt: new Date(NOW - 1000).toISOString(),
              expiresAt: new Date(NOW + 60_000).toISOString(),
            }),
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
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([createLobby()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    // The page's expiresAt is NOW + 60 s; this PC thinks it is NOW + 10 min.
    h.clock.now = NOW + 10 * 60_000;
    await h.runner.pollNow();
    expect(h.lcuPosts()).toHaveLength(1);
    expectAck(h, ID_A, { partyId: 'party-created-0001', lobbyName: 'Customs 09 Sep #1' });
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

describe('CommandRunner: invite', () => {
  it('POSTs [{ toSummonerId }] once, reads the Pending row back and acks it (assumed: 200 with the sent rows)', async () => {
    const h = await setup({
      world: { lobby: lobbyFixture('lobby') },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([invite()]), empty],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts().map((request) => [request.path, JSON.parse(request.body)])).toEqual([
      ['/lol-lobby/v2/lobby/invitations', [{ toSummonerId: 52699007 }]],
    ]);
    expectAck(h, ID_A, { puuid: OTHER, method: 'summonerId', state: 'Pending' });
  });

  it('falls back to [{ toPuuid }] on a 4xx and reports method puuid; starts there when no summoner id is known', async () => {
    const h = await setup({
      world: { lobby: lobbyFixture('lobby'), inviteBySummonerIdStatus: 400 },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([invite()]),
          page([invite(PENDING_FRIEND, null, ID_B)]),
          empty,
        ],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
        [`POST ${commandAckPath(ID_B)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts().map((request) => JSON.parse(request.body))).toEqual([
      [{ toSummonerId: 52699007 }],
      [{ toPuuid: OTHER }],
    ]);
    expectAck(h, ID_A, { puuid: OTHER, method: 'puuid', state: 'Pending' });
  });

  it('acks done without a POST when the invitee is already a member (Accepted) or already invited (Pending)', async () => {
    const lobby = lobbyFixture('lobby--two-players');
    const h = await setup({
      world: { lobby },
      apiRoutes: {
        [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [
          page([invite(FRIEND, '1', ID_A), invite(pendingPuuid(lobby), null, ID_B)]),
          empty,
        ],
        [`POST ${commandAckPath(ID_A)}`]: [okAck],
        [`POST ${commandAckPath(ID_B)}`]: [okAck],
      },
    });
    await h.runner.pollNow();
    expect(h.lcuPosts()).toEqual([]);
    expectAck(h, ID_A, { puuid: FRIEND, method: 'summonerId', state: 'Accepted' });
    expectAck(h, ID_B, { puuid: pendingPuuid(lobby), method: 'puuid', state: 'Pending' });
  });

  it('nacks no_lobby with no lobby, not_custom_lobby in a normal one, and refuses when the local player may not invite', async () => {
    const base = lobbyFixture('lobby');
    const normal: Lobby = { ...base, gameConfig: { ...base.gameConfig, isCustom: false, queueId: 420 } };
    const notLeader: Lobby = {
      ...base,
      localMember: { ...base.localMember, isLeader: false, allowedInviteOthers: false },
    };
    for (const [world, prefix] of [
      [{ lobby: null }, 'no_lobby'],
      [{ lobby: normal }, 'not_custom_lobby: queueId=420'],
      [{ lobby: notLeader }, 'client_rejected: the local player may not invite'],
    ] as const) {
      const h = await setup({
        world,
        apiRoutes: {
          [`GET ${COMMANDS_API_PATH}?clientConnected=true`]: [page([invite()]), empty],
          [`POST ${commandNackPath(ID_A)}`]: [okAck],
        },
      });
      await h.runner.pollNow();
      expect(h.lcuPosts()).toEqual([]);
      expectNack(h, ID_A, prefix);
    }
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

  it('nacks no_lobby and not_custom_lobby like invite does', async () => {
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
  it('across this whole file the client saw no POST outside the allow-list and no GET outside the three reads', () => {
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
