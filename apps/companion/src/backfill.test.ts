/**
 * Backfill against the fake League client (list pages and details from the 16.17 fixtures) and the fake API
 * (the scan route and the game route), with the game watcher's real queue in a temp directory as the sink.
 * The numbered comments are the acceptance checks of the M5.1 brief in `docs/02-milestones.md`; the ones
 * that need a database (5, 6, 7, 9) are the server half's. Check 3 (approval) is gone: backfill has no approval
 * step since 2026-10-03, so a scan is answered or refused (403, the token's player left its group), never "not
 * approved".
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionGamePayloadSchema } from '@customs/db/schemas';
import {
  type EogStatsBlock,
  EogStatsBlockSchema,
  LcuClient,
  type MatchGame,
  type MatchHistoryList,
  MatchHistoryListSchema,
  matchHistoryPagePath,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import {
  BACKFILL_SCAN_API_PATH,
  Backfill,
  type BackfillOptions,
  backfillCachePath,
  backfillCacheSchema,
  SCAN_REFUSED_MESSAGE,
} from './backfill.js';
import type { ConnectedContext } from './connection.js';
import { GAME_API_PATH, GameWatcher } from './gameWatcher.js';
import type { Scheduler } from './lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from './log.js';
import { queueDir } from './queue.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PATCH = '16.17';
const TOKEN = 'tok_backfill_0123456789abcdef';
const PASSWORD = 'fake-lockfile-password-9b8c7d';
const OWN = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const ABORTED = 4_000_965_483;
const DETAIL_GAME = 4_000_769_615;
const EOG_GAME = 4_000_969_091;
const SCAN_ROUTE = `POST ${BACKFILL_SCAN_API_PATH}`;
const GAME_ROUTE = `POST ${GAME_API_PATH}`;

function fixtureBody(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));
const historyFixture = (): MatchHistoryList => MatchHistoryListSchema.parse(fixtureBody('match-history'));
const detailFixture = (): Record<string, unknown> => fixtureBody('match-detail') as Record<string, unknown>;
const eogFixture = (): EogStatsBlock => EogStatsBlockSchema.parse(fixtureBody('eog-stats-block'));

/** The 16 completed customs of the list fixture, newest first. */
const FIXTURE_CUSTOMS = historyFixture()
  .games.games.filter((game) => game.gameType === 'CUSTOM_GAME' && game.endOfGameResult === 'GameComplete')
  .map((game) => game.gameId);

const listRoute = (begIndex: number, endIndex = begIndex + 20): string =>
  `GET ${matchHistoryPagePath(OWN, begIndex, endIndex)}`;
const detailRoute = (gameId: number): string => `GET /lol-match-history/v1/games/${gameId}`;

function page(games: readonly MatchGame[], begIndex: number, endIndex: number): CannedRoute {
  const base = historyFixture();
  return {
    status: 200,
    body: {
      ...base,
      games: {
        ...base.games,
        gameCount: games.length,
        gameIndexBegin: begIndex,
        gameIndexEnd: endIndex,
        games,
      },
    },
  };
}

const emptyPage = (begIndex: number): CannedRoute => page([], begIndex, begIndex + 20);

/** A list entry cloned from the fixture's completed custom, with a new id and creation time. */
function customEntry(gameId: number, gameCreation = 1_788_000_000_000 + gameId): MatchGame {
  const template = historyFixture().games.games.find((game) => game.gameId === DETAIL_GAME);
  if (template === undefined) throw new Error('fixture changed');
  return { ...template, gameId, gameCreation };
}

/** The detail fixture under another id. */
function detailFor(
  gameId: number,
  patch: (body: Record<string, unknown>) => Record<string, unknown> = (b) => b,
): CannedRoute {
  return { status: 200, body: patch({ ...detailFixture(), gameId }) };
}

/** The fixture list (21 games) as page 0, then an empty page: the walk ends after two requests. */
function fixtureRoutes(): Record<string, CannedRoute> {
  return {
    [listRoute(0)]: { status: 200, body: fixtureBody('match-history') },
    [listRoute(20)]: emptyPage(20),
  };
}

const okGame = (created = true): FakeApiResponse => ({
  status: 200,
  body: {
    ok: true,
    phase: 'eog',
    created,
    gameId: '9f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d',
    lobbyId: null,
    participants: 10,
  },
});

const scanOk = (unknown: readonly number[]): FakeApiResponse => ({
  status: 200,
  body: { ok: true, approved: true, unknown },
});
/** What a server from before 2026-10-03 could still answer. The schema is `approved: true` now. */
const scanApprovedFalse: FakeApiResponse = { status: 200, body: { ok: true, approved: false, unknown: [] } };
const scanForbidden: FakeApiResponse = {
  status: 403,
  body: { ok: false, error: 'this token is not a member of its group' },
};

