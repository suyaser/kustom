import { describe, expect, it } from 'vitest';
import type { StatsGame } from '../stats/types';
import { playerIdOf, rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import {
  LANES_SHOWN,
  MIN_LANE_GAMES,
  TYRANT_RATE,
  verdictAlliesOnly,
  verdictEven,
  verdictLeads,
  verdictOwns,
  verdictTogetherCursed,
  verdictTogetherHot,
} from './copy';
import { countedGames, headToHead, laneBoards, laneHeats, lanePair, laneTyrants, versusGames } from './fold';

/**
 * `/1v1` arithmetic (M8.5): a lane meeting is one player a side at that role; a head-to-head
 * is every counted custom the two named people both played.
 */

function at(n: number): string {
  const day = 1 + Math.floor(n / 10);
  const hour = 10 + (n % 10);
  return `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
}

function topGame(
  blue: string,
  red: string,
  winner: 100 | 200,
  n: number,
  extra: { blueKills?: number; redKills?: number; blueChamp?: number; redChamp?: number } = {},
): StatsGame {
  return tenPlayerGame({
    at: at(n),
    winner,
    blue: [
      {
        key: blue,
        role: 'top',
        kills: extra.blueKills ?? 0,
        championId: extra.blueChamp ?? null,
      },
    ],
    red: [
      {
        key: red,
        role: 'top',
        kills: extra.redKills ?? 0,
        championId: extra.redChamp ?? null,
      },
    ],
  });
}

function runTop(blue: string, red: string, blueWins: number, redWins: number, from = 0): StatsGame[] {
  const games: StatsGame[] = [];
  for (let index = 0; index < blueWins; index += 1) {
    games.push(topGame(blue, red, 100, from + index));
  }
  for (let index = 0; index < redWins; index += 1) {
    games.push(topGame(blue, red, 200, from + blueWins + index));
  }
  return games;
}

describe('a lane meeting', () => {
  it('pairs the two people who played that role on opposite sides', () => {
    const game = tenPlayerGame({
      at: at(0),
      blue: ['omar:top', 'iris:jungle'],
      red: ['ahmed:top', 'rami:jungle'],
    });
    const top = lanePair(game, 'top');
    expect(top?.map((row) => row.puuid)).toEqual(['u-omar', 'u-ahmed']);
    const jungle = lanePair(game, 'jungle');
    expect(jungle?.map((row) => row.puuid)).toEqual(['u-iris', 'u-rami']);
    expect(lanePair(game, 'mid')).toBeNull();
  });

  it('refuses a doubled or missing role rather than guessing', () => {
    const doubled = tenPlayerGame({
      at: at(0),
      blue: ['omar:top', 'hana:top'],
      red: ['ahmed:top'],
    });
    expect(lanePair(doubled, 'top')).toBeNull();

    const missing = tenPlayerGame({ at: at(1), blue: ['omar'], red: ['ahmed'] });
    expect(lanePair(missing, 'top')).toBeNull();
  });
});

describe('lane boards', () => {
  it('prints the five longest series past three meetings, winner first', () => {
    const games = countedGames([
      ...runTop('omar', 'ahmed', 8, 2, 0),
      ...runTop('hana', 'lena', 3, 1, 20),
      ...runTop('iris', 'rami', 2, 0, 40),
    ]);
    const top = laneBoards(games, rosterFor(games)).find((board) => board.role === 'top');

    expect(top?.entries.map((row) => [row.a.puuid, row.b.puuid, row.aWins, row.bWins, row.games])).toEqual([
      ['u-omar', 'u-ahmed', 8, 2, 10],
      ['u-hana', 'u-lena', 3, 1, 4],
    ]);
    expect(top?.entries[0]?.tied).toBe(false);
    expect(top?.entries[0]?.winRate).toBe(80);
  });

  it('does not list a series under three meetings', () => {
    const games = countedGames(runTop('omar', 'ahmed', 2, 0));
    const top = laneBoards(games, rosterFor(games)).find((board) => board.role === 'top');
    expect(top?.entries).toEqual([]);
    expect(MIN_LANE_GAMES).toBe(3);
  });

  it('keeps one block per role in lane order, empty when nobody qualifies', () => {
    const games = countedGames(runTop('omar', 'ahmed', 3, 0));
    const boards = laneBoards(games, rosterFor(games));
    expect(boards.map((board) => board.role)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    expect(boards.filter((board) => board.entries.length > 0).map((board) => board.role)).toEqual(['top']);
  });

  it('caps each lane at five rows', () => {
    const games: StatsGame[] = [];
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (let index = 0; index < 6; index += 1) {
      games.push(...runTop(names[index] as string, names[index + 1] as string, 3, 0, index * 10));
    }
    const top = laneBoards(countedGames(games), rosterFor(games)).find((board) => board.role === 'top');
    expect(top?.entries).toHaveLength(LANES_SHOWN);
  });

  it('does not count ARAM or KIWI as a lane meeting', () => {
    const rift = runTop('omar', 'ahmed', 3, 0);
    const aram = tenPlayerGame({
      at: at(50),
      gameMode: 'ARAM',
      blue: ['omar:top'],
      red: ['ahmed:top'],
    });
    const games = versusGames([...rift, aram]);
    const top = laneBoards(games, rosterFor(games)).find((board) => board.role === 'top');
    expect(top?.entries[0]?.games).toBe(3);
  });
});

describe('lane bullies and dead heats', () => {
  it('names a bully only past five meetings at 70%', () => {
    const bully = countedGames(runTop('omar', 'ahmed', 8, 2));
    const short = countedGames(runTop('hana', 'lena', 4, 0, 20));
    expect(laneTyrants(bully, rosterFor(bully)).map((row) => row.a.puuid)).toEqual(['u-omar']);
    expect(laneTyrants(short, rosterFor(short))).toEqual([]);
    expect(TYRANT_RATE).toBe(70);
  });

  it('names a dead heat when the score is within one game over five meetings', () => {
    const even = countedGames(runTop('omar', 'ahmed', 5, 5));
    const blowout = countedGames(runTop('hana', 'lena', 8, 2, 20));
    expect(laneHeats(even, rosterFor(even)).map((row) => [row.a.puuid, row.b.puuid, row.tied])).toEqual([
      ['u-ahmed', 'u-omar', true],
    ]);
    expect(laneHeats(blowout, rosterFor(blowout))).toEqual([]);
  });
});

describe('head to head', () => {
  it('counts games on opposite sides, and games on the same side separately', () => {
    const collide = runTop('omar', 'ahmed', 3, 1);
    const together = [
      tenPlayerGame({ at: at(40), winner: 100, blue: ['omar:top', 'ahmed:jungle'] }),
      tenPlayerGame({ at: at(41), winner: 200, blue: ['omar:mid', 'ahmed:adc'] }),
    ];
    const games = countedGames([...collide, ...together]);
    const series = headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('ahmed'));

    expect(series?.enemies).toBe(4);
    expect(series?.aWins).toBe(3);
    expect(series?.bWins).toBe(1);
    expect(series?.allies).toBe(2);
    expect(series?.allyWins).toBe(1);
    expect(series?.allyLosses).toBe(1);
    expect(series?.lanes[0]).toMatchObject({ role: 'top', aWins: 3, bWins: 1, games: 4 });
    expect(series?.verdict).toBe(verdictLeads('Omar'));
    expect(series?.form).toEqual([true, true, true, false]);
    expect(series?.streak).toMatchObject({ holder: { puuid: 'u-ahmed' }, length: 1 });
  });

  it('owns the series at 70% over five meetings', () => {
    const games = countedGames(runTop('omar', 'ahmed', 8, 2));
    const series = headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('ahmed'));
    expect(series?.verdict).toBe(verdictOwns('Omar', 'Ahmed'));
  });

  it('is dead even when they split the meetings', () => {
    const games = countedGames(runTop('omar', 'ahmed', 3, 3));
    const series = headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('ahmed'));
    expect(series?.verdict).toBe(verdictEven());
  });

  it('says they only ever play together when they never collide', () => {
    const games = countedGames([
      tenPlayerGame({ at: at(0), winner: 100, blue: ['omar:top', 'ahmed:jungle'] }),
    ]);
    const series = headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('ahmed'));
    expect(series?.enemies).toBe(0);
    expect(series?.verdict).toBe(verdictAlliesOnly());
  });

  it('calls a stacked pair hot or cursed from the ally rate', () => {
    const hot = countedGames(
      Array.from({ length: 5 }, (_, index) =>
        tenPlayerGame({ at: at(index), winner: 100, blue: ['omar:top', 'ahmed:jungle'] }),
      ),
    );
    expect(headToHead(hot, rosterFor(hot), playerIdOf('omar'), playerIdOf('ahmed'))?.verdict).toBe(
      verdictTogetherHot(100),
    );

    const cursed = countedGames(
      Array.from({ length: 5 }, (_, index) =>
        tenPlayerGame({ at: at(index), winner: 200, blue: ['omar:top', 'ahmed:jungle'] }),
      ),
    );
    expect(headToHead(cursed, rosterFor(cursed), playerIdOf('omar'), playerIdOf('ahmed'))?.verdict).toBe(
      verdictTogetherCursed(0),
    );
  });

  it('averages KDA and names the champion they lock into each other', () => {
    const games = countedGames([
      topGame('omar', 'ahmed', 100, 0, { blueKills: 10, redKills: 2, blueChamp: 122, redChamp: 114 }),
      topGame('omar', 'ahmed', 200, 1, { blueKills: 4, redKills: 8, blueChamp: 122, redChamp: 114 }),
    ]);
    const series = headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('ahmed'));
    expect(series?.aKda).toEqual({ kills: 7, deaths: 0, assists: 0 });
    expect(series?.bKda).toEqual({ kills: 5, deaths: 0, assists: 0 });
    expect(series?.aChamp).toEqual({ champion: 'Darius', count: 2 });
    expect(series?.bChamp).toEqual({ champion: 'Fiora', count: 2 });
  });

  it('returns null when either person is missing', () => {
    const games = countedGames(runTop('omar', 'ahmed', 1, 0));
    expect(headToHead(games, rosterFor(games), playerIdOf('omar'), playerIdOf('omar'))).toBeNull();
    expect(headToHead(games, rosterFor(games), playerIdOf('omar'), 'p-nobody')).toBeNull();
  });
});

describe('versusGames', () => {
  it('keeps Rift and a missing mode, and drops ARAM and KIWI', () => {
    const rift = tenPlayerGame({ at: at(0), winner: 100, blue: ['omar:top'], red: ['ahmed:top'] });
    const named = tenPlayerGame({
      at: at(1),
      winner: 100,
      gameMode: 'CLASSIC',
      blue: ['omar:top'],
      red: ['ahmed:top'],
    });
    const aram = tenPlayerGame({
      at: at(2),
      winner: 100,
      gameMode: 'ARAM',
      blue: ['omar:top'],
      red: ['ahmed:top'],
    });
    const kiwi = tenPlayerGame({
      at: at(3),
      winner: 100,
      gameMode: 'KIWI',
      blue: ['omar:top'],
      red: ['ahmed:top'],
    });
    expect(versusGames([rift, named, aram, kiwi]).map((game) => game.id)).toEqual([rift.id, named.id]);
  });
});
