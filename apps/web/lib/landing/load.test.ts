import type { Assignment, Role } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import { roundedCount } from './format';
import {
  type ChosenSplitRow,
  type DemoGameRow,
  demoCalibration,
  type LandingSource,
  loadLanding,
  type PlayerRow,
  qualifyingGames,
  type SeatRow,
} from './load';

/**
 * M14.24 acceptance 2 and 3: the hero receipt reads the demo group's latest rolled game and falls
 * back to the worked example without one; the counters are hidden when their read fails.
 */

const ROLES: Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const team = (prefix: string): Assignment[] => ROLES.map((role, i) => ({ puuid: `${prefix}${i}`, role }));
const BLUE = team('b');
const RED = team('r');

const PLAYERS: PlayerRow[] = [...BLUE, ...RED].map((seat) => ({
  id: `id-${seat.puuid}`,
  puuid: seat.puuid,
  name: `Name ${seat.puuid}`,
}));

function seatsFor(gameId: string, options: { swap?: boolean; rated?: boolean } = {}): SeatRow[] {
  const blue = options.swap ? [RED[0], ...BLUE.slice(1)] : BLUE;
  const red = options.swap ? [BLUE[0], ...RED.slice(1)] : RED;
  return [
    ...blue.map((seat) => ({
      gameId,
      playerId: `id-${seat?.puuid}`,
      side: 100,
      rated: options.rated ?? true,
    })),
    ...red.map((seat) => ({
      gameId,
      playerId: `id-${seat?.puuid}`,
      side: 200,
      rated: options.rated ?? true,
    })),
  ];
}

const game = (id: string, over: Partial<DemoGameRow> = {}): DemoGameRow => ({
  id,
  lobbyId: `lobby-${id}`,
  startedAt: '2026-10-02T20:00:00Z',
  winningSide: 100,
  mode: 'CLASSIC',
  ...over,
});

const split = (lobbyId: string, blueWinProb = 0.54): ChosenSplitRow => ({
  lobbyId,
  createdAt: '2026-10-02T19:55:00Z',
  blueWinProb,
  blue: BLUE,
  red: RED,
});

const RUN: StoredSplit[] = [
  {
    rank: 1,
    isChosen: true,
    blueWinProb: 0.54,
    gap: 40,
    offRoleCount: 0,
    blue: BLUE,
    red: RED,
    explanation: 'x',
  },
];

function fakeSource(over: Partial<LandingSource> = {}): LandingSource {
  return {
    group: async () => ({ id: 'g1', slug: 'customs', name: 'Customs Night' }),
    games: async () => [
      game('new', { startedAt: '2026-10-02T20:00:00Z' }),
      game('old', { startedAt: '2026-09-30T20:00:00Z' }),
    ],
    chosenSplits: async (ids) => ids.map((id) => split(id)),
    seats: async (ids) => ids.flatMap((id) => seatsFor(id)),
    players: async () => PLAYERS,
    run: async () => RUN,
    totals: async () => ({ games: 487, players: 23 }),
    ...over,
  };
}

describe('the landing data', () => {
  it("shows the demo group's newest rolled game, with names, winner and date", async () => {
    const data = await loadLanding(fakeSource(), 'customs');
    expect(data.demo?.name).toBe('Customs Night');
    expect(data.demoGames).toBe(2);
    expect(data.hero).toMatchObject({
      kind: 'live',
      gameId: 'new',
      winner: 100,
      startedAt: '2026-10-02T20:00:00Z',
    });
    if (data.hero.kind !== 'live') throw new Error('expected live');
    expect(data.hero.splits).toBe(RUN);
    expect(data.hero.names.b0).toBe('Name b0');
  });

  it('falls back to the worked example when the demo group has no rolled game', async () => {
    const data = await loadLanding(fakeSource({ chosenSplits: async () => [] }), 'customs');
    expect(data.hero).toEqual({ kind: 'example' });
    expect(data.demoGames).toBe(2);
  });

  it('falls back when the demo group is missing or its reads fail, and still shows the counters', async () => {
    const missing = await loadLanding(fakeSource({ group: async () => null }), 'customs');
    expect(missing.hero).toEqual({ kind: 'example' });
    expect(missing.demo).toBeNull();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = await loadLanding(
      fakeSource({
        seats: async () => {
          throw new Error('boom');
        },
      }),
      'customs',
    );
    expect(broken.hero).toEqual({ kind: 'example' });
    expect(broken.demo?.slug).toBe('customs');
    expect(broken.counters).toEqual({ games: 487, players: 23 });
  });

  it('hides the counters when their read fails, or either count is zero', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await loadLanding(
      fakeSource({
        totals: async () => {
          throw new Error('down');
        },
      }),
      'customs',
    );
    expect(failed.counters).toBeNull();
    expect(failed.hero.kind).toBe('live');

    expect(
      (await loadLanding(fakeSource({ totals: async () => ({ games: 0, players: 4 }) }), 'customs')).counters,
    ).toBeNull();
    expect(
      (await loadLanding(fakeSource({ totals: async () => ({ games: 9, players: 0 }) }), 'customs')).counters,
    ).toBeNull();
  });

  it('skips a game whose teams changed after the roll, ARAM, and a game with no lobby', () => {
    const games = [
      game('swapped'),
      game('aram', { mode: 'ARAM' }),
      game('nolobby', { lobbyId: null }),
      game('good'),
    ];
    const splits = games.flatMap((g) => (g.lobbyId === null ? [] : [split(g.lobbyId)]));
    const seats = [
      ...seatsFor('swapped', { swap: true }),
      ...seatsFor('aram'),
      ...seatsFor('nolobby'),
      ...seatsFor('good'),
    ];
    expect(qualifyingGames(games, splits, seats, PLAYERS).map((q) => q.game.id)).toEqual(['good']);
  });
});

describe("the demo group's calibration line", () => {
  const qualifying = (n: number, rated = true) =>
    qualifyingGames(
      Array.from({ length: n }, (_, i) => game(`g${i}`, { winningSide: i % 3 === 0 ? 200 : 100 })),
      Array.from({ length: n }, (_, i) => split(`lobby-g${i}`, 0.56)),
      Array.from({ length: n }, (_, i) => seatsFor(`g${i}`, { rated })).flat(),
      PLAYERS,
    );

  it('is hidden under 20 rated games', () => {
    expect(demoCalibration(qualifying(19))).toBeNull();
    expect(demoCalibration(qualifying(25, false))).toBeNull();
  });

  it("is core's calibration from 20", () => {
    const result = demoCalibration(qualifying(21));
    expect(result).toEqual({ n: 21, favoredWon: 14, actualPct: 67, expectedPct: 56 });
  });
});

describe('a live count', () => {
  it('rounds down, never shows zero, and is exact under ten', () => {
    expect(roundedCount(0)).toBeNull();
    expect(roundedCount(null)).toBeNull();
    expect(roundedCount(Number.NaN)).toBeNull();
    expect(roundedCount(7)).toBe('7');
    expect(roundedCount(10)).toBe('10+');
    expect(roundedCount(487)).toBe('480+');
    expect(roundedCount(1234)).toBe('1,230+');
  });
});
