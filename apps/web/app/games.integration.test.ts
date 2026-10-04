import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `/g/<slug>/games` and `/g/<slug>/games/<id>` against the local Supabase stack (M14.16, folding in
 * M13.11's page checks), read with the **anon key** exactly as a phone would:
 *
 * - the list is the group's games only, and a game of group B under group A is `null` (the 404);
 * - each filter (date, mode, player) narrows the list in the query;
 * - a rolled game gets the rolled receipt, a backfilled one pre-game odds, one with a missing
 *   `mu_before` no odds, a changed-teams game pre-game odds with the run kept;
 * - calibration counts the rolled game and not the changed-teams one;
 * - 500 games: the all-time first page renders under 300 KB of HTML.
 *
 * Everything lives in this run's own scratch groups and is deleted afterwards. Skipped, not failed,
 * without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('games pages against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadGamesList } = await import('@/lib/games/list');
  const { loadGameDetail } = await import('@/lib/games/detail');
  const { GamesList } = await import('./_games/GamesList');
  const { GameDetail } = await import('./_games/GameDetail');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const TZ = 'Africa/Cairo';
  /** Wednesday 2026-06-10 21:00 Cairo: this week is 7 to 14 June. */
  const NOW = new Date('2026-06-10T18:00:00Z');
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  let groups: Record<'a' | 'b' | 'big' | 'pad', string> = { a: '', b: '', big: '', pad: '' };
  const playerIds: string[] = [];
  const puuids: string[] = [];
  const game: Record<'rolled' | 'backfilled' | 'aram' | 'changed' | 'noOdds' | 'other', string> = {
    rolled: '',
    backfilled: '',
    aram: '',
    changed: '',
    noOdds: '',
    other: '',
  };
  let lcu = 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

  async function insertGame(input: {
    groupId: string;
    startedAt: string;
    lobbyId?: string | null;
    mode?: string;
    blue: readonly number[];
    red: readonly number[];
    rated?: boolean;
    missingMu?: boolean;
    winner?: 100 | 200;
  }): Promise<string> {
    lcu += 1;
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: input.groupId,
        lcu_game_id: lcu,
        started_at: input.startedAt,
        duration_s: 1_306,
        winning_side: input.winner ?? 100,
        lobby_id: input.lobbyId ?? null,
        raw: { gameMode: input.mode ?? 'CLASSIC' },
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const rows = [
      ...input.blue.map((i) => [i, 100] as const),
      ...input.red.map((i) => [i, 200] as const),
    ].map(([i, side], seat) => ({
      game_id: data.id,
      group_id: input.groupId,
      player_id: playerIds[i] as string,
      side,
      role: ROLES[seat % 5] ?? 'top',
      champion_id: 103,
      kills: 5,
      deaths: 3,
      assists: 7,
      gold: 11_000,
      damage_to_champs: 18_000 + seat,
      cs: 180,
      vision_score: 20,
      damage_self_mitigated: 9_000,
      damage_to_objectives: 4_000,
      mu_before: input.missingMu && seat === 0 ? null : 25 + i * 0.5,
      sigma_before: input.missingMu && seat === 0 ? null : 6,
      mu_after: input.rated === false ? null : 25 + i * 0.5 + (side === (input.winner ?? 100) ? 0.4 : -0.4),
      sigma_after: input.rated === false ? null : 5.9,
    }));
    const inserted = await db.from('game_players').insert(rows);
    if (inserted.error) throw new Error(inserted.error.message);
    return data.id;
  }

  async function insertLobbyWithSplit(
    groupId: string,
    blue: readonly number[],
    red: readonly number[],
    p: number,
  ) {
    const { data: lobby, error } = await db
      .from('lobbies')
      .insert({
        group_id: groupId,
        lcu_party_id: `it-${runId}-${randomUUID().slice(0, 6)}`,
        status: 'finished',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const assign = (list: readonly number[]) =>
      list.map((i, seat) => ({ puuid: puuids[i], role: ROLES[seat] }));
    const split = await db.from('splits').insert([
      {
        lobby_id: lobby.id,
        rank: 1,
        is_chosen: true,
        blue_win_prob: p,
        gap: 40,
        off_role_count: 0,
        blue: assign(blue),
        red: assign(red),
        explanation: 'Blue favored.',
        roster_key: 'k',
        score: 1,
      },
      {
        lobby_id: lobby.id,
        rank: 2,
        is_chosen: false,
        blue_win_prob: 0.57,
        gap: 90,
        off_role_count: 0,
        blue: assign([red[0] as number, ...blue.slice(1)]),
        red: assign([blue[0] as number, ...red.slice(1)]),
        explanation: 'Blue favored.',
        roster_key: 'k',
        score: 2,
      },
    ]);
    if (split.error) throw new Error(split.error.message);
    return lobby.id;
  }

  const B5 = [0, 1, 2, 3, 4];
  const R5 = [5, 6, 7, 8, 9];

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, ['a', 'b', 'big', 'pad'] as const);
    const { data: players, error } = await db
      .from('players')
      .insert(
        Array.from({ length: 11 }, (_, i) => ({
          puuid: `it-${runId}-gm${i}`,
          display_name: i === 10 ? 'Benchwarmer' : `Gamer${i}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (let i = 0; i < 11; i += 1) {
      const row = (players ?? []).find((p) => p.puuid === `it-${runId}-gm${i}`);
      playerIds.push(row?.id ?? '');
      puuids.push(row?.puuid ?? '');
    }
    // A rating row per player in A: the player select's members.
    const ratings = await db.from('ratings').insert(
      playerIds.map((player_id) => ({
        player_id,
        group_id: groups.a,
        mu: 25,
        sigma: 6,
      })),
    );
    expect(ratings.error).toBeNull();

    const rolledLobby = await insertLobbyWithSplit(groups.a, B5, R5, 0.6);
    game.rolled = await insertGame({
      groupId: groups.a,
      startedAt: '2026-06-09T19:00:00Z',
      lobbyId: rolledLobby,
      blue: B5,
      red: R5,
    });
    const changedLobby = await insertLobbyWithSplit(groups.a, B5, R5, 0.62);
    game.changed = await insertGame({
      groupId: groups.a,
      startedAt: '2026-06-09T20:00:00Z',
      lobbyId: changedLobby,
      blue: [10, 1, 2, 3, 4],
      red: [0, 6, 7, 8, 9],
      winner: 200,
    });
    game.backfilled = await insertGame({
      groupId: groups.a,
      startedAt: '2026-05-20T19:00:00Z',
      blue: B5,
      red: R5,
    });
    game.noOdds = await insertGame({
      groupId: groups.a,
      startedAt: '2026-05-21T19:00:00Z',
      blue: B5,
      red: R5,
      rated: false,
      missingMu: true,
    });
    game.aram = await insertGame({
      groupId: groups.a,
      startedAt: '2026-06-10T17:00:00Z',
      mode: 'ARAM',
      blue: B5,
      red: R5,
      rated: false,
    });
    game.other = await insertGame({
      groupId: groups.b,
      startedAt: '2026-06-09T19:30:00Z',
      blue: B5,
      red: R5,
    });
  }, 60_000);

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds.filter(Boolean));
  }, 60_000);

  const list = (filters: Partial<Parameters<typeof loadGamesList>[1]['filters']> = {}) =>
    loadGamesList(anon, {
      groupId: groups.a,
      viewerPuuid: null,
      timeZone: TZ,
      now: NOW,
      filters: { window: 'all-time', mode: 'sr', player: null, page: 1, ...filters },
    });

  describe('the games list', () => {
    it("lists only the group's own games, newest first (M13.11 check 3)", async () => {
      const view = await list();
      expect(view.items.map((item) => item.id)).toEqual([
        game.changed,
        game.rolled,
        game.noOdds,
        game.backfilled,
      ]);
      expect(view.items.map((item) => item.id)).not.toContain(game.other);
      expect(view.total).toBe(4);
    });

    it('narrows by date, mode and player, each in the query', async () => {
      expect((await list({ window: 'this-week' })).items.map((i) => i.id)).toEqual([
        game.changed,
        game.rolled,
      ]);
      expect((await list({ window: 'tonight' })).total).toBe(0);
      expect((await list({ window: 'tonight', mode: 'aram' })).items.map((i) => i.id)).toEqual([game.aram]);
      const bench = await list({ player: puuids[10] as string });
      expect(bench.items.map((i) => i.id)).toEqual([game.changed]);
      expect(bench.focusName).toBe('Benchwarmer');
      // Somebody who is not a member is dropped, never a 404 and never an empty lie.
      const stranger = await list({ player: 'not-a-member' });
      expect(stranger.filters.player).toBeNull();
      expect(stranger.total).toBe(4);
    });

    it('gives each row its odds: the stored split, pre-game odds, or none', async () => {
      const byId = new Map((await list()).items.map((item) => [item.id, item]));
      expect(byId.get(game.rolled)?.odds).toEqual({ kind: 'rolled', blueWinProb: 0.6, rank: 1 });
      expect(byId.get(game.backfilled)?.odds?.kind).toBe('pre-game');
      expect(byId.get(game.changed)?.odds?.kind).toBe('pre-game');
      expect(byId.get(game.rolled)?.durationLabel).toBe('21 min');
    });

    it('counts only the rolled game in calibration, not the one whose teams changed', async () => {
      const view = await list();
      expect(view.calibration).toMatchObject({ n: 1, favoredWon: 1 });
      const html = renderToStaticMarkup(createElement(GamesList, { view, base: '/g/x/games' }));
      expect(html).toContain('Not enough games yet to check the bot&#x27;s odds (');
    });
  });

  describe('the game page', () => {
    it("is null (the 404) for another group's game under this group (M13.11 check 1)", async () => {
      expect(
        await loadGameDetail(anon, {
          gameId: game.other,
          groupId: groups.a,
          viewerPuuid: null,
          timeZone: TZ,
        }),
      ).toBeNull();
      expect(
        await loadGameDetail(anon, { gameId: 'nope', groupId: groups.a, viewerPuuid: null, timeZone: TZ }),
      ).toBeNull();
    });

    const detail = async (id: string, viewerPuuid: string | null = null) => {
      const view = await loadGameDetail(anon, { gameId: id, groupId: groups.a, viewerPuuid, timeZone: TZ });
      if (view === null) throw new Error('expected a game');
      return view;
    };

    it('a rolled game: the run, the scoreboard with deltas, the viewer marked', async () => {
      const view = await detail(game.rolled, puuids[2] as string);
      expect(view.receipt.kind).toBe('rolled');
      expect(view.blue.seats).toHaveLength(5);
      expect(view.blue.seats.find((seat) => seat.isViewer)?.name).toBe('Gamer2');
      expect(view.blue.seats.every((seat) => seat.delta !== null && seat.vision === 20)).toBe(true);
      const html = renderToStaticMarkup(createElement(GameDetail, { game: view, backHref: '/g/x/games' }));
      expect(html).toContain('The odds were');
      expect(html).toContain('21 min');
    });

    it('a backfilled game shows pre-game odds; a missing mu_before says No odds for this game', async () => {
      const backfilled = renderToStaticMarkup(
        createElement(GameDetail, { game: await detail(game.backfilled), backHref: '/g/x/games' }),
      );
      expect(backfilled).toContain('Pre-game odds');
      expect(backfilled).toContain('Kustom didn&#x27;t pick these teams.');
      const noOdds = renderToStaticMarkup(
        createElement(GameDetail, { game: await detail(game.noOdds), backHref: '/g/x/games' }),
      );
      expect(noOdds).toContain('No odds for this game.');
      expect(noOdds).not.toContain('Pre-game odds');
    });

    it('a changed-teams game keeps the run for the disclosure; an ARAM makes no rating claim', async () => {
      const changed = await detail(game.changed);
      expect(changed.receipt).toMatchObject({ kind: 'pre-game', reason: 'teams-changed' });
      const aram = await detail(game.aram);
      expect(aram.aram).toBe(true);
      expect(aram.receipt.kind).toBe('none');
      expect([...aram.blue.seats, ...aram.red.seats].every((seat) => seat.delta === null)).toBe(true);
    });
  });

  describe('review fixes (M14.16 round 1)', () => {
    const padList = (filters: Partial<Parameters<typeof loadGamesList>[1]['filters']> = {}) =>
      loadGamesList(anon, {
        groupId: groups.pad,
        viewerPuuid: null,
        timeZone: TZ,
        now: NOW,
        filters: { window: 'all-time', mode: 'sr', player: null, page: 1, ...filters },
      });

    it('sorts padded and blank modes onto the same map the calibration rule does', async () => {
      const modes = [' Classic ', '', 'ARAM ', ' aram', 'KIWI'];
      const ids: Record<string, string> = {};
      for (const [i, mode] of modes.entries()) {
        ids[mode] = await insertGame({
          groupId: groups.pad,
          startedAt: `2026-06-0${i + 1}T19:00:00Z`,
          mode,
          blue: B5,
          red: R5,
        });
      }
      const rift = (await padList()).items.map((item) => item.id).sort();
      const aram = (await padList({ mode: 'aram' })).items.map((item) => item.id).sort();
      const { gameModeFromRaw, matchesQueue } = await import('@/lib/games/queue');
      const expect_ = (queue: 'sr' | 'aram') =>
        modes
          .filter((mode) => matchesQueue(gameModeFromRaw({ gameMode: mode }), queue))
          .map((mode) => ids[mode])
          .sort();
      expect(rift).toEqual(expect_('sr'));
      expect(aram).toEqual(expect_('aram'));
      expect(rift).toHaveLength(2);
      expect(aram).toHaveLength(2);
    });

    it('a page past the end is the last page, never a 416 or a 500; page 0 or below is page 1', async () => {
      const far = await padList({ page: 999 });
      expect(far.filters.page).toBe(1);
      expect(far.items).toHaveLength(2);
      for (const page of [0, -3]) {
        const low = await padList({ page });
        expect(low.filters.page).toBe(1);
        expect(low.items).toHaveLength(2);
      }
      // An empty filter past the end is an empty first page.
      const none = await padList({ window: 'tonight', page: 999 });
      expect(none.filters.page).toBe(1);
      expect(none.items).toEqual([]);
    });
  });

  describe('size', () => {
    it('renders the all-time first page of a 500-game group under 300 KB of HTML (report)', async () => {
      const base = Date.parse('2026-01-01T19:00:00Z');
      const games = Array.from({ length: 500 }, (_, i) => {
        lcu += 1;
        return {
          group_id: groups.big,
          lcu_game_id: lcu,
          started_at: new Date(base + i * 3_600_000).toISOString(),
          duration_s: 1_500,
          winning_side: i % 2 === 0 ? 100 : 200,
          // A real end-of-game block is tens of KB; the list must never ship it.
          raw: { gameMode: 'CLASSIC', padding: 'x'.repeat(20_000) },
        };
      });
      const ids: string[] = [];
      for (let from = 0; from < games.length; from += 100) {
        const { data, error } = await db
          .from('games')
          .insert(games.slice(from, from + 100))
          .select('id');
        if (error) throw new Error(error.message);
        ids.push(...(data ?? []).map((row) => row.id));
      }
      const rows = ids.flatMap((gameId) =>
        [...B5, ...R5].map((i, seat) => ({
          game_id: gameId,
          group_id: groups.big,
          player_id: playerIds[i] as string,
          side: seat < 5 ? 100 : 200,
          role: ROLES[seat % 5] ?? 'top',
          kills: 4,
          deaths: 4,
          assists: 4,
          gold: 10_000,
          damage_to_champs: 15_000,
          cs: 150,
          mu_before: 25,
          sigma_before: 6,
          mu_after: 25.3,
          sigma_after: 5.9,
        })),
      );
      for (let from = 0; from < rows.length; from += 1_000) {
        const { error } = await db.from('game_players').insert(rows.slice(from, from + 1_000));
        if (error) throw new Error(error.message);
      }

      const view = await loadGamesList(anon, {
        groupId: groups.big,
        viewerPuuid: puuids[0] as string,
        timeZone: TZ,
        filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
      });
      expect(view.total).toBe(500);
      expect(view.items).toHaveLength(25);
      expect(view.pages).toBe(20);
      const html = renderToStaticMarkup(createElement(GamesList, { view, base: '/g/big/games' }));
      const kb = Buffer.byteLength(html) / 1024;
      console.info(`M14.16: all-time /games first page, 500-game group: ${kb.toFixed(1)} KB of HTML`);
      expect(kb).toBeLessThan(300);
    }, 120_000);
  });
}
