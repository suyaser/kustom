import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `/stats` against the Supabase CLI local stack (M5.4).
 *
 * What it proves that a fixture test cannot: the page is assembled **with the anon key**,
 * through RLS, from real rows — `games`, `game_players` and `players_public` — and the window
 * is a filter in the query rather than a filter in memory, so a week's numbers are that week's
 * whatever else is in the database.
 *
 * Rows are namespaced by a run id and deleted afterwards (M3.27's rule); the stack is shared
 * with every other integration file here, so **nothing asserts a number the whole database
 * decides**. Every assertion below is about this run's own week: it seeds one week that no
 * other file writes into, and reads that week.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('/stats against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadStats } = await import('@/lib/stats/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { StatsView } = await import('./_stats/StatsView');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);

  /**
   * Wednesday 2026-05-13, 21:00 Cairo. **Last week** is then Sunday 3 May to Sunday 10 May: a
   * week in the past, so it never contains "now" and the fixture is the same week whatever day
   * the suite runs on, and **a different week from the one `board.integration.test.ts` seeds**
   * (1 to 8 June), because these files share one database and both count games by window.
   */
  const NOW = new Date('2026-05-13T18:00:00Z');
  const LAST_WEEK = { window: 'last-week', now: NOW, timeZone: 'Africa/Cairo' } as const;

  /** Blue's five and red's five, in lane order, for a week of eight games. */
  const BLUE = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const RED = ['st5', 'st6', 'st7', 'st8', 'st9'];
  const LANES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  /** Blue take five of the eight; the sixth game is short and the seventh has nine players. */
  const GAMES = 8;

  const puuidOf = (key: string) => `it-${runId}-${key}`;
  const playerIds = new Map<string, string>();
  const gameIds: string[] = [];
  let seasonId = '';

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(
        [...BLUE, ...RED].map((key, index) => ({
          puuid: puuidOf(key),
          display_name: `St${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
          // One main role in the window, so `Best off-role` has somebody to consider: `St6`
          // plays jungle all week and their main is top. Everybody else is flexible, which is
          // what puts the "no main role" note under that award.
          main_role: key === 'st6' ? ('top' as const) : null,
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) {
      playerIds.set(row.puuid.replace(`it-${runId}-`, ''), row.id);
    }

    /**
     * **Where `St0`'s history began** (M5.7), and the one thing that makes this week's awards a
     * question with an answer (M7.4).
     *
     * `Most improved` on a week is the weekly climb: everybody starts the week at their seed and
     * `rateGameWeekly` folds the week's games. The other nine have no `ratings` row, so their
     * week starts at the rank on their `players` row — Gold IV, `1380`. `St0`'s starts at the
     * **stored** seed, which was taken when they were unranked and is not their rank today:
     * `1200`, the number the fold actually built their history on. The extra uncertainty in that
     * seed is why five people with one week's results have five different climbs and this award
     * has a single winner.
     */
    const { error: ratingError } = await db.from('ratings').insert({
      player_id: playerIds.get('st0') as string,
      season_id: seasonId,
      mu: 24.6333333,
      sigma: 5,
      games: 6,
      wins: 5,
      seed_mu: 20,
      seed_sigma: 10,
      seed_rank_tier: null,
      seed_rank_division: null,
    });
    expect(ratingError).toBeNull();

    for (let index = 0; index < GAMES; index += 1) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`77${runIdNumber()}${index}`),
          season_id: seasonId,
          // Monday the 4th through Thursday the 7th, inside last week's Sunday-06:00 bounds.
          started_at: `2026-05-0${4 + Math.floor(index / 2)}T${index % 2 === 0 ? '19' : '21'}:00:00Z`,
          // The seventh game is 300 seconds exactly, which the fold's gate refuses, so it is
          // in the database and in no number on the page.
          duration_s: index === 6 ? 300 : 1_800,
          winning_side: index < 5 ? 100 : 200,
          raw: {},
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      const seats = [
        ...BLUE.map((key, seat) => ({ key, side: 100, role: LANES[seat] as (typeof LANES)[number] })),
        ...RED.map((key, seat) => ({ key, side: 200, role: LANES[seat] as (typeof LANES)[number] })),
      ]
        // The eighth game is nine players — the other shape the gate refuses.
        .filter((seat) => !(index === 7 && seat.key === 'st9'));

      await db.from('game_players').insert(
        seats.map((seat) => ({
          game_id: gameId,
          player_id: playerIds.get(seat.key) as string,
          side: seat.side,
          role: seat.role,
          // `St0` climbs 1266 → 1478 on the **stored** track across the week and everybody
          // else stands still. Since M7.4 that is the month windows' number: a week's awards
          // read the weekly track, which starts from the seed above.
          ...ratings(seat.key, index),
        })),
      );
    }
  });

  /** A stable numeric suffix for `lcu_game_id`, which is a bigint and unique. */
  function runIdNumber(): number {
    return Number.parseInt(runId.slice(0, 6), 16) % 100_000;
  }

  function ratings(key: string, index: number) {
    if (key !== 'st0') {
      return { mu_before: 25, sigma_before: 5, mu_after: 25, sigma_after: 5 };
    }
    const before = index === 0 ? 21.1 : 24.4;
    const after = index === GAMES - 1 || index === 5 ? 24.6333333 : 24.4;
    return { mu_before: before, sigma_before: 5, mu_after: after, sigma_after: 5 };
  }

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    const ids = [...playerIds.values()];
    if (ids.length > 0) {
      await db.from('ratings').delete().in('player_id', ids);
      await db.from('players').delete().in('id', ids);
    }
  });

  describe('the week, read with the anon key', () => {
    it('counts the games the fold counts and nothing else', async () => {
      const stats = await loadStats(anon, LAST_WEEK);

      // Eight games in the week, minus the 300-second one and the nine-player one.
      expect(stats.games).toBe(6);
      expect(stats.players).toBe(10);
      expect(stats.range).toBe('Sunday 3 May to Saturday 9 May');
    });

    it('is the group s two numbers over exactly those games', async () => {
      const stats = await loadStats(anon, LAST_WEEK);

      // Blue won the first five; of the six counted games, five are blue's.
      expect(stats.blueWinRate).toBe(83);
      expect(stats.averageMinutes).toBe(30);
      expect(stats.noRoleGames).toBe(0);
    });

    it('ranks each role s players by the tie rule', async () => {
      const stats = await loadStats(anon, LAST_WEEK);
      const jungle = stats.roles.find((block) => block.role === 'jungle');

      expect(jungle?.entries.map((entry) => [entry.name, entry.games, entry.winRate])).toEqual([
        ['St1', 6, 83],
        ['St6', 6, 17],
      ]);
    });

    it('names the pairs who played together and the runs they are on', async () => {
      const stats = await loadStats(anon, LAST_WEEK);

      expect(stats.bestDuos[0]?.games).toBe(6);
      expect(stats.bestDuos[0]?.winRate).toBe(83);
      expect(stats.worstDuos[0]?.winRate).toBe(17);
      expect(stats.longestWin?.length).toBe(5);
      expect(stats.longestLoss?.length).toBe(5);
    });

    /**
     * A closed week has its three awards, computed from the same rows the page counted.
     *
     * **`Most improved` is the weekly climb** (M7.4): `St0`'s seed to where the week left them,
     * `1200 → 1392`, folded from the six counted games with `rateGameWeekly`. The stored
     * `mu_before` / `mu_after` columns on those rows say `1266 → 1478` and are the all-time
     * track's answer — this award does not read them on a week, and a diff that brings `+212`
     * back here is a diff that undid M7.4.
     */
    it('hands the closed week its three awards', async () => {
      const stats = await loadStats(anon, LAST_WEEK);

      expect(stats.awards?.kind).toBe('closed');
      const blocks = stats.awards?.kind === 'closed' ? stats.awards.blocks : [];
      expect(blocks.map((block) => block.label)).toEqual(['Most improved', 'Best off-role', 'Cursed duo']);
      expect(blocks[0]?.lines.map((line) => line.text)).toEqual(['St0 · +192 · 1200 → 1392']);
      // The rule line is M5.4's, unchanged by the track it is measured on (M7.4, acceptance 3).
      expect(blocks[0]?.rule).toBe(
        'Biggest climb in Rating from a first game to a last one, over at least 6 games.',
      );
      // `St6`'s main is top and they played jungle all week: six off-role games, one win.
      expect(blocks[1]?.lines.map((line) => line.text)).toEqual(['St6 · 1W 5L · 17% · their main is top']);
      expect(blocks[1]?.note).toBe('Players with no main role are not in this one — every role is theirs.');
    });

    /** The running window has the placeholder, and `All time` has no block at all. */
    it('has no awards on a window that has not closed', async () => {
      const running = await loadStats(anon, { ...LAST_WEEK, window: 'this-week' });
      expect(running.awards).toEqual({
        kind: 'running',
        line: 'Awards are handed out when the week ends.',
      });

      const allTime = await loadStats(anon, { ...LAST_WEEK, window: 'all-time' });
      expect(allTime.awards).toBeNull();
    });

    /** Acceptance 9: the read is capped, the page says so, and the games it used are the newest. */
    it('reads the most recent N games and says so when it has to', async () => {
      const capped = await loadStats(anon, { ...LAST_WEEK, maxGames: 3 });

      expect(capped.capped).toBe(true);
      expect(capped.cap).toBe(3);
      // The three newest of the week are the nine-player game, the 300-second one and one
      // good one, so the gate leaves a single counted game — the cap is a read, not a filter.
      expect(capped.games).toBe(1);

      const whole = await loadStats(anon, LAST_WEEK);
      expect(whole.capped).toBe(false);
    });
  });

  describe('the page itself', () => {
    it('renders the week from the anon read, with no puuid anywhere in its text', async () => {
      const stats = await loadStats(anon, LAST_WEEK);
      const html = renderToStaticMarkup(createElement(StatsView, { stats }));
      const text = html.replace(/<[^>]*>/g, ' ');

      expect(text).toContain('Sunday 3 May to Saturday 9 May · 6 games');
      expect(text).toContain('Blue wins 83% of the time.');
      expect(text).toContain('Average game 30 min.');
      expect(text).toContain('St0 · +192 · 1200 → 1392');
      // The puuid is in the href of every name; nothing a reader reads carries one.
      expect(html).toContain(`/p/${puuidOf('st0')}`);
      expect(text).not.toContain(puuidOf('st0'));
    });

    it('is the window s own sentence, and nothing else, on a week nobody played', async () => {
      // A week with no games at all: the fixture's week is the one before this one.
      const quiet = await loadStats(anon, {
        ...LAST_WEEK,
        now: new Date('2026-05-20T18:00:00Z'),
      });
      const html = renderToStaticMarkup(createElement(StatsView, { stats: quiet }));

      expect(quiet.games).toBe(0);
      expect(quiet.range).toBeNull();
      expect(html).toContain('No games last week.');
      expect(html).not.toContain('Blue wins');
    });
  });
}
