import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eogBody } from '@/lib/testing/fixtures';

/**
 * The eog route expires the game's group's Stats cache (`stats:<groupId>`) after the game is
 * stored and folded: on a new game, on a repeat post of a game this group already holds (which
 * may have added its draft bans), and on a backfill; never on another group's game; and still when
 * the fold throws after the game was stored. Everything around the route is stubbed: this is the
 * one line's contract, the ingest itself is the integration files'.
 */

const GROUP = '00000000-0000-4000-8000-0000000000aa';
const PUUIDS = Array.from({ length: 10 }, (_, index) => `cache-p${index}`);

const stub = vi.hoisted(() => ({
  expired: [] as [string, string][],
  ingest: null as null | (() => Promise<unknown>),
  rate: null as null | (() => Promise<unknown>),
}));

vi.mock('@/lib/cache/tags', () => ({
  expireGroupTag: (kind: string, groupId: string) => {
    stub.expired.push([kind, groupId]);
  },
  invalidateGroup: (groupId: string, kinds: readonly string[]) => {
    for (const kind of kinds) stub.expired.push([kind, groupId]);
  },
}));
vi.mock('@/lib/companionRoute', () => ({
  withCompanionAuth:
    (
      schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
      handle: (input: unknown, context: unknown) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed = schema.safeParse(await request.json());
      if (!parsed.success) return new Response('bad body', { status: 400 });
      return handle(parsed.data, {
        client: {},
        identity: { puuid: PUUIDS[0], playerId: 'player-0', groupId: GROUP },
        request,
      });
    },
}));
vi.mock('@/lib/ingest/game', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/game')>()),
  ingestEogGame: () => stub.ingest?.(),
}));
vi.mock('@/lib/ingest/rating', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/rating')>()),
  rateStoredGame: () => stub.rate?.(),
}));
vi.mock('@/lib/ingest/discord', () => ({}));
vi.mock('@/lib/ingest/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/hooks')>()),
  emitGameFinished: async () => {},
}));
vi.mock('@/lib/ingest/lobby', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/lobby')>()),
  isLobbyMemberOfGame: async () => false,
  selectActiveLobby: async () => null,
}));
vi.mock('@/lib/lobbyState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lobbyState')>()),
  moveLobbyLogged: async () => {},
  sweepIdleLobbies: async () => {},
}));
vi.mock('@/lib/mode/record', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mode/record')>()),
  applyModeRecord: async () => false,
}));
vi.mock('@/lib/ai/afterIngest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/afterIngest')>()),
  scheduleGameLine: () => {},
}));

const { POST } = await import('./route');

function stored(overrides: { created?: boolean; foreignDuplicate?: boolean; groupId?: string } = {}) {
  return async () => ({
    outcome: 'stored',
    gameId: '00000000-0000-4000-8000-0000000000c1',
    lobbyId: null,
    groupId: overrides.groupId ?? GROUP,
    created: overrides.created ?? true,
    foreignDuplicate: overrides.foreignDuplicate ?? false,
    participants: 10,
    staleLobby: null,
    modeRecord: {
      kind: 'rift',
      lock: null,
      live: false,
      row: { standing: 'normal', pending: null, rated: null },
      rowUpdatedAt: null,
      lockedAt: null,
    },
  });
}

function post(body: Record<string, unknown> = eogBody({ gameId: 7_000_001, puuids: PUUIDS })): Request {
  return new Request('http://localhost/api/companion/game', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/companion/game: the Stats cache', () => {
  beforeEach(() => {
    stub.expired = [];
    stub.rate = async () => ({ rated: true, reason: null, claimed: 10 });
  });

  it("expires the game's group on a new game", async () => {
    stub.ingest = stored({ created: true });
    expect((await POST(post())).status).toBe(200);
    expect(stub.expired).toEqual([
      ['stats', GROUP],
      ['games', GROUP],
    ]);
  });

  it('expires the group on a repeat post of its own game (ban enrichment lands on this path)', async () => {
    stub.ingest = stored({ created: false });
    stub.rate = async () => ({ rated: false, reason: 'already-rated', claimed: 0 });
    expect((await POST(post())).status).toBe(200);
    expect(stub.expired).toEqual([
      ['stats', GROUP],
      ['games', GROUP],
    ]);
  });

  it("expires the game's own group, not the token's, when they differ", async () => {
    const other = '00000000-0000-4000-8000-0000000000bb';
    stub.ingest = stored({ groupId: other });
    await POST(post());
    expect(stub.expired).toEqual([
      ['stats', other],
      ['games', other],
    ]);
  });

  it('expires the group on a backfilled game (stored, not rated)', async () => {
    stub.ingest = stored({ created: true });
    stub.rate = async () => {
      throw new Error('a backfill must not fold');
    };
    const body = { ...eogBody({ gameId: 7_000_002, puuids: PUUIDS }), source: 'backfill' };
    expect((await POST(post(body))).status).toBe(200);
    expect(stub.expired).toEqual([
      ['stats', GROUP],
      ['games', GROUP],
    ]);
  });

  it("expires nothing on another group's game (a foreign duplicate writes nothing)", async () => {
    stub.ingest = stored({ created: false, foreignDuplicate: true });
    expect((await POST(post())).status).toBe(200);
    expect(stub.expired).toEqual([]);
  });

  it('still expires the group when the fold throws after the game was stored', async () => {
    stub.ingest = stored({ created: true });
    stub.rate = async () => {
      throw new Error('fold failed');
    };
    await expect(POST(post())).rejects.toThrow('fold failed');
    expect(stub.expired).toEqual([
      ['stats', GROUP],
      ['games', GROUP],
    ]);
  });

  it('expires nothing when nothing was stored', async () => {
    stub.ingest = async () => ({ outcome: 'skipped-not-this-group', members: 2 });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const body = { ...eogBody({ gameId: 7_000_003, puuids: PUUIDS }), source: 'backfill' };
    expect((await POST(post(body))).status).toBe(200);
    expect(stub.expired).toEqual([]);
    info.mockRestore();
  });
});
