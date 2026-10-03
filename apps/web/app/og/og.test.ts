import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardRow } from '@/lib/board/types';
import type { GamePageView } from '@/lib/og/load';
import { lobbyView, snapshot, workedResult, workedTeams } from '@/lib/testing/tonightFixtures';

/**
 * The three share-card routes and the pages that point at them (M11.4; scoped to a group by M13.9). The loaders are mocked:
 * what is under test is the 404 rule, the PNG itself and the metadata, not the queries.
 */

const loadGamePage = vi.fn<(...args: unknown[]) => Promise<GamePageView | null>>();
const loadPlayerRoles = vi.fn(async () => ({ main: 'mid' as const, backup: 'support' as const }));
const loadPlayerBoard = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const loadTonight = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/og/load', async (original) => ({
  ...(await original<typeof import('@/lib/og/load')>()),
  loadGamePage: (...args: unknown[]) => loadGamePage(...args),
  loadPlayerRoles: () => loadPlayerRoles(),
}));
vi.mock('@/lib/board/load', () => ({ loadPlayerBoard: (...args: unknown[]) => loadPlayerBoard(...args) }));
vi.mock('@/lib/tonight/load', () => ({ loadTonight: (...args: unknown[]) => loadTonight(...args) }));
vi.mock('@/lib/viewer', () => ({ currentViewer: async () => null }));

/** The group pages' slug resolution (M13.9), answered from a table instead of the database. */
const GROUP = { id: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
vi.mock('@/lib/groups/resolve', () => ({
  resolveGroupParam: async (_client: unknown, param: string) =>
    param === GROUP.slug ? { kind: 'group', group: GROUP } : { kind: 'none' },
}));
vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: async () => GROUP }));

const GAME_ID = '0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12';
const SITE = 'https://kustom.example';

const fixtureGame = (overrides: Partial<GamePageView> = {}): GamePageView => ({
  gameId: GAME_ID,
  nightLabel: 'Tuesday 22 September',
  aram: false,
  result: workedResult(),
  explanation: 'Blue favored 46%.',
  ...overrides,
});

const allTime: Pick<BoardRow, 'puuid' | 'name' | 'proven' | 'rating'> = {
  puuid: 'puuid-lena',
  name: 'Lena',
  proven: 1418,
  rating: 1587,
};

/** `OG_PREVIEW_DIR=... pnpm vitest run app/og` writes the PNGs out to look at. */
async function readPng(response: Response, name: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = process.env.OG_PREVIEW_DIR;
  if (dir) await writeFile(join(dir, `${name}.png`), bytes);
  return bytes;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const MAX_BYTES = 300 * 1024;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);
  loadGamePage.mockReset();
  loadPlayerBoard.mockReset();
  loadTonight.mockReset();
});

