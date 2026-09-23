import { describe, expect, it } from 'vitest';
import { nightClock } from '../night';
import {
  FIXTURE_NIGHT_START,
  lobbyView,
  snapshot,
  workedResult,
  workedTeams,
} from '../testing/tonightFixtures';
import { assembleTape, drawnLobbyId, pickTapeLobbies, type TapeLobbyRow, type TapeSource } from './load';
import { tonightState } from './state';
import type { LobbyView } from './types';

/**
 * The night tape's half of the loader (M11.2), from rows shaped as the anon queries return
 * them. Which lobbies, in which order, and what each row carries.
 */

const CLOCK = nightClock(new Date(FIXTURE_NIGHT_START), 'Africa/Cairo');

const lobby = (id: string, status: TapeLobbyRow['status'], at: string): TapeLobbyRow => ({
  id,
  status,
  created_at: at,
});

/** 20:10, 21:40 and 22:41 Cairo on the fixture night. */
const G1 = lobby('l1', 'finished', '2026-09-08T17:10:00.000Z');
const G2 = lobby('l2', 'finished', '2026-09-08T18:40:00.000Z');
const G3 = lobby('l3', 'dropped', '2026-09-08T19:41:00.000Z');

const seat = (puuid: string, role: string) => ({ puuid, role });
const blue = ['b1', 'b2', 'b3', 'b4', 'b5'].map((puuid, index) =>
  seat(puuid, ['top', 'jungle', 'mid', 'adc', 'support'][index] ?? 'top'),
);
const red = ['r1', 'r2', 'r3', 'r4', 'r5'].map((puuid, index) =>
  seat(puuid, ['top', 'jungle', 'mid', 'adc', 'support'][index] ?? 'top'),
);

function source(overrides: Partial<TapeSource> = {}): TapeSource {
  return {
    lobbies: [G1],
    games: [
      {
        id: 'g1',
        lobby_id: 'l1',
        duration_s: 1_864,
        winning_side: 200,
        started_at: '2026-09-08T17:20:00.000Z',
        gameMode: 'CLASSIC',
      },
    ],
    gamePlayers: Array.from({ length: 10 }, () => ({ game_id: 'g1', mu_before: 25, mu_after: 26 })),
    splits: [{ lobby_id: 'l1', blue, red, blue_win_prob: 0.62 }],
    members: [],
    players: new Map(),
    ...overrides,
  };
}

