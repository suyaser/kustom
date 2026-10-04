import { gunzipSync, gzipSync } from 'node:zlib';
import { unstable_cache } from 'next/cache';
import { groupTag } from '../cache/tags';
import type { QueueKind } from '../games/queue';
import { type WindowKind, type WindowRange, windowRange } from '../night';
import { createPublicClient } from '../publicClient';
import { funForRender } from './cacheView';
import type { StatsSegment } from './copy';
import { loadFunFacts, loadRecordsSegment, loadVersusSegment } from './load';

/**
 * The three Stats segments, cached across requests per group (redesign/research/performance.md
 * 5.3). A segment is a fold over every game in the window, and it only changes when a game is
 * stored, rated or re-rated, so recomputing it for every view was the page's whole cost.
 *
 * - **Same for every viewer.** The loaders read with the anon key and nothing about the viewer
 *   enters them or the key: no cookie, no session, no service-role fact. The links (which carry
 *   `?window=`) are built at render, outside the cache.
 * - **Keyed by everything the answer depends on**: group, segment, the window's computed bounds
 *   (so `This week` rolls over on its own at the week's start; the read is handed the same bounds),
 *   the night time zone, and the segment's own picks (map for Records and Champions; the two
 *   puuids for 1v1).
 * - **Tagged `stats:<groupId>`** and expired by every writer that changes the group's games,
 *   ratings or names (`expireGroupTag`). The `revalidate` below is only the safety net for a writer
 *   that cannot reach the cache (the `rebuild-ratings` CLI) or one that was missed.
 * - **Stored gzipped, as the page prints it** (`cacheView.ts`, database performance plan finding
 *   2): the museums keep only the openings a row prints, so a 2,000-game All time view is under
 *   1 MB of JSON instead of 17.5 MB, and compresses about tenfold under Next's 2 MB entry limit. An
 *   entry that would still be too big is not cached rather than throwing, and the view computed
 *   for that miss is the one served: a segment is never computed twice for one view.
 */

/** The safety net, in seconds: a missed expiry shows old numbers for at most this long. */
export const STATS_CACHE_REVALIDATE_S = 3_600;

/** Bump when the cached shape changes, so a deploy never reads an entry the old code wrote. */
export const STATS_CACHE_VERSION = 'stats-segment-v2';

/** Under Next's 2 MB entry limit with room for the cache's own envelope. */
const MAX_ENTRY_CHARS = 1_800_000;

export interface StatsCacheKey {
  groupId: string;
  segment: StatsSegment;
  window: WindowKind;
  /** ISO instants, `null` for an open end (`All time`). */
  start: string | null;
  end: string | null;
  timeZone: string | null;
  /** Records and Champions: the map. `null` on 1v1, which is Rift by definition. */
  mode: QueueKind | null;
  /** 1v1's picks, `null` when not picked (and on the other segments). */
  a: string | null;
  b: string | null;
}

export interface StatsKeyInput {
  groupId: string;
  segment: StatsSegment;
  window: WindowKind;
  timeZone?: string | undefined;
  mode?: QueueKind | undefined;
  a?: string | undefined;
  b?: string | undefined;
  /** Injected in tests; `new Date()` otherwise. */
  now?: Date;
}

/** The cache key for one segment view, with only the fields that segment reads filled in. */
export function statsCacheKey<S extends StatsSegment>(
  input: StatsKeyInput & { segment: S },
): StatsCacheKey & { segment: S } {
  const range = windowRange(input.window, input.now ?? new Date(), input.timeZone);
  const versus = input.segment === 'versus';
  return {
    groupId: input.groupId,
    segment: input.segment,
    window: input.window,
    start: range.start?.toISOString() ?? null,
    end: range.end?.toISOString() ?? null,
    timeZone: input.timeZone ?? null,
    mode: versus ? null : (input.mode ?? null),
    a: versus ? (input.a ?? null) : null,
    b: versus ? (input.b ?? null) : null,
  };
}

