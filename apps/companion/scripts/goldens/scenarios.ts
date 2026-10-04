/**
 * The scenarios `make-goldens.ts` runs (M17.4): every recorded fixture in `packages/lcu/fixtures/16.17` and
 * `16.18` that is an input to a watcher, fed through the TypeScript engine the way the live client would feed
 * it, and every request the engine then made, kept as a golden.
 *
 * A golden is the TypeScript engine's answer, not a hand-written expectation: the Rust port (M17.7 to
 * M17.11) feeds the same fixtures through its own code and must produce JSON-equal bodies. Where a scenario
 * needs a client state no fixture captured (the lobby after a side switch), it derives it in memory from a
 * fixture and says so in `note`; nothing under `fixtures/` is edited.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPANION_COMMAND_TTL_MS, type CompanionCommandKind } from '@customs/db/schemas';
import {
  EogStatsBlockSchema,
  FIXTURES_DIR,
  type Lobby,
  LobbySchema,
  matchHistoryPagePath,
  RankedStatsSchema,
  SummonerSchema,
} from '@customs/lcu';
import type { CannedRoute } from '@customs/lcu/test-support/fake-lcu';
import { pairWithCode } from '../../src/pairing.js';
import { ASKED_TTL_MS } from '../../src/rankSync.js';
import {
  type Captured,
  capturingFetch,
  dispatchRecorded,
  fixtureBody,
  HARNESS_API_BASE,
  type Harness,
  ownSummoner,
  type RecordedEvent,
  startHarness,
} from './harness.js';

/** Every route a golden can be about. `lcu-*` are writes to the League client; `*-file` are files on disk. */
export const GOLDEN_ROUTES = [
  'lobby',
  'game',
  'rank',
  'backfill-scan',
  'commands-poll',
  'command-ack',
  'command-nack',
  'pair',
  'lcu-create-lobby',
  'lcu-invite',
  'lcu-switch-side',
  'queue-file',
  'commands-done-file',
] as const;
export type GoldenRoute = (typeof GOLDEN_ROUTES)[number];

/** The synthetic lobby password the create scenario uses. The golden guard allows exactly this value. */
export const GOLDEN_LOBBY_PASSWORD = 'golden-pw-4821';
/** A 43-character token-shaped string the pair stand-in answers with. Never a real token. */
export const GOLDEN_PAIR_TOKEN = 'GOLDENxPAIRxTOKENxNOTxREALxxxxxxxxxxxxxxxxx';

export const ME = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
export const FRIEND = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';
export const OTHER = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const PENDING_INVITEE = 'ae4f66e8-745c-5b24-8315-dc046c8bba96';
const NO_LOBBY_INVITEE = 'b3b781b3-9a77-5061-8054-817d2355b2e6';
const BACKFILLED_GAME = 4000769615;

/** The default clock: after the 16.17 captures, so nothing reads as from the future. */
const DEFAULT_NOW = Date.parse('2026-09-08T17:00:00.000Z');
/** `GameStart` for game 4000969091, as recorded in `16.17/ws-events.ndjson`. */
const GAME_START = Date.parse('2026-09-08T16:37:38.903Z');
/** The block's `Create` for the same game, as recorded. */
const EOG_CREATE = Date.parse('2026-09-08T16:53:04.508Z');

const LOBBY_404: CannedRoute = {
  status: 404,
  body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' },
};

