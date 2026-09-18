import { describe, expect, it } from 'vitest';
import { puuidOf, rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import { versusQuery, versusView } from './view';

const RANGE = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

describe('versusView', () => {
  it('is empty when the window holds no counted game', () => {
    const view = versusView({
      window: 'this-week',
      games: [],
      players: [],
      range: RANGE,
      capped: false,
      cap: 2_000,
    });
    expect(view.range).toBeNull();
    expect(view.games).toBe(0);
    expect(view.lanes.every((board) => board.entries.length === 0)).toBe(true);
  });

  it('keeps the two picks on a window tap', () => {
    expect(versusQuery(puuidOf('omar'), puuidOf('ahmed'))).toEqual({ a: 'u-omar', b: 'u-ahmed' });
    expect(versusQuery(undefined, puuidOf('ahmed'))).toEqual({ b: 'u-ahmed' });
    expect(versusQuery()).toEqual({});
  });

  it('assembles a ready pick from two puuids on the roster', () => {
    const games = [
      tenPlayerGame({ at: '2026-09-01T19:00:00Z', winner: 100, blue: ['omar:top'], red: ['ahmed:top'] }),
    ];
    const view = versusView({
      window: 'all-time',
      games,
      players: rosterFor(games),
      range: RANGE,
      capped: false,
      cap: 2_000,
      leftPuuid: puuidOf('omar'),
      rightPuuid: puuidOf('ahmed'),
    });
    expect(view.pick.kind).toBe('ready');
    if (view.pick.kind !== 'ready') return;
    expect(view.pick.series.aWins).toBe(1);
    expect(view.roster.map((player) => player.puuid)).toContain('u-omar');
  });
});