interface ScanPost {
  gameIds: number[];
}

interface GamePost {
  phase: string;
  gameId: number;
  source?: string;
  partyId?: string | null;
  participants: { role: string | null }[];
}

interface Harness {
  api: FakeApi;
  lcu: FakeLcu;
  routes: Record<string, CannedRoute>;
  client: LcuClient;
  context: ConnectedContext;
  logger: MemoryLogger;
  watcher: GameWatcher;
  backfill: Backfill;
  configDir: string;
  scheduled: { ms: number; fire: () => void; cancelled: boolean }[];
  clock: { now: number };
  scans(): ScanPost[];
  gamePosts(): GamePost[];
  listGets(): string[];
  detailGets(): number[];
  detailTimes(): number[];
  files(): string[];
  warnings(): string[];
  /** Fires the newest pending timer and waits for the pass it starts. */
  fireTimer(): Promise<void>;
}

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

async function setup(
  options: {
    lcuRoutes?: Record<string, CannedRoute>;
    scanResponses?: readonly FakeApiResponse[];
    gameResponses?: readonly FakeApiResponse[];
    phase?: string | null;
    configDir?: string;
    backfill?: Partial<BackfillOptions>;
    connect?: boolean;
  } = {},
): Promise<Harness> {
  const api = await startFakeApi({
    token: TOKEN,
    routes: {
      [SCAN_ROUTE]: options.scanResponses ?? [scanOk(FIXTURE_CUSTOMS)],
      [GAME_ROUTE]: options.gameResponses ?? [okGame()],
    },
  });
  const routes: Record<string, CannedRoute> = { ...fixtureRoutes(), ...options.lcuRoutes };
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
  const clock = { now: Date.parse('2026-09-09T10:00:00.000Z') };
  const configDir = options.configDir ?? mkdtempSync(join(tmpdir(), 'companion-backfill-'));
  if (!options.configDir) {
    tempDirs.push(configDir);
  }
  const apiClient = new ApiClient({
    apiBase: api.baseUrl,
    token: TOKEN,
    logger,
    maxAttempts: 1,
    timeoutMs: 3_000,
  });
  const watcher = new GameWatcher({
    api: apiClient,
    logger,
    configDir,
    now: () => clock.now,
    backoff: { minMs: 10, maxMs: 30 },
    schedule: manual,
  });
  const backfill = new Backfill({
    api: apiClient,
    sink: watcher,
    logger,
    configDir,
    now: () => clock.now,
    schedule: manual,
    detailIntervalMs: 25,
    scanAttempts: 1,
    ...options.backfill,
  });
  const harness: Harness = {
    api,
    lcu,
    routes,
    client,
    context,
    logger,
    watcher,
    backfill,
    configDir,
    scheduled,
    clock,
    scans: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path === BACKFILL_SCAN_API_PATH)
        .map((request) => JSON.parse(request.body) as ScanPost),
    gamePosts: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path === GAME_API_PATH)
        .map((request) => JSON.parse(request.body) as GamePost),
    listGets: () =>
      lcu.requests
        .filter((request) => request.method === 'GET' && request.path.includes('/matches?'))
        .map((request) => request.path),
    detailGets: () =>
      lcu.requests
        .filter(
          (request) => request.method === 'GET' && request.path.startsWith('/lol-match-history/v1/games/'),
        )
        .map((request) => Number(request.path.slice('/lol-match-history/v1/games/'.length))),
    detailTimes: () =>
      lcu.requests
        .filter(
          (request) => request.method === 'GET' && request.path.startsWith('/lol-match-history/v1/games/'),
        )
        .map((request) => request.receivedAt),
    files: () => (existsSync(queueDir(configDir)) ? readdirSync(queueDir(configDir)).sort() : []),
    warnings: () => logger.lines.filter((line) => line.level === 'warn').map((line) => line.message),
    async fireTimer() {
      const pending = scheduled.filter((entry) => !entry.cancelled);
      const newest = pending[pending.length - 1];
      if (newest === undefined) throw new Error('no timer to fire');
      newest.fire();
      await backfill.settled();
      await watcher.settled();
      await until(() => harness.files().length === 0 || harness.gamePosts().length > 0, 2_000).catch(
        () => undefined,
      );
    },
  };
  harnesses.push(harness);
  if (options.connect !== false) {
    await backfill.hooks().onConnected?.(context);
    await watcher.hooks().onConnected?.(context);
  }
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.backfill.stop();
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

/** Runs a pass, then waits for the queue to drain whatever it queued. */
async function pass(h: Harness): Promise<void> {
  await h.backfill.runNow();
  await h.watcher.settled();
  await until(() => h.files().length === 0, 3_000).catch(() => undefined);
}

