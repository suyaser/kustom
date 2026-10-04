import { describe, expect, it } from 'vitest';
import { LOST, WON } from '../board/copy';
import { gatedGameAward } from '../ingest/fold';
import type { StatsGame } from '../stats/types';
import {
  rosterFor,
  scoredSeats,
  statsGame,
  tenPlayerGame,
  withoutAwardColumns,
} from '../testing/statsFixtures';
import { blueWon, redWon } from './copy';
import type { HistoryGame, HistorySeat } from './types';
import { gamesHistoryView, historyGameOf } from './view';

const WEEK = { start: new Date('2026-09-07T03:00:00Z'), end: new Date('2026-09-14T03:00:00Z') };

function history(games: Parameters<typeof rosterFor>[0], options: { focusPuuid?: string | null } = {}) {
  return gamesHistoryView({
    window: 'this-week',
    games,
    players: rosterFor(games),
    range: WEEK,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
    focusPuuid: options.focusPuuid,
  });
}

describe('gamesHistoryView', () => {
  const early = tenPlayerGame({
    id: 'early',
    at: '2026-09-08T20:00:00Z',
    lcuGameId: '1',
    durationS: 1_456,
    winner: 200,
    blue: [{ key: 'hana', role: 'top', kills: 2, deaths: 6, assists: 3, cs: 140, damageToChamps: 8_000 }],
    red: [
      {
        key: 'lena',
        role: 'adc',
        kills: 12,
        deaths: 2,
        assists: 8,
        cs: 240,
        gold: 16_000,
        damageToChamps: 28_000,
      },
    ],
  });
  const late = tenPlayerGame({
    id: 'late',
    at: '2026-09-09T21:00:00Z',
    lcuGameId: '2',
    durationS: 2_100,
    winner: 100,
    blue: [
      {
        key: 'hana',
        role: 'top',
        championId: 122,
        kills: 9,
        deaths: 6,
        assists: 5,
        cs: 154,
        gold: 12_000,
        damageToChamps: 31_115,
      },
      { key: 'iris', role: 'jungle', kills: 3, deaths: 8, assists: 7, cs: 143, damageToChamps: 20_000 },
    ],
    red: [
      {
        key: 'lena',
        role: 'adc',
        championId: 222,
        kills: 15,
        deaths: 5,
        assists: 6,
        cs: 28,
        gold: 25_527,
        damageToChamps: 35_685,
      },
      { key: 'yuki', role: 'support', kills: 10, deaths: 8, assists: 4, cs: 20, damageToChamps: 6_000 },
    ],
  });

  it('lists newest first and names the winning side', () => {
    const view = history([early, late]);
    expect(view.items.map((game) => game.id)).toEqual(['late', 'early']);
    expect(view.items[0]?.result).toBe(blueWon());
    expect(view.items[1]?.result).toBe(redWon());
    expect(view.items[0]?.score).toBe('12–25');
    expect(view.range).not.toBeNull();
    expect(view.games).toBe(2);
  });

  it('orders each side in lane order and keeps a damage share off the lobby peak', () => {
    const game = history([late]).items[0];
    expect(game?.blue.seats.map((seat) => seat.role)).toEqual(['top', 'jungle', null, null, null]);
    expect(game?.blue.seats[0]?.kda).toBe('9/6/5');
    expect(game?.blue.seats[0]?.champion).toBe('Darius');
    expect(game?.red.seats[0]?.champion).toBe('Jinx');
    expect(game?.red.seats[0]?.damageShare).toBe(100);
    expect(game?.blue.seats[0]?.damageShare).toBe(87);
    expect(game?.red.seats[0]?.kp).toBe(84);
  });

  it('prints no kill participation for a side whose kills do not cover a takedown line (M14.77)', () => {
    // Blue's rows add up to 3 kills, but Hana alone took part in 11: the rows are short, so no
    // `367%` and no confident `100%` either.
    const short = tenPlayerGame({
      id: 'short',
      at: '2026-09-10T20:00:00Z',
      lcuGameId: '3',
      winner: 100,
      blue: [
        { key: 'hana', role: 'top', kills: 2, deaths: 1, assists: 9 },
        { key: 'iris', role: 'jungle', kills: 1, deaths: 0, assists: 1 },
      ],
    });
    const blue = history([short]).items[0]?.blue.seats ?? [];
    expect(blue.find((seat) => seat.name === 'Hana')?.kp).toBeNull();
    // Iris's own line fits inside the side's kills, so hers stays: 2 of 3.
    expect(blue.find((seat) => seat.name === 'Iris')?.kp).toBe(67);
  });

  it('filters to one player and switches the result to their own', () => {
    const view = history([early, late], { focusPuuid: 'u-lena' });
    expect(view.items).toHaveLength(2);
    expect(view.focusName).toBe('Lena');
    expect(view.items[0]?.result).toBe(LOST);
    expect(view.items[1]?.result).toBe(WON);
    expect(view.items[0]?.focusMeta).toBe('15/5/6 · 84% KP · 28 CS');
    expect(view.items[0]?.teammates).toHaveLength(5);
    expect(view.items[0]?.ruleSide).toBe(200);
  });

  it('drops a window to the empty sentence when that person did not play', () => {
    const view = history([late], { focusPuuid: 'u-nobody' });
    expect(view.range).toBeNull();
    expect(view.items).toEqual([]);
    expect(view.games).toBe(0);
  });

  it("defaults to Summoner's Rift and leaves ARAM off that list", () => {
    const rift = tenPlayerGame({
      id: 'rift',
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      blue: [{ key: 'hana', role: 'top' }],
      red: [{ key: 'lena', role: 'adc' }],
    });
    const aram = tenPlayerGame({
      id: 'aram',
      at: '2026-09-09T21:00:00Z',
      winner: 200,
      gameMode: 'ARAM',
      blue: [{ key: 'hana', role: 'top' }],
      red: [{ key: 'lena', role: 'adc' }],
    });
    const kiwi = tenPlayerGame({
      id: 'kiwi',
      at: '2026-09-09T22:00:00Z',
      winner: 100,
      gameMode: 'KIWI',
      blue: [{ key: 'hana', role: 'top' }],
      red: [{ key: 'lena', role: 'adc' }],
    });

    const sr = gamesHistoryView({
      window: 'this-week',
      games: [rift, aram, kiwi],
      players: rosterFor([rift, aram, kiwi]),
      range: WEEK,
      capped: false,
      cap: 2_000,
    });
    expect(sr.queue).toBe('sr');
    expect(sr.items.map((game) => game.id)).toEqual(['rift']);

    const abyss = gamesHistoryView({
      window: 'this-week',
      games: [rift, aram, kiwi],
      players: rosterFor([rift, aram, kiwi]),
      range: WEEK,
      capped: false,
      cap: 2_000,
      queue: 'aram',
    });
    expect(abyss.queue).toBe('aram');
    expect(abyss.items.map((game) => game.id)).toEqual(['aram']);
  });
});

