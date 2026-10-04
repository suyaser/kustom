import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { type StoredGameFacts, storedGameFactsSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAME_FACTS_VERSION } from '@/lib/stats/gameFacts';
import { rawFactsFromUnknown } from '@/lib/stats/rawFacts';
import { eogPayload, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `game_facts` (0041) and `games.game_mode` (0039) against the local stack: ingest writes the facts
 * row with the stored raw, a repeat post (a second companion) changes nothing, a ban merge rewrites
 * it, and `backfill-game-facts` fills and recomputes, twice safely. Every stored row deep-equals
 * `rawFactsFromUnknown(games.raw)`. Skipped when the stack is not running.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('game_facts against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

  const { ingestEogGame } = await import('./game');
  const { backfillGroupFacts } = await import('./backfillGameFacts');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const base = testGameId();
  const liveId = base + 1;
  const banId = base + 2;
  const aramId = base + 3;
  let groupId = '';
  let groupSlug = '';

  /** Every facts row of the test group, with its game's raw and mode, by lcu id. */
  async function readFacts() {
    const { data, error } = await db
      .from('games')
      .select('id, lcu_game_id, raw, game_mode, game_facts(facts_version, facts, updated_at)')
      .eq('group_id', groupId)
      .order('lcu_game_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** The stored facts of one read game, parsed (the reader's own boundary). */
  function factsOf(game: { game_facts: { facts: unknown }[] } | undefined): StoredGameFacts {
    return storedGameFactsSchema.parse(game?.game_facts[0]?.facts);
  }

  async function factsRowCount(): Promise<number> {
    const { count, error } = await db
      .from('game_facts')
      .select('game_id', { count: 'exact', head: true })
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['facts'] as const);
    groupId = groups.facts;
    groupSlug = `it-${runId}-facts`;
  });

  afterAll(async () => {
    await deleteTestGroups(db, [groupId]);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('ingest', () => {
    it('writes one facts row with the stored raw, and game_mode beside it', async () => {
      const payload = eogPayload({
        gameId: liveId,
        puuids,
        raw: {
          gameMode: 'CLASSIC',
          teams: [
            {
              teamId: 100,
              players: [
                {
                  puuid: puuids[0],
                  championName: 'Ahri',
                  detectedTeamPosition: 'MIDDLE',
                  stats: { firstBloodKill: true, PENTA_KILLS: 1, VISION_SCORE: 30 },
                },
              ],
            },
            { teamId: 200, players: [{ puuid: puuids[5], stats: { totalDamageTaken: 40_000 } }] },
          ],
        },
      });
      const result = await ingestEogGame(db, payload, { groupId });
      expect(result).toMatchObject({ outcome: 'stored', created: true, groupId });

      const [game] = await readFacts();
      expect(game?.game_mode).toBe('CLASSIC');
      expect(game?.game_facts).toHaveLength(1);
      expect(game?.game_facts[0]?.facts_version).toBe(GAME_FACTS_VERSION);
      expect(game?.game_facts[0]?.facts).toEqual(rawFactsFromUnknown(game?.raw));
      expect(factsOf(game).byPuuid[puuids[0] as string]?.pentaKills).toBe(1);
    });

    it('is a no-op the second time and from a second companion: one row, not rewritten', async () => {
      const before = await readFacts();
      const payload = eogPayload({ gameId: liveId, puuids, raw: { gameMode: 'CLASSIC', teams: [] } });
      for (let post = 0; post < 2; post += 1) {
        const again = await ingestEogGame(db, payload, { groupId });
        expect(again).toMatchObject({ outcome: 'stored', created: false });
      }
      expect(await factsRowCount()).toBe(1);
      // Not even updated_at moved: a repeat post that merged nothing writes nothing.
      expect(await readFacts()).toEqual(before);
    });

    it('rewrites the row when a later post copies the draft bans onto the block', async () => {
      const live = eogPayload({
        gameId: banId,
        puuids,
        raw: {
          gameMode: 'CLASSIC',
          teams: [
            { teamId: 100, players: [{ puuid: puuids[0] }] },
            { teamId: 200, players: [] },
          ],
        },
      });
      await ingestEogGame(db, live, { groupId });
      const stored = (await readFacts()).find((game) => game.lcu_game_id === banId);
      expect(factsOf(stored).bans).toEqual([]);

      const detail = eogPayload({
        gameId: banId,
        puuids,
        raw: {
          gameMode: 'CLASSIC',
          teams: [
            { teamId: 100, bans: [{ championId: 11, pickTurn: 1 }] },
            { teamId: 200, bans: [{ championId: 154, pickTurn: 6 }] },
          ],
        },
      });
      await ingestEogGame(db, { ...detail, source: 'backfill', partyId: undefined }, { groupId });

      const after = (await readFacts()).find((game) => game.lcu_game_id === banId);
      expect(after?.game_facts[0]?.facts).toEqual(rawFactsFromUnknown(after?.raw));
      expect(factsOf(after).bans).toEqual([
        { championId: 11, teamId: 100 },
        { championId: 154, teamId: 200 },
      ]);
      expect(after?.game_mode).toBe('CLASSIC');
      expect(await factsRowCount()).toBe(2);
    });

    it('fills the row of a game stored before 0041 when it is posted again', async () => {
      await ingestEogGame(db, eogPayload({ gameId: aramId, puuids, raw: { gameMode: 'ARAM' } }), { groupId });
      const aram = (await readFacts()).find((game) => game.lcu_game_id === aramId);
      expect(aram?.game_mode).toBe('ARAM');
      await db
        .from('game_facts')
        .delete()
        .eq('game_id', aram?.id ?? '');
      expect(await factsRowCount()).toBe(2);

      await ingestEogGame(db, eogPayload({ gameId: aramId, puuids, raw: { gameMode: 'ARAM' } }), { groupId });
      expect(await factsRowCount()).toBe(3);
    });
  });

  describe('backfill-game-facts', () => {
    it('fills every missing row, then writes nothing on a second run', async () => {
      await db.from('game_facts').delete().eq('group_id', groupId);
      const group = { id: groupId, slug: groupSlug };

      const dry = await backfillGroupFacts(db, group, true);
      expect(dry).toEqual({ groupSlug, games: 3, missing: 3, stale: 0, written: 0 });
      expect(await factsRowCount()).toBe(0);

      const first = await backfillGroupFacts(db, group, false);
      expect(first).toEqual({ groupSlug, games: 3, missing: 3, stale: 0, written: 3 });
      for (const game of await readFacts()) {
        expect(game.game_facts[0]?.facts).toEqual(rawFactsFromUnknown(game.raw));
        expect(game.game_facts[0]?.facts_version).toBe(GAME_FACTS_VERSION);
      }

      const before = await readFacts();
      const second = await backfillGroupFacts(db, group, false);
      expect(second).toEqual({ groupSlug, games: 3, missing: 0, stale: 0, written: 0 });
      expect(await readFacts()).toEqual(before);
      expect(await factsRowCount()).toBe(3);
    });

    it('recomputes every row below the code version, once', async () => {
      const group = { id: groupId, slug: groupSlug };
      const next = GAME_FACTS_VERSION + 1;
      const bumped = await backfillGroupFacts(db, group, false, next);
      expect(bumped).toEqual({ groupSlug, games: 3, missing: 0, stale: 3, written: 3 });
      for (const game of await readFacts()) {
        expect(game.game_facts[0]?.facts_version).toBe(next);
        expect(game.game_facts[0]?.facts).toEqual(rawFactsFromUnknown(game.raw));
      }
      expect(await backfillGroupFacts(db, group, false, next)).toMatchObject({ stale: 0, written: 0 });
      expect(await factsRowCount()).toBe(3);
    });
  });
}
