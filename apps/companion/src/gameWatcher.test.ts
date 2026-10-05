/**
 * Game capture against the fake League client (`@customs/lcu/test-support/fake-lcu`) for its two reads and
 * the fake API (`test-support/fake-api.ts`) for its posts, with the queue in a temp directory. Fixture-driven;
 * no live client, no live API. The numbered comments are the acceptance checks of the M2.3 brief in
 * `docs/02-milestones.md`; checks 5, 8 and 9 (the test-night ones) are simulated here with two watchers, a
 * torn-down watcher and a replaced API, which is what a kill and a restart look like in-process.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionGamePayloadSchema } from '@customs/db/schemas';
import {
  type EogStatsBlock,
  EogStatsBlockSchema,
  FIXTURES_DIR,
  LcuClient,
  type Lobby,
  LobbySchema,
  mapEog,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import type { ConnectedContext } from './connection.js';
import {
  EOG_BLOCK_PATH,
  GAME_API_PATH,
  GAMEFLOW_SESSION_PATH,
  GameWatcher,
  type GameWatcherOptions,
  gameModeOfSession,
} from './gameWatcher.js';
import type { Scheduler } from './lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from './log.js';
import { GameQueue, queueDir, queueEntrySchema } from './queue.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PATCH = '16.17';
const TOKEN = 'tok_game_watcher_0123456789';
const PASSWORD = 'fake-lockfile-password-7a6b5c';
const PARTY = 'e3c69392-a134-43cb-97ae-8add18c72494';
const GAME_ONE = 4000965483;
const GAME_TWO = 4000969091;
const LOBBY_URI = '/lol-lobby/v2/lobby';
const PHASE_URI = '/lol-gameflow/v1/gameflow-phase';
const SESSION_URI = '/lol-gameflow/v1/session';
const EOG_URI = '/lol-end-of-game/v1/eog-stats-block';
const SESSION_ROUTE = `GET ${GAMEFLOW_SESSION_PATH}`;
const EOG_ROUTE = `GET ${EOG_BLOCK_PATH}`;
const GAME_ROUTE = `POST ${GAME_API_PATH}`;

function fixtureBody(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const eogFixture = (): EogStatsBlock => EogStatsBlockSchema.parse(fixtureBody('eog-stats-block'));
const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));

interface RecordedLine {
  ts: string;
  uri?: string;
  eventType?: 'Create' | 'Update' | 'Delete';
  data?: unknown;
  dropped?: boolean;
  redacted?: boolean;
}

function recorded(uris: readonly string[]): RecordedLine[] {
  const text = readFileSync(join(FIXTURES_DIR, PATCH, 'ws-events.ndjson'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine)
    .filter((line) => line.dropped !== true && line.redacted !== true && line.uri !== undefined)
    .filter((line) => uris.includes(line.uri as string));
}

const okGame = (overrides: Record<string, unknown> = {}): FakeApiResponse => ({
  status: 200,
  body: {
    ok: true,
    phase: 'eog',
    created: true,
    gameId: '9f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d',
    lobbyId: null,
    participants: 6,
    ...overrides,
  },
});

const okInProgress: FakeApiResponse = {
  status: 200,
  body: { ok: true, phase: 'in_progress', created: false, gameId: null, lobbyId: null, participants: 0 },
};

const fail500: FakeApiResponse = { status: 500, body: { ok: false, error: 'boom' } };

const notFound: CannedRoute = {
  status: 404,
  body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'gone' },
};

interface GamePost {
  phase: 'in_progress' | 'eog';
  gameId: number;
  partyId: string | null;
  startedAt: string | null;
  gameMode?: string | null;
  winningSide?: number | null;
  raw?: Record<string, unknown>;
  participants?: unknown[];
}

interface Harness {
  api: FakeApi;
  lcu: FakeLcu;
  routes: Record<string, CannedRoute>;
  client: LcuClient;
  context: ConnectedContext;
  logger: MemoryLogger;
  watcher: GameWatcher;
  configDir: string;
  scheduled: { ms: number; fire: () => void; cancelled: boolean }[];
  clock: { now: number };
  posts(): GamePost[];
  lcuGets(path: string): number;
  files(): string[];
}

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

async function setup(
  options: {
    gameResponses?: readonly FakeApiResponse[];
    lcuRoutes?: Record<string, CannedRoute>;
    phase?: string | null;
    configDir?: string;
    manualTimers?: boolean;
    watcher?: Partial<GameWatcherOptions>;
    api?: FakeApi;
    connect?: boolean;
  } = {},
): Promise<Harness> {
  const api =
    options.api ??
    (await startFakeApi({ token: TOKEN, routes: { [GAME_ROUTE]: options.gameResponses ?? [okGame()] } }));
  const routes: Record<string, CannedRoute> = {
    [SESSION_ROUTE]: notFound,
    [EOG_ROUTE]: notFound,
    ...options.lcuRoutes,
  };
  const lcu = await startFakeLcu({ password: PASSWORD, routes });
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
    phase: options.phase === undefined ? 'Lobby' : options.phase,
  };
  const logger = createMemoryLogger();
  logger.addSecret(TOKEN);
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
  const clock = { now: Date.parse('2026-09-08T16:30:00.000Z') };
  const configDir = options.configDir ?? mkdtempSync(join(tmpdir(), 'companion-game-'));
  if (!options.configDir) {
    tempDirs.push(configDir);
  }
  const watcher = new GameWatcher({
    api: new ApiClient({ apiBase: api.baseUrl, token: TOKEN, logger, maxAttempts: 1, timeoutMs: 3_000 }),
    logger,
    configDir,
    now: () => clock.now,
    backoff: { minMs: 10, maxMs: 30 },
    inProgressAttempts: 1,
    ...(options.manualTimers ? { schedule: manual } : {}),
    ...options.watcher,
  });
  const harness: Harness = {
    api,
    lcu,
    routes,
    client,
    context,
    logger,
    watcher,
    configDir,
    scheduled,
    clock,
    posts: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path === GAME_API_PATH)
        .map((request) => JSON.parse(request.body) as GamePost),
    lcuGets: (path) =>
      lcu.requests.filter((request) => request.method === 'GET' && request.path === path).length,
    files: () => (existsSync(queueDir(configDir)) ? readdirSync(queueDir(configDir)).sort() : []),
  };
  harnesses.push(harness);
  if (options.connect !== false) {
    await watcher.hooks().onConnected?.(context);
  }
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.watcher.stop();
    harness.client.close();
    await harness.lcu.close();
    await harness.api.close().catch(() => undefined);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (check()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function phase(h: Harness, name: string): Promise<void> {
  await h.watcher.hooks().onGameflowPhase?.(name, h.context);
  await h.watcher.settled();
}

async function eog(
  h: Harness,
  block: EogStatsBlock | null,
  eventType: 'Create' | 'Update' | 'Delete' = 'Create',
): Promise<void> {
  await h.watcher.hooks().onEogBlock?.({ eventType, block }, h.context);
  await h.watcher.settled();
}

function lobby(h: Harness, body: Lobby | null): void {
  void h.watcher
    .hooks()
    .onLobbyEvent?.({ eventType: body === null ? 'Delete' : 'Update', lobby: body }, h.context);
}

/**
 * Replays the recording through the hooks: the clock follows each frame's timestamp, every `session` frame
 * becomes the fake client's answer to the next session GET (so the GET is "stubbed from the recording"), and
 * each phase hook is awaited to completion so the GET it triggers sees the session of its own moment.
 */
