import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import type { BoardRow } from '../board/types';
import type { WeekPostSource } from '../discord/post';
import { rebuildRatings } from '../ingest/rebuild';
import { closedWindow } from '../night';
import { readAiGate } from '../premium';
import { createAiClient, fakeReply, mockTransport } from './client';
import { type GenerateDeps, generateWeekLine, retryStoredLine } from './generate';
import { dbMeter } from './meter';
import { dbLineStore, hideLine, readOptedOut, setAiOptOut } from './store';
import {
  loadBoardStoryline,
  loadDiscordStoryline,
  readPlayerIds,
  runStoryline,
  type StorylineHookDeps,
  weekStartDay,
} from './storyline';

/**
 * M16.5 against the local stack: the Sunday post's hook writes one storyline per group-week
 * (mocked model), stores it, the board's Last week reads it, a second Sunday call and a rating
 * rebuild leave it alone, an opted-out player is named nowhere, an admin's Hide takes it off the
 * board and the post, and a group without Premium gets nothing.
 *
 * **Needs `0033_ai_lines.sql` applied**; until then this file skips. Makes its own scratch groups,
 * players and games and deletes them (and their ledger rows).
 */

const stack = await resolveLocalStack();
const service =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied =
  service !== null && (await service.from('ai_settings').select('calls_enabled').limit(1)).error === null;

const TZ = 'Africa/Cairo';
const GOOD =
  "{P1} finished first on the week's board with 5 wins from 6 games. {P2} took 2nd place with 4 wins.";

