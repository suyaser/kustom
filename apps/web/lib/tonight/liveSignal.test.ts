import { groupLiveFilter as contractFilter } from '@customs/db/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupLiveFilter, groupLiveParser, LiveVersionGate, readGroupLive } from './liveSignal';

/** M19.10: Tonight's side of the per-group live signal. */

const GROUP = '11111111-1111-4111-8111-111111111111';
const ROW = { group_id: GROUP, version: 4, kind: 'game', changed_at: '2026-10-04T20:00:00+00:00' };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the filter and the parse', () => {
  it("restates the contract's filter exactly", () => {
    expect(groupLiveFilter(GROUP)).toBe(contractFilter(GROUP));
  });

  it('parses a row strictly: an extra column, a bad kind or a bad version is dropped', async () => {
    const parse = await groupLiveParser();
    expect(parse(ROW)).toEqual(ROW);
    expect(parse({ ...ROW, lobby_id: 'x' })).toBeNull();
    expect(parse({ ...ROW, kind: 'whatever' })).toBeNull();
    expect(parse({ ...ROW, version: -1 })).toBeNull();
    expect(parse(null)).toBeNull();
  });
});

describe('readGroupLive', () => {
  it('reads the one row with the anon key and parses it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([ROW]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readGroupLive(GROUP)).toEqual(ROW);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `http://127.0.0.1:54321/rest/v1/group_live?select=group_id,version,kind,changed_at&group_id=eq.${GROUP}`,
    );
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('is null for a failed read, no row, a row that does not parse, or another group', async () => {
    const answer = (status: number, body: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
      );
    answer(500, []);
    expect(await readGroupLive(GROUP)).toBeNull();
    answer(200, []);
    expect(await readGroupLive(GROUP)).toBeNull();
    answer(200, [{ ...ROW, extra: 1 }]);
    expect(await readGroupLive(GROUP)).toBeNull();
    answer(200, [{ ...ROW, group_id: '22222222-2222-4222-8222-222222222222' }]);
    expect(await readGroupLive(GROUP)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await readGroupLive(GROUP)).toBeNull();
  });
});

describe('LiveVersionGate', () => {
  it('moves only past the version the page has shown', () => {
    const gate = new LiveVersionGate(4);
    expect(gate.moved(4)).toBe(false);
    expect(gate.moved(3)).toBe(false);
    expect(gate.moved(5)).toBe(true);
    expect(gate.moved(5)).toBe(false);
  });

  it('an unknown render version lets the first row through; a newer render raises the floor', () => {
    const gate = new LiveVersionGate(null);
    gate.rendered(null);
    expect(gate.moved(0)).toBe(true);
    gate.rendered(9);
    expect(gate.moved(8)).toBe(false);
    gate.rendered(2);
    expect(gate.moved(9)).toBe(false);
    expect(gate.moved(10)).toBe(true);
  });
});
