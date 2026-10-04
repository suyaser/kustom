import { randomUUID } from 'node:crypto';
import { displayRating, KUSTOM_START, provisionalSeed, seedFromRank } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlayerBoardView } from '@/lib/board/types';
import { kustomSeat, rOf } from '@/lib/testing/kustomSeat';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `/leaderboard` and `/p/[puuid]` against the Supabase CLI local stack (M3.5, M3.8, M3.10).
 *
 * What it proves that a component test cannot: both pages are assembled **with the anon key**,
 * through RLS, from real rows — the ordering is the database's rows put through
 * `provenRating`, the names come out of `players_public` for the ids being rendered, and a
 * player with a null name reaches the page as `Someone` with no puuid anywhere near it.
 *
 * Rows are namespaced by a run id, live in a **scratch group of this run's own**, and are deleted
 * afterwards. The group is what keeps the window counts exact: a local stack in real use holds
 * the original group's own games (and an interrupted run of this file leaves its own), and a
 * count read across groups would count them too. `All time` lists every player the group knows,
 * so nothing asserts an
 * absolute rank — only the order of this run's own three players, which is what the rule is
 * about.
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
  const { RATING_EXPLANATION } = await import('@/lib/board/copy');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  /** This run's scratch group: every row below is in it and every read is scoped to it. */
  const groupId = randomUUID();
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
  const ALL_TIME = { window: 'all-time', groupId } as const;

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
  const WEEK = { now: NOW, groupId } as const;
  /** Wednesday 2026-05-20: last week is 10 to 16 May, before the pair's first game (M14.48). */
  const BEFORE = { now: new Date('2026-05-20T18:00:00Z'), groupId } as const;
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
   * Ten-row games are the only shape the pipeline produces. These are Gold IV like the pair,
   * rated flat at 24 by the stored fold (so they net +0 on a week), and nothing in this file
   * asserts on them.
   */
  const weekFillerPuuids = Array.from({ length: 8 }, (_, index) => `it-${runId}-wfil${index}`);
  const weekFillerIds: string[] = [];

  beforeAll(async () => {
    const { error: groupError } = await db
      .from('groups')
      .insert({ id: groupId, slug: `it-${runId}`, name: `Board test ${runId}` });
    expect(groupError).toBeNull();

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
      {
        group_id: groupId,
        player_id: playerIds.zoe,
        mu: 25.2,
        sigma: 5,
        r: rOf(25.2),
        games: 2,
        wins: 1,
      },
      {
        group_id: groupId,
        player_id: playerIds.ali,
        mu: 22,
        sigma: 6,
        r: rOf(22),
        games: 2,
        wins: 1,
      },
      // Where the fold left the window pair after all three of their games.
      {
        group_id: groupId,
        player_id: playerIds.weekly,
        mu: 25.8,
        sigma: 5,
        r: rOf(25.8),
        games: 3,
        wins: 2,
      },
      {
        group_id: groupId,
        player_id: playerIds.other,
        mu: 21.3,
        sigma: 5,
        r: rOf(21.3),
        games: 3,
        wins: 1,
      },
    ]);

    const startedAt = Date.now();
    // A lobby with a chosen split, for M5.15: `blue_win_prob` 0.58 is what the balancer gave
    // blue, so Zoe (side 100) reads `the 58% side` and Ali (side 200) would read `42%`.
    const { data: lobby } = await db
      .from('lobbies')
      .insert({
        group_id: groupId,
        lcu_party_id: `it-${runId}-party`,
        status: 'finished',
        lobby_name: 'Customs 10 Sep #1',
      })
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
          group_id: groupId,
          lcu_game_id: Number(`8${(startedAt % 1_000_000_00) * 10 + index}`),
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
          group_id: groupId,
          game_id: gameId,
          player_id: playerIds.zoe,
          side: 100,
          role: game.zoeRole as 'top' | 'mid',
          mu_before: game.muBefore,
          sigma_before: 5,
          mu_after: game.muAfter,
          sigma_after: 5,
          // Both games are this week (they are stamped at the run's clock), from 25 at its start.
          ...kustomSeat(rOf(game.muBefore), rOf(game.muAfter), rOf(25)),
        },
        {
          group_id: groupId,
          game_id: gameId,
          player_id: playerIds.ali,
          side: 200,
          role: 'support',
          mu_before: 22,
          sigma_before: 6,
          mu_after: 22,
          sigma_after: 6,
          ...kustomSeat(rOf(22), rOf(22)),
        },
        // On Zoe's side and never rated: the lineup still prints them, and they still have no
        // games of their own.
        {
          group_id: groupId,
          game_id: gameId,
          player_id: playerIds.nameless,
          side: 100,
          role: 'jungle',
        },
        // The other seven seats, so this is a game the gate counts. Rated flat at 25, so they
        // move nobody's numbers and appear in no assertion but Zoe's own lineup.
        ...fillerIds.map((id, seat) => ({
          group_id: groupId,
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
          ...kustomSeat(rOf(25), rOf(25)),
        })),
      ]);
    }

    /**
     * The window pair's three games, at **fixed** instants either side of a Sunday 06:00
     * boundary (M5.9): two last week and one this week, relative to {@link NOW}. Wren climbs
     * 25 → 25.6 → 25.2 → 25.8; Otto is on the other side of all three.
     */
    // `start`: each one's all-time Rating when that game's week began (the weekly track restarts
    // at 1200 on Sunday 06:00, M18).
    for (const [index, game] of [
      {
        startedAt: '2026-06-03T19:00:00Z',
        winning_side: 100,
        wren: [25, 25.6],
        otto: [22, 21.4],
        start: [25, 22],
      },
      {
        startedAt: '2026-06-05T19:00:00Z',
        winning_side: 200,
        wren: [25.6, 25.2],
        otto: [21.4, 21.9],
        start: [25, 22],
      },
      {
        startedAt: '2026-06-09T19:00:00Z',
        winning_side: 100,
        wren: [25.2, 25.8],
        otto: [21.9, 21.3],
        start: [25.2, 21.9],
      },
    ].entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          group_id: groupId,
          lcu_game_id: Number(`9${(startedAt % 1_000_000_00) * 10 + index}`),
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
          group_id: groupId,
          game_id: gameId,
          player_id: playerIds.weekly,
          side: 100,
          role: 'mid',
          mu_before: game.wren[0] as number,
          sigma_before: 5,
          mu_after: game.wren[1] as number,
          sigma_after: 5,
          ...kustomSeat(
            rOf(game.wren[0] as number),
            rOf(game.wren[1] as number),
            rOf(game.start[0] as number),
          ),
        },
        {
          group_id: groupId,
          game_id: gameId,
          player_id: playerIds.other,
          side: 200,
          role: 'adc',
          mu_before: game.otto[0] as number,
          sigma_before: 5,
          mu_after: game.otto[1] as number,
          sigma_after: 5,
          ...kustomSeat(
            rOf(game.otto[0] as number),
            rOf(game.otto[1] as number),
            rOf(game.start[1] as number),
          ),
        },
        // Four each side, so each game is five and five like every game the pipeline writes.
        ...weekFillerIds.map((id, seat) => ({
          group_id: groupId,
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
          ...kustomSeat(rOf(24), rOf(24)),
        })),
      ]);
    }
  });

  /**
   * Keyed on the scratch group and the run id, never on ids collected during setup, so a setup
   * that failed halfway still leaves nothing behind. Each delete runs whatever the one before it
   * returned. `game_players` goes with its game, and `splits` with its lobby (both cascade).
   */
  afterAll(async () => {
    await db.from('games').delete().eq('group_id', groupId);
    await db.from('lobbies').delete().eq('group_id', groupId);
    await db.from('ratings').delete().eq('group_id', groupId);
    await db.from('players').delete().like('puuid', `it-${runId}-%`);
    await db.from('groups').delete().eq('id', groupId);
  });

  describe('the board with the anon key', () => {
    it('orders this run by Rating, the number it prints, and leaves the unrated seat off', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const mine = board.rows.filter((row) => PINNED.includes(row.puuid));

      // `round(mu * 60)`: 25.2 and 22. The seat the fold never rated has no rated game in the
      // group, so it is not a row (M14.15): it is counted under the board instead.
      expect(mine.map((row) => row.puuid)).toEqual([puuid.zoe, puuid.ali]);
      expect(mine.map((row) => row.rating)).toEqual([1_512, 1_320]);
      expect(board.rows.some((row) => row.puuid === puuid.nameless)).toBe(false);
    });

    it("counts the games and the wins the fold recorded, and settles on core's 10", async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const zoe = board.rows.find((row) => row.puuid === puuid.zoe);

      expect(zoe).toMatchObject({ games: 2, wins: 1, losses: 1, ratedGames: 2, settling: true });
      // All time's change is the whole history: from the seed (1200) to today.
      expect(zoe?.climb).toEqual({ rBefore: KUSTOM_START, rAfter: rOf(25.2) });
    });

    it('renders the board with no Proven, no ordinal and no puuid as text', async () => {
      const board = await loadBoard(anon, ALL_TIME);
      const html = renderToStaticMarkup(
        createElement(BoardView, {
          board,
          viewerPuuid: null,
          sort: 'rating',
          page: 1,
          path: '/g/x/leaderboard',
          playerHref: (id: string) => `/g/x/p/${id}` as never,
        }),
      );

      const text = textOf(html);
      expect(text).not.toMatch(/proven|ordinal/i);
      expect(text).not.toContain(puuid.zoe);
      expect(text).toContain('Zoe');
      expect(displayRating(seedFromRank('DIAMOND', 'I').mu)).not.toBe(displayRating(provisionalSeed().mu));
    });
  });

  /**
   * The windowed board (M5.12), against real rows and the anon key.
   *
   * The two **week** windows rank by net all-time points since M14.57 — their membership, their
   * empty states, their sort and their dates are here, and the net-points arithmetic and the
   * tie-break are in `weekBoard.integration.test.ts`. (The month windows went with M14.48.)
   */
  describe('the board through a window', () => {
    it('lists only the players who played inside it', async () => {
      const lastWeek = await loadBoard(anon, { window: 'last-week', ...WEEK });
      const thisWeek = await loadBoard(anon, { window: 'this-week', ...WEEK });

      // Membership, not order: who is on it is the question this test asks.
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
     * M14.57: a week ranks by net points, the sum of the printed all-time deltas. Wren went
     * +36 then −24 (+12); Otto −36 then +30 (−6). Otto's all-time Rating is far lower too, but
     * the order is the points, and the points are the sum of the rows.
     */
    it('sorts a week window on net points, the sum of the printed deltas', async () => {
      const board = await loadBoard(anon, { window: 'last-week', ...WEEK });
      const wren = board.rows.find((row) => row.puuid === puuid.weekly);
      const otto = board.rows.find((row) => row.puuid === puuid.other);
      expect(wren).toMatchObject({ track: 'week', points: 12, rating: 1_548, wins: 1, losses: 1 });
      expect(otto).toMatchObject({ track: 'week', points: -6, rating: 1_278 });
      const points = board.rows.map((row) => row.points ?? 0);
      expect(points).toEqual([...points].sort((a, b) => b - a));
    });

    it('is one ranked list on a week: only All time has a settling section (lead, 2026-10-03)', async () => {
      const [week, all] = await Promise.all([
        loadBoard(anon, { window: 'last-week', ...WEEK }),
        loadBoard(anon, ALL_TIME),
      ]);
      // Three rated games in the group: settling on All time, one ranked list on the week.
      expect(week.rows.find((row) => row.puuid === puuid.weekly)?.settling).toBe(false);
      expect(all.rows.find((row) => row.puuid === puuid.weekly)?.settling).toBe(true);
      expect(week.rows.every((row) => !row.settling)).toBe(true);
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
    });

    it('dates all time from the first counted game there has ever been', async () => {
      const all = await loadBoard(anon, ALL_TIME);

      // Other files share this database, so the day is theirs to move; the shape is not.
      expect(all.range).toMatch(/^first game \d{1,2} [A-Z][a-z]{2} \d{4}$/);
      expect(all.games).toBeGreaterThanOrEqual(3);
    });

    it('is an empty board for a window nobody played in', async () => {
      // Mid-May: a closed week before the pair's first game, with nothing of theirs in it.
      const board = await loadBoard(anon, { window: 'last-week', ...BEFORE });

      expect(board.window).toBe('last-week');
      expect(board.rows.filter((row) => row.puuid.startsWith(`it-${runId}-`))).toEqual([]);
    });

    it('an empty week still prints its dates (M14.70), with no games counted', async () => {
      // 2019: before this product existed, and before any fixture in this repo.
      const empty = await loadBoard(anon, {
        window: 'last-week',
        now: new Date('2019-04-10T18:00:00Z'),
        groupId,
      });

      expect(empty).toMatchObject({ games: 0, rows: [] });
      expect(empty.range).toMatch(/^Sunday \d{1,2} [A-Z][a-z]{2} to Saturday \d{1,2} [A-Z][a-z]{2}$/);
    });
  });

  describe('the player page through a window', () => {
    /**
     * **M14.57, acceptance 3.** The page a board row links to says the row's own number: the
     * week's net points, beside the all-time Rating, and each recent game's pair is the stored
     * one, so the same game prints the same delta on every tab.
     */
    it('reads a week window as net points and the all-time Rating, to the digit on the board row', async () => {
      const LAST_WEEK = { window: 'last-week', ...WEEK } as const;
      const [player, board, all] = await Promise.all([
        loadPlayerBoard(anon, puuid.weekly, LAST_WEEK).then(found),
        loadBoard(anon, LAST_WEEK),
        loadPlayerBoard(anon, puuid.weekly, ALL_TIME).then(found),
      ]);
      const row = board.rows.find((entry) => entry.puuid === puuid.weekly);

      expect(player).toMatchObject({ window: 'last-week', track: 'week', games: 2, wins: 1, losses: 1 });
      expect(player.range).toBe('Sunday 31 May to Saturday 6 Jun');
      expect(player.points).toBe(row?.points);
      expect(player.points).toBe(12);
      // The all-time Rating: there is no week's Rating any more.
      expect(player.rating).toBe(1_548);
      expect(player.rating).toBe(row?.rating);
      // M18.6 (05-design 11.2): the week chart plots week points from 0.
      expect(player.reference).toBe(0);
      expect(player.history).toEqual([0, 36, 12]);
      // Both games listed, each with its all-time pair (the same the All time tab prints) and its
      // weekly pair; the week total row sums the weekly changes to the points.
      expect(player.recent).toHaveLength(2);
      for (const game of player.recent) {
        const same = all.recent.find((other) => other.gameId === game.gameId);
        expect([game.rBefore, game.rAfter]).toEqual([same?.rBefore, same?.rAfter]);
        expect(game.weekRAfter).not.toBeNull();
      }
      expect(player.weekTotal).toBe(12);
    });

    it('is where they are today on `All time`, with the seed line back', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.weekly, ALL_TIME));

      expect(player).toMatchObject({ window: 'all-time', games: 3, wins: 2, losses: 1 });
      // Dated from **their** first counted game, because the page is a person's history.
      expect(player.range).toBe('first game 3 Jun 2026');
      expect(player.rating).toBe(1_548);
      // The neutral first seed is mu 20 (2026-09-16), so 1200 — the seed, not the window's
      // start, and no longer the Gold IV on this player's row.
      expect(player.reference).toBe(1_200);
      expect(player.history).toEqual([1_500, 1_536, 1_512, 1_548]);
    });

    it('keeps a player who did not play in the window on their own page', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.weekly, { window: 'last-week', ...BEFORE }));

      expect(player).toMatchObject({ games: 0, wins: 0, losses: 0, range: null });
      // The page is still theirs and the empty line says the rest: no points this week, and the
      // all-time Rating is where they are today (M14.57).
      expect(player.track).toBe('week');
      expect(player.points).toBe(0);
      expect(player.rating).toBe(1_548);
      expect(player.history).toEqual([]);
      expect(player.recent).toEqual([]);
    });
  });

  describe('the player page with the anon key', () => {
    it('is the Rating and the history in started_at order', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));

      expect(player).toMatchObject({
        name: 'Zoe',
        rating: 1_512,
        games: 2,
        wins: 1,
        settling: true,
        rank: null,
      });
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

    it('prints each game with its compact receipt and its change, and the explanation once', async () => {
      const player = found(await loadPlayerBoard(anon, puuid.zoe, ALL_TIME));
      const html = renderToStaticMarkup(
        createElement(PlayerView, {
          lens: 'public',
          player,
          group: { name: 'Group' },
          viewerPuuid: null,
          path: `/g/x/p/${puuid.zoe}`,
          gameHref: (id: string) => `/g/x/games/${id}` as never,
          allGamesHref: null,
          timeZone: 'Africa/Cairo',
        }),
      );
      const text = textOf(html);

      // Zoe was on blue, blue was given 58%, and red won: said from the winner's side.
      expect(player.recent[0]?.pickRank).toBe(1);
      expect(text).toContain('Red was 42%. Red won.');
      // The newest game took Zoe from 25.6 to 25.2: 1536 to 1512, a signed loss with words.
      expect(text).toContain('1512');
      expect(text).toContain('−24');
      expect(text).toContain('lost 24');
      expect(text).toContain(`Started at ${player.reference}, 2 rated games since.`);
      expect(text.split(RATING_EXPLANATION)).toHaveLength(2);
      expect(text).not.toMatch(/proven|ordinal/i);
      expect(text).not.toContain(puuid.nameless);
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
