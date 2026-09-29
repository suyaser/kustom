import { randomUUID } from 'node:crypto';
import { config, displayRating, type Rating, rateGameWeekly, seedFromRank } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FoldAwardPlayer, gameAward } from '@/lib/ingest/fold';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * **The MVP / ACE bonus on the weekly track** (M7.24), against the Supabase CLI local stack.
 *
 * `lib/board/weekly.test.ts` proves the fold scales the right two seats; what only a database
 * can prove is the wiring around it: that the two week-window reads carry the nine stat columns
 * through RLS and the anon key, that `All time` and the month windows do **not** (acceptance 4 and
 * 5 — same query, wider select, on the week only), and that `/p/[puuid]`'s week-window row names
 * the same MVP whose adjusted delta it prints (acceptance 6).
 *
 * **The fixture is one scored game this week**: ten players seeded Gold IV, every role once a
 * side, all nine stat columns, blue won. The stored `mu_*` columns are flat at one value for
 * everybody, so any number on a week window that moved came from the weekly fold.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the weekly MVP / ACE bonus against the local Supabase stack', () => {
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

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /**
   * The anon client with every `game_players` select recorded, so the width of each window's
   * read is a thing the test can look at rather than infer.
   */
  const selects: string[] = [];
  const anon = createPublicClient();
  const from = anon.from.bind(anon);
  (anon as { from: unknown }).from = (table: string) => {
    const builder = from(table as 'game_players');
    if (table !== 'game_players') return builder;
    const select = builder.select.bind(builder);
    (builder as { select: unknown }).select = (columns?: string, ...rest: unknown[]) => {
      // The board's own read, and only it: `sigma_after` beside the three ids is its spelling.
      // The streak and awards reads in `lib/stats` select every stat column on every window and
      // always have — they are not the read this task widened.
      if ((columns ?? '').startsWith('game_id, player_id, side, role, mu_before, mu_after, sigma_after')) {
        selects.push(columns ?? '*');
      }
      return (select as (...args: unknown[]) => unknown)(columns, ...rest);
    };
    return builder;
  };
  const widestRead = async (read: () => Promise<unknown>): Promise<'wide' | 'narrow' | 'none'> => {
    selects.length = 0;
    await read();
    if (selects.length === 0) return 'none';
    return selects.some((columns) => columns.includes('vision_score')) ? 'wide' : 'narrow';
  };

  const runId = randomUUID().slice(0, 8);
  const NOW = new Date('2026-03-11T18:00:00Z');
  const THIS_WEEK = { window: 'this-week', now: NOW } as const;
  const LAST_WEEK = { window: 'last-week', now: NOW } as const;
  const THIS_MONTH = { window: 'this-month', now: NOW } as const;
  const LAST_MONTH = { window: 'last-month', now: NOW } as const;
  const ALL_TIME = { window: 'all-time' } as const;

  const SEED = seedFromRank('GOLD', 'IV');
  const STORED = { mu: 27.5, sigma: 5.5 } as const;
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  /** Ten seats: blue first, top to support, then red. Every input the score reads, all different. */
  const SEATS = Array.from({ length: 10 }, (_, index) => ({
    puuid: `it-${runId}-s${index}`,
    side: index < 5 ? (100 as const) : (200 as const),
    role: ROLES[index % 5] as (typeof ROLES)[number],
    kills: index,
    deaths: 10 - index,
    assists: index * 2,
    damageToChamps: 20_000 + index * 2_500,
    gold: 10_000 + index * 250,
    cs: 150 + index * 3,
    visionScore: 20 + index,
    damageSelfMitigated: 8_000 + index * 400,
    damageToObjectives: 3_000 + index * 600,
  }));
  const WINNER = 100 as const;

  /** Who carried, by the scorer both folds call — stated, not read back from the loader. */
  const AWARD = gameAward(SEATS satisfies FoldAwardPlayer[], WINNER);
  if (AWARD === null) throw new Error('the fixture game must be scorable');

  /** Each seat's raw weekly `mu` after the game, from the seed: `rateGameWeekly` alone. */
  const RAW = (() => {
    const bySide = (side: 100 | 200) =>
      SEATS.filter((seat) => seat.side === side).sort((a, b) => (a.puuid < b.puuid ? -1 : 1));
    const rated = rateGameWeekly(Array(5).fill(SEED), Array(5).fill(SEED), WINNER);
    const out = new Map<string, Rating>();
    bySide(100).forEach((seat, index) => {
      out.set(seat.puuid, rated.blue[index] as Rating);
    });
    bySide(200).forEach((seat, index) => {
      out.set(seat.puuid, rated.red[index] as Rating);
    });
    return out;
  })();
  const rawDelta = (puuid: string): number => (RAW.get(puuid) as Rating).mu - SEED.mu;
  const MVP_FACTOR = 1 + config.rating.mvp.bonusFraction;
  const ACE_FACTOR = 1 - config.rating.mvp.aceReliefFraction;

  const ids = new Map<string, string>();
  let gameId = '';

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    const seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(
        SEATS.map((seat, index) => ({
          puuid: seat.puuid,
          display_name: `Seat ${index}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) ids.set(row.puuid, row.id);

    await db.from('ratings').insert(
      SEATS.map((seat) => ({
        player_id: ids.get(seat.puuid) as string,
        season_id: seasonId,
        mu: STORED.mu,
        sigma: STORED.sigma,
        games: 40,
        wins: 20,
        seed_mu: SEED.mu,
        seed_sigma: SEED.sigma,
        seed_rank_tier: 'GOLD',
        seed_rank_division: 'IV',
      })),
    );

    const { data: game } = await db
      .from('games')
      .insert({
        lcu_game_id: Number(`8${Date.now() % 1_000_000}24`),
        season_id: seasonId,
        started_at: '2026-03-09T19:00:00Z',
        duration_s: 2_000,
        winning_side: WINNER,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    gameId = game?.id ?? '';
    expect(gameId).not.toBe('');

    const { error: seatError } = await db.from('game_players').insert(
      SEATS.map((seat) => ({
        game_id: gameId,
        player_id: ids.get(seat.puuid) as string,
        side: seat.side,
        role: seat.role,
        kills: seat.kills,
        deaths: seat.deaths,
        assists: seat.assists,
        damage_to_champs: seat.damageToChamps,
        gold: seat.gold,
        cs: seat.cs,
        vision_score: seat.visionScore,
        damage_self_mitigated: seat.damageSelfMitigated,
        damage_to_objectives: seat.damageToObjectives,
        mu_before: STORED.mu,
        sigma_before: STORED.sigma,
        mu_after: STORED.mu,
        sigma_after: STORED.sigma,
      })),
    );
    expect(seatError).toBeNull();
  });

  afterAll(async () => {
    if (gameId !== '') await db.from('games').delete().eq('id', gameId);
    const playerIds = [...ids.values()];
    if (playerIds.length > 0) {
      await db.from('ratings').delete().in('player_id', playerIds);
      await db.from('players').delete().in('id', playerIds);
    }
  });

  const rowOf = async (options: Parameters<typeof loadBoard>[1], puuid: string) =>
    (await loadBoard(anon, options)).rows.find((row) => row.puuid === puuid);

  describe('the weekly MVP / ACE bonus', () => {
    /** **Acceptance 2**, through the loader: 1.25x, 0.80x, eight untouched. */
    it('puts the MVP 1.25x and the ACE 0.80x of their raw weekly delta on the week board', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      for (const seat of SEATS) {
        const row = board.rows.find((candidate) => candidate.puuid === seat.puuid);
        const factor = seat.puuid === AWARD.mvp ? MVP_FACTOR : seat.puuid === AWARD.ace ? ACE_FACTOR : 1;
        expect([seat.puuid, row?.rating]).toEqual([
          seat.puuid,
          displayRating(SEED.mu + rawDelta(seat.puuid) * factor),
        ]);
      }
    });

    /**
     * **Acceptance 6**: `/p/[puuid]` on the week names the MVP and the ACE (M7.10's recent-games
     * award, through `gatedGameAward`) and prints the delta the weekly fold amplified for exactly
     * that seat — and the number above it is the board row's, to the digit.
     */
    it('names the MVP and the ACE on the player page beside the adjusted weekly delta', async () => {
      for (const [puuid, award, factor] of [
        [AWARD.mvp, 'mvp', MVP_FACTOR],
        [AWARD.ace, 'ace', ACE_FACTOR],
      ] as const) {
        const page = await loadPlayerBoard(anon, puuid, THIS_WEEK);
        const recent = page?.recent[0];
        expect(recent?.award).toBe(award);
        expect(recent?.muBefore).toBe(SEED.mu);
        expect(recent?.muAfter).toBe(SEED.mu + rawDelta(puuid) * factor);
        expect(page?.rating).toBe((await rowOf(THIS_WEEK, puuid))?.rating);
      }

      // And a seat that was neither is named nothing and moved exactly what the plain fold says.
      const other = SEATS.find((seat) => seat.puuid !== AWARD.mvp && seat.puuid !== AWARD.ace);
      const page = await loadPlayerBoard(anon, other?.puuid as string, THIS_WEEK);
      expect(page?.recent[0]?.award).toBeNull();
      expect(page?.recent[0]?.muAfter).toBe((RAW.get(other?.puuid as string) as Rating).mu);
    });

    /**
     * **Acceptance 4 and 5**: the two week windows read `game_players` nine columns wider and
     * nothing else does; `All time` and both months keep the narrow select and the stored numbers.
     */
    it('widens the read on the two week windows only', async () => {
      expect(await widestRead(() => loadBoard(anon, THIS_WEEK))).toBe('wide');
      // `Last week` holds no game of this fixture, so it reads nothing at all — but never narrow.
      expect(await widestRead(() => loadBoard(anon, LAST_WEEK))).not.toBe('narrow');
      expect(await widestRead(() => loadBoard(anon, THIS_MONTH))).toBe('narrow');
      expect(await widestRead(() => loadBoard(anon, LAST_MONTH))).not.toBe('wide');
      expect(await widestRead(() => loadBoard(anon, { ...ALL_TIME, includeBreakdown: true }))).not.toBe(
        'wide',
      );

      // The month and all-time rows are the stored numbers, bonus-free, exactly as before M7.24.
      const mvpMonth = await rowOf(THIS_MONTH, AWARD.mvp);
      expect(mvpMonth?.rating).toBe(displayRating(STORED.mu));
      const mvpAllTime = await rowOf(ALL_TIME, AWARD.mvp);
      expect(mvpAllTime?.rating).toBe(displayRating(STORED.mu));
    });
  });
}
