import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type WeekNotesModel, weekNotesModel } from '@/lib/og/weekNotes';
import { weekInput, weekPlayer } from '@/lib/testing/weekNotesFixtures';

/**
 * `/og/g/<slug>/week/<weekStart>` (M14.79): the 404 rules, the cache header and the PNG. The loader
 * is mocked (its reads are `weekNotesLoad`'s); the week's date rule (`weekFromParam`) is real.
 * `OG_PREVIEW_DIR=<dir>` writes the PNGs out to look at.
 */

const loadWeekNotes = vi.fn<(...args: unknown[]) => Promise<WeekNotesModel | null>>();

vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/og/weekNotesLoad', async (original) => ({
  ...(await original<typeof import('@/lib/og/weekNotesLoad')>()),
  loadWeekNotes: (...args: unknown[]) => loadWeekNotes(...args),
}));
const GROUP = { id: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
vi.mock('@/lib/groups/resolve', () => ({
  resolveGroupParam: async (_client: unknown, param: string) =>
    param === GROUP.slug ? { kind: 'group', group: GROUP } : { kind: 'none' },
}));

/** A closed week (a Sunday in Cairo). */
const WEEK = '2026-09-20';

async function call(slug: string, weekStart: string): Promise<Response> {
  const { GET } = await import('./g/[slug]/week/[weekStart]/route');
  return GET(new Request(`https://kustom.example/og/g/${slug}/week/${weekStart}`), {
    params: Promise.resolve({ slug, weekStart }),
  });
}

async function png(response: Response, name: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = process.env.OG_PREVIEW_DIR;
  if (dir) await writeFile(join(dir, `${name}.png`), bytes);
  return bytes;
}

beforeEach(() => {
  vi.stubEnv('CUSTOMS_NIGHT_TZ', 'Africa/Cairo');
  loadWeekNotes.mockReset();
});

describe('/og/g/<slug>/week/<weekStart>', () => {
  it('answers a 1920×1080 PNG, cached for a day and not immutable', async () => {
    loadWeekNotes.mockResolvedValue(weekNotesModel(weekInput()));
    const response = await call('customs', WEEK);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const cache = response.headers.get('cache-control') ?? '';
    expect(cache).toContain('s-maxage=86400');
    expect(cache).not.toContain('immutable');
    const bytes = await png(response, 'week-notes-full');
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1920, 1080]);
    expect(bytes.byteLength).toBeLessThan(600 * 1024);
    // The loader is asked for the group and the week that the path named.
    const [, group, week] = loadWeekNotes.mock.calls[0] ?? [];
    expect(group).toEqual(GROUP);
    expect((week as { key: string }).key).toBe(WEEK);
  });

  // The quietest week that still gets a picture: nobody up, no NERFS (so no KEY), plain SYSTEMS and
  // one first pick. One less and the week is nearly empty, which the loader answers null for.
  it('renders the quiet states: nobody up, no NERFS, no KEY, plain SYSTEMS, one NEW tile', async () => {
    const quiet = weekInput({
      players: [
        weekPlayer({ name: 'Lena', points: 0, games: 1, wins: 1, losses: 0 }),
        weekPlayer({ name: 'Theo', points: -12, games: 1, wins: 0, losses: 1 }),
      ],
      games: 1,
      nights: 1,
      firstNights: [],
      records: [],
      firstPicks: ['Ahri'],
      modes: [],
      fearless: null,
      awards: [],
    });
    loadWeekNotes.mockResolvedValue(weekNotesModel(quiet));
    const response = await call('customs', WEEK);
    expect(response.status).toBe(200);
    await png(response, 'week-notes-quiet');
  });

  it('is a 404 for an unknown group, without reading the week', async () => {
    expect((await call('nobody', WEEK)).status).toBe(404);
    expect(loadWeekNotes).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed date', 'last-week'],
    ['an impossible date', '2026-02-30'],
    ['a day that opens no week (a Monday)', '2026-09-21'],
    ['a week that has not closed', '2099-01-04'],
  ])('is a 404 for %s', async (_case, weekStart) => {
    expect((await call('customs', weekStart)).status).toBe(404);
    expect(loadWeekNotes).not.toHaveBeenCalled();
  });

  // The loader answers null for no counted game and for a nearly empty week (`isNearlyEmpty`).
  it('is a 404 for a week with no counted game, or nothing worth a picture', async () => {
    loadWeekNotes.mockResolvedValue(null);
    expect((await call('customs', WEEK)).status).toBe(404);
  });
});
