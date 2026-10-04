import { randomUUID } from 'node:crypto';
import { displayKustom } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { winLossParts } from '@/lib/board/copy';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { kustomSeat, rOf } from '@/lib/testing/kustomSeat';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.15 (M13.10's acceptance) against the local stack, read **with the anon key** as a phone reads:
 *
 * 1. P plays in groups A and B with different ratings: A's board row and A's player page show A's
 *    numbers, B's show B's, and B's games never appear on A's page (the You page's self lens is this
 *    same call, so group B's numbers cannot leak under "You in A").
 * 2. Q is only in A: Q's page in B is `null` (the 404).
 * 4. The share card's numbers are the group's `All time` row.
 * 8. A 9-game player is settling, a 10-game player is ranked.
 * 6/7. The rendered board has no `Proven` / `ordinal`, and its order is the order of the printed
 *    Ratings within each section. The members with no rated game are counted under it.
 *
 * Scratch groups and players, created and deleted here. Skipped without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('board groups against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadBoard, loadPlayerBoard } = await import('@/lib/board/load');
  const { playerCardModel } = await import('@/lib/og/cards');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { BoardView } = await import('./_board/BoardView');
  const { PlayerView } = await import('./_board/PlayerView');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const KEYS = ['a', 'b'] as const;
  type Key = (typeof KEYS)[number];
  let groups: Record<Key, string> = { a: '', b: '' };

  const P = `it-${runId}-both`;
  const Q = `it-${runId}-q9`;
  const R = `it-${runId}-r10`;
  const M = `it-${runId}-member`;
  const filler = (key: Key) => Array.from({ length: 9 }, (_, index) => `it-${runId}-${key}${index}`);
  const everyone = [P, Q, R, M, ...filler('a'), ...filler('b')];
  const ids = new Map<string, string>();
  const games: Record<Key, string> = { a: '', b: '' };

  /** P's two lives: a confident 25 in A, a lucky 30 in B. */
  const RATING: Record<Key, { mu: number; sigma: number; games: number; wins: number }> = {
    a: { mu: 25, sigma: 3, games: 12, wins: 7 },
    b: { mu: 30, sigma: 6, games: 3, wins: 2 },
  };

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, KEYS);
    const inserted = await db
      .from('players')
      .insert(everyone.map((puuid) => ({ puuid, display_name: puuid.slice(-6) })))
      .select('id, puuid');
    if (inserted.error) throw new Error(inserted.error.message);
    for (const row of inserted.data) ids.set(row.puuid, row.id);
    const id = (puuid: string) => ids.get(puuid) as string;

    for (const key of KEYS) {
      for (const puuid of [P, ...filler(key)]) await setTestMembership(db, groups[key], id(puuid), 'member');
    }
    for (const puuid of [Q, R, M]) await setTestMembership(db, groups.a, id(puuid), 'member');

    // One rated game per group, P on blue in both, on different days.
    for (const key of KEYS) {
      const game = await db
        .from('games')
        .insert({
          group_id: groups[key],
          lcu_game_id: Number(`8${Date.now() % 100_000_000}${key === 'a' ? 1 : 2}`),
          started_at: key === 'a' ? '2026-09-20T19:00:00.000Z' : '2026-09-21T19:00:00.000Z',
          duration_s: 1_800,
          winning_side: 100,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      if (game.error) throw new Error(game.error.message);
      games[key] = game.data.id;
      const seats = [P, ...filler(key)].map((puuid, index) => ({
        group_id: groups[key],
        game_id: game.data.id,
        player_id: id(puuid),
        side: index < 5 ? 100 : 200,
        mu_before: puuid === P ? RATING[key].mu - 0.5 : 25,
        sigma_before: 5,
        mu_after: puuid === P ? RATING[key].mu : 25,
        sigma_after: 4.9,
        ...kustomSeat(rOf(puuid === P ? RATING[key].mu - 0.5 : 25), rOf(puuid === P ? RATING[key].mu : 25)),
      }));
      const written = await db.from('game_players').insert(seats);
      if (written.error) throw new Error(written.error.message);
    }

    const rating = (key: Key, puuid: string, mu: number, sigma: number, count: number, wins: number) => ({
      group_id: groups[key],
      player_id: id(puuid),
      mu,
      sigma,
      r: rOf(mu),
      games: count,
      wins,
    });
    const ratings = await db.from('ratings').insert([
      rating('a', P, RATING.a.mu, RATING.a.sigma, RATING.a.games, RATING.a.wins),
      rating('b', P, RATING.b.mu, RATING.b.sigma, RATING.b.games, RATING.b.wins),
      // Q: high Rating, 9 games: settling. R: lower Rating, 10 games: ranked.
      rating('a', Q, 31, 7, 9, 7),
      rating('a', R, 22, 4, 10, 4),
    ]);
    if (ratings.error) throw new Error(ratings.error.message);
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    const { error } = await db.from('players').delete().in('puuid', everyone);
    if (error) throw new Error(`cleanup: deleting the test players failed: ${error.message}`);
  });

  const ALL_TIME = (key: Key) => ({ window: 'all-time' as const, groupId: groups[key] });

  describe("a player in two groups shows each group's numbers (acceptance 1)", () => {
    for (const key of KEYS) {
      it(`group ${key}'s board row and page print group ${key}'s Rating, record and games`, async () => {
        const [board, page] = await Promise.all([
          loadBoard(anon, ALL_TIME(key)),
          loadPlayerBoard(anon, P, ALL_TIME(key)),
        ]);
        const row = board.rows.find((entry) => entry.puuid === P);
        const want = RATING[key];
        expect(row?.rating).toBe(displayKustom(rOf(want.mu)));
        expect(row?.games).toBe(want.games);
        expect(row?.wins).toBe(want.wins);
        expect(page?.rating).toBe(displayKustom(rOf(want.mu)));
        expect([page?.games, page?.wins, page?.losses]).toEqual([
          want.games,
          want.wins,
          want.games - want.wins,
        ]);
        // Only this group's game is on the page: the other group's never leaks in.
        expect(page?.recent.map((game) => game.gameId)).toEqual([games[key]]);
      });
    }

    it("settles on each group's own count: 3 games in B is settling, 12 in A is ranked", async () => {
      const [a, b] = await Promise.all([
        loadPlayerBoard(anon, P, ALL_TIME('a')),
        loadPlayerBoard(anon, P, ALL_TIME('b')),
      ]);
      expect(a?.settling).toBe(false);
      expect(b?.settling).toBe(true);
      expect(b?.ratedGames).toBe(3);
    });

    it('the self lens and the public page of the same player print the same numbers (acceptance 13)', async () => {
      const player = await loadPlayerBoard(anon, P, ALL_TIME('a'));
      if (player === null) throw new Error('no page');
      const props = {
        player,
        group: { name: 'A' },
        viewerPuuid: P,
        path: '/g/a/p/x',
        gameHref: () => null,
        allGamesHref: null,
        timeZone: 'Africa/Cairo',
      };
      const self = renderToStaticMarkup(createElement(PlayerView, { ...props, lens: 'self' }));
      const pub = renderToStaticMarkup(createElement(PlayerView, { ...props, lens: 'public' }));
      for (const html of [self, pub].map((markup) => markup.replace(/<[^>]*>/g, ''))) {
        expect(html).toContain(String(displayKustom(rOf(RATING.a.mu))));
        expect(html).toContain(`${RATING.a.wins}`);
        expect(html).toContain(`${RATING.a.games} games`);
      }
    });
  });

  describe('a player with nothing in a group is that group’s 404 (acceptance 2)', () => {
    it('Q, only in A, has a page in A and none in B', async () => {
      expect(await loadPlayerBoard(anon, Q, ALL_TIME('a'))).not.toBeNull();
      expect(await loadPlayerBoard(anon, Q, ALL_TIME('b'))).toBeNull();
    });

    it('a member with no game yet has a page (the new-player state)', async () => {
      const page = await loadPlayerBoard(anon, M, ALL_TIME('a'));
      expect(page).not.toBeNull();
      expect(page?.ratedGames).toBe(0);
      expect(page?.recent).toEqual([]);
    });
  });

  it("the share card prints the group's All time row (acceptance 4)", async () => {
    for (const key of KEYS) {
      const [board, page] = await Promise.all([
        loadBoard(anon, ALL_TIME(key)),
        loadPlayerBoard(anon, P, ALL_TIME(key)),
      ]);
      const row = board.rows.find((entry) => entry.puuid === P);
      if (page === null || row === undefined) throw new Error('missing');
      const card = playerCardModel(page, { main: null, backup: null }, 'Group');
      expect(card.stats).toEqual([
        { label: 'Rating', value: String(row.rating) },
        { label: 'Record', parts: winLossParts(row.wins, row.losses) },
      ]);
    }
  });

  describe('the board in group A', () => {
    it('ranks the 10-game player and leaves the 9-game player settling, below (acceptance 8)', async () => {
      const board = await loadBoard(anon, ALL_TIME('a'));
      const q = board.rows.find((row) => row.puuid === Q);
      const r = board.rows.find((row) => row.puuid === R);
      expect(q?.settling).toBe(true);
      expect(r?.settling).toBe(false);
      const order = board.rows.map((row) => row.puuid);
      expect(order.indexOf(R)).toBeLessThan(order.indexOf(Q));
      // Q's Rating is higher, and still below: the section decides first.
      expect(q?.rating ?? 0).toBeGreaterThan(r?.rating ?? 0);
    });

    it('counts the members with no rated game under the board', async () => {
      const board = await loadBoard(anon, ALL_TIME('a'));
      // The nine fillers and M have no rating row in A; P, Q and R are on the board.
      expect(board.notPlayed).toBe(10);
      expect(board.rows.map((row) => row.puuid).sort()).toEqual([P, Q, R].sort());
    });

    it('renders no Proven or ordinal, and prints the Ratings in order within each section (6, 7)', async () => {
      const board = await loadBoard(anon, ALL_TIME('a'));
      const html = renderToStaticMarkup(
        createElement(BoardView, {
          board,
          viewerPuuid: null,
          sort: 'rating',
          page: 1,
          path: '/g/a/leaderboard',
          playerHref: (puuid: string) => `/g/a/p/${puuid}` as never,
        }),
      );
      expect(html).not.toMatch(/proven|ordinal/i);
      const ranked = board.rows.filter((row) => !row.settling).map((row) => row.rating);
      expect(ranked).toEqual([...ranked].sort((x, y) => y - x));
      expect(html).toContain('Still settling');
      expect(html).toContain('+ 10 people who haven&#x27;t played a rated game yet.');
    });

    it('scopes a week window to the group too', async () => {
      const week = await loadBoard(anon, {
        window: 'this-week',
        groupId: groups.b,
        now: new Date('2026-09-22T12:00:00.000Z'),
        timeZone: 'Africa/Cairo',
      });
      expect(week.rows.map((row) => row.puuid)).toContain(P);
      expect(week.rows.every((row) => !row.settling)).toBe(true);
      expect(week.rows.some((row) => row.puuid === Q)).toBe(false);
    });
  });
}
