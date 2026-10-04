import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { readAiGate } from '../premium';
import { createAiClient, fakeReply, mockTransport } from './client';
import { type GenerateDeps, gameLineSourcesFor, generateGameLine } from './generate';
import { dbMeter, readAiBudgetStatus } from './meter';
import { dbLineStore, hideLine, loadShownLine, readOptedOut, setAiOptOut } from './store';

/**
 * M16.3 against the local stack: the game line written through the real meter (`ai_reserve_call`,
 * `ai_settle_call`) and the real store, with a mocked model. Ingest's idempotency rule holds for
 * lines: the same game twice, or two companions at once, and the row counts do not change.
 *
 * **Needs `0033_ai_lines.sql` applied.** Until the lead applies it the file skips with that
 * sentence; without the stack it skips like every other integration file. Makes its own scratch
 * group, players and games, flips only that group's Premium, and deletes everything it made --
 * the ledger rows too, since a deleted group's spend would otherwise still count globally.
 */

const stack = await resolveLocalStack();
const service =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied =
  service !== null && (await service.from('ai_settings').select('calls_enabled').limit(1)).error === null;

const GOOD = '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.';

/** Blue (0-4) beat Red (5-9); Blue's jungler is P2, 9/0/5 on Lee Sin (64). */
const SEATS = [
  { side: 100, role: 'top', champion_id: 86, kills: 7, deaths: 4, assists: 6 },
  { side: 100, role: 'jungle', champion_id: 64, kills: 9, deaths: 0, assists: 5 },
  { side: 100, role: 'mid', champion_id: 61, kills: 8, deaths: 3, assists: 10 },
  { side: 100, role: 'adc', champion_id: 222, kills: 8, deaths: 5, assists: 8 },
  { side: 100, role: 'support', champion_id: 412, kills: 7, deaths: 6, assists: 21 },
  { side: 200, role: 'top', champion_id: 122, kills: 6, deaths: 7, assists: 4 },
  { side: 200, role: 'jungle', champion_id: 254, kills: 5, deaths: 8, assists: 9 },
  { side: 200, role: 'mid', champion_id: 103, kills: 8, deaths: 6, assists: 6 },
  { side: 200, role: 'adc', champion_id: 51, kills: 5, deaths: 7, assists: 5 },
  { side: 200, role: 'support', champion_id: 117, kills: 1, deaths: 11, assists: 3 },
] as const;

