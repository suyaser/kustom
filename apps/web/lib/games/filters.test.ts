import { describe, expect, it } from 'vitest';
import { GAMES_WINDOW_CHIPS, gamesListHref, gamesRange, pageCount, parseGamesFilters } from './filters';

const PUUID = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const BASE = '/g/customs/games';

describe('parseGamesFilters', () => {
  it('opens on all time, Rift, everyone, page 1', () => {
    expect(parseGamesFilters({})).toEqual({
      filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
      legacy: false,
    });
  });

  it('reads every filter back from the URL, so each survives a reload', () => {
    const { filters } = parseGamesFilters({ window: 'tonight', mode: 'aram', player: PUUID, page: '3' });
    expect(filters).toEqual({ window: 'tonight', mode: 'aram', player: PUUID, page: 3 });
    expect(
      parseGamesFilters(Object.fromEntries(new URL(`http://x${gamesListHref(BASE, filters)}`).searchParams))
        .filters,
    ).toEqual(filters);
  });

  it('falls back instead of 404ing on values it does not know (05-design 5.8)', () => {
    const { filters } = parseGamesFilters({ window: 'forever', mode: 'kiwi', player: '', page: '-2' });
    expect(filters).toEqual({ window: 'all-time', mode: 'sr', player: null, page: 1 });
    expect(parseGamesFilters({ window: ['this-week', 'all-time'] }).filters.window).toBe('all-time');
    expect(parseGamesFilters({ page: '2.5' }).filters.page).toBe(1);
  });

  it('honours a pasted board window with no chip of its own', () => {
    expect(parseGamesFilters({ window: 'last-week' }).filters.window).toBe('last-week');
  });

  it('opens the retired month windows on all time, never a 404 (M14.48)', () => {
    expect(parseGamesFilters({ window: 'this-month' }).filters.window).toBe('all-time');
    expect(parseGamesFilters({ window: 'last-month' }).filters.window).toBe('all-time');
    expect(GAMES_WINDOW_CHIPS).toEqual(['tonight', 'this-week', 'all-time']);
  });

  it("reads the 1.0 page's ?p= and ?queue= and says so, for the 308", () => {
    expect(parseGamesFilters({ p: PUUID, queue: 'aram', window: 'this-week' })).toEqual({
      filters: { window: 'this-week', mode: 'aram', player: PUUID, page: 1 },
      legacy: true,
    });
    expect(parseGamesFilters({ queue: 'sr' }).legacy).toBe(true);
  });
});

describe('gamesListHref', () => {
  it('names the window always, the mode only for ARAM, the player and page only when set', () => {
    expect(gamesListHref(BASE, { window: 'all-time', mode: 'sr', player: null, page: 1 })).toBe(
      '/g/customs/games?window=all-time',
    );
    expect(gamesListHref(BASE, { window: 'this-week', mode: 'aram', player: PUUID, page: 2 })).toBe(
      `/g/customs/games?window=this-week&mode=aram&player=${PUUID}&page=2`,
    );
  });
});

describe('gamesRange', () => {
  const now = new Date('2026-06-10T18:00:00Z'); // Wednesday 21:00 Cairo
  it('is the night containing now for Tonight, 06:00 to 06:00', () => {
    const range = gamesRange('tonight', now, 'Africa/Cairo');
    expect(range.start?.toISOString()).toBe('2026-06-10T03:00:00.000Z');
    expect(range.end?.toISOString()).toBe('2026-06-11T03:00:00.000Z');
  });

  it('is the shared window otherwise', () => {
    expect(gamesRange('all-time', now, 'Africa/Cairo')).toEqual({ start: null, end: null });
    expect(gamesRange('this-week', now, 'Africa/Cairo').start?.toISOString()).toBe(
      '2026-06-07T03:00:00.000Z',
    );
  });
});

describe('pageCount', () => {
  it('is 25 a page and never 0', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(500)).toBe(20);
  });
});