describe('Backfill: the walk', () => {
  it('arms the first pass 60 s after the first connect, and only once', async () => {
    const h = await setup({ backfill: { firstDelayMs: 60_000 } });
    expect(h.scheduled.map((entry) => entry.ms)).toEqual([60_000]);
    await h.backfill.hooks().onConnected?.(h.context);
    expect(h.scheduled).toHaveLength(1);
    expect(h.listGets()).toHaveLength(0);
  });

  it('walks the fixture list: one candidate per completed CUSTOM_GAME, the abort dropped with one line naming it (check 1)', async () => {
    const h = await setup({ scanResponses: [scanOk([])] });
    await pass(h);

    // Two list requests: the 21-game page, then the empty page that ends the walk.
    expect(h.listGets()).toEqual([matchHistoryPagePath(OWN, 0, 20), matchHistoryPagePath(OWN, 20, 40)]);
    expect(h.scans()).toHaveLength(1);
    expect(h.scans()[0]?.gameIds).toEqual(FIXTURE_CUSTOMS);
    expect(FIXTURE_CUSTOMS).toHaveLength(16);
    expect(h.scans()[0]?.gameIds).not.toContain(ABORTED);

    const dropLines = h.logger.lines.filter(
      (line) => line.message === 'backfill: game dropped' && line.fields.gameId === ABORTED,
    );
    expect(dropLines).toHaveLength(1);
    expect(dropLines[0]?.level).toBe('info');
    expect(String(dropLines[0]?.fields.reason)).toContain('Abort_TooFewPlayers');
    // Ranked games are not candidates and are not worth an info line every pass.
    const ranked = h.logger.lines.filter(
      (line) => line.message === 'backfill: game dropped' && line.fields.gameId === 4_000_357_055,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.level).toBe('debug');

    expect(h.detailGets()).toHaveLength(0);
    expect(h.gamePosts()).toHaveLength(0);
    const summary = h.backfill.passes[0];
    expect(summary).toMatchObject({ end: 'done', pages: 2, candidates: 16, scanned: 16, walkEnded: true });
    // The deepest page reached is written down for M5.6.
    const ended = h.logger.lines.find((line) => line.message.startsWith('match history ends here'));
    expect(ended?.fields).toMatchObject({ begIndex: 20, games: 0 });
    expect(h.backfill.cache()).toMatchObject({
      deepestBegIndex: 20,
      resumeBegIndex: null,
      pendingGameIds: [],
    });
    // Everything the server already had, plus the abort, is now known locally.
    expect(h.backfill.cache().knownGameIds.length).toBe(17);
  });

  it('fetches only the ids the scan says are unknown, queues them and posts with source backfill and no partyId (check 4)', async () => {
    const unknown = [
      FIXTURE_CUSTOMS[0] as number,
      FIXTURE_CUSTOMS[5] as number,
      FIXTURE_CUSTOMS[15] as number,
    ];
    const h = await setup({
      scanResponses: [scanOk(unknown)],
      lcuRoutes: Object.fromEntries(unknown.map((id) => [detailRoute(id), detailFor(id)])),
    });
    await pass(h);

    expect(h.detailGets()).toEqual(unknown);
    const posts = h.gamePosts();
    expect(posts.map((post) => post.gameId)).toEqual(unknown);
    for (const post of posts) {
      expect(post.phase).toBe('eog');
      expect(post.source).toBe('backfill');
      expect('partyId' in post).toBe(false);
      expect(post.participants).toHaveLength(10);
      expect(post.participants.every((participant) => participant.role === null)).toBe(true);
      expect(companionGamePayloadSchema.safeParse(post).success).toBe(true);
    }
    // Delivered: the queue files are gone.
    expect(h.files()).toEqual([]);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'done', fetched: 3, queued: 3, dropped: 0 });
    expect(h.backfill.scheduledDelayMs).toBe(6 * 60 * 60 * 1000);

    // A second pass: page 0 is all known, so one list request, no scan, no detail fetch, no post.
    await pass(h);
    expect(h.listGets()).toHaveLength(3);
    expect(h.scans()).toHaveLength(1);
    expect(h.detailGets()).toHaveLength(3);
    expect(h.gamePosts()).toHaveLength(3);
    expect(h.backfill.passes[1]).toMatchObject({ end: 'done', pages: 1, candidates: 0, fetched: 0 });

    // Delete the cache and "restart" (fresh watcher and walker on the same directory): the details are
    // fetched again, the server answers created: false, nothing breaks. In one process the game watcher's
    // own dedupe would already say duplicate, which is also right.
    unlinkSync(backfillCachePath(h.configDir));
    const restarted = await setup({
      configDir: h.configDir,
      scanResponses: [scanOk(unknown)],
      gameResponses: [okGame(false)],
      lcuRoutes: Object.fromEntries(unknown.map((id) => [detailRoute(id), detailFor(id)])),
    });
    await pass(restarted);
    expect(restarted.detailGets()).toEqual(unknown);
    expect(restarted.gamePosts().map((post) => post.gameId)).toEqual(unknown);
    expect(restarted.files()).toEqual([]);
    expect(restarted.backfill.passes[0]).toMatchObject({ end: 'done', fetched: 3, queued: 3 });
  });

  it('logs each timeline.lane/role pair the table does not know once per process, not once per game (M5.18)', async () => {
    const unknown = [FIXTURE_CUSTOMS[0] as number, FIXTURE_CUSTOMS[5] as number];
    const h = await setup({
      scanResponses: [scanOk(unknown)],
      lcuRoutes: Object.fromEntries(unknown.map((id) => [detailRoute(id), detailFor(id)])),
    });
    await pass(h);

    expect(h.gamePosts()).toHaveLength(2);
    const lines = h.logger.lines.filter(
      (line) => line.message === 'backfill: timeline pair has no verified role; stored as null',
    );
    // The fixture detail carries six distinct pairs across its ten participants; two games, still six lines.
    const pairs = lines.map((line) => `${line.fields.lane}+${line.fields.role}`).sort();
    expect(pairs).toEqual([
      'BOTTOM+CARRY',
      'BOTTOM+SOLO',
      'BOTTOM+SUPPORT',
      'JUNGLE+NONE',
      'MIDDLE+SOLO',
      'TOP+SOLO',
    ]);
    expect(lines.every((line) => line.level === 'info' && line.fields.gameId === unknown[0])).toBe(true);
  });

  it('writes a cache file that parses, with tmp-and-rename (no .tmp left behind)', async () => {
    const h = await setup({ scanResponses: [scanOk([])] });
    await pass(h);
    const path = backfillCachePath(h.configDir);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    const parsed = backfillCacheSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(parsed.version).toBe(2);
    expect(parsed.lastRunAt).toBe('2026-09-09T10:00:00.000Z');
    expect(parsed.knownGameIds).toEqual(expect.arrayContaining(FIXTURE_CUSTOMS));
  });

  it('pages in steps of 20, at most 5 pages a pass, and resumes the deep walk next pass until the end (M5.6 evidence)', async () => {
    // 140 customs: pages 0..120 are full, 140 is short. Every id unknown to the server, none fetched (cap 0)
    // so this is the walk alone.
    const ids = Array.from({ length: 140 }, (_, index) => 5_000_000_000 - index);
    const routes: Record<string, CannedRoute> = {};
    for (let begIndex = 0; begIndex <= 140; begIndex += 20) {
      const slice = ids.slice(begIndex, begIndex + 21).map((id) => customEntry(id));
      routes[listRoute(begIndex)] = page(slice, begIndex, begIndex + 20);
    }
    const h = await setup({
      lcuRoutes: routes,
      scanResponses: [scanOk([])],
      backfill: { maxDetailsPerPass: 0 },
    });

    await pass(h);
    expect(h.listGets()).toEqual(
      [0, 20, 40, 60, 80].map((begIndex) => matchHistoryPagePath(OWN, begIndex, begIndex + 20)),
    );
    // Five inclusive windows of 21 overlap by one: positions 0..100 are 101 games, deduped on id.
    expect(h.backfill.passes[0]).toMatchObject({ end: 'more', pages: 5, walkEnded: false, candidates: 101 });
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: 100, deepestBegIndex: 80 });
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
    // The scan takes 100 ids per call.
    expect(h.scans().map((scan) => scan.gameIds.length)).toEqual([100, 1]);

    await pass(h);
    expect(h.listGets().slice(5)).toEqual(
      [100, 120, 140].map((begIndex) => matchHistoryPagePath(OWN, begIndex, begIndex + 20)),
    );
    expect(h.backfill.passes[1]).toMatchObject({
      end: 'done',
      pages: 3,
      walkEnded: true,
      deepestBegIndex: 140,
    });
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: null, deepestBegIndex: 140 });
    expect(h.backfill.cache().knownGameIds).toHaveLength(140);

    // Steady state: one page, all known, stop.
    await pass(h);
    expect(h.listGets()).toHaveLength(9);
    expect(h.backfill.passes[2]).toMatchObject({ end: 'done', pages: 1 });
  });

  it('never asks past the depth cap', async () => {
    const ids = Array.from({ length: 260 }, (_, index) => 5_100_000_000 - index);
    const routes: Record<string, CannedRoute> = {};
    for (let begIndex = 0; begIndex <= 260; begIndex += 20) {
      routes[listRoute(begIndex)] = page(
        ids.slice(begIndex, begIndex + 21).map((id) => customEntry(id)),
        begIndex,
        begIndex + 20,
      );
    }
    const h = await setup({
      lcuRoutes: routes,
      scanResponses: [scanOk([])],
      backfill: { maxDetailsPerPass: 0 },
    });
    await pass(h);
    await pass(h);
    expect(h.listGets()).toHaveLength(10);
    expect(h.listGets()[9]).toBe(matchHistoryPagePath(OWN, 180, 200));
    expect(h.backfill.passes[1]).toMatchObject({ end: 'done', walkEnded: true });
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: null, deepestBegIndex: 180 });
  });

  it('a 4xx on a page past 0 is the end of history: the cursor is dropped and the walk from 0 keeps finding new customs', async () => {
    const refused: CannedRoute = {
      status: 400,
      body: { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'bad window' },
    };
    const h = await setup({
      lcuRoutes: { [listRoute(20)]: refused },
      scanResponses: [scanOk([])],
    });
    await pass(h);
    expect(h.listGets()).toHaveLength(2);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'done', pages: 2, walkEnded: true });
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: null, deepestBegIndex: 0 });
    const ended = h.logger.lines.find((line) => line.message.startsWith('match history ends here'));
    expect(ended?.fields).toMatchObject({ begIndex: 20, status: 400 });
    expect(h.backfill.scheduledDelayMs).toBe(6 * 60 * 60 * 1000);

    // A new custom shows up at the top: the steady-state walk from 0 sees it (page 0 has an unknown, so the
    // walk asks page 20 once more, is refused again, and ends cleanly instead of locking on that page).
    const fresh = 5_700_000_001;
    h.routes[listRoute(0)] = page([customEntry(fresh), ...historyFixture().games.games.slice(0, 20)], 0, 20);
    h.routes[detailRoute(fresh)] = detailFor(fresh);
    await pass(h);
    expect(h.listGets()).toHaveLength(4);
    expect(h.scans()[1]?.gameIds).toEqual([fresh]);
    expect(h.backfill.passes[1]).toMatchObject({ end: 'done', walkEnded: true });
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: null });
  });

  it('gives the deep cursor up after three passes stuck on the same page, so the walk from 0 resumes', async () => {
    const broken: CannedRoute = {
      status: 500,
      body: { errorCode: 'RPC_ERROR', httpStatus: 500, message: 'x' },
    };
    const h = await setup({ lcuRoutes: { [listRoute(20)]: broken }, scanResponses: [scanOk([])] });
    await pass(h);
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: 20 });
    expect(h.backfill.passes[0]).toMatchObject({ end: 'more', pages: 2 });
    await pass(h);
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: 20 });
    await pass(h);
    // Third strike: the cursor is dropped and the pass still says "more" (the failure was real).
    expect(h.backfill.cache()).toMatchObject({ resumeBegIndex: null });
    expect(h.warnings()).toContain(
      'match history walk gave up on this page; continuing from the newest games',
    );
    // Only page 20 was asked on passes 2 and 3; from now on the walk starts at 0 again.
    expect(h.listGets()).toHaveLength(4);
    await pass(h);
    expect(h.listGets()[4]).toBe(matchHistoryPagePath(OWN, 0, 20));
    expect(h.backfill.passes[3]).toMatchObject({ end: 'done', pages: 1 });
  });

  it('stops the walk on a page error and tries again later', async () => {
    const h = await setup({
      lcuRoutes: {
        [listRoute(0)]: { status: 500, body: { errorCode: 'RPC_ERROR', httpStatus: 500, message: 'x' } },
      },
      scanResponses: [scanOk([])],
    });
    await pass(h);
    expect(h.listGets()).toHaveLength(1);
    expect(h.scans()).toHaveLength(0);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'more', pages: 1 });
    expect(h.warnings()).toContain('match history page failed; the walk stops here and tries again later');
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
  });
});

