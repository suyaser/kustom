import { randomUUID } from 'node:crypto';
import { displayRating, provisionalSeed, seedFromRank } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The seed line's source, against the local stack (M5.7 for M5.15).
 *
 * `/p/[puuid]` says `Started at 1470, 37 rated games since.` above the chart, and the number in it has
 * to be the one the **fold actually started from** — not one derived from the rank the player
 * wears tonight. This file reads the loader through the anon key, the way the page does, with a
 * `ratings` row whose stored seed disagrees with the player's current rank: exactly the shape a
 * friend who climbed after their first custom leaves behind.
 *
 * The sentence stopped naming a rank at all on 2026-09-16 (M7.19), and M7.20 deleted the view field
 * and the formatter that had gone on building it, so what this file asserts is the one thing that is
 * still on a screen: the **number**. The stored rank columns are still written and are still set up
 * below, because the row shape they make — a stored seed that disagrees with tonight's rank — is
 * exactly what makes `reference` a real test of the 2026-09-11 decision rather than a tautology.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the seed line against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadPlayerBoard } = await import('./load');
  const { createPublicClient } = await import('@/lib/publicClient');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const puuid = `it-${runId}-seed`;
  const ALL_TIME = { window: 'all-time' } as const;

  /** Where this player started, and where they are now: the two must not be the same rank. */
  const SEED = seedFromRank('GOLD', 'II');
  let seasonId = '';
  let playerId = '';

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    // Gold when they first played; Diamond now, because ranks move and that is the point.
    const { data: player, error } = await db
      .from('players')
      .insert({ puuid, display_name: 'Rami', rank_tier: 'DIAMOND', rank_division: 'I' })
      .select('id')
      .single();
    expect(error).toBeNull();
    playerId = player?.id ?? '';

    await db.from('ratings').insert({
      player_id: playerId,
      season_id: seasonId,
      mu: 27.4,
      sigma: 5,
      games: 12,
      wins: 7,
      seed_mu: SEED.mu,
      seed_sigma: SEED.sigma,
      seed_rank_tier: 'GOLD',
      seed_rank_division: 'II',
    });
  });

  afterAll(async () => {
    // `ratings` cascades with the player.
    await db.from('players').delete().eq('puuid', puuid);
  });

  it('reads the stored seed, not the rank the player wears now', async () => {
    const player = await loadPlayerBoard(anon, puuid, ALL_TIME);
    expect(player).not.toBeNull();
    // `Started at 1470.` — the number the history was built on, which is Gold II's and not the
    // Diamond I this player wears now. Nothing formats the stored rank any more (M7.20); this
    // assertion is the whole test, and it fails the day the loader reads `players.rank_tier`.
    expect(player?.reference).toBe(displayRating(SEED.mu));
    expect(player?.reference).not.toBe(displayRating(seedFromRank('DIAMOND', 'I').mu));
    // And the two numbers at the top are still today's rating, which no part of this changes.
    expect(player?.rating).toBe(displayRating(27.4));
  });

  it('falls back to the neutral seed on a row written before 0012', async () => {
    await db
      .from('ratings')
      .update({ seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null })
      .eq('player_id', playerId)
      .eq('season_id', seasonId);

    const player = await loadPlayerBoard(anon, puuid, ALL_TIME);
    // With no stored seed there is nothing to read but the rule for a first one, and since
    // 2026-09-16 that rule ignores the rank: 1200, not Diamond I's 1920.
    //
    // Asserted against `provisionalSeed()` and not against `seedFromRank(null, null)`: the two
    // share `unrankedMu`, so the old spelling passed whichever of the two the loader called and
    // tested nothing. This one fails the moment the loader goes back to reading a rank.
    expect(player?.reference).toBe(displayRating(provisionalSeed().mu));
  });
}
