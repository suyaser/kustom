import { STATS_WINDOW, windowOrDefault } from '../board/window';
import type { QueueKind } from '../games/queue';
import type { WindowKind } from '../night';
import { parsePlayerParam } from '../versus/query';
import type { StatsSegment } from './copy';

/**
 * The Stats tab's URL state (M14.17), pure: the page parses, the view writes links back with the
 * builders below, and nothing else holds state, so every control is a link that survives a reload.
 *
 * - `?window=`: the shared window. **One default for all three segments** (`STATS_WINDOW`, `All
 *   time`, M14.42), and every segment link names the window it was on, so a switch never changes
 *   it. Unknown values fall back (05-design 5.8).
 * - `?mode=aram` on Records and Champions (`/fun`'s old `?queue=aram` is read too).
 * - `?a=&b=` on 1v1: Pick two, opened filled.
 * - `?all=<list>`: that one list uncapped.
 */

export const SEGMENT_DEFAULT_WINDOW: Readonly<Record<StatsSegment, WindowKind>> = {
  records: STATS_WINDOW,
  champions: STATS_WINDOW,
  versus: STATS_WINDOW,
};

export interface StatsUrlState {
  segment: StatsSegment;
  window: WindowKind;
  mode: QueueKind;
  a: string | undefined;
  b: string | undefined;
  all: string | null;
}

export type StatsSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const LIST_ID = /^[a-z0-9-]{1,40}$/;

export function parseStatsParams(segment: StatsSegment, params: StatsSearchParams): StatsUrlState {
  const mode = single(params.mode) ?? single(params.queue);
  const all = single(params.all);
  const a = segment === 'versus' ? parsePlayerParam(params.a) : undefined;
  const b = segment === 'versus' ? parsePlayerParam(params.b) : undefined;
  return {
    segment,
    window: windowOrDefault(params.window, SEGMENT_DEFAULT_WINDOW[segment]),
    mode: segment !== 'versus' && mode === 'aram' ? 'aram' : 'sr',
    // A malformed pick is no pick, never a 404.
    a: a ?? undefined,
    b: b ?? undefined,
    all: all !== undefined && LIST_ID.test(all) ? all : null,
  };
}

/** `/g/<slug>/stats`, `/stats/champions`, `/stats/1v1`. */
export function segmentPath(base: string, segment: StatsSegment): string {
  if (segment === 'records') return base;
  return `${base}/${segment === 'champions' ? 'champions' : '1v1'}`;
}

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, value);
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

/** The current segment's own URL, with `extra` changed. `?all=` only when given. */
export function stateHref(base: string, state: StatsUrlState, extra: Partial<StatsUrlState> = {}): string {
  const next = { ...state, ...extra };
  return withQuery(segmentPath(base, next.segment), {
    window: next.window,
    mode: next.segment !== 'versus' && next.mode === 'aram' ? 'aram' : undefined,
    a: next.segment === 'versus' ? next.a : undefined,
    b: next.segment === 'versus' ? next.b : undefined,
    all: next.all ?? undefined,
  });
}

/**
 * A segment's link from here: always the window it is on (M14.42, scene-walk gap 13: `?window=`
 * travels with every Stats link), the mode between Records and Champions.
 */
export function segmentHref(base: string, state: StatsUrlState, target: StatsSegment): string {
  return withQuery(segmentPath(base, target), {
    window: state.window,
    mode: target !== 'versus' && state.segment !== 'versus' && state.mode === 'aram' ? 'aram' : undefined,
  });
}

/** A window chip: this segment, that window, the mode and the pick kept, `?all=` dropped. */
export function windowHref(base: string, state: StatsUrlState, window: WindowKind): string {
  return stateHref(base, state, { window, all: null });
}

export function modeHref(base: string, state: StatsUrlState, mode: QueueKind): string {
  return stateHref(base, state, { mode, all: null });
}

/** `Show all`: the list uncapped, scrolled back to it. */
export function showAllHref(base: string, state: StatsUrlState, listId: string): string {
  return `${stateHref(base, state, { all: listId })}#${listId}`;
}

export function showFewerHref(base: string, state: StatsUrlState, listId: string): string {
  return `${stateHref(base, state, { all: null })}#${listId}`;
}
