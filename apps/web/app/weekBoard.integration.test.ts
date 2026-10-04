import { randomUUID } from 'node:crypto';
import { displayRating } from '@customs/core';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * **The week boards rank by net points** (M14.57, rewritten from M7.3's weekly-track file), against
 * the Supabase CLI local stack.
 *
 * `This week` and `Last week` sum each player's **printed all-time deltas** over the window's rated
 * games (`displayDelta(mu_before, mu_after)` per row) and rank on that sum, with product's
 * tie-break: net points, more wins, fewer games, higher all-time Rating, name A to Z. What this file
 * proves, and a unit test cannot, is that the loader reads the rows the board counts, through RLS
 * and the anon key, that the player page on every tab prints the same delta for the same game, and
 * that an unrated game adds nothing.
 *
 * **The fixture is ten players over three rated games and one ARAM this week, one game last week.**
 * Every row's `mu` pair is written by hand in display units (`n / 60`), so the expected numbers are
 * stated here rather than computed by the code under test:
 *
 * - `Pia` and `Quinn` tie on points (+35), wins and games; Pia's all-time Rating is higher.
 * - `Amy` and `Zed` tie on everything but the name (−35, same Rating): Amy first.
 * - `Sol` is settling (3 rated games) and **does not chain**: a reset sits between game 1 and game 2,
 *   so his rows sum to +90 while his first-to-last `mu` difference is only +10. The rows win.
 * - `Nell` nets exactly zero: `+0`.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the week boards against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadBoard, loadPlayerBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { displayDelta } = await import('@/lib/ratingDisplay');
  const { BoardView } = await import('./_board/BoardView');
  const { PlayerView } = await import('./_board/PlayerView');
  const { SETTLING_SECTION_LINE, WEEK_BOARD_SENTENCE_SHORT, WEEK_PLAYER_SENTENCE } = await import(
    '@/lib/board/copy'
  );

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();
  const runId = randomUUID().slice(0, 8);

  /** Wednesday 2026-03-11, 20:00 Cairo: this week is Sunday the 8th to Sunday the 15th (M5.9). */
  const NOW = new Date('2026-03-11T18:00:00Z');
  const WEEK = { now: NOW, groupId: ORIGINAL_GROUP_ID } as const;
  const THIS_WEEK = { window: 'this-week', ...WEEK } as const;
  const LAST_WEEK = { window: 'last-week', ...WEEK } as const;
  const ALL_TIME = { window: 'all-time', groupId: ORIGINAL_GROUP_ID } as const;

  /**
   * One player: name, the display rating their chain starts at this week, the three deltas of this
   * week's rated games (blue wins game 1 and 3, red wins game 2), their stored all-time Rating and
   * rated-game count. `reset` restarts the chain before game 2 at the given display number.
   */
  interface Seat {
    name: string;
    start: number;
    deltas: readonly [number, number, number];
    stored: number;
    games: number;
    reset?: number;
  }

  const SEATS: readonly Seat[] = [
    // Blue: 2W 1L.
    { name: 'Pia', start: 1500, deltas: [30, -20, 25], stored: 1535, games: 40 },
    { name: 'Quinn', start: 1400, deltas: [30, -20, 25], stored: 1435, games: 40 },
    { name: 'Rhea', start: 1300, deltas: [40, -10, 30], stored: 1360, games: 40 },
    { name: 'Tam', start: 1300, deltas: [10, -30, 10], stored: 1290, games: 40 },
    { name: 'Sol', start: 1200, deltas: [80, -60, 70], stored: 1210, games: 3, reset: 1200 },
    // Red: 1W 2L.
    { name: 'Zed', start: 1450, deltas: [-30, 20, -25], stored: 1450, games: 40 },
    { name: 'Amy', start: 1450, deltas: [-30, 20, -25], stored: 1450, games: 40 },
    { name: 'Ugo', start: 1350, deltas: [-40, 10, -30], stored: 1290, games: 40 },
    { name: 'Vik', start: 1250, deltas: [-10, 30, -10], stored: 1260, games: 40 },
    { name: 'Nell', start: 1350, deltas: [-20, 40, -20], stored: 1350, games: 40 },
  ];

  const puuidOf = (name: string) => `it-${runId}-${name.toLowerCase()}`;
  const mu = (display: number) => display / 60;
  const WINNERS = [100, 200, 100] as const;
  const THIS_WEEK_AT = ['2026-03-09T19:00:00Z', '2026-03-10T19:00:00Z', '2026-03-11T19:00:00Z'];
  const ARAM_AT = '2026-03-11T20:00:00Z';
  const LAST_WEEK_AT = '2026-03-03T19:00:00Z';

  /** Each seat's three `mu` pairs, in display units, chained unless the seat resets. */
  function pairsOf(seat: Seat): { before: number; after: number }[] {
    const pairs: { before: number; after: number }[] = [];
    let at = seat.start;
    seat.deltas.forEach((delta, index) => {
      if (index === 1 && seat.reset !== undefined) at = seat.reset;
      pairs.push({ before: at, after: at + delta });
      at += delta;
    });
    return pairs;
  }

  /** The contract, stated here: net points are the sum of the printed per-game deltas. */
  const expectedPoints = (seat: Seat): number =>
    pairsOf(seat).reduce((sum, pair) => sum + displayDelta(mu(pair.before), mu(pair.after)), 0);

  /** Product's order, stated here: points, wins, fewer games, Rating, name. */
  const EXPECTED_ORDER = ['Sol', 'Rhea', 'Pia', 'Quinn', 'Vik', 'Nell', 'Tam', 'Amy', 'Zed', 'Ugo'];

  const ids = new Map<string, string>();
  const gameIds: string[] = [];

  beforeAll(async () => {
    const { data: players, error } = await db
      .from('players')
      .insert(SEATS.map((seat) => ({ puuid: puuidOf(seat.name), display_name: seat.name })))
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) ids.set(row.puuid, row.id);

    const { error: ratingsError } = await db.from('ratings').insert(
      SEATS.map((seat) => ({
        group_id: ORIGINAL_GROUP_ID,
        player_id: ids.get(puuidOf(seat.name)) as string,
        mu: mu(seat.stored),
        sigma: 5,
        games: seat.games,
        wins: Math.floor(seat.games / 2),
      })),
    );
    expect(ratingsError).toBeNull();

    const stamp = Date.now() % 1_000_000;
    const insertGame = async (
      index: number,
      startedAt: string,
      winningSide: 100 | 200,
      rows: (seat: Seat, seatIndex: number) => { mu_before: number | null; mu_after: number | null },
      aram = false,
    ) => {
      const { data: game, error: gameError } = await db
        .from('games')
        .insert({
          group_id: ORIGINAL_GROUP_ID,
          lcu_game_id: Number(`8${stamp}${String(index).padStart(2, '0')}`),
          started_at: startedAt,
          duration_s: 1_800,
          winning_side: winningSide,
          raw: { gameMode: aram ? 'ARAM' : 'CLASSIC' },
        })
        .select('id')
        .single();
      expect(gameError).toBeNull();
      const gameId = game?.id ?? '';
      gameIds.push(gameId);
      const { error: rowsError } = await db.from('game_players').insert(
        SEATS.map((seat, seatIndex) => ({
          group_id: ORIGINAL_GROUP_ID,
          game_id: gameId,
          player_id: ids.get(puuidOf(seat.name)) as string,
          side: seatIndex < 5 ? 100 : 200,
          role: (['top', 'jungle', 'mid', 'adc', 'support'] as const)[seatIndex % 5] ?? 'top',
          sigma_before: 5,
          sigma_after: 5,
          ...rows(seat, seatIndex),
        })),
      );
      expect(rowsError).toBeNull();
    };

    // Last week: one rated game, blue wins, twelve points a seat either way.
    await insertGame(0, LAST_WEEK_AT, 100, (seat, seatIndex) => ({
      mu_before: mu(seat.start - 100),
      mu_after: mu(seat.start - 100 + (seatIndex < 5 ? 12 : -12)),
    }));
    // This week: three rated games.
    for (const [index, at] of THIS_WEEK_AT.entries()) {
      await insertGame(index + 1, at, WINNERS[index] as 100 | 200, (seat) => {
        const pair = pairsOf(seat)[index] as { before: number; after: number };
        return { mu_before: mu(pair.before), mu_after: mu(pair.after) };
      });
    }
    // And an ARAM: never rated, so it adds nothing and counts in neither W nor L.
    await insertGame(4, ARAM_AT, 100, () => ({ mu_before: null, mu_after: null }), true);
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    const playerIds = [...ids.values()];
    if (playerIds.length > 0) {
      await db.from('ratings').delete().in('player_id', playerIds);
      await db.from('players').delete().in('id', playerIds);
    }
  });

  /** This run's own rows; the database is shared with every other integration file here. */
  const mine = <T extends { puuid: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.puuid.startsWith(`it-${runId}-`));
  const seatOf = (puuid: string) => SEATS.find((seat) => puuidOf(seat.name) === puuid) as Seat;

  describe('net points', () => {
    /** Acceptance 2, first half: each row's number is the sum of its printed per-game deltas. */
    it('is the sum of each player s printed all-time deltas in the week', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      const rows = mine(board.rows);
      expect(rows).toHaveLength(SEATS.length);

      for (const row of rows) {
        const seat = seatOf(row.puuid);
        expect(row.track).toBe('week');
        expect(row.points).toBe(expectedPoints(seat));
        // The ARAM is not a game here: three rated games, and the W–L of those three.
        expect(row.games).toBe(3);
        expect(row.wins + row.losses).toBe(3);
        // Rating is the all-time one, from `ratings`.
        expect(row.rating).toBe(seat.stored);
      }
    });

    it('lets the rows win for a player whose games do not chain, and prints a net zero as +0', async () => {
      const rows = mine((await loadBoard(anon, THIS_WEEK)).rows);
      const sol = rows.find((row) => row.puuid === puuidOf('Sol'));
      const nell = rows.find((row) => row.puuid === puuidOf('Nell'));

      expect(sol?.points).toBe(90);
      // One mu difference from his first game to his last would have said +10.
      const pairs = pairsOf(seatOf(puuidOf('Sol')));
      expect(displayDelta(mu(pairs[0]?.before ?? 0), mu(pairs[2]?.after ?? 0))).toBe(10);
      expect(Object.is(nell?.points, 0)).toBe(true);
    });

    /** Acceptance 2, second half: the order follows the tie-break, one pair per step it reaches. */
    it('orders the board by net points, then wins, then fewer games, then Rating, then name', async () => {
      const rows = mine((await loadBoard(anon, THIS_WEEK)).rows);
      expect(rows.map((row) => seatOf(row.puuid).name)).toEqual(EXPECTED_ORDER);
    });

    it('keeps one list on a week, with the all-time settling chip on the settling player', async () => {
      const rows = mine((await loadBoard(anon, THIS_WEEK)).rows);
      expect(rows.every((row) => row.settling === false)).toBe(true);
      expect(rows.filter((row) => row.settlingChip).map((row) => seatOf(row.puuid).name)).toEqual(['Sol']);
    });

    it('reads last week as its own window', async () => {
      const board = await loadBoard(anon, LAST_WEEK);
      const rows = mine(board.rows);
      expect(rows).toHaveLength(SEATS.length);
      for (const row of rows) {
        const blue = SEATS.indexOf(seatOf(row.puuid)) < 5;
        expect(row.points).toBe(blue ? 12 : -12);
        expect(row).toMatchObject({ games: 1, wins: blue ? 1 : 0, losses: blue ? 0 : 1 });
      }
    });

    it('leaves All time on Rating, with no points', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const pia = board.rows.find((row) => row.puuid === puuidOf('Pia'));
      expect(pia).toMatchObject({ track: 'all-time', points: null, rating: 1535 });
    });
  });

  describe('the player page on every tab', () => {
    const page = async (name: string, window: 'this-week' | 'last-week' | 'all-time') =>
      loadPlayerBoard(
        anon,
        puuidOf(name),
        window === 'all-time' ? ALL_TIME : window === 'this-week' ? THIS_WEEK : LAST_WEEK,
      );

    /** Acceptance 3: the same game prints the same delta on All time, This week and Last week. */
    it('prints the same delta for the same game on every tab', async () => {
      for (const seat of SEATS) {
        const [all, thisWeek, lastWeek] = await Promise.all([
          page(seat.name, 'all-time'),
          page(seat.name, 'this-week'),
          page(seat.name, 'last-week'),
        ]);
        const byGame = new Map((all?.recent ?? []).map((game) => [game.gameId, game]));
        const weekGames = [...(thisWeek?.recent ?? []), ...(lastWeek?.recent ?? [])];
        expect(weekGames).toHaveLength(5);
        for (const game of weekGames) {
          const same = byGame.get(game.gameId);
          expect(same).toBeDefined();
          expect([game.muBefore, game.muAfter]).toEqual([same?.muBefore, same?.muAfter]);
        }
      }
    });

    it('carries the board row s net points, W–L and the all-time Rating, to the digit', async () => {
      const rows = mine((await loadBoard(anon, THIS_WEEK)).rows);
      const pages = await Promise.all(rows.map((row) => page(seatOf(row.puuid).name, 'this-week')));
      for (const [index, row] of rows.entries()) {
        const player = pages[index];
        expect(player).toMatchObject({
          track: 'week',
          points: row.points,
          games: row.games,
          wins: row.wins,
          losses: row.losses,
          rating: row.rating,
        });
      }
    });

    it('is All time with no points on the all-time tab', async () => {
      const player = await page('Pia', 'all-time');
      expect(player).toMatchObject({ track: 'all-time', points: null, rating: displayRating(mu(1535)) });
    });
  });

  describe('as pages', () => {
    /** React escapes the apostrophe in the copy; a reader sees the sentence, so decode it. */
    const textOf = (html: string): string => html.replace(/&#x27;|&#39;/g, "'").replace(/<[^>]*>/g, ' ');

    it('prints the week sentence under a week board and no settling section', async () => {
      for (const window of ['this-week', 'last-week'] as const) {
        const board = await loadBoard(anon, { window, ...WEEK });
        const text = textOf(
          renderToStaticMarkup(
            createElement(BoardView, {
              board,
              viewerPuuid: null,
              sort: 'rating',
              page: 1,
              path: '/g/customs/leaderboard',
              playerHref: (id: string) => `/g/customs/p/${id}` as never,
            }),
          ),
        );
        expect(text.split(WEEK_BOARD_SENTENCE_SHORT)).toHaveLength(2);
        expect(text).not.toContain(SETTLING_SECTION_LINE);
      }
    });

    it('prints the week note on a player s week tab and not on All time', async () => {
      const draw = async (window: 'this-week' | 'all-time') => {
        const player = await loadPlayerBoard(
          anon,
          puuidOf('Pia'),
          window === 'all-time' ? ALL_TIME : THIS_WEEK,
        );
        return textOf(
          renderToStaticMarkup(
            createElement(PlayerView, {
              lens: 'public' as const,
              player: player as NonNullable<typeof player>,
              group: { name: 'Customs Night' },
              viewerPuuid: null,
              path: `/g/customs/p/${puuidOf('Pia')}`,
              gameHref: () => null,
              allGamesHref: null,
              timeZone: 'Africa/Cairo',
            }),
          ),
        );
      };
      expect(await draw('this-week')).toContain(WEEK_PLAYER_SENTENCE);
      expect(await draw('all-time')).not.toContain(WEEK_PLAYER_SENTENCE);
    });
  });
}
