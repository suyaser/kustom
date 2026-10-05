import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tonight's cached slices (performance plan, phase 2): each is tagged so its writers can drop it
 * (a game end drops the top five, the last game, the daily card and the roster inputs; a rename
 * drops everything that prints a name), keeps its uncached fallback, and leaves per-render facts
 * (is a host up right now, which week it is, who is asking) out of the cached answer.
 */

const { unstableCache, loadBoard, readHostFacts, loadLastGame, loadMysteryPage, loadMysteryOrNone, jar } =
  vi.hoisted(() => ({
    unstableCache: vi.fn(),
    loadBoard: vi.fn(),
    readHostFacts: vi.fn(),
    loadLastGame: vi.fn(),
    loadMysteryPage: vi.fn(),
    loadMysteryOrNone: vi.fn(),
    jar: { visitor: undefined as string | undefined },
  }));

vi.mock('next/cache', () => ({ unstable_cache: unstableCache, revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (jar.visitor === undefined ? undefined : { value: jar.visitor }) }),
}));
vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({}) }));
vi.mock('@/lib/board/load', () => ({ loadBoard }));
vi.mock('@/lib/hostPresence', async (original) => ({
  ...(await original<typeof import('@/lib/hostPresence')>()),
  readHostFacts,
}));
vi.mock('@/lib/tonight/lastGame', () => ({ loadLastGame }));
vi.mock('@/lib/mystery/service', async (original) => ({
  ...(await original<typeof import('@/lib/mystery/service')>()),
  loadMysteryPage,
}));
vi.mock('@/lib/mystery/load', () => ({ loadMysteryOrNone }));
vi.mock('@/lib/names/roster', () => ({
  readRosterInputs: vi.fn(async () => ({ roster: [], firsts: {}, checked: [] })),
}));
vi.mock('@/lib/groups/membership', () => ({ groupAdminNames: vi.fn(async () => ['Yasser']) }));

const cached = await import('./cached');

/** The options `unstable_cache` was given for the call whose key part is `name`. */
const optionsOf = (name: string) =>
  unstableCache.mock.calls.find((call) => (call[1] as string[])[0] === name)?.[2] as
    | { tags: string[]; revalidate: number }
    | undefined;

beforeEach(() => {
  unstableCache.mockReset();
  // A pass-through cache, so the reads underneath run and their arguments are visible.
  unstableCache.mockImplementation((read: (...args: unknown[]) => Promise<unknown>) => read);
  for (const mock of [loadBoard, readHostFacts, loadLastGame, loadMysteryPage, loadMysteryOrNone])
    mock.mockReset();
  jar.visitor = undefined;
});

describe('tags', () => {
  it('the roster inputs drop on a roster change, a game and a rename', async () => {
    await cached.cachedRosterInputs('g1');
    expect(optionsOf('tonight-roster-inputs-v1')).toEqual({
      tags: ['roster:g1', 'games:g1', 'names'],
      revalidate: 300,
    });
  });

  it('the top five and the last game drop on a game; admins on a role change; hosts on a token change', async () => {
    loadBoard.mockResolvedValue({ rows: [], fallback: null });
    loadLastGame.mockResolvedValue(null);
    readHostFacts.mockResolvedValue({ hostNames: [], lastSeen: [] });
    await cached.loadTopBoardCachedOrNone({ groupId: 'g1', window: 'this-week', timeZone: 'UTC', limit: 5 });
    await cached.loadLastGameCachedOrNone('g1');
    await cached.loadAdminNamesCachedOrNone('g1');
    await cached.loadHostPresenceCachedOrNone('g1');
    expect(optionsOf('tonight-top-board-v1')?.tags).toEqual(['games:g1', 'roster:g1', 'names']);
    expect(optionsOf('tonight-last-game-v1')?.tags).toEqual(['games:g1', 'names']);
    expect(optionsOf('tonight-admin-names-v1')?.tags).toEqual(['admins:g1', 'roster:g1', 'names']);
    expect(optionsOf('tonight-host-facts-v1')).toEqual({ tags: ['hosts:g1', 'names'], revalidate: 30 });
  });
});