export type RecordsData = Awaited<ReturnType<typeof loadRecordsSegment>>;
export type ChampionsData = Awaited<ReturnType<typeof loadFunFacts>>;
export type VersusData = Awaited<ReturnType<typeof loadVersusSegment>>;

interface SegmentData {
  records: RecordsData;
  champions: ChampionsData;
  versus: VersusData;
}

/** The key's window bounds back as the `WindowRange` the read takes. */
export function rangeOfKey(key: Pick<StatsCacheKey, 'start' | 'end'>): WindowRange {
  return {
    start: key.start === null ? null : new Date(key.start),
    end: key.end === null ? null : new Date(key.end),
  };
}

/**
 * One segment's data, computed from the key alone (nothing else may change the answer), trimmed to
 * what the page prints (`funForRender`).
 */
export async function computeSegment(key: StatsCacheKey): Promise<SegmentData[StatsSegment]> {
  const client = createPublicClient();
  const options = {
    window: key.window,
    range: rangeOfKey(key),
    groupId: key.groupId,
    ...(key.timeZone === null ? {} : { timeZone: key.timeZone }),
  };
  if (key.segment === 'records') {
    const records = await loadRecordsSegment(client, { ...options, queue: key.mode ?? undefined });
    return { ...records, fun: funForRender(records.fun) };
  }
  if (key.segment === 'champions')
    return funForRender(await loadFunFacts(client, { ...options, queue: key.mode ?? undefined }));
  return loadVersusSegment(client, {
    ...options,
    ...(key.a === null ? {} : { leftPuuid: key.a }),
    ...(key.b === null ? {} : { rightPuuid: key.b }),
  });
}

/** What the cache stores: the data gzipped, or a note that it was too big to store. */
export type CacheEntry = { kind: 'gz'; data: string } | { kind: 'oversized'; chars: number };

export function encodeEntry(value: unknown, limit: number = MAX_ENTRY_CHARS): CacheEntry {
  const data = gzipSync(JSON.stringify(value)).toString('base64');
  return data.length > limit ? { kind: 'oversized', chars: data.length } : { kind: 'gz', data };
}

export function decodeEntry<T>(entry: Extract<CacheEntry, { kind: 'gz' }>): T {
  return JSON.parse(gunzipSync(Buffer.from(entry.data, 'base64')).toString('utf8')) as T;
}

/**
 * A view computed by a miss whose entry was too big to store, handed back to the call that missed
 * so it is not computed a second time. Keyed by the cache key; taken out as soon as it is read.
 */
const oversizedViews = new Map<string, SegmentData[StatsSegment]>();

async function cachedEntry(key: StatsCacheKey): Promise<CacheEntry> {
  const data = await computeSegment(key);
  const entry = encodeEntry(data);
  if (entry.kind === 'oversized') oversizedViews.set(JSON.stringify(key), data);
  return entry;
}

/**
 * One segment's data: from the group's cache when it is there, computed (and stored) when not.
 * The cached function's key is {@link STATS_CACHE_VERSION} plus the whole {@link StatsCacheKey}.
 */
export async function cachedStatsSegment<S extends StatsSegment>(
  key: StatsCacheKey & { segment: S },
): Promise<SegmentData[S]> {
  const entry = await unstable_cache(cachedEntry, [STATS_CACHE_VERSION], {
    tags: [groupTag('stats', key.groupId)],
    revalidate: STATS_CACHE_REVALIDATE_S,
  })(key);
  if (entry.kind === 'gz') return decodeEntry<SegmentData[S]>(entry);
  console.warn(`stats cache: ${key.segment} for ${key.groupId} is too big to cache (${entry.chars} chars)`);
  // This call's miss computed it already; only a stored `oversized` marker (an earlier miss) means
  // computing here, once. Through JSON either way, so a miss serves what a hit would.
  const id = JSON.stringify(key);
  const fresh = oversizedViews.get(id);
  oversizedViews.delete(id);
  const data = fresh ?? (await computeSegment(key));
  return JSON.parse(JSON.stringify(data)) as SegmentData[S];
}
