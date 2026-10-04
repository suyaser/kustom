import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import type { RecapEditOutcome } from '../discord/aiEdit';
import { readAiGate } from '../premium';
import { type GameLineHookDeps, runGameLine } from './afterIngest';
import { createAiClient, fakeReply, mockTransport } from './client';
import { type GenerateDeps, gameLineSourcesFor, generateGameLine } from './generate';
import { dbMeter } from './meter';
import { loadDiscordRecap, loadGameRecap } from './recap';
import { dbLineStore, hideLine, readOptedOut, setAiOptOut } from './store';
import { loadPremiumSection } from './switches';

/**
 * M16.4 against the local stack: the post-ingest hook writes one line per live game (mocked model),
 * every surface reads it through `loadShownLine`, an admin's Hide takes it off every surface, an
 * opted-out player's line shows nowhere, and backfilled or non-Premium games never show anything.
 *
 * **Needs `0033_ai_lines.sql` applied**; until then this file skips with that sentence. Makes its
 * own scratch groups, players and games and deletes them (and their ledger rows).
 */

const stack = await resolveLocalStack();
const service =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied =
  service !== null && (await service.from('ai_settings').select('calls_enabled').limit(1)).error === null;

const GOOD = '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.';

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
  describe.skip('the game recap on the local stack', () => {
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
  let premiumGroup = '';
  let plainGroup = '';
  const playerIds: string[] = [];
  let lcu = Date.now() * 1_000 + 500;

  async function insertGame(groupId: string, source: 'eog' | 'backfill' = 'eog'): Promise<string> {
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
    const seats = await db.from('game_players').insert(
      SEATS.map((seat, index) => ({
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
      })),
    );
    if (seats.error) throw new Error(`seats: ${seats.error.message}`);
    return data.id;
  }

  function hook() {
    const transport = mockTransport(() => fakeReply(GOOD, { inputTokens: 1_500, outputTokens: 30 }));
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
    const edits: string[] = [];
    const hookDeps: GameLineHookDeps = {
      generate: (input) => generateGameLine(deps, gameLineSourcesFor(db), input),
      discordLine: (input) => loadDiscordRecap(db, input),
      editResult: async (input): Promise<RecapEditOutcome> => {
        edits.push(input.line);
        return { status: 'edited' };
      },
      now: () => new Date(),
    };
    return {
      transport,
      edits,
      run: (groupId: string, gameId: string) => runGameLine({ groupId, gameId }, hookDeps),
    };
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['recap', 'plain']);
    premiumGroup = groups.recap;
    plainGroup = groups.plain;
    for (let index = 0; index < 10; index += 1) {
      // P2 (index 1) carries markdown and a mention in their name: Discord must escape it.
      const name = index === 1 ? '*Bold_Guy* @everyone' : `RecapFriend${index}`;
      const { data, error } = await db
        .from('players')
        .insert({ puuid: `it-${runId}-recap-p${index}`, display_name: name })
        .select('id')
        .single();
      if (error) throw new Error(`player: ${error.message}`);
      playerIds.push(data.id);
    }
    for (const group_id of [premiumGroup, plainGroup]) {
      const members = await db
        .from('group_memberships')
        .insert(playerIds.map((player_id) => ({ group_id, player_id })));
      if (members.error) throw new Error(`members: ${members.error.message}`);
    }
    const on = await db.from('groups').update({ premium: true }).eq('id', premiumGroup);
    if (on.error) throw new Error(`premium: ${on.error.message}`);
  }, 60_000);

  afterAll(async () => {
    const groups = [premiumGroup, plainGroup].filter((id) => id !== '');
    for (const id of groups) await db.from('ai_calls').delete().eq('group_id', id);
    if (groups.length > 0) await deleteTestGroups(db, groups);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  describe('the game recap on the local stack (M16.4)', () => {
    let gameId = '';

    it('a fresh live game with no line yet is waiting; then one line, on every surface', async () => {
      gameId = await insertGame(premiumGroup);
      expect(await loadGameRecap(db, { groupId: premiumGroup, gameId, now: new Date() })).toEqual({
        kind: 'waiting',
      });
      const h = hook();
      const run = await h.run(premiumGroup, gameId);
      expect(run?.generated.status).toBe('published');
      expect(h.transport.requests).toHaveLength(1);

      const site = await loadGameRecap(db, { groupId: premiumGroup, gameId, now: new Date() });
      expect(site).toMatchObject({
        kind: 'line',
        text: '*Bold_Guy* @everyone put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
      });
      // Discord: the name escaped, no mention syntax left live (and the edit is sent with mentions off).
      expect(h.edits).toEqual([
        '\\*Bold\\_Guy\\* @everyone put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
      ]);
    });

    it('a second ingest makes no call and no second row', async () => {
      const h = hook();
      const run = await h.run(premiumGroup, gameId);
      expect(run?.generated.status).toBe('cached');
      expect(h.transport.requests).toHaveLength(0);
      expect(h.edits).toHaveLength(0);
      const { count } = await db
        .from('ai_lines')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', premiumGroup);
      expect(count).toBe(1);
    });

    it('an opted-out player is named nowhere', async () => {
      const player = playerIds[1] as string;
      await setAiOptOut(db, { groupId: premiumGroup, playerId: player, optOut: true, actor: 'group_admin' });
      try {
        expect(await loadGameRecap(db, { groupId: premiumGroup, gameId, now: new Date() })).toBeNull();
        expect(await loadDiscordRecap(db, { groupId: premiumGroup, gameId })).toBeNull();
      } finally {
        await setAiOptOut(db, { groupId: premiumGroup, playerId: player, optOut: false, actor: 'self' });
      }
    });

    it('a backfilled game and a non-Premium group show nothing, not even waiting', async () => {
      const h = hook();
      const backfilled = await insertGame(premiumGroup, 'backfill');
      expect((await h.run(premiumGroup, backfilled))?.generated).toEqual({
        status: 'skipped',
        reason: 'not_live',
      });
      expect(
        await loadGameRecap(db, { groupId: premiumGroup, gameId: backfilled, now: new Date() }),
      ).toBeNull();

      const plain = await insertGame(plainGroup);
      expect((await h.run(plainGroup, plain))?.generated).toEqual({
        status: 'skipped',
        reason: 'gate_closed',
      });
      expect(await loadGameRecap(db, { groupId: plainGroup, gameId: plain, now: new Date() })).toBeNull();
      expect(await loadPremiumSection(db, plainGroup, new Date())).toBeNull();
      expect(h.transport.requests).toHaveLength(0);
    });

    it("an admin's Hide takes it off every surface", async () => {
      const shown = await loadGameRecap(db, { groupId: premiumGroup, gameId, now: new Date() });
      expect(shown?.kind).toBe('line');
      const lineId = shown?.kind === 'line' ? shown.lineId : '';
      expect(
        await hideLine(db, {
          groupId: premiumGroup,
          lineId,
          hiddenBy: playerIds[0] as string,
          now: new Date(),
        }),
      ).toBe(true);
      expect(await loadGameRecap(db, { groupId: premiumGroup, gameId, now: new Date() })).toBeNull();
      expect(await loadDiscordRecap(db, { groupId: premiumGroup, gameId })).toBeNull();
    });

    it('the budget line shows only once the month is used up', async () => {
      expect((await loadPremiumSection(db, premiumGroup, new Date()))?.pausedUntilDay).toBeNull();
      await db.from('groups').update({ ai_monthly_cap_usd: 0 }).eq('id', premiumGroup);
      try {
        // M16.3b review: the admin home's one Premium card reads its paused day from here.
        expect((await loadPremiumSection(db, premiumGroup, new Date()))?.pausedUntilDay).toMatch(
          /^1 [A-Z][a-z]{2,3}$/,
        );
      } finally {
        await db.from('groups').update({ ai_monthly_cap_usd: 2 }).eq('id', premiumGroup);
      }
    });
  });
}
