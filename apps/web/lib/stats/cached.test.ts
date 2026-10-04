import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowRange } from '../night';

/**
 * A stand-in for Next's data cache with the parts that matter here: one entry per key parts plus
 * JSON arguments, the tags and revalidate it was given, and a store that only holds JSON (Next
 * stringifies every entry).
 */
const store = new Map<string, string>();
const calls: { keyParts: string[]; tags: string[] | undefined; revalidate: number | false | undefined }[] =
  [];
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(
      fn: (...args: A) => Promise<R>,
      keyParts: string[],
      options: { tags?: string[]; revalidate?: number | false },
    ) =>
    async (...args: A): Promise<R> => {
      calls.push({ keyParts, tags: options.tags, revalidate: options.revalidate });
      const key = `${keyParts.join(',')}-${JSON.stringify(args)}`;
      const hit = store.get(key);
      if (hit !== undefined) return JSON.parse(hit) as R;
      const value = await fn(...args);
      store.set(key, JSON.stringify(value));
      return value;
    },
}));

const loadRecordsSegment = vi.fn();
const loadFunFacts = vi.fn();
const loadVersusSegment = vi.fn();
vi.mock('./load', () => ({
  loadRecordsSegment: (...args: unknown[]) => loadRecordsSegment(...args),
  loadFunFacts: (...args: unknown[]) => loadFunFacts(...args),
  loadVersusSegment: (...args: unknown[]) => loadVersusSegment(...args),
}));
vi.mock('../publicClient', () => ({ createPublicClient: () => ({ anon: true }) }));

const {
  STATS_CACHE_REVALIDATE_S,
  STATS_CACHE_VERSION,
  cachedStatsSegment,
  decodeEntry,
  encodeEntry,
  rangeOfKey,
  statsCacheKey,
} = await import('./cached');

const TZ = 'Africa/Cairo';
// A Wednesday evening in Cairo.
const WEDNESDAY = new Date('2026-09-30T18:00:00Z');

describe('statsCacheKey', () => {
  it('names the group, the segment, the window bounds, the zone and the map', () => {
    const range = windowRange('this-week', WEDNESDAY, TZ);
    expect(
      statsCacheKey({
        groupId: 'g-1',
        segment: 'records',
        window: 'this-week',
        timeZone: TZ,
        mode: 'aram',
        now: WEDNESDAY,
      }),
    ).toEqual({
      groupId: 'g-1',
      segment: 'records',
      window: 'this-week',
      start: range.start?.toISOString(),
      end: range.end?.toISOString(),
      timeZone: TZ,
      mode: 'aram',
      a: null,
      b: null,
    });
  });

  it('leaves All time open at both ends', () => {
    const key = statsCacheKey({ groupId: 'g', segment: 'champions', window: 'all-time', now: WEDNESDAY });
    expect([key.start, key.end]).toEqual([null, null]);
  });

  it('rolls over with the week on its own: same key all week, a new one the next', () => {
    const at = (now: Date) =>
      statsCacheKey({ groupId: 'g', segment: 'records', window: 'this-week', timeZone: TZ, now });
    const thursday = new Date(WEDNESDAY.getTime() + 24 * 3_600_000);
    const nextWeek = new Date(WEDNESDAY.getTime() + 7 * 24 * 3_600_000);
    expect(at(thursday)).toEqual(at(WEDNESDAY));
    expect(at(nextWeek).start).not.toBe(at(WEDNESDAY).start);
    expect(at(nextWeek).start).toBe(at(WEDNESDAY).end);
  });

  it('keys only what the segment reads: the map off 1v1, the picks off the others', () => {
    const base = {
      groupId: 'g',
      window: 'all-time' as const,
      mode: 'aram' as const,
      a: 'p-a',
      b: 'p-b',
      now: WEDNESDAY,
    };
    const versus = statsCacheKey({ ...base, segment: 'versus' });
    expect([versus.mode, versus.a, versus.b]).toEqual([null, 'p-a', 'p-b']);
    const records = statsCacheKey({ ...base, segment: 'records' });
    expect([records.mode, records.a, records.b]).toEqual(['aram', null, null]);
  });

  it('never carries anything about the viewer', () => {
    const key = statsCacheKey({ groupId: 'g', segment: 'versus', window: 'all-time', now: WEDNESDAY });
    expect(Object.keys(key).sort()).toEqual(
      ['a', 'b', 'end', 'groupId', 'mode', 'segment', 'start', 'timeZone', 'window'].sort(),
    );
  });

  it('gives the read back exactly the bounds it was keyed by', () => {
    const key = statsCacheKey({
      groupId: 'g',
      segment: 'records',
      window: 'last-week',
      timeZone: TZ,
      now: WEDNESDAY,
    });
    expect(rangeOfKey(key)).toEqual(windowRange('last-week', WEDNESDAY, TZ));
    expect(rangeOfKey({ start: null, end: null })).toEqual({ start: null, end: null });
  });
});

