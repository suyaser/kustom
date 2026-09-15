import { randomUUID } from 'node:crypto';
import { displayRating, provisionalSeed, seedFromRank } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlayerBoardView } from '@/lib/board/types';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `/leaderboard` and `/p/[puuid]` against the Supabase CLI local stack (M3.5, M3.8, M3.10).
 *
 * What it proves that a component test cannot: both pages are assembled **with the anon key**,
 * through RLS, from real rows — the ordering is the database's rows put through
 * `provenRating`, the names come out of `players_public` for the ids being rendered, and a
 * player with a null name reaches the page as `Someone` with no puuid anywhere near it.
 *
 * Rows are namespaced by a run id and deleted afterwards; the active season is shared with
 * every other file here, so nothing asserts an absolute rank — only the order of this run's
 * own three players, which is what the rule is about.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the board against the local Supabase stack', () => {
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
  const { BoardView } = await import('./_board/BoardView');
  const { PlayerView } = await import('./_board/PlayerView');
  const { NAMELESS_HINT } = await import('@/lib/tonight/copy');
  const { RATING_EXPLANATION } = await import('@/lib/board/copy');
  /**
   * This file is the **board's** half of `/p/[puuid]`. M5.20's sections under the chart are read
   * through `lib/stats` and are covered against this same stack in
   * `playerStats.integration.test.ts`, so the renders below pass the empty view and assert
   * nothing about them.
   */
  const { emptyPlayerStats } = await import('@/lib/testing/boardFixtures');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const puuid = {
    zoe: `it-${runId}-lb0`,
    nameless: `it-${runId}-lb1`,
    ali: `it-${runId}-lb2`,
    // The window pair (M5.12): two games last week and one this week, at fixed instants.
    weekly: `it-${runId}-lb3`,
    other: `it-${runId}-lb4`,
  };

  /**
   * The rendered page as a reader sees it: no tags, and the entities React escapes decoded.
   * The apostrophe in `someone's` comes out of `renderToStaticMarkup` as `&#x27;`, and a
   * puuid is in the href of a row's link on purpose — the page is keyed by PUUID — so "no
   * puuid on the page" is a statement about text, not about markup.
   */
  function textOf(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /** `null` is "no such puuid", which the page turns into a 404; every test below has one. */
  function found(player: PlayerBoardView | null): PlayerBoardView {
    expect(player).not.toBeNull();
    return player as PlayerBoardView;
  }

  /**
   * **`All time` is the window M3.5 shipped**, so every assertion pinned before M5.12 reads
   * the board through it and the numbers are byte-identical. The window cases below pass their
   * own `now`, because a board that depended on the wall clock of the machine running the
   * suite would pass all week and fail on a Sunday morning.
   */
  const ALL_TIME = { window: 'all-time' } as const;

  /**
   * The three players M3.5's assertions are pinned on. The window pair below plays its own
   * games at its own instants and is filtered out of them, so those numbers do not move.
   */
  const PINNED = [puuid.zoe, puuid.nameless, puuid.ali];

  /**
   * Wednesday 2026-06-10, 21:00 Cairo. This week is Sunday the 7th 06:00 to Sunday the 14th
   * 06:00; last week is 31 May to 7 June (M5.9, anchored on Sunday by M5.34).
   *
   * **Deliberately a pair of weeks in the past.** The `All time` block's games are inserted at
   * the wall clock of the run, so a fixture week that could contain "now" would put those
   * players on this board on some days of the year and not others.
   */
  const NOW = new Date('2026-06-10T18:00:00Z');
  const WEEK = { now: NOW } as const;

  let seasonId = '';
  /**
   * The lobby Zoe's newest game was born in, and the split the balancer chose in it: the one
   * fixture in this file with a stored win chance, which is what M5.15's sentence needs.
   */
  let lobbyId = '';
  const playerIds: Record<keyof typeof puuid, string> = {
    zoe: '',
    nameless: '',
    ali: '',
    weekly: '',
    other: '',
  };
  const gameIds: string[] = [];
  /**
   * Seven more seats, so the two `All time` games below are **ten-row games**.
   *
   * Since M5.21 the board's streak is folded over the games `gateGame` counts — ten rows, five
   * a side — which is the same universe `/p/[puuid]` folds. A three-row fixture game is not a
   * game the pipeline can produce, so a streak read off one would be asserting against a state
   * that cannot exist. These fill the seats nothing asserts on: no `ratings` row, no name in
   * any expectation but the lineup of Zoe's own side.
   */
  const fillerPuuids = Array.from({ length: 7 }, (_, index) => `it-${runId}-fil${index}`);
  const fillerIds: string[] = [];

  /**
   * Eight more seats for the **window** games below, so those are ten-row games too.
   *
   * Since M7.3 a week window is folded from scratch with `rateGameWeekly`, which takes five and
   * five: a two-row fixture game would be skipped by that fold and the week's numbers would be
   * ten seeds. These are Gold IV like the pair, rated flat at 24 by the stored fold, and nothing
   * in this file asserts on them.
   */
  const weekFillerPuuids = Array.from({ length: 8 }, (_, index) => `it-${runId}-wfil${index}`);
  const weekFillerIds: string[] = [];

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert([
        { puuid: puuid.zoe, display_name: 'Zoe', rank_tier: 'GOLD', rank_division: 'IV' },
        // The M3.10 case: the database has never been told this player's name. Diamond I on
        // purpose since 2026-09-16 — a rank whose seed (1920) is nowhere near the provisional
        // one (1200), so the board reading the rank instead of the seed would fail loudly here
        // and not hide behind `SILVER`'s mu happening to be `unrankedMu`.
        { puuid: puuid.nameless, rank_tier: 'DIAMOND', rank_division: 'I' },
        { puuid: puuid.ali, display_name: 'Ali', rank_tier: 'GOLD', rank_division: 'IV' },
        { puuid: puuid.weekly, display_name: 'Wren', rank_tier: 'GOLD', rank_division: 'IV' },
        { puuid: puuid.other, display_name: 'Otto', rank_tier: 'GOLD', rank_division: 'IV' },
        ...fillerPuuids.map((id, index) => ({
          puuid: id,
          display_name: `Fil${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
        ...weekFillerPuuids.map((id, index) => ({
          puuid: id,
          display_name: `Wil${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      ])
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) {
      if (row.puuid === puuid.zoe) playerIds.zoe = row.id;
      if (row.puuid === puuid.nameless) playerIds.nameless = row.id;
      if (row.puuid === puuid.ali) playerIds.ali = row.id;
      if (row.puuid === puuid.weekly) playerIds.weekly = row.id;
      if (row.puuid === puuid.other) playerIds.other = row.id;
    }
    // In the order they were asked for, so a seat's role below is the same seat every run.
    for (const id of fillerPuuids) {
      const row = (players ?? []).find((player) => player.puuid === id);
      fillerIds.push(row?.id ?? '');
    }
    for (const id of weekFillerPuuids) {
      const row = (players ?? []).find((player) => player.puuid === id);
      weekFillerIds.push(row?.id ?? '');
    }

    // Two of the three have a rating row; the nameless one has none and is seeded in memory at
    // `provisionalSeed()` — 1200, Proven 0 — the way the first fold will seed them (2026-09-16),
    // and must still appear on the board. Their `DIAMOND I` above is deliberately left in place:
    // it is what the balancer would still guess for them tonight, and the board ignoring it is
    // the point of the assertions below.
    await db.from('ratings').insert([
      { player_id: playerIds.zoe, season_id: seasonId, mu: 25.2, sigma: 5, games: 2, wins: 1 },
      { player_id: playerIds.ali, season_id: seasonId, mu: 22, sigma: 6, games: 2, wins: 1 },
      // Where the fold left the window pair after all three of their games.
      { player_id: playerIds.weekly, season_id: seasonId, mu: 25.8, sigma: 5, games: 3, wins: 2 },
      { player_id: playerIds.other, season_id: seasonId, mu: 21.3, sigma: 5, games: 3, wins: 1 },
    ]);

    const startedAt = Date.now();
    // A lobby with a chosen split, for M5.15: `blue_win_prob` 0.58 is what the balancer gave
    // blue, so Zoe (side 100) reads `the 58% side` and Ali (side 200) would read `42%`.
    const { data: lobby } = await db
      .from('lobbies')
      .insert({ lcu_party_id: `it-${runId}-party`, status: 'finished', lobby_name: 'Customs 10 Sep #1' })
      .select('id')
      .single();
    lobbyId = lobby?.id ?? '';
    await db.from('splits').insert({
      lobby_id: lobbyId,
      rank: 1,
      blue: [1, 2, 3, 4, 5],
      red: [6, 7, 8, 9, 10],
      gap: 40,
      blue_win_prob: 0.58,
      score: 1,
      off_role_count: 0,
      is_chosen: true,
      explanation: 'Even split.',
      roster_key: `it-${runId}-roster`,
    });

    for (const [index, game] of [
      {
        winning_side: 100,
        minutesAgo: 60,
        zoeRole: 'top',
        // The three lanes Zoe and the nameless seat leave on blue, in seat order.
        blueRoles: ['mid', 'adc', 'support'],
        muBefore: 25,
        muAfter: 25.6,
      },
      {
        winning_side: 200,
        minutesAgo: 20,
        zoeRole: 'mid',
        blueRoles: ['top', 'adc', 'support'],
        muBefore: 25.6,
        muAfter: 25.2,
      },
    ].entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`8${(startedAt % 1_000_000_00) * 10 + index}`),
          season_id: seasonId,
          started_at: new Date(startedAt - game.minutesAgo * 60_000).toISOString(),
          duration_s: 2_000,
          winning_side: game.winning_side,
          // Only the newest of the two came from a lobby. The older one is the backfilled
          // case: no lobby, no split, no chance — and the row still prints its result.
          lobby_id: index === 1 ? lobbyId : null,
          raw: {},
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      await db.from('game_players').insert([
        {
          game_id: gameId,
          player_id: playerIds.zoe,
          side: 100,
          role: game.zoeRole as 'top' | 'mid',
          mu_before: game.muBefore,
          sigma_before: 5,
          mu_after: game.muAfter,
          sigma_after: 5,
        },
        {
          game_id: gameId,
          player_id: playerIds.ali,
          side: 200,
          role: 'support',
          mu_before: 22,
          sigma_before: 6,
          mu_after: 22,
          sigma_after: 6,
        },
        // On Zoe's side and never rated: the lineup still prints them, and they still have no
        // games of their own.
        { game_id: gameId, player_id: playerIds.nameless, side: 100, role: 'jungle' },
        // The other seven seats, so this is a game the gate counts. Rated flat at 25, so they
        // move nobody's numbers and appear in no assertion but Zoe's own lineup.
        ...fillerIds.map((id, seat) => ({
          game_id: gameId,
          player_id: id,
          side: seat < 3 ? 100 : 200,
          role: (seat < 3
            ? (game.blueRoles[seat] as string)
            : (['top', 'jungle', 'mid', 'adc'][seat - 3] as string)) as
            | 'top'
            | 'jungle'
            | 'mid'
            | 'adc'
            | 'support',
          mu_before: 25,
          sigma_before: 5,
          mu_after: 25,
          sigma_after: 5,
        })),
      ]);
    }

    /**
     * The window pair's three games, at **fixed** instants either side of a Sunday 06:00
     * boundary (M5.9): two last week and one this week, relative to {@link NOW}. Wren climbs
     * 25 → 25.6 → 25.2 → 25.8; Otto is on the other side of all three.
     */
    for (const [index, game] of [
      { startedAt: '2026-06-03T19:00:00Z', winning_side: 100, wren: [25, 25.6], otto: [22, 21.4] },
      { startedAt: '2026-06-05T19:00:00Z', winning_side: 200, wren: [25.6, 25.2], otto: [21.4, 21.9] },
      { startedAt: '2026-06-09T19:00:00Z', winning_side: 100, wren: [25.2, 25.8], otto: [21.9, 21.3] },
    ].entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`9${(startedAt % 1_000_000_00) * 10 + index}`),
          season_id: seasonId,
          started_at: game.startedAt,
          duration_s: 2_000,
          winning_side: game.winning_side,
          raw: {},
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      await db.from('game_players').insert([
        {
          game_id: gameId,
          player_id: playerIds.weekly,
          side: 100,
          role: 'mid',
          mu_before: game.wren[0] as number,
          sigma_before: 5,
          mu_after: game.wren[1] as number,
          sigma_after: 5,
        },
        {
          game_id: gameId,
          player_id: playerIds.other,
          side: 200,
          role: 'adc',
          mu_before: game.otto[0] as number,
          sigma_before: 5,
          mu_after: game.otto[1] as number,
          sigma_after: 5,
        },
        // Four each side, so the weekly fold (M7.3) has five and five to hand to core.
        ...weekFillerIds.map((id, seat) => ({
          game_id: gameId,
          player_id: id,
          side: seat < 4 ? 100 : 200,
          role: ['top', 'jungle', 'adc', 'support'][seat % 4] as string as
            | 'top'
            | 'jungle'
            | 'mid'
            | 'adc'
            | 'support',
          mu_before: 24,
          sigma_before: 5,
          mu_after: 24,
          sigma_after: 5,
        })),
      ]);
    }
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    // The splits go with it: `splits.lobby_id` cascades.
    if (lobbyId !== '') await db.from('lobbies').delete().eq('id', lobbyId);
    const ids = [...Object.values(playerIds), ...fillerIds, ...weekFillerIds].filter((id) => id !== '');
    if (ids.length > 0) {
      await db.from('ratings').delete().in('player_id', ids);
      await db.from('players').delete().in('id', ids);
    }
  });

  describe('the board with the anon key', () => {
    it('orders this run three by Proven, and prints the number it ordered them by', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const mine = board.rows.filter((row) => PINNED.includes(row.puuid));

      expect(mine.map((row) => row.puuid)).toEqual([puuid.zoe, puuid.ali, puuid.nameless]);
      // `mu - 2 * sigma`, times sixty: 25.2 - 10 = 15.2, 22 - 12 = 10, and the un-folded seat at
      // `provisionalSeed()`'s 20 - 24 = -4, floored to 0 by `provenRating` (2026-09-16). Under
      // the old rule this seat read Diamond I's 1920 / 1520 and sorted *second*; a player with
      // no customs is not placed by solo queue any more, they are simply unproven.
      expect(mine.map((row) => row.proven)).toEqual([912, 600, 0]);
      // And the number people arrive knowing, which is `round(mu * 60)`.
      expect(mine.map((row) => row.rating)).toEqual([1_512, 1_320, 1_200]);
    });

    it('counts the games and the wins the fold recorded, and the run at the front', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const zoe = board.rows.find((row) => row.puuid === puuid.zoe);
      const ali = board.rows.find((row) => row.puuid === puuid.ali);

      expect(zoe).toMatchObject({ games: 2, wins: 1, losses: 1, settling: true });
      // Newest game first: Zoe was on the losing side of it, Ali on the winning side.
      expect(zoe?.streak).toEqual({ kind: 'L', length: 1 });
      expect(ali?.streak).toEqual({ kind: 'W', length: 1 });
    });

    it('keeps a seeded player with no games on the board, at the bottom, with `0 games`', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const seeded = board.rows.find((row) => row.puuid === puuid.nameless);

      expect(seeded).toMatchObject({ name: null, games: 0, wins: 0, settling: true });
      /**
       * **And the number beside them is the seed, not their rank** (2026-09-16). This player
       * wears `DIAMOND I` in `players`, which is still what `lib/ingest/balance.ts` would guess
       * to form tonight's split — the board does not read it. The third line is what makes the
       * first two a test rather than a coincidence: the rank estimate is a different number, so
       * these assertions could not pass on either code path by accident.
       */
      expect(seeded?.rating).toBe(displayRating(provisionalSeed().mu));
      expect(seeded?.proven).toBe(0);
      expect(displayRating(seedFromRank('DIAMOND', 'I').mu)).not.toBe(displayRating(provisionalSeed().mu));
      /**
       * **The rated-vs-counted seam, pinned** (M5.21). This player sat on Zoe's side in both
       * games and the fold rated neither of their rows, so `ratings` says `0 games · 0W 0L`
       * while the streak — folded over the games the *gate* counts, exactly as `/p/[puuid]`
       * folds them — says they lost the last one. It is the state a backfill leaves behind
       * until `rebuild-ratings` runs, and it is documented rather than papered over: a row
       * whose streak was read from a second, narrower universe was the defect M5.21 removed.
       */
      expect(seeded?.streak).toEqual({ kind: 'L', length: 1 });
    });

    it('leaves the breakdown empty unless the page asks for it', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const zoe = board.rows.find((row) => row.puuid === puuid.zoe);

      expect(zoe?.breakdown).toEqual([]);
    });

    it('lists Zoe rated games newest first when the board asks for the expand', async () => {
      const board = await loadBoard(anon, { ...ALL_TIME, includeBreakdown: true });
      const zoe = board.rows.find((row) => row.puuid === puuid.zoe);
      const seeded = board.rows.find((row) => row.puuid === puuid.nameless);

      expect(
        zoe?.breakdown.map((game) => ({ won: game.won, muBefore: game.muBefore, muAfter: game.muAfter })),
      ).toEqual([
        { won: false, muBefore: 25.6, muAfter: 25.2 },
        { won: true, muBefore: 25, muAfter: 25.6 },
      ]);
      // A seed the fold never rated has nothing to open.
      expect(seeded?.breakdown).toEqual([]);
    });

    it('renders the nameless row as `Someone`, with the hint once and no puuid', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const html = renderToStaticMarkup(createElement(BoardView, { board, viewerPuuid: null }));

      const text = textOf(html);
      expect(text).toContain('Someone');
      // Never as text: the puuid is in the row's href, which is how the page is keyed.
      expect(text).not.toContain(puuid.nameless);
      expect(text.split(NAMELESS_HINT)).toHaveLength(2);
    });
  });

  /**
   * The windowed board (M5.12), against real rows and the anon key.
   *
   * **The month windows are what this block pins**, and they are the stored fold exactly as
   * M5.12 shipped it: a window changes which games are looked at, and nothing about the two
   * numbers or the sort. The two **week** windows read the weekly track since M7.3 — their
   * membership, their empty states and their dates are here, and everything the weekly fold
   * computes is in `weekBoard.integration.test.ts`.
   */
  describe('the board through a window', () => {
    it('lists only the players who played inside it', async () => {
      const lastWeek = await loadBoard(anon, { window: 'last-week', ...WEEK });
      const thisWeek = await loadBoard(anon, { window: 'this-week', ...WEEK });

      // Membership, not order: a week is ordered by the weekly fold (M7.3), and who is on it
      // is the question this test asks.
      const pair = (board: { rows: { puuid: string }[] }): string[] =>
        board.rows
          .map((row) => row.puuid)
          .filter((id) => id === puuid.weekly || id === puuid.other)
          .sort();

      expect(pair(lastWeek)).toEqual([puuid.weekly, puuid.other].sort());
      expect(pair(thisWeek)).toEqual([puuid.weekly, puuid.other].sort());
      // The three players of the `All time` block played at the wall clock of the test run and
      // are in neither of these two fixed weeks: the board is who played *then*. The nameless
      // one has no rated row at all and is on no window's board at any time.
      for (const board of [lastWeek, thisWeek]) {
        const puuids = board.rows.map((row) => row.puuid);
        expect(puuids).not.toContain(puuid.zoe);
        expect(puuids).not.toContain(puuid.nameless);
      }
    });

    /**
     * **The board as it stood when the window closed**, on the windows that still read the
     * stored fold. All three of the pair's games are in June, so `This month` is Wren as of the
     * last of them — `mu` 25.8 — with the two numbers, the climb and the chip untouched by
     * M7.3.
     */
    it('is each player as of their last counted game inside the window', async () => {
      const board = await loadBoard(anon, { window: 'this-month', ...WEEK });
      const wren = board.rows.find((row) => row.puuid === puuid.weekly);

      expect(wren?.track).toBe('all-time');
      expect(wren?.rating).toBe(1_548);
      // `mu - 2σ` as of that game: 25.8 - 10 = 15.8, times sixty.
      expect(wren?.proven).toBe(948);
      expect(wren).toMatchObject({ games: 3, wins: 2, losses: 1 });
      // The climb is the two mu values, never a formatted delta: 25 in, 25.8 out.
      expect(wren?.climb).toEqual({ muBefore: 25, muAfter: 25.8 });
    });

    it('opens the month into those rated games when the board asks', async () => {
      const board = await loadBoard(anon, { window: 'this-month', includeBreakdown: true, ...WEEK });
      const wren = board.rows.find((row) => row.puuid === puuid.weekly);

      expect(
        wren?.breakdown.map((game) => ({ won: game.won, muBefore: game.muBefore, muAfter: game.muAfter })),
      ).toEqual([
        { won: true, muBefore: 25.2, muAfter: 25.8 },
        { won: false, muBefore: 25.6, muAfter: 25.2 },
        { won: true, muBefore: 25, muAfter: 25.6 },
      ]);
    });

    it('sorts a month window on Proven, and never on who climbed most', async () => {
      const board = await loadBoard(anon, { window: 'this-month', ...WEEK });
      const mine = board.rows.filter((row) => row.puuid === puuid.weekly || row.puuid === puuid.other);

      // Otto climbed in June (22 → 21.3 is a loss, but he took the middle game) and Wren is
      // still first, because the board sorts on the number it prints.
      expect(mine.map((row) => row.puuid)).toEqual([puuid.weekly, puuid.other]);
      expect(mine.map((row) => row.proven)).toEqual([948, 678]);
    });

    it('carries the whole history into the settling chip, not the window', async () => {
      const board = await loadBoard(anon, { window: 'this-month', ...WEEK });
      const wren = board.rows.find((row) => row.puuid === puuid.weekly);

      // Three games in the month and three in the `ratings` row: the chip is a fact about the
      // rating. (A week window carries no chip at all — M7.3.)
      expect(wren?.games).toBe(3);
      expect(wren?.settling).toBe(true);
    });

    /**
     * The header slot, from the database (M5.12): the window's dates and its **counted** games
     * — a count of games, not of scoreboard rows, and not of games nobody rated.
     */
    it('names the window and counts its games', async () => {
      const week = await loadBoard(anon, { window: 'last-week', ...WEEK });

      expect(week.range).toBe('Sunday 31 May to Saturday 6 Jun');
      // Two games last week; the third is in the running one.
      expect(week.games).toBe(2);

      const month = await loadBoard(anon, { window: 'this-month', ...WEEK });
      expect(month.range).toBe('June');
      expect(month.games).toBe(3);
    });

    it('dates all time from the first counted game there has ever been', async () => {
      const all = await loadBoard(anon, ALL_TIME);

      // Other files share this database, so the day is theirs to move; the shape is not.
      expect(all.range).toMatch(/^Since \d{1,2} [A-Z][a-z]{2} \d{4}$/);
      expect(all.games).toBeGreaterThanOrEqual(3);
    });

    it('is an empty board for a window nobody played in', async () => {
      // May: the month before the pair's first game, a closed window with nothing in it.
      const board = await loadBoard(anon, { window: 'last-month', ...WEEK });

      expect(board.window).toBe('last-month');
      expect(board.rows.filter((row) => row.puuid.startsWith(`it-${runId}-`))).toEqual([]);
    });

    it('leaves the range null when the window has no counted games, so the slot says so', async () => {
      // 2019: before this product existed, and before any fixture in this repo.
      const empty = await loadBoard(anon, { window: 'last-month', now: new Date('2019-04-10T18:00:00Z') });

      expect(empty).toMatchObject({ range: null, games: 0, rows: [] });
    });
  });

  describe('the player page through a window', () => {
    it('counts the window games, plots them, and starts the line where the week found them', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.weekly, { window: 'last-week', ...WEEK }));

      expect(player).toMatchObject({ window: 'last-week', games: 2, wins: 1, losses: 1 });
      // The range half, alone: the record beside it already carries the count.
      expect(player.range).toBe('Sunday 31 May to Saturday 6 Jun');
      // As of their last game inside the week, not where they are today.
      expect(player.rating).toBe(1_512);
      // The rating carried **into** the window, labelled `start` on the chart.
      expect(player.reference).toBe(1_500);
      expect(player.history).toEqual([1_500, 1_536, 1_512]);
      expect(player.recent).toHaveLength(2);
    });

    it('is where they are today on `All time`, with the seed line back', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.weekly, ALL_TIME));

      expect(player).toMatchObject({ window: 'all-time', games: 3, wins: 2, losses: 1 });
      // Dated from **their** first counted game, because the page is a person's history.
      expect(player.range).toBe('Since 3 Jun 2026');
      expect(player.rating).toBe(1_548);
      // The neutral first seed is mu 20 (2026-09-16), so 1200 — the seed, not the window's
      // start, and no longer the Gold IV on this player's row.
      expect(player.reference).toBe(1_200);
      expect(player.history).toEqual([1_500, 1_536, 1_512, 1_548]);
    });

    it('keeps a player who did not play in the window on their own page', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.weekly, { window: 'last-month', ...WEEK }));

      expect(player).toMatchObject({ games: 0, wins: 0, losses: 0, range: null });
      // Their number is still theirs: the page is a person, and the empty line says the rest.
      expect(player.rating).toBe(1_548);
      expect(player.history).toEqual([]);
      expect(player.recent).toEqual([]);
    });
  });

  describe('the player page with the anon key', () => {
    it('is the two numbers and the history in started_at order', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));

      expect(player).toMatchObject({ name: 'Zoe', rating: 1_512, proven: 912, games: 2, wins: 1 });
      // The rating carried into the first game, then out of each one: oldest first.
      expect(player.history).toEqual([1_500, 1_536, 1_512]);
      // `By role` moved to `lib/stats` with M5.20 and is read there — one fold of one record,
      // over the games the rating fold counted (`playerStats.integration.test.ts`).
      // Nobody is seeded from their rank any more (2026-09-16): the neutral seed is mu 20, so
      // the reference line is 1200 — in the series' own units, never the seed's ordinal.
      expect(player.reference).toBe(1_200);
    });

    it('lists the recent games newest first, with the five of their own side', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));

      expect(player.recent).toHaveLength(2);
      expect(player.recent[0]?.won).toBe(false);
      expect(player.recent[1]?.won).toBe(true);
      // Zoe's side only, in lane order, names read from `players_public` by these ids. The
      // nameless seat is the `null` at jungle; the other three are the filler seats that make
      // this a ten-row game.
      expect(player.recent[0]?.team.map((seat) => seat.role)).toEqual([
        'top',
        'jungle',
        'mid',
        'adc',
        'support',
      ]);
      expect(player.recent[0]?.team.map((seat) => seat.name)).toEqual(['Fil0', null, 'Zoe', 'Fil1', 'Fil2']);
    });

    it('carries the chance the balancer gave their own side, for a game born in a lobby', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));

      // Newest first: the lobby game, where blue — Zoe's side — was given 58%.
      expect(player.recent[0]?.blueWinProb).toBe(0.58);
      // And the older one has no lobby, so no chance is invented for it (M5.15).
      expect(player.recent[1]?.blueWinProb).toBeNull();
    });

    it('says why each change is the size it is, in one sentence per row', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));
      const text = textOf(
        renderToStaticMarkup(createElement(PlayerView, { player, stats: emptyPlayerStats() })),
      );

      // Zoe was on blue, and the split the group played gave blue 58%.
      expect(text).toContain('As the 58% side.');
      // The backfilled row has no stored chance, so it has no caption at all — and its own
      // numbers are untouched: 25 → 25.6 is 1500 → 1536.
      expect(text).toContain('1536');
      expect(text).not.toContain('As the 50% side.');
      // The seed line, from the same number the chart's hairline is drawn at.
      expect(text).toContain(`Seeded from Gold IV at ${player.reference}, 2 games since.`);
      // And the one line under the list, exactly once.
      expect(text.split(RATING_EXPLANATION)).toHaveLength(2);
    });

    it('renders a nameless teammate as `Someone` and never a puuid', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));
      const html = renderToStaticMarkup(createElement(PlayerView, { player, stats: emptyPlayerStats() }));

      const text = textOf(html);
      expect(text).toContain('Someone');
      expect(text).not.toContain(puuid.nameless);
      expect(text.split(NAMELESS_HINT)).toHaveLength(2);
      // The delta is computed at render and adds up with the rating beside it: the newest
      // game took Zoe from 25.6 to 25.2, which is 1536 to 1512. The delta is one string, so it
      // reads `(−24)` and not `(`, `−24`, `)`, and a loss is `dim` at 400, never coloured by
      // sign. Between the two sits the bare number's visually-hidden noun (M3.19).
      expect(html).toContain('1512<span class="cn-sr"> Rating</span><span class="cn-delta"> (−24)</span>');
    });

    it('is nobody for a puuid the database has never met', async () => {
      expect(await loadPlayerBoard(anon, `it-${runId}-nope`, ALL_TIME)).toBeNull();
    });

    it('reads names through `players_public`, never the base table', async () => {
      const { error } = await anon.from('players').select('puuid').limit(1);

      expect(error).not.toBeNull();
    });
  });
}