describe('Backfill: the scan answer', () => {
  it('there is no "not approved" state: approved false is a body that does not parse, so a failed scan (10 min)', async () => {
    const h = await setup({ scanResponses: [scanApprovedFalse] });
    await pass(h);
    expect(h.scans()).toHaveLength(1);
    expect(h.detailGets()).toHaveLength(0);
    expect(h.gamePosts()).toHaveLength(0);
    expect(h.files()).toEqual([]);
    expect(h.warnings()).toEqual(['backfill scan failed; trying again later']);
    expect(h.warnings().some((line) => /approv/i.test(line))).toBe(false);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'scan_failed', pending: 16 });
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
    // Nothing became "known": the next pass asks again.
    expect(h.backfill.cache().knownGameIds).toEqual([ABORTED]);
  });

  it('a 403 (the token is no longer a member of its group) is one sentence, stop, retry in 6 h', async () => {
    const h = await setup({ scanResponses: [scanForbidden] });
    await pass(h);
    expect(h.detailGets()).toHaveLength(0);
    expect(h.gamePosts()).toHaveLength(0);
    expect(h.warnings()).toEqual([SCAN_REFUSED_MESSAGE]);
    expect(h.logger.lines.filter((line) => line.level === 'error')).toHaveLength(0);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'refused', pending: 16 });
    expect(h.backfill.scheduledDelayMs).toBe(6 * 60 * 60 * 1000);
    expect(h.backfill.cache().knownGameIds).toEqual([ABORTED]);
    await pass(h);
    expect(h.scans()).toHaveLength(2);
    expect(h.warnings()).toEqual([SCAN_REFUSED_MESSAGE, SCAN_REFUSED_MESSAGE]);
  });

  it('the API being down is one line and a retry in 10 min; the ids wait in the cache', async () => {
    const h = await setup({ scanResponses: [{ status: 500, body: { ok: false, error: 'boom' } }] });
    await pass(h);
    expect(h.detailGets()).toHaveLength(0);
    expect(h.warnings()).toEqual(['backfill scan failed; trying again later']);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'scan_failed', pending: 16 });
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
    expect(h.backfill.cache().pendingGameIds).toEqual(FIXTURE_CUSTOMS);
  });
});

