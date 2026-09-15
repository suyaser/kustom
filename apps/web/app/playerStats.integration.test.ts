import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The per-player sections on `/p/[puuid]` (M5.20) against the Supabase CLI local stack.
 *
 * What a fixture test cannot prove, and this does:
 *
 * - the sections are read **with the anon key**, through RLS, from real `games`,
 *   `game_players` and `players_public` rows, by the same loader `/stats` uses;
 * - the **window is a filter in the query** (acceptance 8): the same page on two windows is two
 *   different sets of numbers, and a window this player did not play draws nothing;
 * - **the streak equals the leaderboard row's** (acceptance 5): two code paths, two queries,
 *   one `W3`. This is the assertion a fixture cannot make, because the board folds its own
 *   read and this folds `lib/stats`'.
 *
 * Rows are namespaced by a run id and deleted afterwards (M3.27's rule). The week below —
 * Sunday 5 July 2026 — is this file's alone: `board.integration.test.ts` seeds 31 May to 7 June
 * and `stats.integration.test.ts` seeds 3 to 9 May, and all three share one database.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('/p/[puuid] sections against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadPlayerStats } = await import('@/lib/stats/load');
  const { loadBoard, loadPlayerBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { PlayerView } = await import('./_board/PlayerView');
  const { formatStreak } = await import('@/lib/board/streak');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);

  /** Wednesday 15 July 2026: `Last week` is then Sunday 5 July to Saturday 11 July (M5.34). */
  const NOW = new Date('2026-07-15T18:00:00Z');
  const LAST_WEEK = { window: 'last-week', now: NOW, timeZone: 'Africa/Cairo' } as const;
  const ALL_TIME = { window: 'all-time', now: NOW, timeZone: 'Africa/Cairo' } as const;

  /**
   * Eight games in that week, seen from `pn0` — the person whose page this is.
   *
   * `role` is theirs, `won` is their side's, and the sixth game is 300 seconds exactly, which
   * the fold's gate refuses: it is in the database, **stored unrated as the fold stores it**,
   * and in none of the numbers below.
   *
   * Their seven counted games in order are W W L W · L L L — longest win 2, longest loss 3,
   * current `L3`, which is the form acceptance 5 names.
   */
  const NIGHT = [
    { role: 'jungle', won: true, durationS: 1_800 },
    { role: 'jungle', won: true, durationS: 1_800 },
    { role: 'jungle', won: false, durationS: 1_800 },
    { role: 'jungle', won: true, durationS: 1_800 },
    { role: 'jungle', won: false, durationS: 1_800 },
    { role: 'jungle', won: true, durationS: 300 },
    { role: 'mid', won: false, durationS: 2_340 },
    { role: 'jungle', won: false, durationS: 1_800 },
  ] as const;

  /**
   * `pn4` leaves blue after the fourth game and `pn5` takes the seat, so the fixture holds a
   * partner **at four games together** (absent, under the minimum) beside three at seven.
   */
  const SWAPPED = new Set([4, 6, 7]);

  /**
   * **Ten more people and 250 more games, after this player's last one** (M5.21).
   *
   * The streak-equality case below is only worth making on a database where the two reads
   * *could* disagree: until M5.21 the board folded the group's most recent 200 games and this
   * page folded up to 2000, so a player whose last game is further back than 250 of everybody
   * else's had `streak: null` on their row and a real `L3` on their own page. These games are
   * that gap. They are ten-row, rated flat at 25, played on Monday 13 and Tuesday 14 July —
   * inside `This week` and outside the `Last week` every other test here reads — so no number
   * above moves and nobody wins an award for them.
   */
  const FILLER_GAMES = 250;
  const FILLER_KEYS = Array.from({ length: 10 }, (_, index) => `pf${index}`);

  const KEYS = ['pn0', 'pn1', 'pn2', 'pn3', 'pn4', 'pn5', 'pn6', 'pn7', 'pn8', 'pn9'];
  const LANES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  const puuidOf = (key: string) => `it-${runId}-${key}`;
  const playerIds = new Map<string, string>();
  const gameIds: string[] = [];

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    const seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert([
        ...KEYS.map((key, index) => ({
          puuid: puuidOf(key),
          display_name: `Pn${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
        ...FILLER_KEYS.map((key, index) => ({
          puuid: puuidOf(key),
          display_name: `Pf${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      ])
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) playerIds.set(row.puuid.replace(`it-${runId}-`, ''), row.id);

    for (const [index, night] of NIGHT.entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`88${runIdNumber()}${index}`),
          season_id: seasonId,
          // Monday the 6th through Thursday the 9th, inside last week's Sunday-06:00 bounds.
          started_at: `2026-07-0${6 + Math.floor(index / 2)}T${index % 2 === 0 ? '19' : '21'}:00:00Z`,
          duration_s: night.durationS,
          // `pn0` is always on blue, so their side won exactly when the fixture says they did.
          winning_side: night.won ? 100 : 200,
          raw: {},
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      const blue = ['pn0', 'pn1', 'pn2', 'pn3', SWAPPED.has(index) ? 'pn5' : 'pn4'];
      const red = KEYS.filter((key) => !blue.includes(key));

      await db.from('game_players').insert(
        [
          ...blue.map((key, seat) => ({ key, side: 100, seat })),
          ...red.map((key, seat) => ({ key, side: 200, seat })),
        ].map(({ key, side, seat }) => ({
          game_id: gameId,
          player_id: playerIds.get(key) as string,
          side,
          // `pn0`'s own role is the fixture's; everybody else takes the seat they sat in.
          role: key === 'pn0' ? night.role : (LANES[seat] as (typeof LANES)[number]),
          ...ratings(key, index, night.durationS),
        })),
      );
    }

    await seedTheGap(seasonId);
  });

  /**
   * The 250 games between this player's last one and tonight (M5.21).
   *
   * Bulk inserts, because 250 round trips against the local stack is a minute of waiting for a
   * fixture nothing asserts on directly: one `games` insert, then the scoreboards in chunks.
   */
  async function seedTheGap(seasonId: string): Promise<void> {
    const START = Date.parse('2026-07-13T07:00:00Z');
    const { data: rows, error } = await db
      .from('games')
      .insert(
        Array.from({ length: FILLER_GAMES }, (_, index) => ({
          lcu_game_id: Number(`77${runIdNumber()}${index}`),
          season_id: seasonId,
          started_at: new Date(START + index * 5 * 60_000).toISOString(),
          duration_s: 1_800,
          winning_side: 100,
          raw: {},
        })),
      )
      .select('id');
    expect(error).toBeNull();

    const seats = (gameId: string) =>
      FILLER_KEYS.map((key, seat) => ({
        game_id: gameId,
        player_id: playerIds.get(key) as string,
        side: seat < 5 ? 100 : 200,
        role: LANES[seat % 5] as (typeof LANES)[number],
        // Flat: these games move nobody, so `Most improved` is still the one who climbed.
        mu_before: 25,
        sigma_before: 5,
        mu_after: 25,
        sigma_after: 5,
      }));

    const all = (rows ?? []).flatMap((row) => {
      gameIds.push(row.id);
      return seats(row.id);
    });
    for (let from = 0; from < all.length; from += 500) {
      const { error: seatError } = await db.from('game_players').insert(all.slice(from, from + 500));
      expect(seatError).toBeNull();
    }
  }

  /** A stable numeric suffix for `lcu_game_id`, which is a bigint and unique. */
  function runIdNumber(): number {
    return Number.parseInt(runId.slice(0, 6), 16) % 100_000;
  }

  /**
   * What the fold would have stored on this row.
   *
   * **A game the gate refuses carries no rating**, which is not a detail: `rebuild-ratings`
   * nulls those columns, and it is what keeps the board's rated-only universe and the stats
   * fold's counted-games universe the same list — and therefore the streak on this page and the
   * streak on the board row one number. A fixture that rated a 300-second game would be
   * asserting against a state the pipeline cannot produce.
   *
   * `Pn0` climbs 1266 → 1478 across the week and nobody else moves, so `Last week` has exactly
   * one most improved and their page is the one that says so.
   */
  function ratings(key: string, index: number, durationS: number) {
    if (durationS <= 300) {
      return { mu_before: null, sigma_before: null, mu_after: null, sigma_after: null };
    }
    if (key !== 'pn0') {
      return { mu_before: 25, sigma_before: 5, mu_after: 25, sigma_after: 5 };
    }
    return {
      mu_before: index === 0 ? 21.1 : 24.4,
      sigma_before: 5,
      mu_after: index === NIGHT.length - 1 ? 24.6333333 : 24.4,
      sigma_after: 5,
    };
  }

  afterAll(async () => {
    // In chunks: `in.(…)` is a URL, and 258 ids in one is the `414 URI too long` the board's
    // own reads are chunked against.
    for (let from = 0; from < gameIds.length; from += 50) {
      await db
        .from('games')
        .delete()
        .in('id', gameIds.slice(from, from + 50));
    }
    const ids = [...playerIds.values()];
    if (ids.length > 0) {
      await db.from('ratings').delete().in('player_id', ids);
      await db.from('players').delete().in('id', ids);
    }
  });

  describe('the sections, read with the anon key', () => {
    it('counts the games the fold counts, and folds their own record out of them', async () => {
      const stats = await loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK);

      // Eight in the week, minus the 300-second one.
      expect(stats.games).toBe(7);
      expect(stats.roles.map((record) => [record.role, record.wins, record.losses, record.winRate])).toEqual([
        // Six rows on jungle clear the minimum; one game on mid prints bare.
        ['jungle', 3, 3, 50],
        ['mid', 0, 1, null],
      ]);
      expect(stats.noRoleGames).toBe(0);
    });

    it('is their side record, and only the sides they sat on', async () => {
      const stats = await loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK);

      expect(
        stats.sides.map(({ side, record }) => [side, record.wins, record.losses, record.winRate]),
      ).toEqual([[100, 3, 4, 43]]);
    });

    it('names the partners at five games together and leaves out the one at four', async () => {
      const stats = await loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK);
      const named = stats.bestPartners.map((partner) => partner.name);

      expect(named).toEqual(['Pn1', 'Pn2', 'Pn3']);
      expect(stats.bestPartners[0]).toMatchObject({ games: 7, wins: 3, losses: 4 });
      // Four games together, and three: neither is a partner, at either end of the list.
      const all = [...stats.bestPartners, ...stats.worstPartners].map((partner) => partner.name);
      expect(all).not.toContain('Pn4');
      expect(all).not.toContain('Pn5');
      // And nobody they only ever played against.
      expect(all).not.toContain('Pn9');
    });

    /** Acceptance 7: the winner's page says so, and nobody else's does. */
    it('gives the most improved line to the one who climbed, and to nobody else', async () => {
      const [winner, other] = await Promise.all([
        loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK),
        loadPlayerStats(anon, puuidOf('pn1'), LAST_WEEK),
      ]);

      expect(winner.awards).toContain('Most improved, week of 5 Jul.');
      expect(other.awards).not.toContain('Most improved, week of 5 Jul.');
    });

    it('is the mean of their own games, to the minute, and never zero', async () => {
      const stats = await loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK);

      // Six at 30 minutes and one at 39: 13140 seconds over seven games is 31 minutes.
      expect(stats.averageMinutes).toBe(31);
    });
  });

  /**
   * **Acceptance 5, the assertion this file exists for.** The board folds its own read of
   * `game_players` and the page folds `lib/stats`'; if the two ever disagree, one of them is
   * wrong on a page a friend is reading. `All time` is where a board row carries a streak at
   * all (M5.12), and it is this page's default window.
   */
  describe('the streak the leaderboard row prints', () => {
    /**
     * **M5.21's acceptance: their last game is 250 games back.** The board used to fold the
     * group's most recent 200 games for this one number, so this player's row said nothing
     * while their own page said `L3`. One read, one window, one answer — and the gap is
     * asserted first, because a fixture that quietly stopped producing it would turn this
     * test into a tautology.
     */
    it('is the same run, from the same helper, on the same window', async () => {
      const { count } = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .gt('started_at', '2026-07-10T00:00:00Z');
      expect(count).toBeGreaterThanOrEqual(FILLER_GAMES);

      const [board, stats] = await Promise.all([
        loadBoard(anon, ALL_TIME),
        loadPlayerStats(anon, puuidOf('pn0'), ALL_TIME),
      ]);
      const row = board.rows.find((entry) => entry.puuid === puuidOf('pn0'));

      expect(row?.streak).toBeDefined();
      expect(stats.streaks?.current).toEqual(row?.streak);
      expect(formatStreak(stats.streaks?.current as { kind: 'W' | 'L'; length: number })).toBe('L3');
      // And the two the window holds, hand-computed off the fixture: W W L W · L L L.
      expect(stats.streaks?.longestWin).toBe(2);
      expect(stats.streaks?.longestLoss).toBe(3);
    });
  });

  describe('the window', () => {
    it('changes every section, and draws none of them for a window they did not play', async () => {
      const week = await loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK);
      const quiet = await loadPlayerStats(anon, puuidOf('pn0'), { ...LAST_WEEK, window: 'this-week' });

      expect(week.games).toBe(7);
      expect(quiet).toMatchObject({
        games: 0,
        roles: [],
        sides: [],
        bestPartners: [],
        streaks: null,
        averageMinutes: null,
      });
    });
  });

  /** A page the loader could not find is a 404 in production, and a failure here. */
  function found<T>(value: T | null): T {
    expect(value).not.toBeNull();
    return value as T;
  }

  describe('the page itself', () => {
    it('renders the sections under the chart, with no puuid anywhere in its text', async () => {
      const [board, stats] = await Promise.all([
        loadPlayerBoard(anon, puuidOf('pn0'), LAST_WEEK),
        loadPlayerStats(anon, puuidOf('pn0'), LAST_WEEK),
      ]);
      const player = found(board);
      const html = renderToStaticMarkup(createElement(PlayerView, { player, stats }));
      const text = html.replace(/<[^>]*>/g, ' ');

      for (const title of ['By role', 'By side', 'Partners', 'Streaks']) {
        expect(text).toContain(title);
      }
      expect(text).toContain('3W 3L · 50%');
      // The bare record under the minimum: no percentage on one game at mid.
      expect(text).toContain('0W 1L');
      expect(text).toContain('L3');
      expect(text).toContain('Average game 31 min.');
      /**
       * Acceptance 7 end to end: the week closed, `Pn0` climbed 212 and nobody else moved, so
       * their page — and nobody else's — carries the line. No badge, no icon, no rule: the
       * award's own three-part line is on `/stats` and in the Sunday post.
       */
      expect(text).toContain('Most improved, week of 5 Jul.');
      expect(text).not.toContain('+212');
      // A partner's name is a link to their page; the puuid is in the href and nowhere a
      // reader reads.
      expect(html).toContain(`/p/${puuidOf('pn1')}`);
      expect(text).not.toContain(puuidOf('pn0'));
      expect(text).not.toContain('NaN');
    });

    it('draws no section at all on a window this player did not play', async () => {
      const options = { ...LAST_WEEK, window: 'this-week' } as const;
      const [board, stats] = await Promise.all([
        loadPlayerBoard(anon, puuidOf('pn0'), options),
        loadPlayerStats(anon, puuidOf('pn0'), options),
      ]);
      const player = found(board);
      const html = renderToStaticMarkup(createElement(PlayerView, { player, stats }));
      const text = html.replace(/<[^>]*>/g, ' ');

      // The window's own sentence, and nothing drawn over it.
      expect(text).toContain('No games this week yet.');
      expect(text).not.toContain('By role');
      expect(text).not.toContain('Partners');
      expect(text).not.toContain('Average game');
    });
  });
}