async function replay(h: Harness, lines: readonly RecordedLine[]): Promise<void> {
  for (const line of lines) {
    h.clock.now = Date.parse(line.ts);
    switch (line.uri) {
      case SESSION_URI:
        h.routes[SESSION_ROUTE] = { status: 200, body: line.data };
        break;
      case PHASE_URI:
        await phase(h, line.data as string);
        break;
      case EOG_URI:
        await eog(
          h,
          line.data === null ? null : EogStatsBlockSchema.parse(line.data),
          line.eventType ?? 'Update',
        );
        break;
      case LOBBY_URI:
        lobby(h, line.data === null ? null : LobbySchema.parse(line.data));
        break;
      default:
        break;
    }
  }
  await h.watcher.settled();
}

const ALL_URIS = [SESSION_URI, PHASE_URI, EOG_URI, LOBBY_URI];

describe('GameWatcher: post 1, in_progress', () => {
  it('replays the recorded phases: exactly two in_progress posts, ids 4000965483 and 4000969091, startedAt at each GameStart frame (check 1)', async () => {
    const h = await setup({ gameResponses: [okInProgress] });
    await replay(h, recorded([SESSION_URI, PHASE_URI, LOBBY_URI]));

    const posts = h.posts();
    expect(posts.map((post) => post.phase)).toEqual(['in_progress', 'in_progress']);
    expect(posts.map((post) => post.gameId)).toEqual([GAME_ONE, GAME_TWO]);
    const gameStarts = recorded([PHASE_URI])
      .filter((line) => line.data === 'GameStart')
      .map((line) => Date.parse(line.ts));
    expect(gameStarts).toEqual([
      Date.parse('2026-09-08T16:34:20.911Z'),
      Date.parse('2026-09-08T16:37:38.903Z'),
    ]);
    for (const [index, post] of posts.entries()) {
      expect(Math.abs(Date.parse(post.startedAt ?? '') - (gameStarts[index] as number))).toBeLessThan(100);
    }
    // The party id was captured at GameStart, before the lobby Delete that follows it.
    expect(posts[0]?.partyId).toBe('c85a9f77-e83a-4b37-b8a1-502ee3d540b2');
    expect(posts[1]?.partyId).toBe(PARTY);
    // M21.12: the recorded customs are CLASSIC.
    expect(posts.map((post) => post.gameMode)).toEqual(['CLASSIC', 'CLASSIC']);
    // Exactly one session read per game: the InProgress that follows GameStart by 17-60 ms does not read again.
    expect(h.lcuGets(GAMEFLOW_SESSION_PATH)).toBe(2);
    expect(h.files()).toEqual([]);
  });

  it('never posts the stale id from a session in phase Lobby: no GameStart, no read, no post (check 3)', async () => {
    const h = await setup({
      lcuRoutes: { [SESSION_ROUTE]: { status: 200, body: fixtureBody('gameflow-session--in-lobby') } },
    });
    await phase(h, 'Lobby');
    await phase(h, 'ChampSelect');
    await phase(h, 'None');
    expect(h.lcuGets(GAMEFLOW_SESSION_PATH)).toBe(0);
    expect(h.posts()).toEqual([]);

    // Belt and braces: even a GameStart event answered with a Lobby-phase session posts nothing.
    await phase(h, 'GameStart');
    expect(h.lcuGets(GAMEFLOW_SESSION_PATH)).toBe(1);
    expect(h.posts()).toEqual([]);
    expect(h.logger.lines.some((line) => line.message.includes('stale'))).toBe(true);
  });

  it('posts nothing, with one log line, when the session GET fails or carries gameId 0, and does not read again on InProgress', async () => {
    const h = await setup({ lcuRoutes: { [SESSION_ROUTE]: notFound } });
    await phase(h, 'GameStart');
    await phase(h, 'InProgress');
    expect(h.lcuGets(GAMEFLOW_SESSION_PATH)).toBe(1);
    expect(h.posts()).toEqual([]);
    expect(
      h.logger.lines.filter((line) => line.message.includes('could not read the gameflow session')),
    ).toHaveLength(1);

    const session = fixtureBody('gameflow-session') as { gameData: Record<string, unknown> };
    h.routes[SESSION_ROUTE] = {
      status: 200,
      body: { ...session, phase: 'GameStart', gameData: { ...session.gameData, gameId: 0 } },
    };
    await phase(h, 'WaitingForStats');
    await phase(h, 'GameStart');
    expect(h.posts()).toEqual([]);
    expect(h.logger.lines.some((line) => line.message.includes('no game id'))).toBe(true);
  });

  it('posts in_progress on InProgress when GameStart was missed, once per game, and not for a non-custom game', async () => {
    const session = fixtureBody('gameflow-session') as { gameData: Record<string, unknown> };
    const h = await setup({
      gameResponses: [okInProgress],
      lcuRoutes: { [SESSION_ROUTE]: { status: 200, body: { ...session, phase: 'InProgress' } } },
    });
    await phase(h, 'InProgress');
    await phase(h, 'InProgress');
    expect(h.posts().map((post) => post.gameId)).toEqual([GAME_TWO]);
    expect(h.posts()[0]?.partyId).toBeNull();

    h.routes[SESSION_ROUTE] = {
      status: 200,
      body: {
        ...session,
        phase: 'GameStart',
        gameData: { ...session.gameData, gameId: 4000970000, isCustomGame: false },
      },
    };
    await phase(h, 'None');
    await phase(h, 'GameStart');
    expect(h.posts()).toHaveLength(1);
    expect(h.logger.lines.some((line) => line.message.includes('not a custom'))).toBe(true);
  });

  it('gives up on a failed in_progress post with one log line and no file', async () => {
    const session = fixtureBody('gameflow-session') as Record<string, unknown>;
    const h = await setup({
      gameResponses: [fail500],
      lcuRoutes: { [SESSION_ROUTE]: { status: 200, body: { ...session, phase: 'GameStart' } } },
    });
    await phase(h, 'GameStart');
    expect(h.posts()).toHaveLength(1);
    expect(h.files()).toEqual([]);
    expect(h.logger.lines.filter((line) => line.message.includes('in_progress post failed'))).toHaveLength(1);
    expect(h.watcher.heldStart(GAME_TWO)?.startedAt).toBe('2026-09-08T16:30:00.000Z');
  });
});