describe('/og/g/<gameId>', () => {
  const call = async (gameId: string) => {
    const { GET } = await import('./g/[slug]/route');
    return GET(new Request(`${SITE}/og/g/${gameId}`), { params: Promise.resolve({ slug: gameId }) });
  };

  it('answers a 1200×630 PNG under 300 KB for a stored game', async () => {
    loadGamePage.mockResolvedValue(fixtureGame());
    const response = await call(GAME_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = await readPng(response, 'game');
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect(bytes.byteLength).toBeLessThan(MAX_BYTES);
  });

  it('renders the ARAM card too', async () => {
    loadGamePage.mockResolvedValue(
      fixtureGame({ aram: true, result: workedResult({ rated: false, winningSide: 100 }) }),
    );
    const response = await call(GAME_ID);
    expect(response.status).toBe(200);
    await readPng(response, 'game-aram');
  });

  it('404s an unknown game, never a blank card', async () => {
    loadGamePage.mockResolvedValue(null);
    const response = await call(GAME_ID);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toBe('image/png');
  });
});

describe('/og/p/[puuid]', () => {
  const call = async (puuid: string) => {
    const { GET } = await import('./p/[puuid]/route');
    return GET(new Request(`${SITE}/og/p/${puuid}?window=this-week`), { params: Promise.resolve({ puuid }) });
  };

  it('reads the all-time board whatever the page was opened on, and answers a PNG', async () => {
    loadPlayerBoard.mockResolvedValue(allTime);
    const response = await call('puuid-lena');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(loadPlayerBoard.mock.calls[0]?.[2]).toMatchObject({ window: 'all-time' });
    expect((await readPng(response, 'player')).byteLength).toBeLessThan(MAX_BYTES);
  });

  it('404s a puuid nobody knows', async () => {
    loadPlayerBoard.mockResolvedValue(null);
    expect((await call('nobody')).status).toBe(404);
  });
});

describe('/og/g/[slug]/tonight', () => {
  const call = async (slug: string) => {
    const { GET } = await import('./g/[slug]/tonight/route');
    return GET(new Request(`${SITE}/og/g/${slug}/tonight`), { params: Promise.resolve({ slug }) });
  };

  it.each([
    ['tonight-idle', snapshot(null)],
    ['tonight-filling', snapshot(lobbyView({ status: 'open' }))],
    [
      'tonight-result',
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    ],
  ])('answers a PNG for %s', async (name, fixture) => {
    loadTonight.mockResolvedValue(fixture);
    const response = await call('customs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await readPng(response, name)).byteLength).toBeLessThan(MAX_BYTES);
    // The group's night, never every group's.
    expect(loadTonight.mock.calls[0]?.[1]).toMatchObject({ groupId: GROUP.id });
  });

  it("404s an unknown group, never another group's night", async () => {
    const response = await call('nope');
    expect(response.status).toBe(404);
    expect(loadTonight).not.toHaveBeenCalled();
  });
});

describe('/og/tonight', () => {
  it("308s to the original group's card, permanently", async () => {
    const { legacyRedirects } = await import('../../next.config');
    expect(legacyRedirects).toContainEqual({
      source: '/og/tonight',
      destination: '/og/g/customs/tonight',
      permanent: true,
    });
  });
});

describe('/g/[slug]/games/[gameId]', () => {
  const params = Promise.resolve({ slug: 'customs', gameId: GAME_ID });

  it('404s a missing game, or one of another group', async () => {
    loadGamePage.mockResolvedValue(null);
    const { default: GamePage } = await import('../(group)/g/[slug]/games/[gameId]/page');
    await expect(GamePage({ params })).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    // The group's id goes to the loader, which answers `null` for a game outside it.
    expect(loadGamePage.mock.calls[0]?.[3]).toBe(GROUP.id);
  });

  it('emits no share card for a missing game', async () => {
    loadGamePage.mockResolvedValue(null);
    const { generateMetadata } = await import('../(group)/g/[slug]/games/[gameId]/page');
    const metadata = await generateMetadata({ params });
    expect(metadata.openGraph).toBeUndefined();
  });
});

describe('share metadata', () => {
  const expectShareCard = (metadata: import('next').Metadata, path: string) => {
    const images = metadata.openGraph?.images;
    const image = Array.isArray(images) ? images[0] : images;
    expect(image).toMatchObject({ url: `${SITE}${path}`, width: 1200, height: 630 });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  };

  it("/g/[slug] points at its group's tonight card", async () => {
    const { generateMetadata } = await import('../(group)/g/[slug]/page');
    expectShareCard(
      await generateMetadata({ params: Promise.resolve({ slug: 'customs' }) }),
      '/og/g/customs/tonight',
    );
  });

  it('/g/[slug]/games/[gameId] points at its game card', async () => {
    loadGamePage.mockResolvedValue(fixtureGame());
    const { generateMetadata } = await import('../(group)/g/[slug]/games/[gameId]/page');
    expectShareCard(
      await generateMetadata({ params: Promise.resolve({ slug: 'customs', gameId: GAME_ID }) }),
      `/og/g/${GAME_ID}`,
    );
  });

  it('/p/[puuid] points at its player card on any window', async () => {
    loadPlayerBoard.mockResolvedValue(allTime);
    const { generateMetadata } = await import('../(site)/p/[puuid]/page');
    expectShareCard(
      await generateMetadata({
        params: Promise.resolve({ puuid: 'puuid-lena' }),
        searchParams: Promise.resolve({ window: 'this-week' }),
      }),
      '/og/p/puuid-lena',
    );
  });
});