describe('Backfill: the rate limit and the idle rule (check 8)', () => {
  it('with 40 unknown ids one pass fetches 20 details, spaced by the interval, and finishes them next pass', async () => {
    const ids = Array.from({ length: 40 }, (_, index) => 5_200_000_000 - index);
    const routes: Record<string, CannedRoute> = {
      [listRoute(0)]: page(
        ids.slice(0, 21).map((id) => customEntry(id)),
        0,
        20,
      ),
      [listRoute(20)]: page(
        ids.slice(20, 40).map((id) => customEntry(id)),
        20,
        40,
      ),
      [listRoute(40)]: emptyPage(40),
    };
    for (const id of ids) {
      routes[detailRoute(id)] = detailFor(id);
    }
    const h = await setup({
      lcuRoutes: routes,
      scanResponses: [scanOk(ids)],
      backfill: { detailIntervalMs: 40 },
    });

    await pass(h);
    expect(h.listGets()).toHaveLength(3);
    expect(h.detailGets()).toEqual(ids.slice(0, 20));
    const times = h.detailTimes();
    for (let index = 1; index < times.length; index += 1) {
      expect((times[index] as number) - (times[index - 1] as number)).toBeGreaterThanOrEqual(38);
    }
    expect(h.gamePosts()).toHaveLength(20);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'more', fetched: 20, queued: 20, pending: 20 });
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
    expect(h.backfill.cache().pendingGameIds).toEqual(ids.slice(20));

    await pass(h);
    // The pending ids are scanned again (a friend may have posted them meanwhile) and then fetched.
    expect(h.scans()).toHaveLength(2);
    expect(h.scans()[1]?.gameIds).toEqual(ids.slice(20));
    expect(h.detailGets()).toEqual(ids);
    expect(h.gamePosts()).toHaveLength(40);
    expect(h.backfill.passes[1]).toMatchObject({ end: 'done', fetched: 20, pending: 0 });
    expect(h.backfill.cache().pendingGameIds).toEqual([]);
  });

  it('makes zero client requests while the phase is InProgress, ChampSelect or EndOfGame, and is put back 10 min', async () => {
    for (const phase of ['InProgress', 'ChampSelect', 'EndOfGame']) {
      const h = await setup({ phase, backfill: { firstDelayMs: 60_000 } });
      await h.fireTimer();
      // (The game watcher's connect-time eog GET in `EndOfGame` is its own business, so match-history only.)
      expect(h.lcu.requests.filter((request) => request.path.includes('/lol-match-history/'))).toHaveLength(
        0,
      );
      expect(h.scans()).toHaveLength(0);
      expect(h.backfill.passes[0]?.end).toBe('no_client');
      expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
      // Back in the lobby: the next timer runs the pass.
      await h.backfill.hooks().onGameflowPhase?.('Lobby', h.context);
      await h.fireTimer();
      expect(h.listGets().length).toBeGreaterThan(0);
    }
  });

  it('pauses a pass where it stands when the phase changes mid-fetch and keeps the rest for later', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => 5_300_000_000 - index);
    const routes: Record<string, CannedRoute> = {
      [listRoute(0)]: page(
        ids.map((id) => customEntry(id)),
        0,
        20,
      ),
    };
    for (const id of ids) {
      routes[detailRoute(id)] = detailFor(id);
    }
    const h = await setup({
      lcuRoutes: routes,
      scanResponses: [scanOk(ids)],
      backfill: { detailIntervalMs: 60 },
    });
    const running = h.backfill.runNow();
    await until(() => h.detailGets().length === 2);
    await h.backfill.hooks().onGameflowPhase?.('ChampSelect', h.context);
    await running;
    await h.watcher.settled();
    expect(h.detailGets().length).toBeLessThanOrEqual(3);
    expect(h.backfill.passes[0]?.end).toBe('paused');
    expect(h.backfill.cache().pendingGameIds.length).toBeGreaterThanOrEqual(3);
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);
  });

  it('stops a pass when the client disconnects and picks the rest up after the next connect', async () => {
    const ids = Array.from({ length: 4 }, (_, index) => 5_400_000_000 - index);
    const routes: Record<string, CannedRoute> = {
      [listRoute(0)]: page(
        ids.map((id) => customEntry(id)),
        0,
        20,
      ),
    };
    for (const id of ids) {
      routes[detailRoute(id)] = detailFor(id);
    }
    const h = await setup({
      lcuRoutes: routes,
      scanResponses: [scanOk(ids)],
      backfill: { detailIntervalMs: 60 },
    });
    const running = h.backfill.runNow();
    await until(() => h.detailGets().length === 1);
    await h.backfill.hooks().onDisconnected?.('client_lost');
    await running;
    expect(h.backfill.passes[0]?.end).toBe('paused');
    const pendingBefore = h.backfill.cache().pendingGameIds;
    expect(pendingBefore.length).toBeGreaterThanOrEqual(2);

    await h.backfill.hooks().onConnected?.(h.context);
    await pass(h);
    expect(h.backfill.cache().pendingGameIds).toEqual([]);
    expect(new Set(h.gamePosts().map((post) => post.gameId))).toEqual(new Set(ids));
  });
});