/**
 * M7.23: `/games` names the MVP and the ACE, and only through `gatedGameAward`.
 *
 * This page lists every captured game — remakes, nine-player customs, unrated games — so most of
 * these cases are the ones where nothing may be printed, and none of them may throw.
 */
describe('gamesHistoryView MVP / ACE (M7.23)', () => {
  function scored(spec: Partial<Parameters<typeof statsGame>[0]> = {}): StatsGame {
    return statsGame({ id: 'scored', at: '2026-09-09T20:00:00Z', winner: 100, ...scoredSeats(), ...spec });
  }

  function seats(game: HistoryGame | undefined): HistorySeat[] {
    return game === undefined ? [] : [...game.blue.seats, ...game.red.seats];
  }

  function awarded(game: StatsGame, players = rosterFor([game])): HistorySeat[] {
    const view = gamesHistoryView({
      window: 'this-week',
      games: [game],
      players,
      range: WEEK,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    return seats(view.items[0]).filter((seat) => seat.award !== null);
  }

  it('names exactly two on a clean rated five a side, and they are `gatedGameAward`s two', () => {
    for (const winner of [100, 200] as const) {
      const game = scored({ winner });
      const answer = gatedGameAward(game.rows, game.durationS, game.winningSide);
      expect(answer).not.toBeNull();

      const named = awarded(game);
      expect(named).toHaveLength(2);
      const mvp = named.find((seat) => seat.award === 'mvp');
      const ace = named.find((seat) => seat.award === 'ace');
      expect(mvp?.puuid).toBe(answer?.mvp);
      expect(ace?.puuid).toBe(answer?.ace);
      const sideOf = (puuid: string | undefined) => game.rows.find((row) => row.puuid === puuid)?.side;
      expect(sideOf(mvp?.puuid)).toBe(winner);
      expect(sideOf(ace?.puuid)).toBe(winner === 100 ? 200 : 100);
    }
  });

  it('carries the same word on the focused view, the focus row and the teammates', () => {
    const game = scored();
    const answer = gatedGameAward(game.rows, game.durationS, game.winningSide);
    const view = gamesHistoryView({
      window: 'this-week',
      games: [game],
      players: rosterFor([game]),
      range: WEEK,
      capped: false,
      cap: 2_000,
      focusPuuid: answer?.mvp ?? null,
    });
    expect(view.items[0]?.focus?.award).toBe('mvp');
    expect(view.items[0]?.teammates.filter((seat) => seat.award !== null)).toHaveLength(1);
  });

  it('names nobody on an unrated game', () => {
    expect(awarded(scored({ unrated: true }))).toEqual([]);
  });

  it('names nobody on a remake, at 300 seconds exactly and below', () => {
    expect(awarded(scored({ durationS: 300 }))).toEqual([]);
    expect(awarded(scored({ durationS: 180 }))).toEqual([]);
  });

  it('names nobody on a nine-player custom, and does not throw on it', () => {
    const { blue, red } = scoredSeats();
    const nine = scored({ blue, red: red.slice(0, 4) });
    expect(nine.rows).toHaveLength(9);
    expect(() => awarded(nine)).not.toThrow();
    expect(awarded(nine)).toEqual([]);
  });

  it('names nobody on a six-four split, and does not throw on it', () => {
    const { blue, red } = scoredSeats();
    const lopsided = scored({ blue: [...blue, red[4] as (typeof red)[number]], red: red.slice(0, 4) });
    expect(() => awarded(lopsided)).not.toThrow();
    expect(awarded(lopsided)).toEqual([]);
  });

  it('names nobody when any one of the seven components is missing for any one of the ten', () => {
    const columns = ['visionScore', 'damageSelfMitigated', 'damageToObjectives'] as const;
    for (const column of columns) {
      const game = scored();
      const rows = game.rows.map((row, index) => (index === 7 ? { ...row, [column]: null } : row));
      expect(awarded({ ...game, rows })).toEqual([]);
    }
    expect(awarded(withoutAwardColumns(scored()))).toEqual([]);
  });

  it('names nobody when any one of the ten has no stored role, even where the page paints one', () => {
    const game = scored();
    // The blue support: `withDisplayRoles` recovers `support` for this seat off its CS, so the
    // scoreboard still prints a role — but the fold never saw one, and neither does the award.
    const rows = game.rows.map((row) => (row.puuid === 'u-theo' ? { ...row, role: null } : row));
    const view = gamesHistoryView({
      window: 'this-week',
      games: [{ ...game, rows }],
      players: rosterFor([game]),
      range: WEEK,
      capped: false,
      cap: 2_000,
    });
    expect(view.items[0]?.blue.seats.find((seat) => seat.puuid === 'u-theo')?.role).toBe('support');
    expect(seats(view.items[0]).filter((seat) => seat.award !== null)).toEqual([]);
  });

  it('names nobody when one of the ten could not be read from the roster', () => {
    const game = scored();
    const players = rosterFor([game]).filter((player) => player.puuid !== 'u-noor');
    expect(awarded(game, players)).toEqual([]);
  });

  it('never names anyone on `/fun`s one-game record, which does not ask', () => {
    const game = scored();
    const roster = new Map(rosterFor([game]).map((player) => [player.puuid, player]));
    const record = historyGameOf(game, roster, null, 'Africa/Cairo');
    expect(seats(record).every((seat) => seat.award === null)).toBe(true);
  });
});