export interface GoldenRequest {
  readonly route: GoldenRoute;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** One golden file. `body` for one request, `requests` for an ordered sequence, `file` for a file on disk. */
export interface Golden {
  readonly name: string;
  readonly kind: 'request' | 'sequence' | 'file';
  readonly target: 'api' | 'lcu' | 'disk';
  /** For `sequence`, the route every request is checked by is per request; this is `'lobby'`-and-friends. */
  readonly route: GoldenRoute | 'sequence';
  readonly patch: string;
  /** `<patch>/<fixture id>` of every fixture the scenario fed in. */
  readonly fixtures: readonly string[];
  readonly scenario: string;
  readonly note: string;
  readonly method?: string;
  readonly path?: string;
  /** The command kind an ack or nack answers, so the ack's `result` is checked by the right schema. */
  readonly commandKind?: string;
  readonly body?: unknown;
  readonly requests?: readonly (GoldenRequest & { readonly afterEvent?: number })[];
  readonly file?: unknown;
}

export interface ScenarioResult {
  readonly name: string;
  readonly description: string;
  readonly goldens: readonly Golden[];
  /** Every API request the scenario made, in order, by route (the index's per-scenario summary). */
  readonly apiRoutes: readonly GoldenRoute[];
  readonly lcuWrites: readonly GoldenRoute[];
}

export function routeOf(request: Pick<Captured, 'target' | 'method' | 'path'>): GoldenRoute {
  const path = request.path.split('?')[0] ?? request.path;
  if (request.target === 'lcu') {
    if (path === '/lol-lobby/v2/lobby') return 'lcu-create-lobby';
    if (path === '/lol-lobby/v2/lobby/invitations') return 'lcu-invite';
    if (path.startsWith('/lol-lobby/v2/lobby/team/')) return 'lcu-switch-side';
    throw new Error(`unexpected client write ${request.method} ${path}`);
  }
  if (path === '/api/companion/lobby') return 'lobby';
  if (path === '/api/companion/game') return 'game';
  if (path === '/api/companion/rank') return 'rank';
  if (path === '/api/companion/backfill/scan') return 'backfill-scan';
  if (path === '/api/companion/commands') return 'commands-poll';
  if (path === '/api/companion/pair') return 'pair';
  if (/\/ack$/.test(path)) return 'command-ack';
  if (/\/nack$/.test(path)) return 'command-nack';
  throw new Error(`unexpected api request ${request.method} ${path}`);
}

function requestGolden(
  request: Captured,
  meta: {
    name: string;
    patch: string;
    fixtures: readonly string[];
    scenario: string;
    note: string;
    commandKind?: string;
  },
): Golden {
  if (request.rawBody !== null && JSON.stringify(request.body) !== request.rawBody) {
    // The parse must be lossless, or the golden would not be the bytes that went out.
    throw new Error(`${meta.name}: body does not survive a JSON round trip`);
  }
  return {
    name: meta.name,
    kind: 'request',
    target: request.target,
    route: routeOf(request),
    patch: meta.patch,
    fixtures: meta.fixtures,
    scenario: meta.scenario,
    note: meta.note,
    method: request.method,
    path: request.path,
    ...(meta.commandKind !== undefined ? { commandKind: meta.commandKind } : {}),
    body: request.body,
  };
}

function only(requests: readonly Captured[], route: GoldenRoute, scenario: string, count = 1): Captured[] {
  const matched = requests.filter((request) => routeOf(request) === route);
  if (matched.length !== count) {
    throw new Error(`${scenario}: expected ${count} ${route} request(s), saw ${matched.length}`);
  }
  return matched;
}

function summary(name: string, description: string, h: Harness, goldens: Golden[]): ScenarioResult {
  return {
    name,
    description,
    goldens,
    apiRoutes: h.apiRequests.map(routeOf),
    lcuWrites: h.lcuWrites().map(routeOf),
  };
}

const lobbyFixture = (patch: string, id: string): Lobby => LobbySchema.parse(fixtureBody(patch, id));

/** The fake client's answers for every summoner lookup a fixture covers; anyone else is a 404. */
function summonerRoutes(): Record<string, CannedRoute> {
  return {
    [`GET /lol-summoner/v2/summoners/puuid/${ME}`]: {
      status: 200,
      body: fixtureBody('16.17', 'summoner-by-puuid'),
    },
    [`GET /lol-summoner/v2/summoners/puuid/${OTHER}`]: {
      status: 200,
      body: fixtureBody('16.17', 'summoner-by-puuid--other'),
    },
  };
}

// --- lobby ---------------------------------------------------------------------------------------------------

async function lobbyScenario(
  name: string,
  patch: string,
  fixture: string,
  note: string,
): Promise<ScenarioResult> {
  const h = await startHarness({
    parts: ['lobby'],
    clock: { now: DEFAULT_NOW },
    patch,
    lcuRoutes: { 'GET /lol-lobby/v2/lobby': LOBBY_404, ...summonerRoutes() },
  });
  try {
    await h.connect();
    await h.hooks.onLobbyEvent?.({ eventType: 'Update', lobby: lobbyFixture(patch, fixture) }, h.context);
    await h.settle();
    const [post] = only(h.apiRequests, 'lobby', name);
    const goldens = [
      requestGolden(post as Captured, {
        name: `lobby--${fixture}`,
        patch,
        fixtures: [`${patch}/${fixture}`, '16.17/current-summoner'],
        scenario: name,
        note,
      }),
    ];
    return summary(
      name,
      `A lobby Update carrying ${patch}/${fixture}; the local player is current-summoner.`,
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

async function lobbyNamesScenario(): Promise<ScenarioResult> {
  const name = 'lobby-names-repost';
  const h = await startHarness({
    parts: ['lobby'],
    clock: { now: DEFAULT_NOW },
    summoner: null,
    lcuRoutes: { 'GET /lol-lobby/v2/lobby': LOBBY_404, ...summonerRoutes() },
  });
  try {
    await h.connect();
    await h.hooks.onLobbyEvent?.({ eventType: 'Update', lobby: lobbyFixture('16.17', 'lobby') }, h.context);
    await h.settle();
    const [first, second] = only(h.apiRequests, 'lobby', name, 2);
    const fixtures = ['16.17/lobby', '16.17/summoner-by-puuid'];
    const goldens = [
      requestGolden(first as Captured, {
        name: 'lobby--lobby--names-unknown',
        patch: '16.17',
        fixtures,
        scenario: name,
        note: 'current-summoner did not answer at connect, so no name is known: the roster is posted at once with null names (a post never waits on a lookup).',
      }),
      requestGolden(second as Captured, {
        name: 'lobby--lobby--names-repost',
        patch: '16.17',
        fixtures,
        scenario: name,
        note: 'The background lookup (summoners/puuid/{puuid} -> summoner-by-puuid) finished: one coalesced re-post of the same roster with the name filled in.',
      }),
    ];
    return summary(
      name,
      'A lobby Update while the own name is unknown: post at once, look the name up, re-post once.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

// --- game ----------------------------------------------------------------------------------------------------

async function gameLiveScenario(): Promise<ScenarioResult> {
  const name = 'game-live';
  const clock = { now: GAME_START };
  let eogPosts = 0;
  const h = await startHarness({
    parts: ['game'],
    clock,
    lcuRoutes: {
      'GET /lol-gameflow/v1/session': { status: 200, body: fixtureBody('16.17', 'gameflow-session') },
    },
    // The first end-of-game post answers 503, so the queue file stays on disk long enough to be read.
    api: (request) => {
      if (request.path === '/api/companion/game' && (request.body as { phase?: string })?.phase === 'eog') {
        eogPosts += 1;
        if (eogPosts === 1) return { status: 503, body: { ok: false, error: 'golden harness: try later' } };
      }
      return undefined;
    },
  });
  try {
    await h.connect();
    // The game watcher keeps the last custom lobby's partyId for both posts.
    await h.hooks.onLobbyEvent?.({ eventType: 'Update', lobby: lobbyFixture('16.17', 'lobby') }, h.context);
    await h.hooks.onGameflowPhase?.('GameStart', h.context);
    await h.settle();
    clock.now = GAME_START + 17;
    await h.hooks.onGameflowPhase?.('InProgress', h.context);
    await h.settle();
    clock.now = EOG_CREATE;
    const block = EogStatsBlockSchema.parse(fixtureBody('16.17', 'eog-stats-block'));
    await h.hooks.onEogBlock?.({ eventType: 'Create', block }, h.context);
    await h.settle();
    const queueText = readFileSync(join(h.configDir, 'queue', `${block.gameId}.json`), 'utf8');
    // The Update that follows the Create is a no-op: the game is already in the queue.
    await h.hooks.onEogBlock?.({ eventType: 'Update', block }, h.context);
    await h.settle();

    const games = only(h.apiRequests, 'game', name, 2);
    const fixtures = ['16.17/lobby', '16.17/gameflow-session', '16.17/eog-stats-block'];
    const goldens: Golden[] = [
      requestGolden(games[0] as Captured, {
        name: 'game--in-progress--gameflow-session',
        patch: '16.17',
        fixtures: ['16.17/lobby', '16.17/gameflow-session'],
        scenario: name,
        note: 'gameflow-phase GameStart -> one GET /lol-gameflow/v1/session -> in_progress with gameData.gameId, the partyId of the last custom lobby seen, and the moment GameStart was observed (the injected clock, set to the GameStart recorded for this game in ws-events.ndjson). InProgress 17 ms later posts nothing.',
      }),
      requestGolden(games[1] as Captured, {
        name: 'game--eog--eog-stats-block--observed-start',
        patch: '16.17',
        fixtures,
        scenario: name,
        note: 'The block from the WebSocket Create (held in memory, never re-read): partyId and startedAt are the ones held from in_progress; raw is the whole block, scrubbed. Written to the queue before the POST (the stand-in answers this POST 503 so the file stays to be read; a retry re-sends the same bytes from the file); the Update that follows is deduped on gameId.',
      }),
      {
        name: 'queue-file--eog-stats-block',
        kind: 'file',
        target: 'disk',
        route: 'queue-file',
        patch: '16.17',
        fixtures,
        scenario: name,
        note: `<stateDir>/queue/${block.gameId}.json as the TypeScript engine wrote it before the first POST: { version, queuedAt, payload } where payload is the exact request body. On disk it is JSON.stringify(entry, null, 2) plus a newline; queuedAt is the injected clock at capture.`,
        path: `queue/${block.gameId}.json`,
        file: JSON.parse(queueText),
      },
    ];
    if (`${JSON.stringify(JSON.parse(queueText), null, 2)}\n` !== queueText) {
      throw new Error(`${name}: the queue file is not in the documented format`);
    }
    return summary(
      name,
      'A custom played with the companion watching: lobby, GameStart, InProgress, the block over the socket.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

async function gameAtConnectScenario(): Promise<ScenarioResult> {
  const name = 'game-eog-at-connect';
  const h = await startHarness({
    parts: ['game'],
    clock: { now: DEFAULT_NOW },
    phase: 'EndOfGame',
    lcuRoutes: {
      'GET /lol-end-of-game/v1/eog-stats-block': {
        status: 200,
        body: fixtureBody('16.17', 'eog-stats-block'),
      },
    },
  });
  try {
    await h.connect();
    const [post] = only(h.apiRequests, 'game', name);
    const goldens = [
      requestGolden(post as Captured, {
        name: 'game--eog--eog-stats-block--at-connect',
        patch: '16.17',
        fixtures: ['16.17/eog-stats-block', '16.17/gameflow-phase'],
        scenario: name,
        note: 'The companion started on the end-of-game screen (phase EndOfGame at connect): the one GET of the block, partyId null (no lobby seen), startedAt derived as endOfGameTimestamp - gameLength * 1000.',
      }),
    ];
    return summary(name, 'Connected with the client already on the end-of-game screen.', h, goldens);
  } finally {
    await h.close();
  }
}

async function gameStaleSessionScenario(): Promise<ScenarioResult> {
  const name = 'game-stale-session';
  const h = await startHarness({
    parts: ['game'],
    clock: { now: DEFAULT_NOW },
    lcuRoutes: {
      'GET /lol-gameflow/v1/session': {
        status: 200,
        body: fixtureBody('16.17', 'gameflow-session--in-lobby'),
      },
    },
  });
  try {
    await h.connect();
    await h.hooks.onGameflowPhase?.('GameStart', h.context);
    await h.settle();
    only(h.apiRequests, 'game', name, 0);
    return summary(
      name,
      'GameStart, but the session read back is the previous game in phase Lobby: no in_progress post (16.17/gameflow-session--in-lobby).',
      h,
      [],
    );
  } finally {
    await h.close();
  }
}

// --- rank ----------------------------------------------------------------------------------------------------

async function rankOwnScenario(): Promise<ScenarioResult> {
  const name = 'rank-own';
  const h = await startHarness({
    parts: ['rank'],
    clock: { now: DEFAULT_NOW },
    lcuRoutes: {
      'GET /lol-ranked/v1/current-ranked-stats': {
        status: 200,
        body: fixtureBody('16.17', 'current-ranked-stats'),
      },
    },
  });
  try {
    await h.connect();
    const [post] = only(h.apiRequests, 'rank', name);
    const goldens = [
      requestGolden(post as Captured, {
        name: 'rank--current-ranked-stats--own',
        patch: '16.17',
        fixtures: ['16.17/current-ranked-stats', '16.17/current-summoner'],
        scenario: name,
        note: 'Own rank on the first connect: queueMap.RANKED_SOLO_5x5 verbatim (tier, division, leaguePoints), the own Riot ID from current-summoner. wins/losses are never sent.',
      }),
    ];
    return summary(name, 'First connect: the own rank.', h, goldens);
  } finally {
    await h.close();
  }
}

async function rankOtherScenario(): Promise<ScenarioResult> {
  const name = 'rank-other';
  const h = await startHarness({
    parts: ['lobby', 'rank'],
    clock: { now: DEFAULT_NOW },
    ranksNeeded: [OTHER],
    lcuRoutes: {
      'GET /lol-lobby/v2/lobby': LOBBY_404,
      'GET /lol-ranked/v1/current-ranked-stats': {
        status: 200,
        body: fixtureBody('16.17', 'current-ranked-stats'),
      },
      [`GET /lol-ranked/v1/ranked-stats/${OTHER}`]: {
        status: 200,
        body: fixtureBody('16.17', 'ranked-stats-by-puuid--other'),
      },
      ...summonerRoutes(),
    },
  });
  try {
    await h.connect();
    await h.hooks.onLobbyEvent?.({ eventType: 'Update', lobby: lobbyFixture('16.17', 'lobby') }, h.context);
    await h.settle();
    const ranks = only(h.apiRequests, 'rank', name, 2);
    const goldens = [
      requestGolden(ranks[1] as Captured, {
        name: 'rank--ranked-stats-by-puuid--other',
        patch: '16.17',
        fixtures: ['16.17/ranked-stats-by-puuid--other', '16.17/summoner-by-puuid--other'],
        scenario: name,
        note: 'The lobby answer listed this puuid in ranksNeeded: GET ranked-stats/{puuid}, then the summoner lookup (the lobby watcher did not know the name), then one post carrying both.',
      }),
    ];
    return summary(
      name,
      'A lobby answer asks for a rank the companion does not hold: rank plus name, one post.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

async function rankSocketScenario(): Promise<ScenarioResult> {
  const name = 'rank-socket-shortcut';
  const clock = { now: DEFAULT_NOW };
  const h = await startHarness({
    parts: ['rank'],
    clock,
    lcuRoutes: {
      'GET /lol-ranked/v1/current-ranked-stats': {
        status: 200,
        body: fixtureBody('16.17', 'current-ranked-stats'),
      },
    },
  });
  try {
    await h.connect();
    const rank = h.rank;
    if (rank === null) throw new Error(`${name}: no rank sync`);
    // First ask: the GET fails (no route), so nothing is posted and the puuid stays wanted.
    rank.needed([FRIEND]);
    await h.settle();
    const stats = RankedStatsSchema.parse(fixtureBody('16.17', 'ranked-stats-by-puuid--ws-cached'));
    await h.hooks.onRankedStats?.({ puuid: FRIEND, stats }, h.context);
    // An hour later the server asks again; the socket's copy replaces the GET.
    clock.now += ASKED_TTL_MS + 1;
    rank.needed([FRIEND]);
    await h.settle();
    const ranks = only(h.apiRequests, 'rank', name, 2);
    const goldens = [
      requestGolden(ranks[1] as Captured, {
        name: 'rank--ranked-stats-by-puuid--ws-cached',
        patch: '16.17',
        fixtures: ['16.17/ranked-stats-by-puuid--ws-cached'],
        scenario: name,
        note: 'An unranked friend from a cached-ranked-stats push: tier "" and division "NA" are sent verbatim (the server folds them to null); the name lookup 404s, so gameName/tagLine are null.',
      }),
    ];
    return summary(
      name,
      'A requested puuid whose ranked stats arrived over the socket: the push replaces the GET.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

// --- backfill ------------------------------------------------------------------------------------------------

async function backfillScenario(): Promise<ScenarioResult> {
  const name = 'backfill';
  const h = await startHarness({
    parts: ['backfill'],
    clock: { now: DEFAULT_NOW },
    phase: 'None',
    scanUnknown: (ids) => ids.filter((id) => id === BACKFILLED_GAME),
    lcuRoutes: {
      [`GET ${matchHistoryPagePath(ME, 0, 20)}`]: {
        status: 200,
        body: fixtureBody('16.17', 'match-history'),
      },
      [`GET /lol-match-history/v1/games/${BACKFILLED_GAME}`]: {
        status: 200,
        body: fixtureBody('16.17', 'match-detail'),
      },
    },
  });
  try {
    await h.connect();
    if (h.backfill === null) throw new Error(`${name}: no backfill`);
    await h.backfill.runNow();
    await h.settle();
    const [scan] = only(h.apiRequests, 'backfill-scan', name);
    const [game] = only(h.apiRequests, 'game', name);
    const goldens = [
      requestGolden(scan as Captured, {
        name: 'backfill-scan--match-history',
        patch: '16.17',
        fixtures: ['16.17/match-history'],
        scenario: name,
        note: 'A fresh state dir: page begIndex=0&endIndex=20 is the fixture (21 games), the next page 404s (the end of what the client gives). Candidates are the completed customs in history order; MATCHED_GAME and Abort_TooFewPlayers are left out.',
      }),
      requestGolden(game as Captured, {
        name: 'game--backfill--match-detail',
        patch: '16.17',
        fixtures: ['16.17/match-detail'],
        scenario: name,
        note: 'The scan answered this id unknown: GET /lol-match-history/v1/games/{gameId}, mapMatchDetail, through the queue. source "backfill", no partyId key at all, role null for every participant (the timeline table is empty on 16.17), startedAt is gameCreation.',
      }),
    ];
    return summary(name, 'One backfill pass over the recorded match history.', h, goldens);
  } finally {
    await h.close();
  }
}

async function backfillNoCustomsScenario(): Promise<ScenarioResult> {
  const name = 'backfill-no-customs';
  const other = SummonerSchema.parse(fixtureBody('16.17', 'summoner-by-puuid--other'));
  const h = await startHarness({
    parts: ['backfill'],
    clock: { now: DEFAULT_NOW },
    phase: 'None',
    summoner: other,
    lcuRoutes: {
      [`GET ${matchHistoryPagePath(OTHER, 0, 20)}`]: {
        status: 200,
        body: fixtureBody('16.17', 'match-history--other'),
      },
    },
  });
  try {
    await h.connect();
    if (h.backfill === null) throw new Error(`${name}: no backfill`);
    await h.backfill.runNow();
    await h.settle();
    only(h.apiRequests, 'backfill-scan', name, 0);
    return summary(
      name,
      'A history of matchmade games only (16.17/match-history--other): no scan, nothing posted.',
      h,
      [],
    );
  } finally {
    await h.close();
  }
}

// --- commands ------------------------------------------------------------------------------------------------

function command(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  const ttl = COMPANION_COMMAND_TTL_MS[kind as CompanionCommandKind] ?? 60_000;
  return {
    id,
    kind,
    payload,
    createdAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now - 1_000 + ttl).toISOString(),
  };
}

interface LobbyWorld {
  lobby: unknown;
}

/** A client that plays a lobby: the GET answers whatever `world.lobby` is, the writes move it. */
function lobbyClient(
  world: LobbyWorld,
  writes: {
    create?: () => CannedRoute;
    invite?: (body: string) => CannedRoute;
    team?: (path: string) => CannedRoute;
  } = {},
): (method: string, path: string, body: string) => CannedRoute | undefined {
  return (method, path, body) => {
    if (method === 'GET' && path === '/lol-lobby/v2/lobby') {
      return world.lobby === null ? LOBBY_404 : { status: 200, body: world.lobby };
    }
    if (method === 'GET' && path === '/lol-game-queues/v1/custom') {
      return { status: 200, body: fixtureBody('16.18', 'custom-game-queues') };
    }
    if (method === 'GET' && path === '/lol-game-queues/v1/queues') {
      return { status: 200, body: fixtureBody('16.18', 'game-queues') };
    }
    if (method === 'POST' && path === '/lol-lobby/v2/lobby' && writes.create) return writes.create();
    if (method === 'POST' && path === '/lol-lobby/v2/lobby/invitations' && writes.invite)
      return writes.invite(body);
    if (method === 'POST' && path.startsWith('/lol-lobby/v2/lobby/team/') && writes.team)
      return writes.team(path);
    return undefined;
  };
}

async function createLobbyScenario(): Promise<ScenarioResult> {
  const name = 'command-create-lobby';
  const now = DEFAULT_NOW;
  const created = fixtureBody('16.18', 'create-lobby');
  const world: LobbyWorld = { lobby: null };
  const create = command(
    '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    'create_lobby',
    { lobbyName: 'customs-verify', lobbyPassword: GOLDEN_LOBBY_PASSWORD },
    now,
  );
  const h = await startHarness({
    parts: ['lobby', 'commands'],
    clock: { now },
    patch: '16.18',
    phase: 'None',
    commandPages: [[create], [create], []],
    lcuHandle: lobbyClient(world, {
      create: () => {
        world.lobby = created;
        return { status: 200, body: created };
      },
    }),
  });
  try {
    await h.connect();
    if (h.commands === null) throw new Error(`${name}: no runner`);
    // Started after the connect so the lobby watcher's connect-time read cannot race the create.
    h.commands.start();
    await h.settle();
    // The client then pushes the new lobby: its first post carries the password this process set.
    await h.hooks.onLobbyEvent?.({ eventType: 'Create', lobby: LobbySchema.parse(created) }, h.context);
    await h.settle();
    // The server hands the same command out again (a lost ack): re-acked from commands-done.json, no client call.
    await h.commands.pollNow();
    await h.settle();
    const doneText = readFileSync(join(h.configDir, 'commands-done.json'), 'utf8');

    const polls = only(h.apiRequests, 'commands-poll', name, 2);
    const acks = only(h.apiRequests, 'command-ack', name, 2);
    const [write] = only(h.lcuWrites(), 'lcu-create-lobby', name);
    const [lobbyPost] = only(h.apiRequests, 'lobby', name);
    const fixtures = ['16.18/custom-game-queues', '16.18/game-queues', '16.18/create-lobby'];
    const goldens: Golden[] = [
      requestGolden(polls[0] as Captured, {
        name: 'commands-poll--connected',
        patch: '16.18',
        fixtures: [],
        scenario: name,
        note: 'The poll while the client is up. A GET: the golden is the path and query, there is no body.',
      }),
      requestGolden(write as Captured, {
        name: 'lcu-create-lobby--create-lobby',
        patch: '16.18',
        fixtures,
        scenario: name,
        note: 'The create body sent to the client: queueId and mutators.id are the draft entry joined from the dialog data (16.18: 3110), never a constant. Compare 16.18/create-lobby.json "request" (the same body, password redacted there).',
      }),
      requestGolden(acks[0] as Captured, {
        name: 'command-ack--create-lobby',
        patch: '16.18',
        fixtures,
        scenario: name,
        commandKind: 'create_lobby',
        note: 'GET lobby 404 -> dialog data -> POST create -> GET lobby read back: partyId and customLobbyName from the read-back.',
      }),
      requestGolden(lobbyPost as Captured, {
        name: 'lobby--create-lobby--with-password',
        patch: '16.18',
        fixtures: ['16.18/create-lobby'],
        scenario: name,
        note: 'The lobby this process created: every post for that party carries the password it set (passwordFor). Any other party posts lobbyPassword null.',
      }),
      requestGolden(acks[1] as Captured, {
        name: 'command-ack--create-lobby--replayed',
        patch: '16.18',
        fixtures,
        scenario: name,
        commandKind: 'create_lobby',
        note: 'The same command id handed out again: re-acked from commands-done.json with the recorded result, no client call (execute-once). Identical to the first ack.',
      }),
      {
        name: 'commands-done-file--create-lobby',
        kind: 'file',
        target: 'disk',
        route: 'commands-done-file',
        patch: '16.18',
        fixtures,
        scenario: name,
        note: '<stateDir>/commands-done.json after the create: written after the client call and before the ack. "at" is the injected clock.',
        path: 'commands-done.json',
        file: JSON.parse(doneText),
      },
    ];
    if (h.lcuWrites().length !== 1) throw new Error(`${name}: the replay made a client call`);
    return summary(
      name,
      'create_lobby from an empty client, the new lobby pushed back, then the same command re-delivered.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

/**
 * The same create while the own name is unknown, so the lobby watcher re-posts once the lookup lands. Pins a
 * quirk of the 0.4.0 engine: the names re-post maps the lobby again without `passwordFor`, so it carries
 * `lobbyPassword: null` for a party this process created (harmless: the server never clears on null).
 */
async function createLobbyNamesScenario(): Promise<ScenarioResult> {
  const name = 'command-create-lobby-names-repost';
  const now = DEFAULT_NOW;
  const created = fixtureBody('16.18', 'create-lobby');
  const world: LobbyWorld = { lobby: null };
  const h = await startHarness({
    parts: ['lobby', 'commands'],
    clock: { now },
    patch: '16.18',
    phase: 'None',
    summoner: null,
    commandPages: [
      [
        command(
          '8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
          'create_lobby',
          { lobbyName: 'customs-verify', lobbyPassword: GOLDEN_LOBBY_PASSWORD },
          now,
        ),
      ],
      [],
    ],
    lcuRoutes: summonerRoutes(),
    lcuHandle: lobbyClient(world, {
      create: () => {
        world.lobby = created;
        return { status: 200, body: created };
      },
    }),
  });
  try {
    await h.connect();
    if (h.commands === null) throw new Error(`${name}: no runner`);
    h.commands.start();
    await h.settle();
    await h.hooks.onLobbyEvent?.({ eventType: 'Create', lobby: LobbySchema.parse(created) }, h.context);
    await h.settle();
    const [first, second] = only(h.apiRequests, 'lobby', name, 2);
    const fixtures = ['16.18/create-lobby', '16.17/summoner-by-puuid'];
    const goldens = [
      requestGolden(first as Captured, {
        name: 'lobby--create-lobby--with-password--names-unknown',
        patch: '16.18',
        fixtures,
        scenario: name,
        note: 'The first post for the party this process created: the password rides, the own name is not known yet (current-summoner did not answer at connect).',
      }),
      requestGolden(second as Captured, {
        name: 'lobby--create-lobby--names-repost',
        patch: '16.18',
        fixtures,
        scenario: name,
        note: 'QUIRK of the 0.4.0 engine: the names re-post (repostWithNames) maps the lobby without passwordFor, so lobbyPassword is null here although the previous post carried it. Harmless (the server never clears on null). Parity keeps it unless a decision row says otherwise.',
      }),
    ];
    return summary(
      name,
      'create_lobby with the own name unknown: the password post, then the names re-post.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

/**
 * M17.17: the same create with `pickType: 'blind'` (what a mirror game's Start a lobby queues). Only the
 * write is pinned: the entry is the blind one joined from the dialog data and the queue list (16.18: 3100).
 * The fake client reads back the recorded draft lobby, so the ack is not a golden here.
 */
async function createLobbyBlindScenario(): Promise<ScenarioResult> {
  const name = 'command-create-lobby-blind';
  const now = DEFAULT_NOW;
  const created = fixtureBody('16.18', 'create-lobby');
  const world: LobbyWorld = { lobby: null };
  const h = await startHarness({
    parts: ['lobby', 'commands'],
    clock: { now },
    patch: '16.18',
    phase: 'None',
    commandPages: [
      [
        command(
          '9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
          'create_lobby',
          { lobbyName: 'customs-verify', lobbyPassword: GOLDEN_LOBBY_PASSWORD, pickType: 'blind' },
          now,
        ),
      ],
      [],
    ],
    lcuHandle: lobbyClient(world, {
      create: () => {
        world.lobby = created;
        return { status: 200, body: created };
      },
    }),
  });
  try {
    await h.connect();
    if (h.commands === null) throw new Error(`${name}: no runner`);
    h.commands.start();
    await h.settle();
    const [write] = only(h.lcuWrites(), 'lcu-create-lobby', name);
    const goldens: Golden[] = [
      requestGolden(write as Captured, {
        name: 'lcu-create-lobby--create-lobby--blind',
        patch: '16.18',
        fixtures: ['16.18/custom-game-queues', '16.18/game-queues'],
        scenario: name,
        note: 'The create body for pickType "blind": queueId and mutators.id are the blind entry joined from the dialog data and the queue list (16.18: 3100, "SR Blind Pick Custom"), otherwise the draft body byte for byte. UNVERIFIED against a live client: the 16.18 probe only ever sent draft (3110).',
      }),
    ];
    return summary(name, 'create_lobby with pickType blind: the write names the blind entry.', h, goldens);
  } finally {
    await h.close();
  }
}

interface CommandCase {
  readonly name: string;
  readonly golden: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly patch: string;
  readonly fixtures: readonly string[];
  readonly lobby: unknown;
  readonly phase?: string;
  /** The client's answers to writes; given the world so a write can move the lobby the next GET reads. */
  readonly writes?: (world: LobbyWorld) => Parameters<typeof lobbyClient>[1];
  readonly expect: 'command-ack' | 'command-nack';
  readonly lcuGolden?: { readonly name: string; readonly route: GoldenRoute; readonly note: string };
  readonly note: string;
  readonly description: string;
}

async function commandScenario(spec: CommandCase): Promise<ScenarioResult> {
  const now = DEFAULT_NOW;
  const world: LobbyWorld = { lobby: spec.lobby };
  const h = await startHarness({
    parts: ['commands'],
    clock: { now },
    patch: spec.patch,
    phase: spec.phase ?? 'Lobby',
    commandPages: [[command('5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f', spec.kind, spec.payload, now)], []],
    lcuHandle: lobbyClient(world, spec.writes?.(world) ?? {}),
  });
  try {
    await h.connect();
    if (h.commands === null) throw new Error(`${spec.name}: no runner`);
    h.commands.start();
    await h.settle();
    const [answer] = only(h.apiRequests, spec.expect, spec.name);
    const goldens: Golden[] = [];
    if (spec.lcuGolden) {
      const [write] = only(h.lcuWrites(), spec.lcuGolden.route, spec.name);
      goldens.push(
        requestGolden(write as Captured, {
          name: spec.lcuGolden.name,
          patch: spec.patch,
          fixtures: spec.fixtures,
          scenario: spec.name,
          note: spec.lcuGolden.note,
        }),
      );
    }
    goldens.push(
      requestGolden(answer as Captured, {
        name: spec.golden,
        patch: spec.patch,
        fixtures: spec.fixtures,
        scenario: spec.name,
        commandKind: spec.kind,
        note: spec.note,
      }),
    );
    return summary(spec.name, spec.description, h, goldens);
  } finally {
    await h.close();
  }
}

/** The lobby after a switch to 200: the create-lobby capture with the local player moved. Derived, not captured. */
function lobbyOnSide200(): unknown {
  const lobby = structuredClone(fixtureBody('16.18', 'create-lobby')) as {
    gameConfig: { customTeam100: unknown[]; customTeam200: unknown[] };
  };
  lobby.gameConfig.customTeam200 = [...lobby.gameConfig.customTeam200, ...lobby.gameConfig.customTeam100];
  lobby.gameConfig.customTeam100 = [];
  return lobby;
}

function commandCases(): CommandCase[] {
  const created = fixtureBody('16.18', 'create-lobby');
  return [
    {
      name: 'command-invite',
      golden: 'command-ack--invite--sent',
      kind: 'invite',
      payload: { puuid: FRIEND, summonerId: '55838205' },
      patch: '16.18',
      fixtures: ['16.18/create-lobby', '16.18/lobby-invitations'],
      lobby: created,
      writes: () => ({ invite: () => ({ status: 200, body: fixtureBody('16.18', 'lobby-invitations') }) }),
      expect: 'command-ack',
      lcuGolden: {
        name: 'lcu-invite--lobby-invitations',
        route: 'lcu-invite',
        note: 'The invite body: [{ toSummonerId }] first, the number parsed from the payload string (16.18: accepted).',
      },
      note: 'Invite accepted by the client (16.18/lobby-invitations); the read-back lobby has no row for the puuid yet, so the state is Pending.',
      description: 'invite in the lobby the create made, by summonerId.',
    },
    {
      name: 'command-invite-already-pending',
      golden: 'command-ack--invite--already-pending',
      kind: 'invite',
      payload: { puuid: PENDING_INVITEE, summonerId: null },
      patch: '16.17',
      fixtures: ['16.17/lobby'],
      lobby: fixtureBody('16.17', 'lobby'),
      expect: 'command-ack',
      note: 'The lobby already holds a Pending invitation for this puuid: acked without a client write. summonerId null, so method is "puuid".',
      description: 'invite for someone already invited (16.17/lobby): no write.',
    },
    {
      name: 'command-invite-already-member',
      golden: 'command-ack--invite--already-member',
      kind: 'invite',
      payload: { puuid: FRIEND, summonerId: '53574489' },
      patch: '16.17',
      fixtures: ['16.17/lobby--two-players'],
      lobby: fixtureBody('16.17', 'lobby--two-players'),
      expect: 'command-ack',
      note: 'The puuid is already a member: Accepted, no client write.',
      description: 'invite for someone already in the lobby (16.17/lobby--two-players): no write.',
    },
    {
      name: 'command-invite-client-rejected',
      golden: 'command-nack--invite--client-rejected',
      kind: 'invite',
      payload: { puuid: NO_LOBBY_INVITEE, summonerId: '80934556' },
      patch: '16.17',
      fixtures: [
        '16.17/lobby',
        '16.17/lobby-invitations--no-lobby',
        '16.17/lobby-invitations--by-puuid--no-lobby',
      ],
      lobby: fixtureBody('16.17', 'lobby'),
      writes: () => ({
        invite: (body) => ({
          status: 404,
          body: fixtureBody(
            '16.17',
            body.includes('toPuuid')
              ? 'lobby-invitations--by-puuid--no-lobby'
              : 'lobby-invitations--no-lobby',
          ),
        }),
      }),
      expect: 'command-nack',
      note: 'Both invite bodies refused with the captured 404s: summonerId first, then the puuid fallback; the nack names both answers. Not retryable.',
      description: 'invite the client refuses both ways.',
    },
    {
      name: 'command-switch-side',
      golden: 'command-ack--switch-side',
      kind: 'switch_side',
      payload: { targetSide: 200 },
      patch: '16.18',
      fixtures: ['16.18/create-lobby', '16.18/lobby-team'],
      lobby: created,
      writes: (world) => ({
        team: () => {
          world.lobby = lobbyOnSide200();
          return { status: 204, body: '' };
        },
      }),
      expect: 'command-ack',
      lcuGolden: {
        name: 'lcu-switch-side--lobby-team',
        route: 'lcu-switch-side',
        note: 'POST /lol-lobby/v2/lobby/team/TEAM2 with no body (16.18/lobby-team: 204). The golden body is null.',
      },
      note: 'The local player on 100 moves to 200. The read-back lobby is DERIVED in memory from 16.18/create-lobby (the local player moved to customTeam200): no capture of the after-state exists.',
      description: 'switch_side 100 -> 200.',
    },
    {
      name: 'command-switch-side-already',
      golden: 'command-ack--switch-side--already',
      kind: 'switch_side',
      payload: { targetSide: 100 },
      patch: '16.17',
      fixtures: ['16.17/lobby--two-players'],
      lobby: fixtureBody('16.17', 'lobby--two-players'),
      expect: 'command-ack',
      note: 'Already on side 100: acked without a client write.',
      description: 'switch_side to the side the player is on.',
    },
    {
      name: 'command-create-already-in-lobby',
      golden: 'command-nack--create-lobby--already-in-lobby',
      kind: 'create_lobby',
      payload: { lobbyName: 'customs-verify', lobbyPassword: GOLDEN_LOBBY_PASSWORD },
      patch: '16.17',
      fixtures: ['16.17/lobby'],
      lobby: fixtureBody('16.17', 'lobby'),
      expect: 'command-nack',
      note: 'A lobby is open (16.17/lobby): never dissolved, nack already_in_lobby with its partyId.',
      description: 'create_lobby while standing in a lobby.',
    },
    {
      name: 'command-create-client-rejected',
      golden: 'command-nack--create-lobby--client-rejected',
      kind: 'create_lobby',
      payload: { lobbyName: 'customs-verify', lobbyPassword: GOLDEN_LOBBY_PASSWORD },
      patch: '16.17',
      fixtures: ['16.18/custom-game-queues', '16.18/game-queues', '16.17/create-lobby--legacy-blind'],
      lobby: null,
      writes: () => ({
        create: () => ({ status: 500, body: fixtureBody('16.17', 'create-lobby--legacy-blind') }),
      }),
      expect: 'command-nack',
      note: "The create POST answered the captured 500 INVALID_LOBBY: nack client_rejected with the path, status and the client's message.",
      description: 'create_lobby the client refuses.',
    },
    {
      name: 'command-invite-no-lobby',
      golden: 'command-nack--invite--no-lobby',
      kind: 'invite',
      payload: { puuid: FRIEND, summonerId: '53574489' },
      patch: '16.17',
      fixtures: [],
      lobby: null,
      expect: 'command-nack',
      note: 'No lobby open (GET lobby 404): nack no_lobby, nothing written.',
      description: 'invite with no lobby.',
    },
    {
      name: 'command-wrong-phase',
      golden: 'command-nack--switch-side--wrong-phase',
      kind: 'switch_side',
      payload: { targetSide: 200 },
      patch: '16.17',
      fixtures: [],
      lobby: null,
      phase: 'InProgress',
      expect: 'command-nack',
      note: 'The phase is InProgress: wrong_phase with the phase, no client call at all.',
      description: 'a command during a game.',
    },
    {
      name: 'command-unknown-kind',
      golden: 'command-nack--unknown-kind',
      kind: 'dodge',
      payload: {},
      patch: '16.17',
      fixtures: [],
      lobby: null,
      expect: 'command-nack',
      note: 'A kind the companion does not know: malformed_payload, not retryable.',
      description: 'a kind outside the enum.',
    },
    {
      name: 'command-malformed-payload',
      golden: 'command-nack--switch-side--malformed-payload',
      kind: 'switch_side',
      payload: { targetSide: 300 },
      patch: '16.17',
      fixtures: [],
      lobby: null,
      expect: 'command-nack',
      note: "A payload its kind's schema refuses: malformed_payload with the zod issue text (the first three issues, path: message).",
      description: 'a payload that fails its schema.',
    },
  ];
}

async function notConnectedScenario(): Promise<ScenarioResult> {
  const name = 'command-not-connected';
  const now = DEFAULT_NOW;
  const h = await startHarness({
    parts: ['commands'],
    clock: { now },
    commandPages: [
      [command('1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', 'switch_side', { targetSide: 200 }, now)],
      [],
    ],
  });
  try {
    if (h.commands === null) throw new Error(`${name}: no runner`);
    // `host.ts` starts the runner before the client connects: the first poll says clientConnected=false.
    h.commands.start();
    await h.settle();
    const [poll] = only(h.apiRequests, 'commands-poll', name);
    const [nack] = only(h.apiRequests, 'command-nack', name);
    const goldens = [
      requestGolden(poll as Captured, {
        name: 'commands-poll--disconnected',
        patch: '16.17',
        fixtures: [],
        scenario: name,
        note: 'The poll before the client is up: clientConnected=false. A GET: path and query only.',
      }),
      requestGolden(nack as Captured, {
        name: 'command-nack--not-connected',
        patch: '16.17',
        fixtures: [],
        scenario: name,
        commandKind: 'switch_side',
        note: 'A command handed out while there is no client (the real server never does this on false; it is the race of a socket dropping between poll and call): nack not_connected, retryable true, nothing recorded.',
      }),
    ];
    return summary(name, 'The runner before the client connects.', h, goldens);
  } finally {
    await h.close();
  }
}

// --- pair ----------------------------------------------------------------------------------------------------

async function pairScenario(): Promise<ScenarioResult> {
  const name = 'pair-host';
  const requests: Captured[] = [];
  const configDir = mkdtempSync(join(tmpdir(), 'kustom-goldens-pair-'));
  try {
    const outcome = await pairWithCode({
      apiBase: HARNESS_API_BASE,
      code: ' k7q-m4x ',
      configDir,
      mode: 'host',
      readPuuid: async () => ({ ok: true, puuid: ownSummoner().puuid }),
      fetch: capturingFetch(requests, () => ({
        status: 200,
        body: {
          ok: true,
          group: { id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a', slug: 'customs', name: 'Customs' },
          companionToken: GOLDEN_PAIR_TOKEN,
        },
      })),
    });
    if (!outcome.ok) throw new Error(`${name}: pairing failed: ${outcome.message}`);
    const [post] = only(requests, 'pair', name);
    const goldens = [
      requestGolden(post as Captured, {
        name: 'pair--host',
        patch: '16.17',
        fixtures: ['16.17/current-summoner'],
        scenario: name,
        note: 'The person typed " k7q-m4x ": the code is upper-cased and stripped to the alphabet, the puuid is current-summoner\'s, mode "host" (M17 always sends it). No bearer token on this route.',
      }),
    ];
    return {
      name,
      description: 'Pairing with a code from the site.',
      goldens,
      apiRoutes: requests.map(routeOf),
      lcuWrites: [],
    };
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

// --- the recorded night ----------------------------------------------------------------------------------------

async function replayScenario(): Promise<ScenarioResult> {
  const name = 'ws-replay';
  const lines = readFileSync(join(FIXTURES_DIR, '16.17', 'ws-events.ndjson'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent);
  const clock = { now: Date.parse(lines[0]?.ts ?? '2026-09-08T16:33:00.000Z') };
  // The session the client would answer with right now: the newest `/lol-gameflow/v1/session` event so far.
  let session: unknown = null;
  const h = await startHarness({
    parts: ['lobby', 'game'],
    clock,
    phase: 'Lobby',
    lcuHandle: (method, path) => {
      if (method === 'GET' && path === '/lol-gameflow/v1/session' && session !== null) {
        return { status: 200, body: session };
      }
      if (method === 'GET' && path === '/lol-lobby/v2/lobby') return LOBBY_404;
      return undefined;
    },
  });
  try {
    await h.connect();
    const requests: (GoldenRequest & { afterEvent: number })[] = [];
    let seen = h.apiRequests.length;
    for (const [index, line] of lines.entries()) {
      clock.now = Date.parse(line.ts);
      if (line.uri === '/lol-gameflow/v1/session' && line.data !== undefined && line.eventType !== 'Delete') {
        session = line.data;
      }
      if (await dispatchRecorded(h.hooks, h.context, line)) {
        await h.settle();
      }
      for (const request of h.apiRequests.slice(seen)) {
        requests.push({
          route: routeOf(request),
          method: request.method,
          path: request.path,
          body: request.body,
          afterEvent: index,
        });
      }
      seen = h.apiRequests.length;
    }
    const goldens: Golden[] = [
      {
        name: 'sequence--ws-events',
        kind: 'sequence',
        target: 'api',
        route: 'sequence',
        patch: '16.17',
        fixtures: ['16.17/ws-events', '16.17/current-summoner'],
        scenario: name,
        note: "Every line of 16.17/ws-events.ndjson routed to the lobby and game watchers in order, the injected clock set to each line's ts, the GET of /lol-gameflow/v1/session answered with the newest session event so far, settling after each event. afterEvent is the 0-based line the request followed. Two lobbies, one game TerminatedInError (in_progress posted, the no-winner block dropped), one played (in_progress, then eog with the held partyId and startedAt). Every lobby Update is posted, changed or not; the server dedupes.",
        requests,
      },
    ];
    return summary(
      name,
      'The recorded 16.17 evening, replayed through the lobby and game watchers.',
      h,
      goldens,
    );
  } finally {
    await h.close();
  }
}

export async function runScenarios(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  results.push(
    await lobbyScenario(
      'lobby',
      '16.17',
      'lobby',
      "One member on side 100, no spectator, the own name from current-summoner, lobbyPassword null (this process did not create the party). summonerId is the client's number.",
    ),
  );
  results.push(
    await lobbyScenario(
      'lobby-two-players',
      '16.17',
      'lobby--two-players',
      "Two members, one on each side (membership of customTeam100/200 by puuid, never members[].teamId). The friend's name lookup 404s: null names, and no re-post since nothing changed.",
    ),
  );
  results.push(
    await lobbyScenario(
      'lobby-spectator',
      '16.17',
      'lobby--spectator',
      'The friend in the spectator slot (from a WS payload): side null, isSpectator true.',
    ),
  );
  results.push(
    await lobbyScenario(
      'lobby-create-lobby',
      '16.18',
      'create-lobby',
      'The lobby the 16.18 create made, posted by a process that did not create it: lobbyPassword null.',
    ),
  );
  results.push(await lobbyNamesScenario());
  results.push(await gameLiveScenario());
  results.push(await gameAtConnectScenario());
  results.push(await gameStaleSessionScenario());
  results.push(await rankOwnScenario());
  results.push(await rankOtherScenario());
  results.push(await rankSocketScenario());
  results.push(await backfillScenario());
  results.push(await backfillNoCustomsScenario());
  results.push(await createLobbyScenario());
  results.push(await createLobbyNamesScenario());
  results.push(await createLobbyBlindScenario());
  for (const spec of commandCases()) {
    results.push(await commandScenario(spec));
  }
  results.push(await notConnectedScenario());
  results.push(await pairScenario());
  results.push(await replayScenario());
  return results;
}