describe('Backfill: drops and dedupe', () => {
  it('drops a detail with no winner, with nine participants, and one that fails the schema, each with one line, and remembers them', async () => {
    const [noWinner, nine, broken] = [5_500_000_001, 5_500_000_002, 5_500_000_003];
    const h = await setup({
      lcuRoutes: {
        [listRoute(0)]: page(
          [noWinner, nine, broken].map((id) => customEntry(id)),
          0,
          20,
        ),
        [detailRoute(noWinner)]: detailFor(noWinner, (body) => ({
          ...body,
          teams: (body.teams as { win: string }[]).map((team) => ({ ...team, win: 'Fail' })),
        })),
        [detailRoute(nine)]: detailFor(nine, (body) => ({
          ...body,
          participants: (body.participants as unknown[]).slice(0, 9),
        })),
        [detailRoute(broken)]: detailFor(broken, (body) => ({ ...body, teams: 'nope' })),
      },
      scanResponses: [scanOk([noWinner, nine, broken])],
    });
    await pass(h);
    expect(h.detailGets()).toEqual([noWinner, nine, broken]);
    expect(h.gamePosts()).toHaveLength(0);
    expect(h.files()).toEqual([]);
    const drops = h.logger.lines.filter((line) => line.message === 'backfill: game dropped');
    expect(drops.map((line) => [line.fields.gameId, line.fields.reason])).toEqual([
      [noWinner, 'no winning team'],
      [nine, '9 participants, not ten'],
      [broken, 'detail does not match the schema'],
    ]);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'done', fetched: 3, dropped: 3, queued: 0 });
    // Remembered: the next pass does not fetch them again.
    await pass(h);
    expect(h.detailGets()).toHaveLength(3);
  });

  it('a game already captured from an end-of-game block is not posted again from backfill (dedupe across sources)', async () => {
    const h = await setup({
      lcuRoutes: {
        [listRoute(0)]: page([customEntry(EOG_GAME)], 0, 20),
        [detailRoute(EOG_GAME)]: detailFor(EOG_GAME),
      },
      scanResponses: [scanOk([EOG_GAME])],
    });
    // The block lands first, as it would on a real night: one file, one post.
    await h.watcher.hooks().onEogBlock?.({ eventType: 'Create', block: eogFixture() }, h.context);
    await h.watcher.settled();
    await until(() => h.gamePosts().length === 1);
    // An eog post carries no `source` key; the wire schema defaults it to 'eog'.
    expect(h.gamePosts()[0]).toMatchObject({ gameId: EOG_GAME });
    expect(h.gamePosts()[0]?.source).toBeUndefined();

    await pass(h);
    await until(() => h.gamePosts().length === 2);
    expect(h.detailGets()).toEqual([EOG_GAME]);
    expect(h.gamePosts()).toHaveLength(2);
    expect(h.gamePosts()[1]).toMatchObject({ gameId: EOG_GAME, source: 'backfill' });
    expect(h.backfill.passes[0]).toMatchObject({ end: 'done', fetched: 1, queued: 1, duplicates: 0 });
    expect(h.backfill.cache().knownGameIds).toContain(EOG_GAME);
  });

  it('a queue write the game watcher refuses leaves the id pending, not known, and it lands next pass', async () => {
    const id = 5_650_000_001;
    const h = await setup({
      lcuRoutes: { [listRoute(0)]: page([customEntry(id)], 0, 20), [detailRoute(id)]: detailFor(id) },
      scanResponses: [scanOk([id])],
    });
    // A regular file where the queue directory should be: every write fails, as on a full disk.
    writeFileSync(join(h.configDir, 'queue'), 'not a directory');
    await pass(h);
    expect(h.detailGets()).toEqual([id]);
    expect(h.gamePosts()).toHaveLength(0);
    expect(h.backfill.passes[0]).toMatchObject({
      end: 'more',
      fetched: 1,
      queued: 0,
      dropped: 0,
      pending: 1,
    });
    expect(h.backfill.cache().knownGameIds).not.toContain(id);
    expect(h.backfill.cache().pendingGameIds).toEqual([id]);
    expect(h.backfill.scheduledDelayMs).toBe(10 * 60 * 1000);

    unlinkSync(join(h.configDir, 'queue'));
    await pass(h);
    expect(h.detailGets()).toEqual([id, id]);
    expect(h.gamePosts().map((post) => post.gameId)).toEqual([id]);
    expect(h.backfill.cache().knownGameIds).toContain(id);
    expect(h.backfill.cache().pendingGameIds).toEqual([]);
  });

  it('a queued backfill file survives an API outage and posts on the next drain, like any queued game', async () => {
    const id = 5_600_000_001;
    const h = await setup({
      lcuRoutes: { [listRoute(0)]: page([customEntry(id)], 0, 20), [detailRoute(id)]: detailFor(id) },
      scanResponses: [scanOk([id])],
      gameResponses: [{ status: 500, body: { ok: false, error: 'down' } }, okGame(false)],
    });
    await h.backfill.runNow();
    await h.watcher.settled();
    expect(h.files()).toEqual([`${id}.json`]);
    expect(h.backfill.passes[0]).toMatchObject({ end: 'done', queued: 1 });
    // The game watcher's outer backoff timer is the newest scheduled entry; fire it.
    const pending = h.scheduled.filter((entry) => !entry.cancelled);
    const drainTimer = pending.find((entry) => entry.ms <= 30);
    if (drainTimer === undefined) throw new Error('no drain timer');
    drainTimer.fire();
    await until(() => h.files().length === 0);
    expect(h.gamePosts()).toHaveLength(2);
    expect(h.gamePosts()[1]).toMatchObject({ gameId: id, source: 'backfill' });
  });
});