if (stack === null || service === null || !applied) {
  describe.skip('the weekly storyline on the local stack', () => {
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
  const now = new Date();
  const window = closedWindow('last-week', now, TZ);
  const weekStart = weekStartDay(window, TZ);
  let premiumGroup = '';
  let plainGroup = '';
  const playerIds: string[] = [];
  const puuids: string[] = [];

  function rows(): BoardRow[] {
    return puuids.slice(0, 3).map((puuid, index) => ({
      puuid,
      name: null,
      track: 'week',
      points: [120, 60, -30][index] as number,
      sortKey: 30 - index,
      rating: 1500,
      games: 6,
      wins: [5, 4, 1][index] as number,
      losses: [1, 2, 5][index] as number,
      ratedGames: 30,
      climb: null,
      settling: false,
      settlingChip: false,
      awards: [],
    }));
  }

  function source(groupId: string): WeekPostSource {
    return { groupId, window, timeZone: TZ, rows: rows(), games: 9, stats: null };
  }

  function hook() {
    const transport = mockTransport(() => fakeReply(GOOD, { inputTokens: 2_500, outputTokens: 80 }));
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
    let scheduled = 0;
    const deps: StorylineHookDeps = {
      readGate: (id) => readAiGate(db, id),
      readPlayerIds: (list) => readPlayerIds(db, list),
      generate: (input) => generateWeekLine(generateDeps, input),
      discordLine: (input) => loadDiscordStoryline(db, input),
      schedule: () => {
        scheduled += 1;
      },
      budgetMs: 30_000,
    };
    return { transport, deps, scheduled: () => scheduled };
  }

  async function weekRow(groupId: string) {
    const { data, error } = await db
      .from('ai_lines')
      .select('*')
      .eq('group_id', groupId)
      .eq('kind', 'week')
      .eq('subject', weekStart)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['story', 'plain']);
    premiumGroup = groups.story;
    plainGroup = groups.plain;
    for (let index = 0; index < 10; index += 1) {
      // P1 carries markdown and a mention in their name: Discord must escape it.
      const name = index === 0 ? '*Story_Star* @everyone' : `StoryFriend${index}`;
      const puuid = `it-${runId}-story-p${index}`;
      const { data, error } = await db
        .from('players')
        .insert({ puuid, display_name: name })
        .select('id')
        .single();
      if (error) throw new Error(`player: ${error.message}`);
      playerIds.push(data.id);
      puuids.push(puuid);
    }
    for (const group_id of [premiumGroup, plainGroup]) {
      const members = await db
        .from('group_memberships')
        .insert(playerIds.map((player_id) => ({ group_id, player_id })));
      if (members.error) throw new Error(`members: ${members.error.message}`);
    }
    const on = await db.from('groups').update({ premium: true }).eq('id', premiumGroup);
    if (on.error) throw new Error(`premium: ${on.error.message}`);

    // One finished game inside the closed week, so the rebuild below has something to fold.
    const { data: game, error: gameError } = await db
      .from('games')
      .insert({
        group_id: premiumGroup,
        lcu_game_id: Date.now() * 1_000 + 777,
        duration_s: 30 * 60,
        started_at: new Date(window.start.getTime() + 2 * 60 * 60_000).toISOString(),
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
        source: 'eog',
      })
      .select('id')
      .single();
    if (gameError) throw new Error(`game: ${gameError.message}`);
    const roles = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
    const seats = await db.from('game_players').insert(
      playerIds.map((player_id, index) => ({
        group_id: premiumGroup,
        game_id: game.id,
        player_id,
        side: index < 5 ? 100 : 200,
        role: roles[index % 5] as (typeof roles)[number],
        champion_id: 64,
        kills: 5,
        deaths: 3,
        assists: 7,
      })),
    );
    if (seats.error) throw new Error(`seats: ${seats.error.message}`);
  }, 60_000);

  afterAll(async () => {
    const groups = [premiumGroup, plainGroup].filter((id) => id !== '');
    for (const id of groups) await db.from('ai_calls').delete().eq('group_id', id);
    if (groups.length > 0) await deleteTestGroups(db, groups);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  describe('the weekly storyline on the local stack (M16.5)', () => {
    it('one call per group-week, stored, and it opens the post (names escaped)', async () => {
      const h = hook();
      const line = await runStoryline(source(premiumGroup), h.deps);
      expect(line).toBe(
        "\\*Story\\_Star\\* @everyone finished first on the week's board with 5 wins from 6 games. StoryFriend1 took 2nd place with 4 wins.",
      );
      expect(h.transport.requests).toHaveLength(1);
      expect(h.transport.requests[0]?.model).toBe('claude-sonnet-5-5');
      expect(await weekRow(premiumGroup)).toMatchObject({
        status: 'published',
        attempts: 1,
        week_start: weekStart,
      });
    });

    it('M16.12: the stored facts read back for a retry; a published week is no retry', async () => {
      const row = await weekRow(premiumGroup);
      const facts = await dbLineStore(db).readFacts(row?.id as string);
      expect(facts?.length).toBeGreaterThan(1);
      expect(facts?.[0]).toMatchObject({ id: 'F1' });
      const h = hook();
      const generateDeps: GenerateDeps = {
        client: createAiClient({
          transport: h.transport,
          meter: dbMeter(db),
          readGate: (id) => readAiGate(db, id),
          log: () => {},
        }),
        store: dbLineStore(db),
        readGate: (id) => readAiGate(db, id),
        readOptedOut: (id) => readOptedOut(db, id),
        now: () => new Date(),
        log: () => {},
      };
      expect(
        await retryStoredLine(generateDeps, { groupId: premiumGroup, subject: { kind: 'week', weekStart } }),
      ).toMatchObject({ status: 'cached' });
      expect(h.transport.requests).toHaveLength(0);
    });

    it('a second Sunday call makes no call and no second row', async () => {
      const h = hook();
      expect(await runStoryline(source(premiumGroup), h.deps)).not.toBeNull();
      expect(h.transport.requests).toHaveLength(0);
      const { count } = await db
        .from('ai_lines')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', premiumGroup);
      expect(count).toBe(1);
    });

    it("shows on the board's Last week, and is gone once the next week closes", async () => {
      const shown = await loadBoardStoryline(db, { groupId: premiumGroup, now, timeZone: TZ });
      expect(shown?.text).toBe(
        "*Story_Star* @everyone finished first on the week's board with 5 wins from 6 games. StoryFriend1 took 2nd place with 4 wins.",
      );
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
      expect(await loadBoardStoryline(db, { groupId: premiumGroup, now: nextWeek, timeZone: TZ })).toBeNull();
    });

    it('no rating rebuild rewrites it', async () => {
      const before = await weekRow(premiumGroup);
      const rebuilt = await rebuildRatings(db, { groupId: premiumGroup, force: true });
      expect(rebuilt.ok).toBe(true);
      expect(await weekRow(premiumGroup)).toEqual(before);
    });

    it('an opted-out player is named nowhere', async () => {
      const player = playerIds[0] as string;
      await setAiOptOut(db, { groupId: premiumGroup, playerId: player, optOut: true, actor: 'group_admin' });
      try {
        expect(await loadBoardStoryline(db, { groupId: premiumGroup, now, timeZone: TZ })).toBeNull();
        expect(await runStoryline(source(premiumGroup), hook().deps)).toBeNull();
      } finally {
        await setAiOptOut(db, { groupId: premiumGroup, playerId: player, optOut: false, actor: 'self' });
      }
    });

    it("an admin's Hide takes it off the board and the post that has not gone out", async () => {
      const shown = await loadBoardStoryline(db, { groupId: premiumGroup, now, timeZone: TZ });
      expect(shown).not.toBeNull();
      expect(
        await hideLine(db, {
          groupId: premiumGroup,
          lineId: shown?.lineId as string,
          hiddenBy: playerIds[1] as string,
          now: new Date(),
        }),
      ).toBe(true);
      expect(await loadBoardStoryline(db, { groupId: premiumGroup, now, timeZone: TZ })).toBeNull();
      const h = hook();
      // The post (a retry, or the first try after the Hide) carries no storyline, and nothing is regenerated.
      expect(await runStoryline(source(premiumGroup), h.deps)).toBeNull();
      expect(h.transport.requests).toHaveLength(0);
      expect(await weekRow(premiumGroup)).toMatchObject({ status: 'hidden' });
    });

    it('a group without Premium gets no call, no row and no storyline', async () => {
      const h = hook();
      expect(await runStoryline(source(plainGroup), h.deps)).toBeNull();
      expect(await loadBoardStoryline(db, { groupId: plainGroup, now, timeZone: TZ })).toBeNull();
      expect(h.transport.requests).toHaveLength(0);
      expect(await weekRow(plainGroup)).toBeNull();
    });
  });
}