describe('GameWatcher: post 2, eog from the socket', () => {
  it('replays the five eog frames: one post, 4000969091, winningSide 200; 4000965483 is dropped by name; Delete does nothing (check 2)', async () => {
    const h = await setup({ gameResponses: [okInProgress, okInProgress, okGame()] });
    await replay(h, recorded(ALL_URIS));

    const posts = h.posts();
    expect(posts.filter((post) => post.phase === 'in_progress')).toHaveLength(2);
    const eogs = posts.filter((post) => post.phase === 'eog');
    expect(eogs).toHaveLength(1);
    expect(eogs[0]).toMatchObject({ gameId: GAME_TWO, partyId: PARTY, winningSide: 200 });
    // check 4, first half: the held InProgress moment, not the arithmetic.
    expect(eogs[0]?.startedAt).toBe('2026-09-08T16:37:38.903Z');
    expect(companionGamePayloadSchema.safeParse(eogs[0]).success).toBe(true);

    const dropped = h.logger.lines.filter((line) => line.message.includes('no winning team'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.fields.gameId).toBe(String(GAME_ONE));
    expect(h.files()).toEqual([]);
    expect(h.lcuGets(EOG_BLOCK_PATH)).toBe(0);
  });

  it('derives startedAt as endOfGameTimestamp - gameLength * 1000 when only the eog frame was seen (check 4)', async () => {
    const h = await setup();
    await eog(h, eogFixture());
    const posts = h.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      phase: 'eog',
      gameId: GAME_TWO,
      partyId: null,
      startedAt: '2026-09-08T16:37:47.672Z',
    });
    expect(h.files()).toEqual([]);
  });

  it('dedupes Create and Update of the same block: one file, one post', async () => {
    const h = await setup({ gameResponses: [fail500] });
    await eog(h, eogFixture(), 'Create');
    await eog(h, eogFixture(), 'Update');
    await eog(h, eogFixture(), 'Create');
    expect(h.files()).toEqual([`${GAME_TWO}.json`]);
    expect(h.posts()).toHaveLength(1);
  });

  it('writes the file before the post, and the file is the exact request body (the ordering the queue exists for)', async () => {
    const h = await setup({ gameResponses: [fail500] });
    await eog(h, eogFixture());
    const files = h.files();
    expect(files).toEqual([`${GAME_TWO}.json`]);
    const onDisk = JSON.parse(readFileSync(join(queueDir(h.configDir), files[0] as string), 'utf8')) as {
      queuedAt: string;
      payload: unknown;
    };
    expect(queueEntrySchema.safeParse(onDisk).success).toBe(true);
    expect(onDisk.queuedAt).toBe('2026-09-08T16:30:00.000Z');
    expect(onDisk.payload).toEqual(h.posts()[0]);
  });

  it('a MATCHED_GAME block produces no file and no post (check 11)', async () => {
    const h = await setup();
    await eog(h, { ...eogFixture(), gameType: 'MATCHED_GAME' });
    expect(h.posts()).toEqual([]);
    expect(h.files()).toEqual([]);
    const line = h.logger.lines.find((entry) => entry.message.includes('not a custom game'));
    expect(line?.fields).toMatchObject({ gameId: String(GAME_TWO), gameType: 'MATCHED_GAME' });
  });

  it('the queued file reads "[redacted]" at mucJwtDto and multiUserChatPassword, and no log line carries a secret (check 7)', async () => {
    const h = await setup({ gameResponses: [fail500] });
    const leaky = {
      ...eogFixture(),
      mucJwtDto: { jwt: 'SECRET_JWT_VALUE_0123456789' },
      multiUserChatPassword: 'SECRET_CHAT_PASSWORD_abcdef',
    } as EogStatsBlock;
    await eog(h, leaky);
    const text = readFileSync(join(queueDir(h.configDir), `${GAME_TWO}.json`), 'utf8');
    expect(text).not.toContain('SECRET_JWT_VALUE');
    expect(text).not.toContain('SECRET_CHAT_PASSWORD');
    const parsed = JSON.parse(text) as { payload: { raw: Record<string, unknown> } };
    expect(parsed.payload.raw.mucJwtDto).toBe('[redacted]');
    expect(parsed.payload.raw.multiUserChatPassword).toBe('[redacted]');

    const log = JSON.stringify(h.logger.lines);
    expect(log).not.toContain('SECRET_JWT_VALUE');
    expect(log).not.toContain('SECRET_CHAT_PASSWORD');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain('"teams"');
  });
});

