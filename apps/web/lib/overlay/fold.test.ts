import { describe, expect, it } from 'vitest';
import { MIN_DUO_GAMES } from '../stats/copy';
import { puuidOf, rosterFor, statsGame } from '../testing/statsFixtures';
import { type OverlaySeatInput, overlayView, presentOverlayFearless } from './fold';

/**
 * Overlay fold (M12): with/against from headToHead, lane opponent from the posted split.
 */

function at(n: number): string {
  const day = 1 + Math.floor(n / 10);
  const hour = 10 + (n % 10);
  return `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
}

const BLUE = ['omar', 'iris', 'karim', 'bilal', 'theo'] as const;
const RED = ['hana', 'rami', 'nadia', 'lena', 'yuki'] as const;

function allyGames(n: number) {
  return Array.from({ length: n }, (_, i) =>
    statsGame({
      at: at(i),
      lcuGameId: String(1000 + i),
      blue: [...BLUE],
      red: [...RED],
      winner: 100,
    }),
  );
}

function seat(key: string, role: OverlaySeatInput['role'], side: 100 | 200, rating = 1400): OverlaySeatInput {
  return {
    puuid: puuidOf(key),
    name: key,
    role,
    rating,
    side,
  };
}

describe('overlayView', () => {
  it('returns fearless and a null lobby when none is open', () => {
    const view = overlayView({
      viewerPuuid: puuidOf('omar'),
      fearless: [{ id: 103, name: 'Ahri', role: 'mid' }],
      resetAt: '2026-09-01T00:00:00Z',
      lobby: null,
      games: [],
      players: [],
    });
    expect(view.lobby).toBeNull();
    expect(view.fearless.champions).toHaveLength(1);
    expect(view.fearless.champions[0]?.iconUrl).toContain('103.png');
  });

  it('keeps teams null until a split is posted', () => {
    const view = overlayView({
      viewerPuuid: puuidOf('omar'),
      fearless: [],
      resetAt: null,
      lobby: {
        status: 'open',
        blue: [],
        red: [],
        hasPostedTeams: false,
      },
      games: [],
      players: [],
    });
    expect(view.lobby?.teams).toBeNull();
  });

  it(`prints with/against only past ${MIN_DUO_GAMES} games together`, () => {
    const thin = allyGames(MIN_DUO_GAMES - 1);
    const thick = allyGames(MIN_DUO_GAMES);
    const players = rosterFor(thick);
    const blue = [
      seat('omar', 'top', 100),
      seat('iris', 'jungle', 100),
      seat('karim', 'mid', 100),
      seat('bilal', 'adc', 100),
      seat('theo', 'support', 100),
    ];
    const red = [
      seat('hana', 'top', 200),
      seat('rami', 'jungle', 200),
      seat('nadia', 'mid', 200),
      seat('lena', 'adc', 200),
      seat('yuki', 'support', 200),
    ];

    const under = overlayView({
      viewerPuuid: puuidOf('omar'),
      fearless: [],
      resetAt: null,
      lobby: { status: 'balanced', blue, red, hasPostedTeams: true },
      games: thin,
      players: rosterFor(thin),
    });
    const irisUnder = under.lobby?.teams?.blue.find((row) => row.puuid === puuidOf('iris'));
    expect(irisUnder?.with).toBeNull();
    expect(irisUnder?.against).toBeNull();

    const ready = overlayView({
      viewerPuuid: puuidOf('omar'),
      fearless: [],
      resetAt: null,
      lobby: { status: 'balanced', blue, red, hasPostedTeams: true },
      games: thick,
      players,
    });
    const iris = ready.lobby?.teams?.blue.find((row) => row.puuid === puuidOf('iris'));
    expect(iris?.with).toEqual({ games: MIN_DUO_GAMES, wins: MIN_DUO_GAMES, losses: 0 });
    expect(iris?.isLaneOpponent).toBe(false);

    const hana = ready.lobby?.teams?.red.find((row) => row.puuid === puuidOf('hana'));
    expect(hana?.isLaneOpponent).toBe(true);
    expect(hana?.against).toEqual({ games: MIN_DUO_GAMES, wins: MIN_DUO_GAMES, losses: 0 });
    expect(hana?.with).toBeNull();
  });

  it('marks the posted lane opponent on the other side', () => {
    const games = allyGames(1);
    const view = overlayView({
      viewerPuuid: puuidOf('omar'),
      fearless: [],
      resetAt: null,
      lobby: {
        status: 'balanced',
        blue: [seat('omar', 'top', 100)],
        red: [seat('hana', 'top', 200), seat('lena', 'adc', 200)],
        hasPostedTeams: true,
      },
      games,
      players: rosterFor(games),
    });
    expect(view.lobby?.teams?.red.find((row) => row.puuid === puuidOf('hana'))?.isLaneOpponent).toBe(true);
    expect(view.lobby?.teams?.red.find((row) => row.puuid === puuidOf('lena'))?.isLaneOpponent).toBe(false);
  });
});

describe('presentOverlayFearless', () => {
  it('orders by lane then A–Z and attaches icon urls', () => {
    const presented = presentOverlayFearless([
      { id: 99, name: 'Lux', role: 'mid' },
      { id: 103, name: 'Ahri', role: 'mid' },
      { id: 86, name: 'Garen', role: 'top' },
    ]);
    expect(presented.map((c) => c.name)).toEqual(['Garen', 'Ahri', 'Lux']);
    expect(presented[0]?.iconUrl).toContain('/86.png');
  });
});
