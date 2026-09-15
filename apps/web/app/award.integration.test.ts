import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The MVP and the ACE, on both surfaces, off one game (M7.10).
 *
 * This file exists for **acceptance 3**: the two names in the Discord result post and the two
 * words on `/p/[puuid]` come from the same answer, and a test pins that they cannot disagree
 * about one game. The pure tests either side of it (`lib/discord/assemble.test.ts`) prove each
 * surface calls `gatedGameAward`; this one proves the two of them, reading the same stored
 * columns through two different clients with two different queries, name the same two people.
 *
 * It is also the only test that runs the **widened selects** against the real schema. A typo in
 * a column name is a 400 at run time on the one path that matters while ten people are looking
 * at Discord, and nothing above this line would catch it.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the MVP and the ACE against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadPlayerBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { buildResultInput, loadResultSource } = await import('@/lib/discord/assemble');
  const { resultEmbed } = await import('@/lib/discord/embeds');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  /** The page's own client: the anon key and RLS, exactly as a phone would read it. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const ALL_TIME = { window: 'all-time' } as const;
  const CONTEXT = { timestamp: '2026-09-15T21:00:00.000Z' };

  /**
   * Ten seats. Red wins, so the **MVP** comes off red and the **ACE** off blue.
   *
   * `red-adc` leads every one of the nine numbers, on either side; `blue-jungle` leads blue in
   * every one of them at about half those values. The other eight are identical and tiny. That
   * makes the answer independent of the three role weight vectors (M7.13): a player who is
   * ahead of their side on every component cannot be caught by a teammate whose bucket happens
   * to care about a different one. The test still asks `gatedGameAward` rather than trusting
   * that reasoning — the two surfaces agreeing with **it** is the property, not the names.
   */
  const SEATS = [
    { key: 'blue-top', side: 100, role: 'top', tier: 'rest' },
    { key: 'blue-jungle', side: 100, role: 'jungle', tier: 'ace' },
    { key: 'blue-mid', side: 100, role: 'mid', tier: 'rest' },
    { key: 'blue-adc', side: 100, role: 'adc', tier: 'rest' },
    { key: 'blue-support', side: 100, role: 'support', tier: 'rest' },
    { key: 'red-top', side: 200, role: 'top', tier: 'rest' },
    { key: 'red-jungle', side: 200, role: 'jungle', tier: 'rest' },
    { key: 'red-mid', side: 200, role: 'mid', tier: 'rest' },
    { key: 'red-adc', side: 200, role: 'adc', tier: 'mvp' },
    { key: 'red-support', side: 200, role: 'support', tier: 'rest' },
  ] as const;

  const STAT_LINE = {
    mvp: {
      kills: 20,
      deaths: 1,
      assists: 20,
      damage_to_champs: 60_000,
      gold: 20_000,
      cs: 300,
      vision_score: 60,
      damage_self_mitigated: 40_000,
      damage_to_objectives: 30_000,
    },
    ace: {
      kills: 10,
      deaths: 1,
      assists: 10,
      damage_to_champs: 30_000,
      gold: 10_000,
      cs: 150,
      vision_score: 30,
      damage_self_mitigated: 20_000,
      damage_to_objectives: 15_000,
    },
    rest: {
      kills: 1,
      deaths: 10,
      assists: 1,
      damage_to_champs: 600,
      gold: 200,
      cs: 3,
      vision_score: 1,
      damage_self_mitigated: 400,
      damage_to_objectives: 300,
    },
  } as const;

  const puuidOf = (key: string): string => `it-${runId}-${key}`;
  const playerIds = new Map<string, string>();
  let seasonId = '';
  let gameId = '';
  /** The second game: the same ten, one vision score missing. No MVP anywhere. */
  let holedGameId = '';

  async function insertGame(lcuGameId: number, startedAt: string, hole: boolean): Promise<string> {
    const { data: row, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        season_id: seasonId,
        started_at: startedAt,
        duration_s: 2_000,
        winning_side: 200,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const id = row?.id ?? '';

    const { error: rowsError } = await db.from('game_players').insert(
      SEATS.map((seat, index) => ({
        game_id: id,
        player_id: playerIds.get(seat.key) ?? '',
        side: seat.side,
        role: seat.role,
        ...STAT_LINE[seat.tier],
        // One hole is one game without an award: core refuses to score a game where any of the
        // ten is missing any of the nine, and it is the fold's own rule, not this file's.
        ...(hole && index === 5 ? { vision_score: null } : {}),
        mu_before: 25,
        sigma_before: 5,
        mu_after: seat.side === 200 ? 25.4 : 24.6,
        sigma_after: 4.9,
      })),
    );
    expect(rowsError).toBeNull();
    return id;
  }

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(
        SEATS.map((seat) => ({
          puuid: puuidOf(seat.key),
          display_name: seat.key,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) {
      const seat = SEATS.find((candidate) => puuidOf(candidate.key) === row.puuid);
      if (seat !== undefined) playerIds.set(seat.key, row.id);
    }

    const base = Date.now();
    gameId = await insertGame(
      Number(`77${base % 10_000_000}`),
      new Date(base - 3_600_000).toISOString(),
      false,
    );
    holedGameId = await insertGame(
      Number(`78${base % 10_000_000}`),
      new Date(base - 1_800_000).toISOString(),
      true,
    );
  });

  afterAll(async () => {
    const games = [gameId, holedGameId].filter((id) => id !== '');
    if (games.length > 0) await db.from('games').delete().in('id', games);
    const ids = [...playerIds.values()];
    if (ids.length > 0) {
      await db.from('ratings').delete().in('player_id', ids);
      await db.from('players').delete().in('id', ids);
    }
  });

  /** The newest game on a player's page, which is the holed one; the older one is theirs too. */
  async function recentOf(key: string, wanted: string) {
    const player = await loadPlayerBoard(anon, puuidOf(key), ALL_TIME);
    const game = player?.recent.find((entry) => entry.gameId === wanted);
    expect(game).toBeDefined();
    return game;
  }

  describe('one game, two surfaces', () => {
    it('names the same two people in the post and on the page', async () => {
      const source = await loadResultSource(db, gameId);
      expect(source).not.toBeNull();
      const input = buildResultInput(source as NonNullable<typeof source>, CONTEXT);

      // The post: two display names, one line, under the two columns.
      expect(input?.award).toEqual({ mvp: 'red-adc', ace: 'blue-jungle' });
      expect(resultEmbed(input as NonNullable<typeof input>).embeds[0]?.fields[2]?.value).toBe(
        'MVP red-adc · ACE blue-jungle',
      );

      // The page: the same two people, as a word on their own row, from the anon read.
      expect((await recentOf('red-adc', gameId))?.award).toBe('mvp');
      expect((await recentOf('blue-jungle', gameId))?.award).toBe('ace');
    });

    it('says nothing at all for the other eight', async () => {
      for (const seat of SEATS.filter((candidate) => candidate.tier === 'rest')) {
        expect((await recentOf(seat.key, gameId))?.award).toBeNull();
      }
    });

    it('drops the line on both surfaces when one of the ten is missing one number', async () => {
      const source = await loadResultSource(db, holedGameId);
      const input = buildResultInput(source as NonNullable<typeof source>, CONTEXT);

      expect(input?.award).toBeNull();
      // Acceptance 2: no field, and the post is the two columns it has always been.
      expect(resultEmbed(input as NonNullable<typeof input>).embeds[0]?.fields).toHaveLength(2);
      expect((await recentOf('red-adc', holedGameId))?.award).toBeNull();
      expect((await recentOf('blue-jungle', holedGameId))?.award).toBeNull();
    });
  });
}