describe('which lobbies are on the tape', () => {
  it('two finished and one filling: both finished, oldest first, the filling one is primary', () => {
    const filling = lobby('l3', 'open', '2026-09-08T19:41:00.000Z');
    const rows = [G2, G1, filling].filter((row) => row.status !== 'open');
    const picked = pickTapeLobbies(rows, FIXTURE_NIGHT_START, drawnLobbyId(filling));
    expect(picked.map((row) => row.id)).toEqual(['l1', 'l2']);
  });

  it('one finished and nothing newer: it is the poster, and the tape is empty', () => {
    expect(pickTapeLobbies([G1], FIXTURE_NIGHT_START, drawnLobbyId(G1))).toEqual([]);
  });

  it('two finished and a newest dropped: the page is idle and all three are rows, dropped last', () => {
    const picked = pickTapeLobbies([G3, G1, G2], FIXTURE_NIGHT_START, drawnLobbyId(G3));
    expect(picked.map((row) => row.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('never carries an abandoned lobby, a live one, or one from before 06:00', () => {
    const rows = [
      lobby('ab', 'abandoned', '2026-09-08T18:00:00.000Z'),
      lobby('bal', 'balanced', '2026-09-08T18:05:00.000Z'),
      lobby('ig', 'in_game', '2026-09-08T18:06:00.000Z'),
      lobby('op', 'open', '2026-09-08T18:07:00.000Z'),
      // 05:59 Cairo: last night's.
      lobby('early', 'finished', '2026-09-08T02:59:00.000Z'),
      G1,
    ];
    expect(pickTapeLobbies(rows, FIXTURE_NIGHT_START, null).map((row) => row.id)).toEqual(['l1']);
  });

  /**
   * `drawnLobbyId` is the loader's reading of `tonightState`: every status the loader can hand it
   * draws a primary block except `dropped`. Pinned against the function itself, status by status.
   */
  it.each([
    ['open', {}],
    ['balanced', { teams: workedTeams() }],
    ['in_game', { teams: workedTeams() }],
    ['finished', { teams: workedTeams(), result: workedResult() }],
    ['finished', { teams: workedTeams(), result: workedResult({ rated: false }) }],
    ['finished', {}],
    ['dropped', { teams: workedTeams() }],
  ] as const)('agrees with tonightState for a %s lobby', (status, extra) => {
    const view = lobbyView({ status, ...(extra as Partial<LobbyView>) });
    const idle = tonightState(snapshot(view)).kind === 'idle';
    expect(drawnLobbyId(view) === null).toBe(idle);
  });
});

describe('what a tape row carries', () => {
  it('numbers nothing itself, and prints the clock in the night zone', () => {
    const [row] = assembleTape(source(), CLOCK);
    expect(row).toMatchObject({ lobbyId: 'l1', clock: '20:10', status: 'finished', blueWinProb: 0.62 });
    expect(row?.result).toEqual({
      gameId: 'g1',
      winningSide: 200,
      durationS: 1_864,
      aram: false,
      rated: true,
    });
  });

  it('gives a dropped lobby no result', () => {
    const [row] = assembleTape(source({ lobbies: [G3], games: [], gamePlayers: [], splits: [] }), CLOCK);
    expect(row).toMatchObject({ status: 'dropped', result: null, blueWinProb: null, sitters: [] });
  });

  it('marks an ARAM by the queue rule /games uses, and never rated', () => {
    const aram = source({
      games: [{ ...source().games[0], gameMode: 'aram' } as TapeSource['games'][number]],
      gamePlayers: Array.from({ length: 10 }, () => ({ game_id: 'g1', mu_before: null, mu_after: null })),
    });
    expect(assembleTape(aram, CLOCK)[0]?.result).toMatchObject({ aram: true, rated: false });
  });

  it('marks a remake unrated: any scoreboard row missing a mu', () => {
    const rows = source().gamePlayers.map((row, index) => (index === 0 ? { ...row, mu_after: null } : row));
    expect(assembleTape(source({ gamePlayers: rows }), CLOCK)[0]?.result).toMatchObject({
      aram: false,
      rated: false,
    });
  });

  it("takes the lobby's newest game with a winner", () => {
    const first = source().games[0] as TapeSource['games'][number];
    const games = [
      first,
      { ...first, id: 'g1b', winning_side: 100, started_at: '2026-09-08T18:00:00.000Z' },
      { ...first, id: 'g1c', winning_side: null, started_at: '2026-09-08T18:30:00.000Z' },
    ];
    expect(assembleTape(source({ games }), CLOCK)[0]?.result?.gameId).toBe('g1b');
  });

  it('lists the sitters in join order, names inside one post by name, nobody from the ten', () => {
    const players = new Map([
      ['p-b1', { puuid: 'b1', name: 'Playing' }],
      ['p-yuki', { puuid: 'yuki', name: 'Yuki' }],
      ['p-omar', { puuid: 'omar', name: 'Omar' }],
      ['p-ali', { puuid: 'ali', name: 'Ali' }],
      ['p-anon', { puuid: 'anon', name: null }],
    ]);
    const members = [
      { lobby_id: 'l1', player_id: 'p-b1', created_at: '2026-09-08T17:00:00.000Z' },
      { lobby_id: 'l1', player_id: 'p-yuki', created_at: '2026-09-08T17:01:00.000Z' },
      { lobby_id: 'l1', player_id: 'p-omar', created_at: '2026-09-08T17:02:00.000Z' },
      { lobby_id: 'l1', player_id: 'p-anon', created_at: '2026-09-08T17:02:00.000Z' },
      { lobby_id: 'l1', player_id: 'p-ali', created_at: '2026-09-08T17:02:00.000Z' },
      // Another lobby's member is not this lobby's sitter.
      { lobby_id: 'l2', player_id: 'p-ali', created_at: '2026-09-08T17:00:00.000Z' },
    ];
    expect(assembleTape(source({ members, players }), CLOCK)[0]?.sitters).toEqual([
      'Yuki',
      'Ali',
      'Omar',
      null,
    ]);
  });

  it('knows of no sitter without a chosen split', () => {
    const players = new Map([['p-yuki', { puuid: 'yuki', name: 'Yuki' }]]);
    const members = [{ lobby_id: 'l1', player_id: 'p-yuki', created_at: '2026-09-08T17:01:00.000Z' }];
    expect(assembleTape(source({ members, players, splits: [] }), CLOCK)[0]?.sitters).toEqual([]);
  });
});
