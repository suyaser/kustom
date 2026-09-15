import { describe, expect, it } from 'vitest';
import { LOST, WON } from '../board/copy';
import { rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import { blueWon, redWon } from './copy';
import { parseFocusPuuid } from './params';
import { gamesHistoryView } from './view';

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
    expect(abyss.items.map((game) => game.id)).toEqual(['kiwi', 'aram']);
  });
});

describe('parseFocusPuuid', () => {
  it('treats a missing parameter as the group list', () => {
    expect(parseFocusPuuid(undefined)).toBeUndefined();
  });

  it('refuses a repeated parameter and a placeholder', () => {
    expect(parseFocusPuuid(['a', 'b'])).toBeNull();
    expect(parseFocusPuuid('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('keeps a real puuid', () => {
    expect(parseFocusPuuid('u-lena')).toBe('u-lena');
  });
});
