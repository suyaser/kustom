import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { closedWindow } from '../night';
import { readAiGate } from '../premium';
import { createAiClient, fakeReply, mockTransport } from './client';
import { type GenerateDeps, generatePlayerLine } from './generate';
import { AI_FEATURES, dbMeter } from './meter';
import { runScouting, type ScoutingDeps, scoutingDepsFor } from './scouting';
import { loadPlayerScouting } from './scoutingRead';
import { dbLineStore, hideLine, readOptedOut } from './store';
import { weekStartDay } from './storyline';

/**
 * M16.6 against the local stack: the Sunday run writes one scouting report per settled player who
 * played the closed week (mocked model), none for a settling, opted-out or absent player, a second
 * run makes no call, the page reads it back with its written date, Hide and an opt-out take it off
 * the page, and a group without Premium gets nothing. Own scratch groups, players and games.
 */

const stack = await resolveLocalStack();
const service =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied =
  service !== null && (await service.from('ai_settings').select('calls_enabled').limit(1)).error === null;

const TZ = 'Africa/Cairo';
const GOOD = '{P1} means Lee Sin: 13 games on it at 54 percent. Over the week {P1} went 1 win in 1 game.';

if (stack === null || service === null || !applied) {
  describe.skip('the scouting report on the local stack', () => {
    it('needs the local stack with 0033 applied', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const db = service;
  const runId = randomUUID().slice(0, 8);
  const now = new Date();
  const window = closedWindow('last-week', now, TZ);
  const weekStart = weekStartDay(window, TZ);
  let scoutGroup = '';
  let plainGroup = '';
  const playerIds: string[] = [];
  const puuids: string[] = [];
  let lcu = Date.now() * 1_000 + 900;

  function deps() {
    const transport = mockTransport(() => fakeReply(GOOD, { inputTokens: 1_200, outputTokens: 60 }));
    const generateDeps: GenerateDeps = {
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
    const scouting: ScoutingDeps = {
      ...scoutingDepsFor(db),
      generate: (input) => generatePlayerLine(generateDeps, input),
    };
    return { transport, scouting };
  }

  async function game(
    groupId: string,
    startedAt: Date,
    seats: { player: number; side: 100 | 200 }[],
    won: 100 | 200,
  ) {
    lcu += 1;
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: lcu,
        duration_s: 30 * 60,
        started_at: startedAt.toISOString(),
        winning_side: won,
        raw: { gameMode: 'CLASSIC' },
        source: 'eog',
      })
      .select('id')
      .single();
    if (error) throw new Error(`game: ${error.message}`);
    const rows = await db.from('game_players').insert(
      seats.map(({ player, side }) => ({
        group_id: groupId,
        game_id: data.id,
        player_id: playerIds[player] as string,
        side,
        role: 'jungle' as const,
        champion_id: 64,
        kills: 5,
        deaths: 3,
        assists: 7,
      })),
    );
    if (rows.error) throw new Error(`seats: ${rows.error.message}`);
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['scout', 'scoutplain']);
    scoutGroup = groups.scout;
    plainGroup = groups.scoutplain;
    for (let index = 0; index < 4; index += 1) {
      const puuid = `it-${runId}-scout-p${index}`;
      const { data, error } = await db
        .from('players')
        .insert({ puuid, display_name: `Scout${index}` })
        .select('id')
        .single();
      if (error) throw new Error(`player: ${error.message}`);
      playerIds.push(data.id);
      puuids.push(puuid);
    }
    for (const group_id of [scoutGroup, plainGroup]) {
      const members = await db
        .from('group_memberships')
        .insert(playerIds.map((player_id) => ({ group_id, player_id })));
      if (members.error) throw new Error(`members: ${members.error.message}`);
      // P0 settled and played, P1 settled and played (opts out later), P2 settling and played,
      // P3 settled and absent this week.
      const ratings = await db.from('ratings').insert(
        [
          [0, 12, 7],
          [1, 12, 6],
          [2, 5, 3],
          [3, 15, 8],
        ].map(([player, games, wins]) => ({
          group_id,
          player_id: playerIds[player as number] as string,
          mu: 25,
          sigma: 5,
          games: games as number,
          wins: wins as number,
        })),
      );
      if (ratings.error) throw new Error(`ratings: ${ratings.error.message}`);
    }
    const on = await db.from('groups').update({ premium: true }).eq('id', scoutGroup);
    if (on.error) throw new Error(`premium: ${on.error.message}`);

    // Twelve earlier games for P0 (6 won), then one game inside the closed week that P0 wins.
    for (let index = 0; index < 12; index += 1) {
      const at = new Date(window.start.getTime() - (index + 1) * 24 * 60 * 60_000);
      await game(
        scoutGroup,
        at,
        [
          { player: 0, side: 100 },
          { player: 3, side: 200 },
        ],
        index % 2 === 0 ? 100 : 200,
      );
    }
    await game(
      scoutGroup,
      new Date(window.start.getTime() + 2 * 60 * 60_000),
      [
        { player: 0, side: 100 },
        { player: 1, side: 100 },
        { player: 2, side: 200 },
      ],
      100,
    );
  }, 60_000);

  afterAll(async () => {
    const groups = [scoutGroup, plainGroup].filter((id) => id !== '');
    for (const id of groups) await db.from('ai_calls').delete().eq('group_id', id);
    if (groups.length > 0) await deleteTestGroups(db, groups);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  async function playerRows(groupId: string) {
    const { data, error } = await db
      .from('ai_lines')
      .select('player_id, status, week_start, model')
      .eq('group_id', groupId)
      .eq('kind', 'player');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  const far = () => Date.now() + 60_000;

  describe('the scouting report on the local stack (M16.6)', () => {
    it('writes one report, for the settled player who played and has not opted out', async () => {
      const opt = await db
        .from('group_memberships')
        .update({ ai_opt_out: true })
        .eq('group_id', scoutGroup)
        .eq('player_id', playerIds[1] as string);
      if (opt.error) throw new Error(opt.error.message);

      const h = deps();
      const run = await runScouting(h.scouting, { groupId: scoutGroup, window, weekStart, deadline: far() });
      expect(run).toMatchObject({ candidates: 1, attempted: 1, deferred: 0, outcomes: { published: 1 } });
      expect(h.transport.requests).toHaveLength(1);
      expect(h.transport.requests[0]?.model).toBe(AI_FEATURES.player.model);
      // The facts carried P0's pool: Lee Sin on 13 rated games, 7 wins, the jungle.
      expect(h.transport.requests[0]?.user).toContain('13 games on Lee Sin');
      // M16.19: the week's best game is read from the pool (5 kills, 7 assists); no duo under 5 games
      // together, and the opted-out P1 is never a partner.
      expect(h.transport.requests[0]?.user).toContain('their best game of the week');
      expect(h.transport.requests[0]?.user).toContain('5 kills in that game');
      expect(h.transport.requests[0]?.user).not.toContain('wins with most');
      expect(await playerRows(scoutGroup)).toEqual([
        {
          player_id: playerIds[0],
          status: 'published',
          week_start: weekStart,
          model: AI_FEATURES.player.model,
        },
      ]);
    });

    it('the group reads leave opted-out players out in the query itself', async () => {
      const reads = scoutingDepsFor(db);
      const out = new Set([playerIds[1] as string]);
      const week = await reads.readWeek(scoutGroup, window, out);
      expect([...week.keys()].sort()).toEqual([playerIds[0], playerIds[2]].sort());
      expect(week.get(playerIds[0] as string)).toEqual({ games: 1, wins: 1 });
      const all = await reads.readWeek(scoutGroup, window, new Set());
      expect(all.has(playerIds[1] as string)).toBe(true);
      const ratings = await reads.readRatings(scoutGroup, out);
      expect([...ratings.keys()].sort()).toEqual([playerIds[0], playerIds[3]].sort());
    });

    it('a second run makes no call and no second row', async () => {
      const h = deps();
      const run = await runScouting(h.scouting, { groupId: scoutGroup, window, weekStart, deadline: far() });
      expect(run?.outcomes).toEqual({ cached: 1 });
      expect(h.transport.requests).toHaveLength(0);
      expect(await playerRows(scoutGroup)).toHaveLength(1);
    });

    it('past the deadline nobody is started', async () => {
      const h = deps();
      const run = await runScouting(h.scouting, {
        groupId: scoutGroup,
        window,
        weekStart,
        deadline: Date.now(),
      });
      expect(run).toMatchObject({ attempted: 0, deferred: 1 });
      expect(h.transport.requests).toHaveLength(0);
    });

    it('the page reads it with the name and the written date; nothing for the others', async () => {
      const shown = await loadPlayerScouting(db, {
        groupId: scoutGroup,
        puuid: puuids[0] as string,
        timeZone: TZ,
      });
      expect(shown?.text).toBe(
        'Scout0 means Lee Sin: 13 games on it at 54 percent. Over the week Scout0 went 1 win in 1 game.',
      );
      expect(shown?.written).toMatch(/^Written [A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2}$/);
      for (const index of [1, 2, 3]) {
        expect(
          await loadPlayerScouting(db, { groupId: scoutGroup, puuid: puuids[index] as string, timeZone: TZ }),
        ).toBeNull();
      }
    });

    it('a group without Premium: no run, no row, nothing on the page', async () => {
      const h = deps();
      expect(
        await runScouting(h.scouting, { groupId: plainGroup, window, weekStart, deadline: far() }),
      ).toBeNull();
      expect(h.transport.requests).toHaveLength(0);
      expect(await playerRows(plainGroup)).toEqual([]);
      expect(
        await loadPlayerScouting(db, { groupId: plainGroup, puuid: puuids[0] as string, timeZone: TZ }),
      ).toBeNull();
    });

    it('an opt-out hides it at once, and Hide takes it away for everyone', async () => {
      const read = () =>
        loadPlayerScouting(db, { groupId: scoutGroup, puuid: puuids[0] as string, timeZone: TZ });
      const shown = await read();
      expect(shown).not.toBeNull();

      const out = await db
        .from('group_memberships')
        .update({ ai_opt_out: true })
        .eq('group_id', scoutGroup)
        .eq('player_id', playerIds[0] as string);
      if (out.error) throw new Error(out.error.message);
      expect(await read()).toBeNull();
      const back = await db
        .from('group_memberships')
        .update({ ai_opt_out: false })
        .eq('group_id', scoutGroup)
        .eq('player_id', playerIds[0] as string);
      if (back.error) throw new Error(back.error.message);
      expect(await read()).not.toBeNull();

      expect(
        await hideLine(db, {
          groupId: scoutGroup,
          lineId: shown?.lineId as string,
          hiddenBy: null,
          now: new Date(),
        }),
      ).toBe(true);
      expect(await read()).toBeNull();
    });
  });
}