describe('the top five', () => {
  it("keys on the week's start, so a new week reads a new board with nobody invalidating it", async () => {
    const keys: unknown[][] = [];
    unstableCache.mockImplementation(
      (read: (...args: unknown[]) => Promise<unknown>) =>
        async (...args: unknown[]) => {
          keys.push(args);
          return read(...args);
        },
    );
    loadBoard.mockResolvedValue({ rows: [{ puuid: 'a' }, { puuid: 'b' }], fallback: null });
    const read = (now: string) =>
      cached.loadTopBoardCachedOrNone({
        groupId: 'g1',
        window: 'this-week',
        timeZone: 'UTC',
        limit: 1,
        now: new Date(now),
      });
    expect((await read('2026-10-07T20:00:00Z')).rows).toEqual([{ puuid: 'a' }]);
    await read('2026-10-08T20:00:00Z');
    await read('2026-10-14T20:00:00Z');
    // The arguments are the cache key: two days of one week share it, the next week does not.
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[2]).not.toEqual(keys[0]);
  });

  it('a failed read is the empty rail, as before', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadBoard.mockRejectedValue(new Error('down'));
    expect(
      await cached.loadTopBoardCachedOrNone({
        groupId: 'g1',
        window: 'this-week',
        timeZone: 'UTC',
        limit: 5,
      }),
    ).toEqual({
      rows: [],
      fallback: null,
    });
    error.mockRestore();
  });
});

describe('hosts', () => {
  it('decides "recently" on every render, against the cached last-seen times', async () => {
    readHostFacts.mockResolvedValue({ hostNames: ['Omar'], lastSeen: ['2026-10-04T20:00:00Z'] });
    expect(await cached.loadHostPresenceCachedOrNone('g1', new Date('2026-10-04T20:05:00Z'))).toEqual({
      hostNames: ['Omar'],
      hostSeenRecently: true,
    });
    expect(await cached.loadHostPresenceCachedOrNone('g1', new Date('2026-10-04T20:30:00Z'))).toEqual({
      hostNames: ['Omar'],
      hostSeenRecently: false,
    });
  });

  it('a failed read is null (no line drawn)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readHostFacts.mockRejectedValue(new Error('down'));
    expect(await cached.loadHostPresenceCachedOrNone('g1')).toBeNull();
    error.mockRestore();
  });
});

describe('the daily card', () => {
  it('a visitor who has played keeps the per-visitor read; nobody else touches the cache with a cookie', async () => {
    jar.visitor = '9f1c8a52-6c2e-4f53-9d1a-2b7c3e4f5a6b';
    loadMysteryOrNone.mockResolvedValue({ kind: 'closed' });
    expect(await cached.loadMysteryCachedOrNone(new Date(), 'g1', 'UTC')).toEqual({ kind: 'closed' });
    expect(loadMysteryPage).not.toHaveBeenCalled();
  });

  it('everyone else shares the anonymous card, keyed by day, read with no visitor', async () => {
    loadMysteryPage.mockResolvedValue({ kind: 'play' });
    expect(await cached.loadMysteryCachedOrNone(new Date('2026-10-04T12:00:00Z'), 'g1', 'UTC')).toEqual({
      kind: 'play',
    });
    expect(loadMysteryPage.mock.calls[0]?.[1]).toMatchObject({
      visitorId: null,
      groupId: 'g1',
      timeZone: 'UTC',
    });
    expect(loadMysteryOrNone).not.toHaveBeenCalled();
  });
});

describe('the last game', () => {
  it('a failed read is undefined (no poster, and not the empty group)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadLastGame.mockRejectedValue(new Error('down'));
    expect(await cached.loadLastGameCachedOrNone('g1')).toBeUndefined();
    error.mockRestore();
  });
});
