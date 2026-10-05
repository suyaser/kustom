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

/** The ten on the scoreboard, each on the split's side (the rolled-and-played game). */
const TEN = [...blue.map((one) => [one.puuid, 100] as const), ...red.map((one) => [one.puuid, 200] as const)];
const scoreboard = (sideOf: (puuid: string, side: 100 | 200) => 100 | 200 = (_, side) => side) =>
  TEN.map(([puuid, side]) => ({
    game_id: 'g1',
    player_id: `p-${puuid}`,
    side: sideOf(puuid, side),
    r_before: 1500,
    r_after: 1508,
  }));
const tenPlayers = new Map(TEN.map(([puuid]) => [`p-${puuid}`, { puuid, name: puuid }]));

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
    gamePlayers: scoreboard(),
    splits: [{ lobby_id: 'l1', blue, red, blue_win_prob: 0.62 }],
    members: [],
    players: tenPlayers,
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
      // No stat lines in this source: no MVP rather than a guess (M14.9).
      mvp: null,
      // M15.19: no rule columns in this source.
      rule: null,
    });
  });

  describe('odds by the receipt rule (M21.7)', () => {
    const rolledSplit = { lobby_id: 'l1', blue, red, blue_win_prob: 0.62, rank: 2 };
    /** b1 and r1 traded seats after the roll: the teams are not the split's. */
    const traded = (puuid: string, side: 100 | 200): 100 | 200 =>
      puuid === 'b1' ? 200 : puuid === 'r1' ? 100 : side;
    const tradedTeams = {
      blue: ['r1', 'b2', 'b3', 'b4', 'b5'],
      red: ['b1', 'r2', 'r3', 'r4', 'r5'],
    };

    it('rolled and played: the split odds and pick number, as before', () => {
      const [row] = assembleTape(source({ splits: [rolledSplit] }), CLOCK);
      expect(row).toMatchObject({ blueWinProb: 0.62, rank: 2 });
    });

    it('rolled, played on swapped sides: the split turned round, pick number kept', () => {
      const swapped = scoreboard((_, side) => (side === 100 ? 200 : 100));
      const [row] = assembleTape(source({ splits: [rolledSplit], gamePlayers: swapped }), CLOCK);
      expect(row?.blueWinProb).toBeCloseTo(0.38, 10);
      expect(row?.rank).toBe(2);
    });

    it('rolled, then swapped in the lobby: the kickoff odds, no pick number', () => {
      const kickoffs = new Map([
        [
          'l1',
          {
            kind: 'custom' as const,
            ...tradedTeams,
            at: '2026-09-08T17:19:00.000Z',
            blueWinProb: 0.41,
            oddsModel: 'kustom' as const,
          },
        ],
      ]);
      const [row] = assembleTape(
        source({ splits: [rolledSplit], gamePlayers: scoreboard(traded), kickoffs }),
        CLOCK,
      );
      expect(row).toMatchObject({ blueWinProb: 0.41, rank: null });
    });

    it('rolled, then swapped, no kickoff record: pre-game odds from the befores, never 0.62', () => {
      const [row] = assembleTape(source({ splits: [rolledSplit], gamePlayers: scoreboard(traded) }), CLOCK);
      // Ten at 1500: an even game.
      expect(row).toMatchObject({ blueWinProb: 0.5, rank: null });
    });

    it('rolled, then swapped, played not rated: no odds', () => {
      const game = { ...(source().games[0] as TapeSource['games'][number]), rated: false };
      const [row] = assembleTape(
        source({ splits: [rolledSplit], games: [game], gamePlayers: scoreboard(traded) }),
        CLOCK,
      );
      expect(row).toMatchObject({ blueWinProb: null, rank: null });
    });

    it("unrolled (M21.14): the kickoff record's odds, the result post's number; no pick number", () => {
      const kickoffs = new Map([
        [
          'l1',
          {
            kind: 'unrolled' as const,
            ...tradedTeams,
            at: '2026-09-08T17:19:00.000Z',
            blueWinProb: 0.41,
            oddsModel: 'kustom' as const,
          },
        ],
      ]);
      const [row] = assembleTape(source({ splits: [], gamePlayers: scoreboard(traded), kickoffs }), CLOCK);
      expect(row).toMatchObject({ blueWinProb: 0.41, rank: null });
    });

    it("unrolled, no kickoff record (M21.14): the fold's fold_p, else preGameOdds", () => {
      const folded = scoreboard((_, side) => side).map((row) => ({
        ...row,
        fold_p: row.side === 100 ? 0.44 : 0.56,
      }));
      expect(assembleTape(source({ splits: [], gamePlayers: folded }), CLOCK)[0]).toMatchObject({
        blueWinProb: 0.44,
        rank: null,
      });
      // Ten at 1500 and no fold_p: an even game.
      expect(assembleTape(source({ splits: [] }), CLOCK)[0]).toMatchObject({ blueWinProb: 0.5, rank: null });
    });
  });

  it('carries the rule a checked game was played under (M15.19), and none for an unchecked one', () => {
    const game = source().games[0] as TapeSource['games'][number];
    const tanks = source({
      games: [{ ...game, rule: 'class', rule_class_tag: 'Tank', rule_checked: true }],
      gamePlayers: Array.from({ length: 10 }, () => ({ game_id: 'g1', r_before: null, r_after: null })),
    });
    expect(assembleTape(tanks, CLOCK)[0]?.result).toMatchObject({
      rated: false,
      rule: { id: 'class', tag: 'Tank' },
    });
    const region = source({
      games: [
        { ...game, rule: 'region', rule_region_blue: 'ionia', rule_region_red: 'noxus', rule_checked: true },
      ],
    });
    expect(assembleTape(region, CLOCK)[0]?.result?.rule).toEqual({
      id: 'region',
      blue: 'ionia',
      red: 'noxus',
    });
    // A remake under the rule was never checked: not called a tanks game.
    const remake = source({
      games: [{ ...game, rule: 'class', rule_class_tag: 'Tank', rule_checked: false }],
    });
    expect(assembleTape(remake, CLOCK)[0]?.result?.rule).toBeNull();
  });

  it('gives a dropped lobby no result', () => {
    const [row] = assembleTape(source({ lobbies: [G3], games: [], gamePlayers: [], splits: [] }), CLOCK);
    expect(row).toMatchObject({ status: 'dropped', result: null, blueWinProb: null, sitters: [] });
  });

  it('marks an ARAM by the queue rule /games uses, and never rated', () => {
    const aram = source({
      games: [{ ...source().games[0], gameMode: 'aram' } as TapeSource['games'][number]],
      gamePlayers: Array.from({ length: 10 }, () => ({ game_id: 'g1', r_before: null, r_after: null })),
    });
    expect(assembleTape(aram, CLOCK)[0]?.result).toMatchObject({ aram: true, rated: false });
  });

  it('marks a remake unrated: any scoreboard row missing a mu', () => {
    const rows = source().gamePlayers.map((row, index) => (index === 0 ? { ...row, r_after: null } : row));
    expect(assembleTape(source({ gamePlayers: rows }), CLOCK)[0]?.result).toMatchObject({
      aram: false,
      rated: false,
    });
  });

  it('gives a remake (300 s or less) no result, but keeps its game for the tile: no winner, not played', () => {
    const game = source().games[0] as TapeSource['games'][number];
    const unrated = source().gamePlayers.map((row) => ({ ...row, r_before: null, r_after: null }));
    const [row] = assembleTape(
      source({ games: [{ ...game, duration_s: 300 }], gamePlayers: unrated }),
      CLOCK,
    );
    expect(row).toMatchObject({
      status: 'finished',
      result: null,
      remake: { gameId: game.id, durationS: 300 },
    });
    const [played] = assembleTape(
      source({ games: [{ ...game, duration_s: 301 }], gamePlayers: unrated }),
      CLOCK,
    );
    expect(played?.result).not.toBeNull();
    expect(played).not.toHaveProperty('remake');
  });

  it('M23.2: carries why a game was voided, and nothing for one that was not', () => {
    const game = source().games[0] as TapeSource['games'][number];
    const early = source({ games: [{ ...game, duration_s: 632, rated: false, void_reason: 'early-end' }] });
    expect(assembleTape(early, CLOCK)[0]?.result?.voidReason).toBe('early-end');
    const admin = source({ games: [{ ...game, rated: false, void_reason: 'admin' }] });
    expect(assembleTape(admin, CLOCK)[0]?.result?.voidReason).toBe('admin');
    expect(assembleTape(source(), CLOCK)[0]?.result).not.toHaveProperty('voidReason');
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