describe('GameWatcher: the connect-time GET', () => {
  it('reads the block once at connect in EndOfGame and posts it: one GET, one POST (check 10)', async () => {
    const h = await setup({
      phase: 'EndOfGame',
      lcuRoutes: { [EOG_ROUTE]: { status: 200, body: fixtureBody('eog-stats-block') } },
    });
    await until(() => h.posts().length === 1);
    await h.watcher.settled();
    expect(h.lcuGets(EOG_BLOCK_PATH)).toBe(1);
    expect(h.posts()[0]).toMatchObject({
      phase: 'eog',
      gameId: GAME_TWO,
      startedAt: '2026-09-08T16:37:47.672Z',
    });
    // The socket event for the same block arriving afterwards is a no-op.
    await eog(h, eogFixture(), 'Update');
    expect(h.posts()).toHaveLength(1);
    expect(h.files()).toEqual([]);
  });

  it('on a 404 at connect: zero posts, one log line naming backfill, and no second GET across 60 s (check 10)', async () => {
    const h = await setup({
      phase: 'WaitingForStats',
      manualTimers: true,
      lcuRoutes: { [EOG_ROUTE]: notFound },
    });
    await until(() => h.lcuGets(EOG_BLOCK_PATH) === 1);
    await pause(20);
    const lines = h.logger.lines.filter((line) => line.message.includes('backfill'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.phase).toBe('WaitingForStats');
    h.clock.now += 60_000;
    for (const timer of h.scheduled.splice(0)) {
      timer.fire();
    }
    await pause(20);
    expect(h.scheduled).toEqual([]);
    expect(h.lcuGets(EOG_BLOCK_PATH)).toBe(1);
    expect(h.posts()).toEqual([]);
  });

  it('does not read the block at connect in any other phase', async () => {
    for (const name of ['Lobby', 'InProgress', 'None', 'PreEndOfGame', null]) {
      const h = await setup({
        phase: name,
        lcuRoutes: { [EOG_ROUTE]: { status: 200, body: fixtureBody('eog-stats-block') } },
      });
      await pause(20);
      expect(h.lcuGets(EOG_BLOCK_PATH)).toBe(0);
      expect(h.posts()).toEqual([]);
    }
  });

  it('reconnecting after the score screen is gone posts nothing and says why once', async () => {
    const h = await setup({ phase: 'EndOfGame', lcuRoutes: { [EOG_ROUTE]: notFound } });
    await until(() => h.lcuGets(EOG_BLOCK_PATH) === 1);
    await h.watcher.hooks().onDisconnected?.('socket_closed');
    await h.watcher.hooks().onConnected?.({ ...h.context, phase: 'Lobby' });
    await pause(20);
    expect(h.lcuGets(EOG_BLOCK_PATH)).toBe(1);
    expect(h.posts()).toEqual([]);
  });
});

describe('GameWatcher: the queue', () => {
  it('a stubbed 422 deletes the file and logs the reason; so does a 403 (check 6)', async () => {
    for (const [status, error] of [
      [422, 'no winning team; remake or terminated'],
      [403, 'a companion may only report a game its own player was in'],
    ] as const) {
      const h = await setup({ gameResponses: [{ status, body: { ok: false, error } }] });
      await eog(h, eogFixture());
      await until(() => h.files().length === 0);
      expect(h.posts()).toHaveLength(1);
      const line = h.logger.lines.find((entry) => entry.message.includes('refused the game for good'));
      expect(line?.fields).toMatchObject({ gameId: String(GAME_TWO), status, error });
      expect(line?.message).toContain('backfill');
    }
  });

  it('five consecutive 500s leave the file in place and the fifth log line still names it (check 6)', async () => {
    const h = await setup({ gameResponses: [fail500], manualTimers: true });
    await eog(h, eogFixture());
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await until(() => h.posts().length === attempt);
      await until(() => h.scheduled.some((timer) => !timer.cancelled));
      (h.scheduled.find((timer) => !timer.cancelled) as { fire: () => void }).fire();
    }
    await until(() => h.posts().length === 5);
    await pause(20);
    expect(h.files()).toEqual([`${GAME_TWO}.json`]);
    const failures = h.logger.lines.filter(
      (line) => line.message === 'game post failed; the queued copy is kept and retried',
    );
    expect(failures).toHaveLength(5);
    expect(failures[4]?.fields.gameId).toBe(String(GAME_TWO));
  });

  it('keeps the file on a network error, a 429 and a 401 (the token may be replaced) and retries', async () => {
    for (const response of [
      { status: 0, body: null, drop: true },
      { status: 429, body: { ok: false, error: 'slow down' } },
      { status: 401, body: { ok: false, error: 'unknown companion token' } },
    ] as const) {
      const h = await setup({ gameResponses: [response], manualTimers: true });
      await eog(h, eogFixture());
      await until(() => h.posts().length === 1);
      await until(() => h.scheduled.some((timer) => !timer.cancelled));
      expect(h.files()).toEqual([`${GAME_TWO}.json`]);
    }
  });

  it('the crash sequence: 500, file on disk, companion killed, API back, restart posts exactly once and the file is gone (check 5)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'companion-crash-'));
    tempDirs.push(configDir);

    // Night one: the API answers 500. The block is captured over the socket and lands on disk.
    const first = await setup({ configDir, gameResponses: [fail500] });
    await eog(first, eogFixture());
    await until(() => first.posts().length >= 1);
    expect(first.files()).toEqual([`${GAME_TWO}.json`]);
    const text = readFileSync(join(queueDir(configDir), `${GAME_TWO}.json`), 'utf8');
    expect(queueEntrySchema.safeParse(JSON.parse(text)).success).toBe(true);

    // The player clicks past the score screen (the client's GET now 404s) and the companion is killed.
    first.watcher.stop();
    await first.api.close();

    // The API is back; the companion starts. The queue replays before League is even looked for.
    const second = await setup({
      configDir,
      gameResponses: [okGame({ participants: 10 })],
      connect: false,
      phase: 'Lobby',
    });
    second.watcher.start();
    await until(() => second.posts().length === 1);
    await until(() => second.files().length === 0);
    await pause(20);
    expect(second.posts()).toHaveLength(1);
    expect(second.posts()[0]).toMatchObject({ phase: 'eog', gameId: GAME_TWO });
    expect(second.lcuGets(EOG_BLOCK_PATH)).toBe(0);
    expect(second.logger.lines.find((line) => line.message === 'game posted')?.fields).toMatchObject({
      gameId: String(GAME_TWO),
      created: true,
      participants: 10,
    });

    // Run the recovery twice: nothing left to post, and the directory ends empty both times.
    const third = await setup({ configDir, connect: false });
    third.watcher.start();
    await pause(50);
    expect(third.posts()).toEqual([]);
    expect(third.files()).toEqual([]);
  });

  it('the crash sequence with the kill before the first POST: the file alone is enough (check 5)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'companion-crash-'));
    tempDirs.push(configDir);
    // What capture leaves behind when the process dies between the rename and the POST.
    const queue = new GameQueue({ configDir });
    const written = queue.write(mapped(GAME_TWO), '2026-09-08T16:53:04.508Z');
    expect(written).not.toBeNull();

    const h = await setup({ configDir, gameResponses: [okGame({ created: false })], connect: false });
    h.watcher.start();
    await until(() => h.posts().length === 1 && h.files().length === 0);
    await pause(20);
    expect(h.posts()).toHaveLength(1);
    expect(h.posts()[0]).toMatchObject({ phase: 'eog', gameId: GAME_TWO });
  });

  it('a companion killed mid-game still lands the game through the other companion (check 8, simulated)', async () => {
    const api = await startFakeApi({
      token: TOKEN,
      routes: { [GAME_ROUTE]: [okInProgress, okInProgress, okGame()] },
    });
    const session = fixtureBody('gameflow-session') as Record<string, unknown>;
    const routes = { [SESSION_ROUTE]: { status: 200, body: { ...session, phase: 'GameStart' } } };
    const a = await setup({ api, lcuRoutes: routes });
    const b = await setup({ api, lcuRoutes: routes });
    await phase(a, 'GameStart');
    await phase(b, 'GameStart');
    a.watcher.stop();
    await eog(b, eogFixture());
    const eogs = b.posts().filter((post) => post.phase === 'eog');
    expect(eogs).toHaveLength(1);
    expect(eogs[0]).toMatchObject({ gameId: GAME_TWO, startedAt: '2026-09-08T16:30:00.000Z' });
    expect(b.files()).toEqual([]);
  });

  it('two companions, one end of game: both post, one sees created: true, both delete their file (check 9, simulated)', async () => {
    const api = await startFakeApi({
      token: TOKEN,
      routes: { [GAME_ROUTE]: [okGame({ created: true }), okGame({ created: false })] },
    });
    const a = await setup({ api });
    const b = await setup({ api });
    await eog(a, eogFixture());
    await eog(b, eogFixture());
    await until(() => a.files().length === 0 && b.files().length === 0);
    expect(a.posts()).toHaveLength(2);
    const created = [a, b].map(
      (h) => h.logger.lines.find((line) => line.message === 'game posted')?.fields.created,
    );
    expect(created.sort()).toEqual([false, true]);
  });

  it('51 queued files: the oldest is deleted with a log line and the remaining 50 are posted, oldest first (check 12)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'companion-cap-'));
    tempDirs.push(configDir);
    const queue = new GameQueue({ configDir });
    for (let i = 0; i < 51; i += 1) {
      const minute = String(i).padStart(2, '0');
      expect(queue.write(mapped(4000970000 + i), `2026-09-08T15:${minute}:00.000Z`)).not.toBeNull();
    }
    expect(readdirSync(queueDir(configDir))).toHaveLength(50);
    const h = await setup({ configDir, connect: false });
    h.watcher.start();
    await until(() => h.posts().length === 50, 10_000);
    await until(() => h.files().length === 0);
    const ids = h.posts().map((post) => post.gameId);
    expect(ids[0]).toBe(4000970001);
    expect(ids[49]).toBe(4000970050);
    expect(new Set(ids).size).toBe(50);
    expect(ids.includes(4000970000)).toBe(false);
  });

  it('a queued game already posted in this process is not captured again, even if its file is gone', async () => {
    const h = await setup();
    await eog(h, eogFixture());
    await until(() => h.files().length === 0);
    await eog(h, eogFixture(), 'Update');
    expect(h.posts()).toHaveLength(1);
    expect(h.watcher.settledGameIds.has(String(GAME_TWO))).toBe(true);
  });
});

/** The same mapper the watcher uses; `raw` already scrubbed, no observed start. */
function mapped(gameId: number = GAME_TWO) {
  return mapEog({ ...eogFixture(), gameId }, { partyId: PARTY, startedAt: null });
}

describe('gameModeOfSession (M21.12)', () => {
  const session = (queue: unknown, map: unknown) =>
    ({ gameData: { queue: { gameMode: queue } }, map: { gameMode: map } }) as Parameters<
      typeof gameModeOfSession
    >[0];

  it('reads the queue first, then the map, upper-cased, and leaves out anything that is not a plain word', () => {
    expect(gameModeOfSession(session(' aram ', 'CLASSIC'))).toBe('ARAM');
    expect(gameModeOfSession(session(undefined, 'ARAM'))).toBe('ARAM');
    expect(gameModeOfSession(session('A B', undefined))).toBeNull();
    expect(gameModeOfSession(session('', undefined))).toBeNull();
  });
});
