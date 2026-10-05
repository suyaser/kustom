import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestEogGame } from '@/lib/ingest/game';
import { ensurePlayers } from '@/lib/ingest/players';
import { rateStoredGame } from '@/lib/ingest/rating';
import { rebuildRatings } from '@/lib/ingest/rebuild';
import { eogPayload, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, pinTestGroupMode } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The owner's two ways out for a game that should never have rated (owner bug 2026-10-05, game
 * 717217f9 on 2026-10-04): (a) `update games set rated = false` and rebuild the group, or (b) delete
 * the game row (its `game_players`, `game_facts` and `ai_lines` cascade) and rebuild. Either must
 * leave the group's ratings, and the rating columns of every other game, exactly as if the bad game
 * had never been played: compared against a group that only ever had the good games.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('removing a game from ratings against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.DISCORD_WEBHOOK_URL = '';

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-rg${index}`);
  /** The bad game reshuffles the sides, so it really moves numbers. */
  const shuffled = [
    ten[0],
    ten[5],
    ten[1],
    ten[6],
    ten[2],
    ten[7],
    ten[3],
    ten[8],
    ten[4],
    ten[9],
  ] as string[];
  const lcuIds: number[] = [];
  let groups: Record<'base' | 'unrate' | 'remove', string> = { base: '', unrate: '', remove: '' };

  /** Good game, bad game, good game, in that order. The base group never has the bad one. */
  const night = [
    { at: '2026-10-04T20:00:00.000Z', puuids: ten, winningSide: 100 as const, bad: false },
    { at: '2026-10-04T21:00:00.000Z', puuids: shuffled, winningSide: 200 as const, bad: true },
    { at: '2026-10-04T22:00:00.000Z', puuids: ten, winningSide: 200 as const, bad: false },
  ];

  async function play(groupId: string, withBad: boolean): Promise<Map<'bad' | number, string>> {
    const ids = new Map<'bad' | number, string>();
    for (const [index, game] of night.entries()) {
      if (game.bad && !withBad) continue;
      const gameId = testGameId();
      lcuIds.push(gameId);
      const payload = eogPayload({
        gameId,
        puuids: game.puuids,
        startedAt: game.at,
        winningSide: game.winningSide,
        // Not 717217f9's 632 s: since M23.1 a new Rift game under 900 s is stored voided (ended early).
        durationS: game.bad ? 1_100 : 1_900,
        raw: { gameMode: 'CLASSIC' },
      });
      const stored = await ingestEogGame(db, payload, { groupId });
      if (stored.outcome !== 'stored') throw new Error('not stored');
      const fold = await rateStoredGame(db, stored.gameId);
      expect(fold.rated).toBe(true);
      ids.set(game.bad ? 'bad' : index, stored.gameId);
    }
    return ids;
  }

  /** Ten decimals: a fold and a rebuild agree to float noise in the last digit (1e-13), not bit for bit. */
  const round = (value: number | null) => (value === null ? null : Math.round(value * 1e10) / 1e10);

  /** The group's `ratings`, keyed by puuid, every number the fold owns. */
  async function ratingsOf(groupId: string) {
    const { data, error } = await db
      .from('ratings')
      .select('mu, sigma, ordinal, games, wins, r, players!inner(puuid)')
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return Object.fromEntries(
      (data ?? [])
        .map((row) => [
          row.players.puuid,
          { mu: round(row.mu), sigma: round(row.sigma), games: row.games, wins: row.wins, r: round(row.r) },
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }

  /** One game's rating columns, keyed by puuid. */
  async function columnsOf(gameId: string): Promise<Record<string, Record<string, number | null>>> {
    const { data, error } = await db
      .from('game_players')
      .select('mu_before, sigma_before, mu_after, sigma_after, r_before, r_after, players!inner(puuid)')
      .eq('game_id', gameId);
    if (error) throw new Error(error.message);
    return Object.fromEntries(
      (data ?? [])
        .map(({ players, ...rest }) => [
          players.puuid,
          Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, round(value)])) as Record<
            string,
            number | null
          >,
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }

  let base = new Map<'bad' | number, string>();
  let unrate = new Map<'bad' | number, string>();
  let remove = new Map<'bad' | number, string>();

  beforeAll(async () => {
    await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    groups = await createTestGroups(db, runId, ['base', 'unrate', 'remove'] as const);
    for (const groupId of Object.values(groups)) await pinTestGroupMode(db, groupId, 'normal');
    base = await play(groups.base, false);
    unrate = await play(groups.unrate, true);
    remove = await play(groups.remove, true);
    await rebuildRatings(db, { groupId: groups.base, force: true });
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', lcuIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', ten);
  });

  it('the bad game moved the numbers (the premise)', async () => {
    expect(await ratingsOf(groups.unrate)).not.toEqual(await ratingsOf(groups.base));
  });

  it('(a) rated = false, then a rebuild: ratings and the other games are as if it was never played', async () => {
    const bad = unrate.get('bad') ?? '';
    const updated = await db.from('games').update({ rated: false }).eq('id', bad).select('id');
    expect(updated.data).toHaveLength(1);
    await rebuildRatings(db, { groupId: groups.unrate, force: true });
    expect(await ratingsOf(groups.unrate)).toEqual(await ratingsOf(groups.base));
    expect(await columnsOf(unrate.get(2) ?? '')).toEqual(await columnsOf(base.get(2) ?? ''));
    // The game is still there, scoreboard and all, with no rating columns.
    const left = await columnsOf(bad);
    expect(Object.keys(left)).toHaveLength(10);
    expect(Object.values(left).every((row) => row.mu_after === null && row.r_after === null)).toBe(true);
  });

  it('(b) delete the game, then a rebuild: the same numbers, and its rows are gone with it', async () => {
    const bad = remove.get('bad') ?? '';
    const deleted = await db.from('games').delete().eq('id', bad).select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
    for (const table of ['game_players', 'game_facts', 'ai_lines'] as const) {
      const { count } = await db
        .from(table)
        .select('game_id', { count: 'exact', head: true })
        .eq('game_id', bad);
      expect(count).toBe(0);
    }
    await rebuildRatings(db, { groupId: groups.remove, force: true });
    expect(await ratingsOf(groups.remove)).toEqual(await ratingsOf(groups.base));
    expect(await columnsOf(remove.get(2) ?? '')).toEqual(await columnsOf(base.get(2) ?? ''));
  });
}
