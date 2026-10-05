import { randomUUID } from 'node:crypto';
import { preGameOdds } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M21.14 against the local stack: a game with no lobby at all (an eog that matched none) gets a
 * result post with its pre-game odds, the number the game page prints for it, and `/fun` counts it
 * at the same number. The unrolled game
 * (a lobby, no roll) is `app/playedOdds.integration.test.ts`'s game C.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the result post of a game with no lobby against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadResultSource, buildResultInput } = await import('@/lib/discord/assemble');
  const { resultEmbed } = await import('@/lib/discord/embeds');
  const { game4Identity } = await import('@/lib/testing/discordGame4');
  const { loadGameDetail } = await import('@/lib/games/detail');
  const { receiptBlueWinProb } = await import('@/lib/games/receipt');
  const { resultOddsLine } = await import('@/lib/receipt/copy');
  const { loadFunFacts } = await import('@/lib/stats/load');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const puuids = Array.from({ length: 10 }, (_, i) => `it-${runId}-nl${String(i).padStart(2, '0')}`);
  const LANES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  /** Blue 1250 each against red 1150 each: blue favored, red wins. */
  const rOf = (i: number) => (i < 5 ? 1250 : 1150);
  const blueP = preGameOdds(
    [0, 1, 2, 3, 4].map((i) => ({ r: rOf(i) })),
    [5, 6, 7, 8, 9].map((i) => ({ r: rOf(i) })),
  );
  let group = '';
  let gameId = '';

  beforeAll(async () => {
    if (blueP === null) throw new Error('no pre-game odds');
    ({ home: group } = await createTestGroups(db, runId, ['home'] as const));
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid, i) => ({ puuid, gameName: `NL${i}` })),
    );
    const played = await db
      .from('games')
      .insert({
        group_id: group,
        lobby_id: null,
        lcu_game_id: Number(`9${Date.now() % 10_000_000}1`),
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
        duration_s: 1_800,
        winning_side: 200,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    if (played.error) throw new Error(`game: ${played.error.message}`);
    gameId = played.data.id;

    const rows = puuids.map((puuid, i) => {
      const side = i < 5 ? 100 : 200;
      return {
        game_id: gameId,
        group_id: group,
        player_id: ids.get(puuid) as string,
        side,
        role: LANES[i % 5] ?? null,
        r_before: rOf(i),
        r_after: rOf(i) + (side === 200 ? 12 : -12),
        k: 16,
        // What the fold writes: each side's expected, the same formula as preGameOdds.
        fold_p: side === 100 ? blueP : 1 - blueP,
        award: 'none',
        rated_games_before: 20,
        kills: 3,
        deaths: 3,
        assists: 3,
        gold: 10_000,
        cs: 150,
        damage_to_champs: 15_000 + i,
      };
    });
    const seats = await db.from('game_players').insert(rows);
    if (seats.error) throw new Error(`seats: ${seats.error.message}`);
  });

  afterAll(async () => {
    await deleteTestGroups(db, [group]);
    const { error } = await db.from('players').delete().in('puuid', puuids);
    if (error) throw new Error(`cleanup: deleting the test players failed: ${error.message}`);
  });

  it("prints the game page's pre-game odds and Upset! by them", async () => {
    const source = await loadResultSource(db, gameId);
    expect(source?.blueWinProb).toBeCloseTo(blueP ?? Number.NaN, 12);

    const detail = await loadGameDetail(anon, {
      gameId,
      groupId: group,
      viewerPuuid: null,
      timeZone: 'Africa/Cairo',
    });
    expect(detail?.receipt.kind).toBe('pre-game');
    if (detail === null) throw new Error('no detail');
    expect(source?.blueWinProb).toBeCloseTo(receiptBlueWinProb(detail.receipt) ?? Number.NaN, 12);

    if (source === null) throw new Error('no source');
    const input = buildResultInput(source, { identity: game4Identity('https://customs.example') });
    if (input === null) throw new Error('no input');
    const first = resultEmbed(input).embeds[0]?.description?.split('\n')[0];
    expect(first).toBe(resultOddsLine(blueP ?? 0, 200));
    expect(first).toMatch(/Upset!$/);
  });

  it("/fun's Won against the odds counts it at red's pre-game chance, the post's number", async () => {
    const fun = await loadFunFacts(anon, { window: 'all-time', groupId: group, timeZone: 'Africa/Cairo' });
    // The night's only win against the odds is the record (a row needs more wins than one).
    expect(fun.odds.record?.game.id).toBe(gameId);
    expect(fun.odds.record?.percent).toBe(100 - Math.round((blueP ?? 0) * 100));
  });
}
