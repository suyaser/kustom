import { describe, expect, it } from 'vitest';
import { legacyRedirects } from '../../next.config';
import {
  modeHref,
  parseStatsParams,
  segmentHref,
  showAllHref,
  showFewerHref,
  stateHref,
  windowHref,
} from './segment';

const BASE = '/g/customs/stats';

describe('parseStatsParams', () => {
  it('opens every segment on the one default window, All time (M14.42)', () => {
    expect(parseStatsParams('records', {}).window).toBe('all-time');
    expect(parseStatsParams('champions', {}).window).toBe('all-time');
    expect(parseStatsParams('versus', {}).window).toBe('all-time');
  });

  it('falls back on an unknown window or list instead of 404ing', () => {
    const state = parseStatsParams('records', { window: 'forever', all: '../x', mode: 'kiwi' });
    expect(state).toMatchObject({ window: 'all-time', all: null, mode: 'sr' });
  });

  it.each(['records', 'champions', 'versus'] as const)(
    'opens %s on its default for the retired month windows, never a 404 (M14.48)',
    (segment) => {
      expect(parseStatsParams(segment, { window: 'this-month' }).window).toBe('all-time');
      expect(parseStatsParams(segment, { window: 'last-month' }).window).toBe('all-time');
    },
  );

  it("reads /fun's ?queue=aram as the mode, and never gives 1v1 a mode", () => {
    expect(parseStatsParams('records', { queue: 'aram' }).mode).toBe('aram');
    expect(parseStatsParams('champions', { mode: 'aram' }).mode).toBe('aram');
    expect(parseStatsParams('versus', { mode: 'aram' }).mode).toBe('sr');
  });

  it('opens Pick two filled from ?a=&b=, and drops a malformed pick', () => {
    expect(parseStatsParams('versus', { a: 'u-lena', b: 'u-omar' })).toMatchObject({
      a: 'u-lena',
      b: 'u-omar',
    });
    expect(parseStatsParams('versus', { a: ['x', 'y'] }).a).toBeUndefined();
    expect(parseStatsParams('records', { a: 'u-lena' }).a).toBeUndefined();
  });
});

describe('the segment links (M14.17 acceptance 12)', () => {
  it('carry a window the URL named across a segment switch', () => {
    const state = parseStatsParams('records', { window: 'last-week' });
    expect(segmentHref(BASE, state, 'champions')).toBe('/g/customs/stats/champions?window=last-week');
    expect(segmentHref(BASE, state, 'versus')).toBe('/g/customs/stats/1v1?window=last-week');
    // And back: the window survives the round trip.
    const versus = parseStatsParams('versus', { window: 'last-week' });
    expect(
      parseStatsParams(
        'records',
        Object.fromEntries(new URL(`http://x${segmentHref(BASE, versus, 'records')}`).searchParams),
      ).window,
    ).toBe('last-week');
  });

  it('name the window even when it was the default, so a switch never changes it (M14.42)', () => {
    const state = parseStatsParams('records', {});
    expect(segmentHref(BASE, state, 'versus')).toBe('/g/customs/stats/1v1?window=all-time');
    expect(segmentHref(BASE, state, 'champions')).toBe('/g/customs/stats/champions?window=all-time');
  });

  it('carry ARAM between Records and Champions, never into 1v1', () => {
    const state = parseStatsParams('records', { mode: 'aram' });
    expect(segmentHref(BASE, state, 'champions')).toBe(
      '/g/customs/stats/champions?window=all-time&mode=aram',
    );
    expect(segmentHref(BASE, state, 'versus')).toBe('/g/customs/stats/1v1?window=all-time');
  });

  it('keep the pick and the mode on a window chip, and drop ?all=', () => {
    const versus = parseStatsParams('versus', { a: 'u-lena', b: 'u-omar', all: 'nemesis' });
    expect(windowHref(BASE, versus, 'this-week')).toBe(
      '/g/customs/stats/1v1?window=this-week&a=u-lena&b=u-omar',
    );
    const records = parseStatsParams('records', { mode: 'aram', all: 'odds' });
    expect(modeHref(BASE, records, 'sr')).toBe('/g/customs/stats?window=all-time');
    expect(stateHref(BASE, records)).toBe('/g/customs/stats?window=all-time&mode=aram&all=odds');
  });

  it('open one list uncapped and back, anchored to it', () => {
    const state = parseStatsParams('champions', {});
    expect(showAllHref(BASE, state, 'picked')).toBe(
      '/g/customs/stats/champions?window=all-time&all=picked#picked',
    );
    expect(showFewerHref(BASE, state, 'picked')).toBe('/g/customs/stats/champions?window=all-time#picked');
  });
});

describe('the redirects (M14.17 acceptance 10)', () => {
  it.each([
    ['/stats', '/g/customs/stats'],
    ['/fun', '/g/customs/stats'],
    ['/1v1', '/g/customs/stats/1v1'],
    ['/mystery', '/g/customs/mystery'],
    ['/g/:slug/fun', '/g/:slug/stats'],
    ['/g/:slug/1v1', '/g/:slug/stats/1v1'],
  ])('308s %s to %s, query carried', (source, destination) => {
    expect(legacyRedirects).toContainEqual({ source, destination, permanent: true });
  });
});
