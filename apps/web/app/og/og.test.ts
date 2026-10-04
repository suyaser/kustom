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
const loadGameDetail = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/og/load', async (original) => ({
  ...(await original<typeof import('@/lib/og/load')>()),
  loadGamePage: (...args: unknown[]) => loadGamePage(...args),
  loadPlayerRoles: () => loadPlayerRoles(),
}));
vi.mock('@/lib/board/load', () => ({ loadPlayerBoard: (...args: unknown[]) => loadPlayerBoard(...args) }));
vi.mock('@/lib/tonight/load', () => ({ loadTonight: (...args: unknown[]) => loadTonight(...args) }));
vi.mock('@/lib/games/detail', () => ({ loadGameDetail: (...args: unknown[]) => loadGameDetail(...args) }));
vi.mock('@/lib/viewer', () => ({
  currentViewer: async () => null,
  currentViewerState: async () => ({ kind: 'anonymous' }),
}));

/** The group pages' slug resolution (M13.9), answered from a table instead of the database. */
const GROUP = { id: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
/** A 40-character name, the longest `groupNameSchema` allows, all wide capitals (M14.42). */
const LONG_GROUP = {
  id: '00000000-0000-4000-8000-000000000040',
  slug: 'long',
  name: 'WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMMMM',
};
vi.mock('@/lib/groups/resolve', () => ({
  resolveGroupParam: async (_client: unknown, param: string) =>
    param === GROUP.slug
      ? { kind: 'group', group: GROUP }
      : param === LONG_GROUP.slug
        ? { kind: 'group', group: LONG_GROUP }
        : param === GAME_ID
          ? { kind: 'game', gameId: GAME_ID, slug: GROUP.slug }
          : { kind: 'none' },
}));
/** `/join/<code>`'s lookup (M14.42): one live code, everything else dead. */
const LIVE_CODE = 'live-code-1234';
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({}) }));
vi.mock('@/lib/groups/invites', () => ({
  groupByInviteCode: async (_client: unknown, code: string) =>
    code === LIVE_CODE ? { ...GROUP, name: 'Friday Five', slug: 'friday-five', createdBy: null } : null,
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

const allTime: Pick<BoardRow, 'puuid' | 'name' | 'rating' | 'wins' | 'losses'> = {
  puuid: 'puuid-lena',
  name: 'Lena',
  rating: 1587,
  wins: 24,
  losses: 17,
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
  loadGameDetail.mockReset();
});

/** What the rebuilt game page's metadata reads off its loader (M14.16). */
const detailFixture = {
  gameId: GAME_ID,
  winningSide: 200,
  durationLabel: '34 min',
  nightLabel: 'Tuesday 22 September',
};

describe('/og/g/<slug>/games/<gameId>', () => {
  const call = async (slug: string, gameId: string) => {
    const { GET } = await import('./g/[slug]/games/[gameId]/route');
    return GET(new Request(`${SITE}/og/g/${slug}/games/${gameId}`), {
      params: Promise.resolve({ slug, gameId }),
    });
  };

  it('answers a 1200×630 PNG under 300 KB for a stored game of the group', async () => {
    loadGamePage.mockResolvedValue(fixtureGame());
    const response = await call('customs', GAME_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = await readPng(response, 'game');
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect(bytes.byteLength).toBeLessThan(MAX_BYTES);
    // Asked inside the group: a game of another group is the loader's `null`.
    expect(loadGamePage.mock.calls[0]?.[3]).toBe(GROUP.id);
  });

  it("fits 05-design 6.14's names and a 40-character group name without cutting them (M14.42)", async () => {
    const result = workedResult();
    const names = ['Used2BeATahmMain', 'TheSHADOWREAPER', '1sec Reloading', 'MANOOOOOOOO', 'Ramzyinhović'];
    const caps = 'WMWMWMWMWMWMWMWM';
    loadGamePage.mockResolvedValue(
      fixtureGame({
        result: {
          ...result,
          blue: result.blue.map((seat, i) => ({ ...seat, name: names[i] ?? caps })),
          red: result.red.map((seat) => ({ ...seat, name: caps })),
        },
      }),
    );
    const response = await call('long', GAME_ID);
    expect(response.status).toBe(200);
    expect((await readPng(response, 'game-long-names')).byteLength).toBeLessThan(MAX_BYTES);
  });

  it('renders the ARAM card too', async () => {
    loadGamePage.mockResolvedValue(
      fixtureGame({ aram: true, result: workedResult({ rated: false, winningSide: 100 }) }),
    );
    const response = await call('customs', GAME_ID);
    expect(response.status).toBe(200);
    await readPng(response, 'game-aram');
  });

  it('404s an unknown game or one of another group, never a blank card', async () => {
    loadGamePage.mockResolvedValue(null);
    const response = await call('customs', GAME_ID);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toBe('image/png');
  });

  it('404s an unknown group without reading the game', async () => {
    const response = await call('nope', GAME_ID);
    expect(response.status).toBe(404);
    expect(loadGamePage).not.toHaveBeenCalled();
  });
});

/** M14.61, 05-design 10.11: the two Discord images, 256 × 256, on our own origin. */
describe('/og/kustom/avatar and /og/g/<slug>/games/<gameId>/badge (M14.61)', () => {
  const size = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return [view.getUint32(16), view.getUint32(20)];
  };
  const badge = async (slug: string, gameId: string) => {
    const { GET } = await import('./g/[slug]/games/[gameId]/badge/route');
    return GET(new Request(`${SITE}/og/g/${slug}/games/${gameId}/badge`), {
      params: Promise.resolve({ slug, gameId }),
    });
  };

  it('answers the avatar: a 256 × 256 PNG, cached for a year, immutable', async () => {
    const { GET } = await import('./kustom/avatar/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = await readPng(response, 'discord-avatar');
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(size(bytes)).toEqual([256, 256]);
  });

  it("answers the badge for a stored game of the group, in the game card's cache", async () => {
    loadGamePage.mockResolvedValue(fixtureGame());
    const response = await badge('customs', GAME_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    const bytes = await readPng(response, `discord-badge-${fixtureGame().result.winningSide}`);
    expect(size(bytes)).toEqual([256, 256]);
    expect(loadGamePage.mock.calls[0]?.[3]).toBe(GROUP.id);
    const blue = fixtureGame({ result: { ...workedResult(), winningSide: 100 } });
    loadGamePage.mockResolvedValue(blue);
    const blueResponse = await badge('customs', GAME_ID);
    expect(blueResponse.status).toBe(200);
    expect(size(await readPng(blueResponse, 'discord-badge-100'))).toEqual([256, 256]);
  });

  it("404s the badge of an unknown game, another group's game or an unknown group", async () => {
    loadGamePage.mockResolvedValue(null);
    expect((await badge('customs', GAME_ID)).status).toBe(404);
    loadGamePage.mockReset();
    expect((await badge('nope', GAME_ID)).status).toBe(404);
    expect(loadGamePage).not.toHaveBeenCalled();
  });
});

describe('/og/g/<gameId> (the M11.4 address)', () => {
  const call = async (segment: string) => {
    const { GET } = await import('./g/[slug]/route');
    return GET(new Request(`${SITE}/og/g/${segment}`), { params: Promise.resolve({ slug: segment }) });
  };

  it("308s to the card's group address", async () => {
    const response = await call(GAME_ID);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${SITE}/og/g/customs/games/${GAME_ID}`);
  });

  it('404s anything that is not a stored game', async () => {
    expect((await call('0b6f6d7e-0000-4a8e-9d3b-2f4e6a8c0d12')).status).toBe(404);
    expect((await call('customs')).status).toBe(404);
  });
});

describe('/og/g/[slug]/p/[puuid] (M14.15)', () => {
  const call = async (slug: string, puuid: string) => {
    const { GET } = await import('./g/[slug]/p/[puuid]/route');
    return GET(new Request(`${SITE}/og/g/${slug}/p/${puuid}?window=this-week`), {
      params: Promise.resolve({ slug, puuid }),
    });
  };

  it("reads the group's all-time board whatever the page was opened on, and answers a PNG", async () => {
    loadPlayerBoard.mockResolvedValue(allTime);
    const response = await call('customs', 'puuid-lena');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(loadPlayerBoard.mock.calls[0]?.[2]).toMatchObject({ window: 'all-time', groupId: GROUP.id });
    expect((await readPng(response, 'player')).byteLength).toBeLessThan(MAX_BYTES);
  });

  it('renders the settling chip and a long name (M14.42)', async () => {
    loadPlayerBoard.mockResolvedValue({
      ...allTime,
      name: 'Used2BeATahmMain',
      wins: 1,
      losses: 0,
      ratedGames: 1,
      settling: true,
    });
    const response = await call('long', 'puuid-lena');
    expect(response.status).toBe(200);
    expect((await readPng(response, 'player-settling')).byteLength).toBeLessThan(MAX_BYTES);
  });

  it('404s a puuid with nothing in the group, and an unknown group', async () => {
    loadPlayerBoard.mockResolvedValue(null);
    expect((await call('customs', 'nobody')).status).toBe(404);
    loadPlayerBoard.mockResolvedValue(allTime);
    expect((await call('nope', 'puuid-lena')).status).toBe(404);
  });
});

describe('the old board and player addresses (M14.15, M13.10 acceptance 3)', () => {
  it('308 to the original group, query strings carried by Next', async () => {
    const { legacyRedirects } = await import('../../next.config');
    expect(legacyRedirects).toContainEqual({
      source: '/leaderboard',
      destination: '/g/customs/leaderboard',
      permanent: true,
    });
    expect(legacyRedirects).toContainEqual({
      source: '/p/:puuid',
      destination: '/g/customs/p/:puuid',
      permanent: true,
    });
    expect(legacyRedirects).toContainEqual({
      source: '/og/p/:puuid',
      destination: '/og/g/customs/p/:puuid',
      permanent: true,
    });
    // A destination that names no query of its own gets the request's appended by Next, so
    // `/leaderboard?window=last-week` lands on `/g/customs/leaderboard?window=last-week`.
    for (const redirect of legacyRedirects) expect(redirect.destination).not.toContain('?');
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

  it('renders a finished night for a group with a 40-character name (M14.42)', async () => {
    loadTonight.mockResolvedValue(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    );
    const response = await call('long');
    expect(response.status).toBe(200);
    await readPng(response, 'tonight-result-long-group');
  });
});

describe('/og/kustom and /og/g/[slug]/join (M14.42)', () => {
  it('answers the plain Kustom card', async () => {
    const { GET } = await import('./kustom/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await readPng(response, 'kustom')).byteLength).toBeLessThan(MAX_BYTES);
  });

  it("answers a group's invite card by slug, and 404s an unknown group", async () => {
    const { GET } = await import('./g/[slug]/join/route');
    const call = (slug: string) =>
      GET(new Request(`${SITE}/og/g/${slug}/join`), { params: Promise.resolve({ slug }) });
    const response = await call('customs');
    expect(response.status).toBe(200);
    await readPng(response, 'join');
    const long = await call('long');
    expect(long.status).toBe(200);
    await readPng(long, 'join-long-group');
    expect((await call('nope')).status).toBe(404);
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
    loadGameDetail.mockResolvedValue(null);
    const { default: GamePage } = await import('../(group)/g/[slug]/games/[gameId]/page');
    await expect(GamePage({ params })).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    // The group's id goes to the loader, which answers `null` for a game outside it.
    expect(loadGameDetail.mock.calls[0]?.[1]).toMatchObject({ gameId: GAME_ID, groupId: GROUP.id });
  });

  it('emits no share card for a missing game', async () => {
    loadGameDetail.mockResolvedValue(null);
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
    const { generateMetadata } = await import('../(group)/g/[slug]/(tonight)/page');
    expectShareCard(
      await generateMetadata({ params: Promise.resolve({ slug: 'customs' }) }),
      '/og/g/customs/tonight',
    );
  });

  it('/g/[slug]/games/[gameId] points at its game card, at the group address', async () => {
    loadGameDetail.mockResolvedValue(detailFixture);
    const { generateMetadata } = await import('../(group)/g/[slug]/games/[gameId]/page');
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'customs', gameId: GAME_ID }),
    });
    expectShareCard(metadata, `/og/g/customs/games/${GAME_ID}`);
    expect(metadata.title).toBe('Red won · 34 min · Customs Night · Kustom');
  });

  it('/g/[slug]/p/[puuid] points at its group player card on any window', async () => {
    loadPlayerBoard.mockResolvedValue(allTime);
    const { generateMetadata } = await import('../(group)/g/[slug]/p/[puuid]/page');
    expectShareCard(
      await generateMetadata({
        params: Promise.resolve({ slug: 'customs', puuid: 'puuid-lena' }),
        searchParams: Promise.resolve({ window: 'this-week' }),
      }),
      '/og/g/customs/p/puuid-lena',
    );
  });
});

describe('titles and link previews (M14.42, scene-walk gap 9; quality A8)', () => {
  const params = Promise.resolve({ slug: 'customs' });
  const ogTitle = (metadata: import('next').Metadata) =>
    (metadata.openGraph as { title?: string } | undefined)?.title;
  const ogImage = (metadata: import('next').Metadata) => {
    const images = metadata.openGraph?.images;
    return (Array.isArray(images) ? images[0] : images) as { url: string } | undefined;
  };

  it('Tonight: the tab names the page and the group, the preview says whose night', async () => {
    const { generateMetadata } = await import('../(group)/g/[slug]/(tonight)/page');
    const metadata = await generateMetadata({ params });
    expect(metadata.title).toBe('Tonight · Customs Night · Kustom');
    expect(ogTitle(metadata)).toBe('Customs Night tonight · Kustom');
    expect(metadata.twitter).toMatchObject({ title: 'Customs Night tonight · Kustom' });
  });

  it('every other group page names the group in its title', async () => {
    const games = await import('../(group)/g/[slug]/games/page');
    expect((await games.generateMetadata({ params, searchParams: Promise.resolve({}) })).title).toMatch(
      / · Customs Night · Kustom$/,
    );
    const board = await import('../(group)/g/[slug]/leaderboard/page');
    expect((await board.generateMetadata({ params, searchParams: Promise.resolve({}) })).title).toMatch(
      / · Board · Customs Night · Kustom$|Customs Night · Kustom$/,
    );
    const you = await import('../(group)/g/[slug]/you/page');
    expect((await you.generateMetadata({ params })).title).toBe('You · Customs Night · Kustom');
    loadPlayerBoard.mockResolvedValue(allTime);
    const player = await import('../(group)/g/[slug]/p/[puuid]/page');
    expect(
      (
        await player.generateMetadata({
          params: Promise.resolve({ slug: 'customs', puuid: 'puuid-lena' }),
          searchParams: Promise.resolve({}),
        })
      ).title,
    ).toBe('Lena · Customs Night · Kustom');
  });

  it("every group page's description is the group's pitch", async () => {
    const { generateMetadata } = await import('../(group)/g/[slug]/layout');
    expect((await generateMetadata({ params })).description).toBe(
      'Customs Night uses Kustom to pick fair teams for your customs.',
    );
  });

  it('/ and /about: the positioning title and line, and the Kustom card', async () => {
    for (const route of [await import('../(kustom)/page'), await import('../(kustom)/about/page')]) {
      const { metadata } = route;
      expect(ogTitle(metadata)).toBe('Kustom: fair teams for your League customs');
      expect((metadata.openGraph as { description?: string }).description).toMatch(
        /^Kustom picks fair teams for your League customs/,
      );
      expect(ogImage(metadata)?.url).toBe(`${SITE}/og/kustom`);
    }
  });

  it('/join/<code>: a live code names its group, a dead one names none', async () => {
    const { generateMetadata } = await import('../join/[code]/page');
    const live = await generateMetadata({ params: Promise.resolve({ code: LIVE_CODE }) });
    expect(ogTitle(live)).toBe('Join Friday Five on Kustom');
    expect((live.openGraph as { description?: string }).description).toBe(
      'Friday Five uses Kustom to pick fair teams for your customs.',
    );
    expect(ogImage(live)?.url).toBe(`${SITE}/og/g/friday-five/join`);
    expect(ogImage(live)?.url).not.toContain(LIVE_CODE);
    expect(live.robots).toMatchObject({ index: false });

    const dead = await generateMetadata({ params: Promise.resolve({ code: 'gone-code-0000' }) });
    expect(ogImage(dead)?.url).toBe(`${SITE}/og/kustom`);
    expect(JSON.stringify(dead)).not.toMatch(/Friday Five|Customs Night/);
    expect(dead.robots).toMatchObject({ index: false });
  });
});
