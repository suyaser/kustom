import { randomUUID } from 'node:crypto';
import { displayKustom } from '@customs/core';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FoldAwardPlayer, gameAward } from '@/lib/ingest/fold';
import { kustomSeat } from '@/lib/testing/kustomSeat';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * **The MVP / ACE share on a week** (M7.24, M14.57, Kustom since M18.6), against the Supabase CLI
 * local stack.
 *
 * The week board reads the weekly track the fold stored (`week_r_after`); the fold already applied
 * the share when it wrote it. So the MVP's week points are the MVP's stored weekly change, share and
 * all, and the week read needs none of the nine stat columns. `/p/[puuid]`'s week tab still names
 * the MVP (M7.10's recent-games award) beside the game's weekly pair, and lists the all-time pair
 * the all-time tab prints for the same game.
 *
 * **The fixture is one scored game this week**, everyone's first of the week: ten players, every
 * role once a side, all nine stat columns, blue won, with stored pairs written as the fold would
 * have. Weekly (1200, K 32, 50%): +16 for a winner, +19 for the MVP (×1.2), −16 for a loser, −13
 * for the ACE (×0.8). All time (1500, K 16): +8, +10, −8, −6 (the other shares are ×1 here).
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the week MVP / ACE bonus against the local Supabase stack', () => {
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
      // The board's own read, and only it: the four Rating columns beside the ids are its spelling.
      // The streak and awards reads in `lib/stats` select every stat column on every window and
      // always have — they are not the read this task widened.
      if (
        (columns ?? '').startsWith(
          'game_id, player_id, side, role, r_before, r_after, week_r_before, week_r_after',
        )
      ) {
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
  const THIS_WEEK = { window: 'this-week', now: NOW, groupId: ORIGINAL_GROUP_ID } as const;
  const LAST_WEEK = { window: 'last-week', now: NOW, groupId: ORIGINAL_GROUP_ID } as const;
  const ALL_TIME = { window: 'all-time', groupId: ORIGINAL_GROUP_ID } as const;

  const BEFORE = 1500;
  const WEEK_BEFORE = 1200;
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

  /** The share each seat's change carries: the MVP ×1.2, the ACE ×0.8, everyone else ×1 here. */
  const SHARE = (puuid: string): number => (puuid === AWARD.mvp ? 1.2 : puuid === AWARD.ace ? 0.8 : 1);
  /** What the fold stored on each track: the share is already in `r_after` / `week_r_after`. */
  const AFTER = (puuid: string, side: 100 | 200): number =>
    BEFORE + (side === WINNER ? 8 : -8) * SHARE(puuid);
  const WEEK_AFTER = (puuid: string, side: 100 | 200): number =>
    WEEK_BEFORE + (side === WINNER ? 16 : -16) * SHARE(puuid);
  const POINTS = (puuid: string, side: 100 | 200): number =>
    displayKustom(WEEK_AFTER(puuid, side)) - WEEK_BEFORE;

  const ids = new Map<string, string>();
  let gameId = '';

  beforeAll(async () => {
    const { data: players, error } = await db
      .from('players')
      .insert(
        SEATS.map((seat, index) => ({
          puuid: seat.puuid,
          display_name: `Seat ${index}`,
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) ids.set(row.puuid, row.id);

    await db.from('ratings').insert(
      SEATS.map((seat) => ({
        group_id: ORIGINAL_GROUP_ID,
        player_id: ids.get(seat.puuid) as string,
        r: AFTER(seat.puuid, seat.side),
        games: 40,
        wins: 20,
      })),
    );

    const { data: game } = await db
      .from('games')
      .insert({
        group_id: ORIGINAL_GROUP_ID,
        lcu_game_id: Number(`8${Date.now() % 1_000_000}24`),
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
        group_id: ORIGINAL_GROUP_ID,
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
        ...kustomSeat(BEFORE, AFTER(seat.puuid, seat.side), null, {
          award: seat.puuid === AWARD.mvp ? 'mvp' : seat.puuid === AWARD.ace ? 'ace' : 'none',
        }),
        week_r_before: WEEK_BEFORE,
        week_r_after: WEEK_AFTER(seat.puuid, seat.side),
        week_k: 32,
        week_fold_p: 0.5,
        week_games_before: 0,
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

  describe('the MVP / ACE bonus on a week', () => {
    /** The week's points are the stored weekly Rating, so they carry the share the fold stored. */
    it('puts each seat s stored weekly change, share included, on the week board as its points', async () => {
      const board = await loadBoard(anon, THIS_WEEK);
      for (const seat of SEATS) {
        const row = board.rows.find((candidate) => candidate.puuid === seat.puuid);
        expect([seat.puuid, row?.points]).toEqual([seat.puuid, POINTS(seat.puuid, seat.side)]);
      }
      expect(POINTS(AWARD.mvp, 100)).toBe(19);
      expect(POINTS(AWARD.ace, 200)).toBe(-13);
    });

    /**
     * `/p/[puuid]` on the week names the MVP and the ACE beside the game's weekly pair, carries the
     * all-time pair the all-time tab prints, and its points are the board row's, to the digit.
     */
    it('names the MVP and the ACE on the week tab beside the weekly change', async () => {
      for (const [puuid, award] of [
        [AWARD.mvp, 'mvp'],
        [AWARD.ace, 'ace'],
      ] as const) {
        const [week, all] = await Promise.all([
          loadPlayerBoard(anon, puuid, THIS_WEEK),
          loadPlayerBoard(anon, puuid, ALL_TIME),
        ]);
        const recent = week?.recent[0];
        expect(recent?.award).toBe(award);
        const same = all?.recent.find((game) => game.gameId === recent?.gameId);
        expect([recent?.rBefore, recent?.rAfter]).toEqual([same?.rBefore, same?.rAfter]);
        expect(recent?.weekRAfter).toBe(WEEK_AFTER(puuid, award === 'mvp' ? 100 : 200));
        expect(week?.weekTotal).toBe(week?.points);
        expect(week?.points).toBe((await rowOf(THIS_WEEK, puuid))?.points);
      }
    });

    /** No week window widens the board's read any more: no fold reads the nine stat columns. */
    it('reads the narrow select on every window', async () => {
      expect(await widestRead(() => loadBoard(anon, THIS_WEEK))).toBe('narrow');
      expect(await widestRead(() => loadBoard(anon, LAST_WEEK))).not.toBe('wide');
      expect(await widestRead(() => loadBoard(anon, ALL_TIME))).not.toBe('wide');
    });
  });
}