describe('Backfill: the timers', () => {
  it('after a done pass the next one is 6 h away and runs when the timer fires', async () => {
    const h = await setup({ scanResponses: [scanOk([])], backfill: { firstDelayMs: 60_000 } });
    expect(h.backfill.scheduledDelayMs).toBe(60_000);
    await h.fireTimer();
    expect(h.backfill.passes).toHaveLength(1);
    expect(h.backfill.scheduledDelayMs).toBe(6 * 60 * 60 * 1000);
    await h.fireTimer();
    expect(h.backfill.passes).toHaveLength(2);
    expect(h.backfill.scheduledDelayMs).toBe(6 * 60 * 60 * 1000);
    expect(h.listGets()).toHaveLength(3);
  });

  it('stop() cancels the timer and no pass runs afterwards', async () => {
    const h = await setup({ scanResponses: [scanOk([])], backfill: { firstDelayMs: 60_000 } });
    h.backfill.stop();
    expect(h.scheduled.every((entry) => entry.cancelled)).toBe(true);
    await h.backfill.runNow();
    expect(h.listGets()).toHaveLength(0);
  });

  it('a connect with no local player logs once and does nothing', async () => {
    const h = await setup({ connect: false });
    await h.backfill.hooks().onConnected?.({ ...h.context, summoner: null });
    await pass(h);
    await pass(h);
    expect(h.listGets()).toHaveLength(0);
    expect(h.warnings()).toEqual([
      'backfill skipped: the local player is unknown (current-summoner did not answer)',
    ]);
  });
});