describe('encodeEntry', () => {
  it('round-trips the data through gzip', () => {
    const value = {
      rows: Array.from({ length: 500 }, (_, i) => ({ id: `g-${i}`, name: 'H4RDC0R33', n: i })),
    };
    const entry = encodeEntry(value);
    expect(entry.kind).toBe('gz');
    if (entry.kind !== 'gz') return;
    expect(entry.data.length).toBeLessThan(JSON.stringify(value).length / 4);
    expect(decodeEntry(entry)).toEqual(value);
  });

  it('refuses an entry too big for the data cache instead of storing it', () => {
    const entry = encodeEntry({ blob: 'x'.repeat(10_000) }, 10);
    expect(entry.kind).toBe('oversized');
  });
});

describe('cachedStatsSegment', () => {
  beforeEach(() => {
    store.clear();
    calls.length = 0;
    loadRecordsSegment.mockReset().mockResolvedValue({ stats: { n: 1 }, fun: { m: 2 } });
    loadFunFacts.mockReset().mockResolvedValue({ pools: ['a'] });
    loadVersusSegment.mockReset().mockResolvedValue({ versus: {}, stats: {}, fun: { rivals: {} } });
  });

  it("tags the entry with the group's stats tag, the safety-net revalidate and the version", async () => {
    await cachedStatsSegment(statsCacheKey({ groupId: 'g-1', segment: 'champions', window: 'all-time' }));
    expect(calls).toEqual([
      { keyParts: [STATS_CACHE_VERSION], tags: ['stats:g-1'], revalidate: STATS_CACHE_REVALIDATE_S },
    ]);
  });

  it('reads once per key and serves the second view from the cache', async () => {
    const key = statsCacheKey({ groupId: 'g-1', segment: 'records', window: 'all-time', mode: 'sr' });
    expect(await cachedStatsSegment(key)).toEqual({ stats: { n: 1 }, fun: { m: 2 } });
    expect(await cachedStatsSegment(key)).toEqual({ stats: { n: 1 }, fun: { m: 2 } });
    expect(loadRecordsSegment).toHaveBeenCalledOnce();
  });

  it('reads again for another group, map, window or pick', async () => {
    const records = { segment: 'records' as const, window: 'all-time' as const };
    await cachedStatsSegment(statsCacheKey({ ...records, groupId: 'g-1', mode: 'sr' }));
    await cachedStatsSegment(statsCacheKey({ ...records, groupId: 'g-2', mode: 'sr' }));
    await cachedStatsSegment(statsCacheKey({ ...records, groupId: 'g-1', mode: 'aram' }));
    await cachedStatsSegment(statsCacheKey({ ...records, groupId: 'g-1', mode: 'sr', window: 'this-week' }));
    expect(loadRecordsSegment).toHaveBeenCalledTimes(4);
    await cachedStatsSegment(
      statsCacheKey({ groupId: 'g-1', segment: 'versus', window: 'all-time', a: 'x' }),
    );
    await cachedStatsSegment(
      statsCacheKey({ groupId: 'g-1', segment: 'versus', window: 'all-time', a: 'y' }),
    );
    expect(loadVersusSegment).toHaveBeenCalledTimes(2);
  });

  it("hands the loader the key's group, bounds, zone and picks, with the anon client", async () => {
    const key = statsCacheKey({
      groupId: 'g-1',
      segment: 'versus',
      window: 'this-week',
      timeZone: TZ,
      a: 'p-a',
      now: WEDNESDAY,
    });
    await cachedStatsSegment(key);
    expect(loadVersusSegment).toHaveBeenCalledWith(
      { anon: true },
      {
        window: 'this-week',
        range: windowRange('this-week', WEDNESDAY, TZ),
        groupId: 'g-1',
        timeZone: TZ,
        leftPuuid: 'p-a',
      },
    );
  });

  it('serves the same shape on a miss as on a hit (both have been through JSON)', async () => {
    loadFunFacts.mockResolvedValue({ when: undefined, list: [1] });
    const key = statsCacheKey({ groupId: 'g-1', segment: 'champions', window: 'all-time' });
    const miss = await cachedStatsSegment(key);
    const hit = await cachedStatsSegment(key);
    expect(miss).toStrictEqual(hit);
    expect(miss).toStrictEqual({ list: [1] });
  });
});