if (stack === null || service === null || !applied) {
  describe.skip('AI lines on the local stack', () => {
    it(
      stack === null
        ? 'needs the local stack: run `pnpm db:start`'
        : 'needs migration 0033_ai_lines.sql applied to the local stack',
      () => {
        expect(true).toBe(true);
      },
    );
  });
} else {
  const db = service;
  const runId = randomUUID().slice(0, 8);
  let groupId = '';
  const playerIds: string[] = [];
  const names = new Map<string, string>();
  let lcu = Date.now() * 1_000;

  async function insertGame(source: 'eog' | 'backfill' = 'eog'): Promise<string> {
    lcu += 1;
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: lcu,
        duration_s: 31 * 60 + 24,
        started_at: new Date(Date.now() - 32 * 60_000).toISOString(),
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
        source,
      })
      .select('id')
      .single();
    if (error) throw new Error(`game: ${error.message}`);
    const rows = SEATS.map((seat, index) => ({
      group_id: groupId,
      game_id: data.id,
      player_id: playerIds[index] as string,
      side: seat.side,
      role: seat.role,
      champion_id: seat.champion_id,
      kills: seat.kills,
      deaths: seat.deaths,
      assists: seat.assists,
      cs: 150 + index,
      damage_to_champs: 10_000 + index * 100,
      vision_score: 10 + index,
      gold: 9_000,
    }));
    const seats = await db.from('game_players').insert(rows);
    if (seats.error) throw new Error(`seats: ${seats.error.message}`);
    return data.id;
  }

  function harness(answer = GOOD) {
    const transport = mockTransport(() => fakeReply(answer, { inputTokens: 1_500, outputTokens: 30 }));
    const deps: GenerateDeps = {
      client: createAiClient({
        transport,
        meter: dbMeter(db),
        readGate: (id) => readAiGate(db, id),
        log: () => {},
      }),
      store: dbLineStore(db),
      readGate: (id) => readAiGate(db, id),
      readOptedOut: (id) => readOptedOut(db, id),
      now: () => new Date(),
      sleep: async () => {},
      log: () => {},
    };
    const run = (gameId: string) => generateGameLine(deps, gameLineSourcesFor(db), { groupId, gameId });
    return { transport, deps, run };
  }

  const count = async (table: 'ai_lines' | 'ai_calls') => {
    const { count: n, error } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const nameOf = (id: string) => names.get(id) ?? null;

  beforeAll(async () => {
    groupId = (await createTestGroups(db, runId, ['ai'])).ai;
    for (let index = 0; index < 10; index += 1) {
      const name = `AiFriend${index}`;
      const { data, error } = await db
        .from('players')
        .insert({ puuid: `it-${runId}-ai-p${index}`, display_name: name })
        .select('id')
        .single();
      if (error) throw new Error(`player: ${error.message}`);
      playerIds.push(data.id);
      names.set(data.id, name);
    }
    const members = await db
      .from('group_memberships')
      .insert(playerIds.map((player_id) => ({ group_id: groupId, player_id })));
    if (members.error) throw new Error(`members: ${members.error.message}`);
    // Premium on for this scratch group only (the trigger stamps premium_changed_at now).
    const on = await db.from('groups').update({ premium: true }).eq('id', groupId);
    if (on.error) throw new Error(`premium: ${on.error.message}`);
  }, 60_000);

  afterAll(async () => {
    if (groupId !== '') {
      await db.from('ai_calls').delete().eq('group_id', groupId);
      await deleteTestGroups(db, [groupId]);
    }
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  describe('AI lines on the local stack (M16.3)', () => {
    let gameId = '';
    let lineId = '';

    it('writes, meters and stores one line for a live game', async () => {
      gameId = await insertGame();
      const h = harness();
      const outcome = await h.run(gameId);
      expect(outcome).toMatchObject({ status: 'published', text: GOOD });
      if (outcome.status === 'published') lineId = outcome.lineId;
      expect(await count('ai_lines')).toBe(1);
      expect(await count('ai_calls')).toBe(1);
      const { data } = await db
        .from('ai_calls')
        .select('outcome, cost_usd, input_tokens, output_tokens')
        .eq('group_id', groupId);
      // 1,500 in and 30 out on the game line's model: Sonnet 5.5 at $2/$10 since M16.8.
      expect(data).toEqual([{ outcome: 'ok', cost_usd: 0.0033, input_tokens: 1_500, output_tokens: 30 }]);
      const budget = await readAiBudgetStatus(db, groupId, new Date());
      expect(budget).toMatchObject({ paused: false, groupSpentUsd: 0.0033, groupCapUsd: 2 });
    });

    it('is idempotent: the same game again, and two companions at once, change no row count', async () => {
      const h = harness();
      expect(await h.run(gameId)).toMatchObject({ status: 'cached' });
      const both = await Promise.all([h.run(gameId), h.run(gameId)]);
      expect(both.map((outcome) => outcome.status)).toEqual(['cached', 'cached']);
      expect(h.transport.requests).toHaveLength(0);
      expect(await count('ai_lines')).toBe(1);
      expect(await count('ai_calls')).toBe(1);
    });

    it('two racing first ingests of a new game make one call and one row', async () => {
      const second = await insertGame();
      const h = harness();
      const outcomes = await Promise.all([h.run(second), h.run(second)]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['cached', 'published']);
      expect(h.transport.requests).toHaveLength(1);
      expect(await count('ai_lines')).toBe(2);
      expect(await count('ai_calls')).toBe(2);
    });

    it('shows the line with names, and hides it the moment a named player opts out', async () => {
      const subject = { kind: 'game' as const, gameId };
      expect(await loadShownLine(db, { groupId, subject, nameOf })).toEqual({
        lineId,
        text: 'AiFriend1 put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
      });
      expect(
        await setAiOptOut(db, {
          groupId,
          playerId: playerIds[1] as string,
          optOut: true,
          actor: 'group_admin',
        }),
      ).toEqual({
        ok: true,
        optOut: true,
      });
      expect(await loadShownLine(db, { groupId, subject, nameOf })).toBeNull();
      expect(
        await setAiOptOut(db, {
          groupId,
          playerId: playerIds[1] as string,
          optOut: false,
          actor: 'group_admin',
        }),
      ).toEqual({ ok: false, reason: 'admin_cannot_opt_in' });
      expect(await loadShownLine(db, { groupId, subject, nameOf })).toBeNull();
      await setAiOptOut(db, { groupId, playerId: playerIds[1] as string, optOut: false, actor: 'self' });
      expect(await loadShownLine(db, { groupId, subject, nameOf })).not.toBeNull();
    });

    it('the group switch off: nothing rendered and no call', async () => {
      await db.from('groups').update({ ai_lines_enabled: false }).eq('id', groupId);
      try {
        expect(await loadShownLine(db, { groupId, subject: { kind: 'game', gameId }, nameOf })).toBeNull();
        const h = harness();
        expect(await h.run(await insertGame())).toEqual({ status: 'skipped', reason: 'gate_closed' });
        expect(h.transport.requests).toHaveLength(0);
      } finally {
        await db.from('groups').update({ ai_lines_enabled: true }).eq('id', groupId);
      }
    });

    it('a backfilled game never gets a line', async () => {
      const h = harness();
      expect(await h.run(await insertGame('backfill'))).toEqual({ status: 'skipped', reason: 'not_live' });
    });

    it('at the cap: the call is not made and the ledger does not grow', async () => {
      const calls = await count('ai_calls');
      // Cap the group at nothing: no worst case fits.
      const { error } = await db.from('groups').update({ ai_monthly_cap_usd: 0 }).eq('id', groupId);
      expect(error).toBeNull();
      const h = harness();
      expect(await h.run(await insertGame())).toMatchObject({
        status: 'failed',
        reason: 'refused:group_cap',
      });
      expect(h.transport.requests).toHaveLength(0);
      expect(await count('ai_calls')).toBe(calls);
      expect((await readAiBudgetStatus(db, groupId, new Date()))?.paused).toBe(true);
      await db.from('groups').update({ ai_monthly_cap_usd: 2 }).eq('id', groupId);
    });

    it("an admin's Hide is for good", async () => {
      const at = new Date();
      expect(await hideLine(db, { groupId, lineId, hiddenBy: playerIds[0] as string, now: at })).toBe(true);
      expect(await hideLine(db, { groupId, lineId, hiddenBy: null, now: at })).toBe(false);
      expect(await loadShownLine(db, { groupId, subject: { kind: 'game', gameId }, nameOf })).toBeNull();
      const back = await db.from('ai_lines').update({ status: 'published' }).eq('id', lineId);
      expect(back.error?.message).toMatch(/hidden -> published is not an allowed move/);
    });
  });
}
