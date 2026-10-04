import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { kustomSeat, rOf } from '@/lib/testing/kustomSeat';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.70 against the local stack, through the anon key: an empty `This week` points to `Last week`
 * when last week had a rated game, else to `All time`; a group that never played points nowhere.
 * Three scratch groups, deleted afterwards. Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('where an empty week points, against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadBoard, loadTopBoardOrNone } = await import('./load');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const TZ = 'Africa/Cairo';
  /** Wednesday 2026-06-10 21:00 Cairo: this week is 7 to 14 June, last week 31 May to 7 June. */
  const NOW = new Date('2026-06-10T18:00:00Z');
  let groups: Record<'lastWeek' | 'older' | 'never' | 'reset', string> = {
    lastWeek: '',
    older: '',
    never: '',
    reset: '',
  };
  let playerId = '';

  async function ratedGame(groupId: string, startedAt: string) {
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000),
        started_at: startedAt,
        duration_s: 1_500,
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const row = await db.from('game_players').insert({
      game_id: data.id,
      group_id: groupId,
      player_id: playerId,
      side: 100,
      role: 'mid',
      champion_id: 103,
      mu_before: 25,
      sigma_before: 6,
      mu_after: 25.4,
      sigma_after: 5.9,
      ...kustomSeat(rOf(25), rOf(25.4)),
    });
    if (row.error) throw new Error(row.error.message);
  }

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, ['lastWeek', 'older', 'never', 'reset'] as const);
    const { data, error } = await db
      .from('players')
      .insert({ puuid: `it-${runId}-fallback`, display_name: 'Lena' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    playerId = data.id;
    await ratedGame(groups.lastWeek, '2026-06-03T18:00:00Z');
    await ratedGame(groups.older, '2026-05-01T18:00:00Z');
    // Played last week, then the owner reset ratings on Tuesday 9 June: All time is empty since.
    await ratedGame(groups.reset, '2026-06-03T18:00:00Z');
    const reset = await db
      .from('groups')
      .update({ ratings_since: '2026-06-09T10:00:00Z' })
      .eq('id', groups.reset);
    if (reset.error) throw new Error(reset.error.message);
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().eq('puuid', `it-${runId}-fallback`);
  });

  const week = (groupId: string) => ({ window: 'this-week' as const, groupId, now: NOW, timeZone: TZ });

  it('points to last week when last week had a game', async () => {
    const board = await loadBoard(anon, week(groups.lastWeek));
    expect(board.games).toBe(0);
    expect(board.fallback).toBe('last-week');
    expect((await loadTopBoardOrNone(anon, { ...week(groups.lastWeek), limit: 5 })).fallback).toBe(
      'last-week',
    );
  });

  it('points to all time when last week was empty too, and Last week itself points to all time', async () => {
    expect((await loadBoard(anon, week(groups.older))).fallback).toBe('all-time');
    expect((await loadBoard(anon, { ...week(groups.older), window: 'last-week' })).fallback).toBe('all-time');
  });

  it('points nowhere for a group that never played, or a window with games', async () => {
    expect((await loadBoard(anon, week(groups.never))).fallback).toBeNull();
    expect((await loadBoard(anon, { ...week(groups.lastWeek), window: 'last-week' })).fallback).toBeNull();
    expect((await loadBoard(anon, { ...week(groups.lastWeek), window: 'all-time' })).fallback).toBeNull();
  });

  it('after a reset with nothing played since, an empty week points nowhere (All time is empty too)', async () => {
    const board = await loadBoard(anon, week(groups.reset));
    expect(board.games).toBe(0);
    expect(board.everRated).toBe(false);
    expect(board.fallback).toBeNull();
    expect((await loadTopBoardOrNone(anon, { ...week(groups.reset), limit: 5 })).fallback).toBeNull();
  });
}
