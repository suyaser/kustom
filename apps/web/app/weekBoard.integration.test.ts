import { randomUUID } from 'node:crypto';
import { displayRating, ordinal, type Rating, rateGameWeekly, seedFromRank } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * **The weekly board** (M7.3), against the Supabase CLI local stack.
 *
 * `This week` and `Last week` are not the stored rating read through a date filter any more:
 * they are a second fold, from each player's seed, over that week's rated games, with M7.2's
 * `rateGameWeekly`. What this file proves, and a unit test cannot, is that the fold reads the
 * rows the board counts, through RLS and the anon key, and that the page built out of them
 * prints the number it sorted on and no Proven anywhere.
 *
 * **The fixture is two players and the eighteen around them.**
 *
 * - **Zoya** plays twice this week and wins both, alongside four much stronger friends against
 *   five much weaker ones — so her two wins are worth little each.
 * - **Adel** plays all eight of his nights and takes four, against opponents seeded like him.
 *
 * Their `ratings` rows are identical, down to the seed, and their names put Adel first on any
 * board that has to fall back to the name tie-break. So `All time` reads `Adel, Zoya` and the
 * week reads `Zoya, Adel` — and Adel's weekly **Proven** is the higher of the two, because
 * eight games shrink a sigma four games cannot. The week puts Zoya first anyway. That is the
 * decision M7.3 exists to carry out, and this fixture is the one shape that can fail it.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the weekly board against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { BoardView } = await import('./_board/BoardView');
  const { PROVEN_LABEL, RATING_LABEL, SETTLING_CHIP, SETTLING_SENTENCE, WEEK_BOARD_SENTENCE } = await import(
    '@/lib/board/copy'
  );

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);

  /**
   * Wednesday 2026-03-11, 20:00 Cairo: this week is Sunday the 8th 06:00 to Sunday the 15th
   * (M5.9, anchored on Sunday by M5.34). A fixed week in the past, like every other window
   * fixture in this app, so the board does not depend on the day the suite runs.
   */
  const NOW = new Date('2026-03-11T18:00:00Z');
  const WEEK = { now: NOW } as const;
  const THIS_WEEK = { window: 'this-week', ...WEEK } as const;
  const LAST_WEEK = { window: 'last-week', ...WEEK } as const;
  const THIS_MONTH = { window: 'this-month', ...WEEK } as const;
  const ALL_TIME = { window: 'all-time' } as const;

  const id = (suffix: string): string => `it-${runId}-${suffix}`;

  /** The two the acceptance cases are about. `Adel` sorts first on any name tie-break. */
  const ZOYA = id('zoya');
  const ADEL = id('adel');
  /** Zoya's four friends and the five they beat; Adel's four and the five he splits with. */
  const ZOYA_MATES = Array.from({ length: 4 }, (_, index) => id(`zm${index}`));
  const ZOYA_OPPS = Array.from({ length: 5 }, (_, index) => id(`zo${index}`));
  const ADEL_MATES = Array.from({ length: 4 }, (_, index) => id(`am${index}`));
  const ADEL_OPPS = Array.from({ length: 5 }, (_, index) => id(`ao${index}`));

  /**
   * One rank per player, and **the rank is the whole fixture**: the weekly fold seeds from it,
   * so the ranks below are what make Zoya's two wins small and Adel's eight games ordinary.
   */
  const RANK: Readonly<Record<string, readonly [string, string]>> = {
    [ZOYA]: ['GOLD', 'IV'],
    [ADEL]: ['GOLD', 'IV'],
    ...Object.fromEntries(ZOYA_MATES.map((puuid) => [puuid, ['MASTER', 'IV'] as const])),
    ...Object.fromEntries(ZOYA_OPPS.map((puuid) => [puuid, ['IRON', 'IV'] as const])),
    ...Object.fromEntries(ADEL_MATES.map((puuid) => [puuid, ['GOLD', 'IV'] as const])),
    ...Object.fromEntries(ADEL_OPPS.map((puuid) => [puuid, ['GOLD', 'IV'] as const])),
  };

  const EVERYONE = Object.keys(RANK);
  const seedOf = (puuid: string): Rating => {
    const rank = RANK[puuid] as readonly [string, string];
    return seedFromRank(rank[0], rank[1]);
  };

  const NAMES: Readonly<Record<string, string>> = {
    [ZOYA]: 'Zoya',
    [ADEL]: 'Adel',
  };

  /** Where the stored fold left them: **identical for Zoya and Adel**, which is the point. */
  const STORED = { mu: 27.5, sigma: 5.5 } as const;

  interface Fixture {
    startedAt: string;
    blue: readonly string[];
    red: readonly string[];
    winningSide: 100 | 200;
  }

  const zoyaGame = (startedAt: string, winningSide: 100 | 200): Fixture => ({
    startedAt,
    blue: [ZOYA, ...ZOYA_MATES],
    red: ZOYA_OPPS,
    winningSide,
  });

  const adelGame = (startedAt: string, winningSide: 100 | 200): Fixture => ({
    startedAt,
    blue: [ADEL, ...ADEL_MATES],
    red: ADEL_OPPS,
    winningSide,
  });

  /** Zoya: two games, two wins. Adel: eight games, `L W L W W L W L` — 4W 4L. */
  const THIS_WEEK_GAMES: Fixture[] = [
    zoyaGame('2026-03-09T19:00:00Z', 100),
    zoyaGame('2026-03-09T20:00:00Z', 100),
    adelGame('2026-03-09T19:30:00Z', 200),
    adelGame('2026-03-09T20:30:00Z', 100),
    adelGame('2026-03-10T19:00:00Z', 200),
    adelGame('2026-03-10T20:00:00Z', 100),
    adelGame('2026-03-10T21:00:00Z', 100),
    adelGame('2026-03-11T19:00:00Z', 200),
    adelGame('2026-03-11T20:00:00Z', 100),
    adelGame('2026-03-11T21:00:00Z', 200),
  ];

  /** Two games in the week before, so `Last week` is a board of its own: one each. */
  const LAST_WEEK_GAMES: Fixture[] = [
    zoyaGame('2026-03-03T19:00:00Z', 100),
    adelGame('2026-03-04T19:00:00Z', 200),
  ];

  const ALL_GAMES = [...LAST_WEEK_GAMES, ...THIS_WEEK_GAMES];

  /**
   * The week, folded here from the two things the rule is made of: the seed each player starts
   * on, and `rateGameWeekly` applied in `started_at` order over that window's games.
   *
   * Written out rather than imported from the loader, so the test states the contract instead
   * of asserting that the loader agrees with itself.
   */
  function expectedWeek(games: readonly Fixture[]): Map<string, Rating> {
    const current = new Map<string, Rating>(EVERYONE.map((puuid) => [puuid, seedOf(puuid)]));

    for (const fixture of [...games].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) {
      // Each side by puuid ascending, the order both folds hand to core.
      const blue = [...fixture.blue].sort();
      const red = [...fixture.red].sort();
      const rated = rateGameWeekly(
        blue.map((puuid) => current.get(puuid) as Rating),
        red.map((puuid) => current.get(puuid) as Rating),
        fixture.winningSide,
      );
      blue.forEach((puuid, index) => {
        current.set(puuid, rated.blue[index] as Rating);
      });
      red.forEach((puuid, index) => {
        current.set(puuid, rated.red[index] as Rating);
      });
    }
    return current;
  }

  const ids = new Map<string, string>();
  const gameIds: string[] = [];
  let seasonId = '';

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(
        EVERYONE.map((puuid) => {
          const rank = RANK[puuid] as readonly [string, string];
          return {
            puuid,
            display_name: NAMES[puuid] ?? `Seat ${puuid.slice(-3)}`,
            rank_tier: rank[0],
            rank_division: rank[1],
          };
        }),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) ids.set(row.puuid, row.id);

    /**
     * **One stored rating for everybody**, with the seed the fold started them from written on
     * the row (M5.7): the weekly fold reads that pair first and the live rank columns only for
     * a player who has never been rated, which is what makes a closed week reproducible.
     */
    await db.from('ratings').insert(
      EVERYONE.map((puuid) => {
        const seed = seedOf(puuid);
        const rank = RANK[puuid] as readonly [string, string];
        return {
          player_id: ids.get(puuid) as string,
          season_id: seasonId,
          mu: STORED.mu,
          sigma: STORED.sigma,
          games: 40,
          wins: 20,
          seed_mu: seed.mu,
          seed_sigma: seed.sigma,
          seed_rank_tier: rank[0],
          seed_rank_division: rank[1],
        };
      }),
    );

    /**
     * The stored `mu_after` is deliberately **flat and identical for everybody**: it is what
     * makes "the week is not the stored track" a claim the numbers themselves can prove.
     */
    const stamp = Date.now() % 1_000_000;
    for (const [index, fixture] of ALL_GAMES.entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`7${stamp}${String(index).padStart(2, '0')}`),
          season_id: seasonId,
          started_at: fixture.startedAt,
          duration_s: 2_000,
          winning_side: fixture.winningSide,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      await db.from('game_players').insert(
        [...fixture.blue, ...fixture.red].map((puuid, seat) => ({
          game_id: gameId,
          player_id: ids.get(puuid) as string,
          side: seat < 5 ? 100 : 200,
          role: ['top', 'jungle', 'mid', 'adc', 'support'][seat % 5] as string as
            | 'top'
            | 'jungle'
            | 'mid'
            | 'adc'
            | 'support',
          mu_before: STORED.mu,
          sigma_before: STORED.sigma,
          mu_after: STORED.mu,
          sigma_after: STORED.sigma,
        })),
      );
    }
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

  describe('the weekly fold', () => {
    it('is the seed folded through the week, not the stored rating', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      const expected = expectedWeek(THIS_WEEK_GAMES);
      const zoya = board.rows.find((row) => row.puuid === ZOYA);

      expect(zoya?.track).toBe('weekly');
      expect(zoya?.rating).toBe(displayRating((expected.get(ZOYA) as Rating).mu));
      // And it is nowhere near the stored number every one of these rows carries in `ratings`.
      expect(zoya?.rating).not.toBe(displayRating(STORED.mu));
      // The climb is the weekly seed to the weekly end: both ends on the one track.
      expect(zoya?.climb).toEqual({
        muBefore: seedOf(ZOYA).mu,
        muAfter: (expected.get(ZOYA) as Rating).mu,
      });
    });

    /**
     * **Acceptance 1.** Zoya and Adel have identical `ratings` rows, so `All time` can only
     * separate them by name — and it puts Adel first. The week, which is the only thing that
     * differs, puts Zoya first.
     */
    it('orders two identical all-time ratings by the week they each had', async () => {
      const [week, all] = await Promise.all([loadBoard(anon, THIS_WEEK), loadBoard(anon, ALL_TIME)]);

      const two = (board: { rows: { puuid: string }[] }): string[] =>
        board.rows.map((row) => row.puuid).filter((puuid) => puuid === ZOYA || puuid === ADEL);

      expect(
        all.rows.filter((row) => row.puuid === ZOYA || row.puuid === ADEL).map((row) => row.rating),
      ).toEqual([displayRating(STORED.mu), displayRating(STORED.mu)]);
      expect(two(all)).toEqual([ADEL, ZOYA]);
      expect(two(week)).toEqual([ZOYA, ADEL]);
    });

    /**
     * **Acceptance 5, and the whole reason a week sorts on Rating.** Zoya went 2W 0L in two
     * games; Adel went 4W 4L in eight. Adel's weekly `sigma` is the smaller for having played
     * four times as many, so his weekly **Proven** is the higher of the two — and the board
     * still puts Zoya first, because a week is ordered by `Rating` and by nothing else. This
     * test fails the moment anything reads `sigma` to order a week window.
     */
    it('puts a clean two-game week above a longer patchy one, Proven notwithstanding', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      const expected = expectedWeek(THIS_WEEK_GAMES);
      const zoyaWeek = expected.get(ZOYA) as Rating;
      const adelWeek = expected.get(ADEL) as Rating;

      // The fixture's own claim, in both numbers: Zoya's weekly mu is the higher and her
      // weekly ordinal is the lower. That pair is what makes this test worth having.
      expect(zoyaWeek.mu).toBeGreaterThan(adelWeek.mu);
      expect(ordinal(zoyaWeek)).toBeLessThan(ordinal(adelWeek));

      const rows = mine(board.rows);
      const zoya = rows.findIndex((row) => row.puuid === ZOYA);
      const adel = rows.findIndex((row) => row.puuid === ADEL);

      expect(zoya).toBeLessThan(adel);
      expect(rows[zoya]).toMatchObject({ games: 2, wins: 2, losses: 0 });
      expect(rows[adel]).toMatchObject({ games: 8, wins: 4, losses: 4 });
      // The printed numbers, both ways round: Rating puts Zoya first, Proven would not.
      expect((rows[zoya] as (typeof rows)[number]).rating).toBeGreaterThan(
        (rows[adel] as (typeof rows)[number]).rating,
      );
      expect((rows[zoya] as (typeof rows)[number]).proven).toBeLessThan(
        (rows[adel] as (typeof rows)[number]).proven,
      );
    });

    /**
     * **Acceptance 6.** Every rating number on a week row is the weekly track's, `sortKey` is
     * the weekly `mu` itself, and the rows come back in non-increasing `rating` order — so the
     * printed order matches the printed number.
     */
    it('carries the weekly track in `rating`, `sortKey` and `proven`, and sorts on it', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      const expected = expectedWeek(THIS_WEEK_GAMES);

      for (const row of mine(board.rows)) {
        const weekly = expected.get(row.puuid) as Rating;
        expect(row.track).toBe('weekly');
        expect(row.sortKey).toBeCloseTo(weekly.mu, 9);
        expect(row.rating).toBe(displayRating(weekly.mu));
        expect(row.proven).toBe(Math.max(0, displayRating(ordinal(weekly))));
        // No chip on a week, ever: on a week that would be every row, every week.
        expect(row.settling).toBe(false);
      }

      const ratings = board.rows.map((row) => row.rating);
      for (const [index, rating] of ratings.entries()) {
        expect(rating).toBeLessThanOrEqual(ratings[index - 1] ?? rating);
      }
    });

    it('opens a week row into the weekly deltas, never the stored ones', async () => {
      const board = await loadBoard(anon, { ...THIS_WEEK, includeBreakdown: true });
      const zoya = board.rows.find((row) => row.puuid === ZOYA);

      expect(zoya?.breakdown).toHaveLength(2);
      // The expand explains the number above it: the oldest game starts at the weekly seed and
      // each game picks up where the one before it left off.
      const games = zoya?.breakdown ?? [];
      const oldest = games[games.length - 1];
      const newest = games[0];
      expect(oldest?.muBefore).toBe(seedOf(ZOYA).mu);
      expect(newest?.muBefore).toBe(oldest?.muAfter);
      expect(newest?.muAfter).not.toBe(STORED.mu);
    });

    /**
     * **Acceptance 2.** `Last week` is a closed board and has to read the same on Tuesday as it
     * did on Sunday — including after somebody's rank moves, which is why the fold prefers the
     * seed stored on the `ratings` row to the live `players.rank_*` columns (M5.7).
     */
    it('reads the same closed week after a rank moves', async () => {
      const before = await loadBoard(anon, LAST_WEEK);

      await db.from('players').update({ rank_tier: 'DIAMOND', rank_division: 'I' }).eq('puuid', ZOYA);
      const after = await loadBoard(anon, LAST_WEEK);
      const rank = RANK[ZOYA] as readonly [string, string];
      await db.from('players').update({ rank_tier: rank[0], rank_division: rank[1] }).eq('puuid', ZOYA);

      expect(mine(after.rows)).toEqual(mine(before.rows));
    });

    it('is only the week its games are in: last week is its own fold', async () => {
      const [thisWeek, lastWeek] = await Promise.all([
        loadBoard(anon, THIS_WEEK),
        loadBoard(anon, LAST_WEEK),
      ]);
      const expected = expectedWeek(LAST_WEEK_GAMES);
      const zoya = lastWeek.rows.find((row) => row.puuid === ZOYA);

      expect(lastWeek.games).toBe(LAST_WEEK_GAMES.length);
      expect(zoya?.rating).toBe(displayRating((expected.get(ZOYA) as Rating).mu));
      // Two weeks, two folds, one seed each: the same player, two different numbers.
      expect(zoya?.rating).not.toBe(thisWeek.rows.find((row) => row.puuid === ZOYA)?.rating);
    });

    /**
     * **Acceptance 3, from the other side.** The month window over exactly these games is the
     * stored fold: the flat `mu_after` every row was written with, Proven from the same pair,
     * and the chip decided by the `ratings` row.
     */
    it('leaves the month windows on the stored track', async () => {
      const board = await loadBoard(anon, THIS_MONTH);
      const zoya = board.rows.find((row) => row.puuid === ZOYA);

      expect(zoya?.track).toBe('all-time');
      expect(zoya?.rating).toBe(displayRating(STORED.mu));
      expect(zoya?.proven).toBe(Math.max(0, displayRating(ordinal(STORED))));
      // 40 games on the `ratings` row: past the threshold, so no chip.
      expect(zoya?.settling).toBe(false);
    });
  });

  /**
   * **Acceptance 7 and 8**, on the page: a week board prints the weekly `Rating` as its one
   * number — no Proven column, label or small-type second number — carries no `settling` chip,
   * and says the week's own sentence under it.
   */
  describe('the week board as a page', () => {
    const render = async (window: 'this-week' | 'last-week' | 'this-month') => {
      const board = await loadBoard(anon, { window, ...WEEK });
      return renderToStaticMarkup(createElement(BoardView, { board, viewerPuuid: null }));
    };

    /** React escapes the apostrophe in the copy; a reader sees the sentence, so decode it. */
    const textOf = (html: string): string => html.replace(/&#x27;|&#39;/g, "'").replace(/<[^>]*>/g, ' ');

    it('prints the weekly Rating as the row one number and no Proven at all', async () => {
      const [html, board] = await Promise.all([render('this-week'), loadBoard(anon, THIS_WEEK)]);
      const zoya = board.rows.find((row) => row.puuid === ZOYA);

      expect(html).toContain(`${zoya?.rating}<span class="cn-sr"> ${RATING_LABEL}</span>`);
      // Not in the legend, not as a label, not visually hidden on a row: nowhere.
      expect(html).not.toContain(PROVEN_LABEL);
      // And the one number is not printed a second time in small type under itself.
      expect(html).not.toContain('cn-row-rating');
      // The legend over the column names the number that is in it.
      expect(html).toContain(`<span class="cn-num cn-legend">${RATING_LABEL}</span>`);
    });

    it('is the week sentence under the board, and no chip on any row', async () => {
      for (const window of ['this-week', 'last-week'] as const) {
        const text = textOf(await render(window));

        // Character for character, from `lib/board/copy.ts`, and exactly once.
        expect(text.split(WEEK_BOARD_SENTENCE)).toHaveLength(2);
        expect(text).not.toContain(SETTLING_SENTENCE);
        expect(text).not.toContain(SETTLING_CHIP);
      }
    });

    it('still prints Proven and its sentence on the month window', async () => {
      const html = await render('this-month');

      expect(html).toContain(PROVEN_LABEL);
      expect(html).toContain('cn-row-rating');
      expect(textOf(html)).not.toContain(WEEK_BOARD_SENTENCE);
    });
  });
}
