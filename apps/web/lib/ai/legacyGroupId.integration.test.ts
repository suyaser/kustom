import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import type { BoardRow } from '../board/types';
import { closedWindow } from '../night';
import { readAiGate } from '../premium';
import { createAiClient, fakeReply, mockTransport } from './client';
import { buildWeekFacts, factHash, PROMPT_VERSION } from './facts';
import {
  type GenerateDeps,
  generatePlayerLine,
  generateWeekLine,
  PENDING_STALE_MS,
  retryStoredLine,
} from './generate';
import { AI_FEATURES, dbMeter } from './meter';
import { dbLineStore, readOptedOut } from './store';
import { loadDiscordStoryline, readPlayerIds, runStoryline, type StorylineHookDeps, weekStartDay } from './storyline';

/**
 * Production bug, 2026-10-04: the original group's fixed id `00000000-0000-0000-0000-000000000001`
 * is not an RFC 9562 uuid (version nibble 0), and `aiLineRowSchema.group_id` was `z.uuid()`. Every
 * `ai_lines` row the store read back for that group failed to parse: the claim's insert landed,
 * then its read-back threw, so the week storyline never reached Discord and the scouting reports
 * stayed `pending` with no text. This file runs the same paths on a scratch group whose id has the
 * same shape (`00000000-0000-0000-0000-<random 12 hex>`): never the real customs group.
 */

const stack = await resolveLocalStack();
const service =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied =
  service !== null && (await service.from('ai_settings').select('calls_enabled').limit(1)).error === null;

const TZ = 'Africa/Cairo';
const WEEK_TEXT =
  "{P1} finished first on the week's board with 5 wins from 6 games. {P2} took 2nd place with 4 wins.";

if (stack === null || service === null || !applied) {
  describe.skip('AI lines for a group whose id is not an RFC uuid', () => {
    it('needs the local stack with 0033 applied: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const db = service;
  const runId = randomUUID().slice(0, 8);
  // Version nibble 0, like the original group's id: z.uuid() refuses it, Postgres takes it.
  const groupId = `00000000-0000-0000-0000-${randomBytes(6).toString('hex')}`;
  const now = new Date();
  const window = closedWindow('last-week', now, TZ);
  const weekStart = weekStartDay(window, TZ);
  const playerIds: string[] = [];
  const puuids: string[] = [];

  function deps(at: () => Date = () => new Date(), text = WEEK_TEXT) {
    const transport = mockTransport(() => fakeReply(text, { inputTokens: 2_500, outputTokens: 80 }));
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
      now: at,
      sleep: async () => {},
      log: () => {},
    };
    return { transport, generateDeps };
  }

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

  async function line(kind: 'week' | 'player') {
    const { data, error } = await db
      .from('ai_lines')
      .select('*')
      .eq('group_id', groupId)
      .eq('kind', kind);
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    const group = await db
      .from('groups')
      .insert({ id: groupId, slug: `it-${runId}-legacy`, name: `it ${runId} legacy`, premium: true });
    if (group.error) throw new Error(`group: ${group.error.message}`);
    for (let index = 0; index < 3; index += 1) {
      const puuid = `it-${runId}-legacy-p${index}`;
      const { data, error } = await db
        .from('players')
        .insert({ puuid, display_name: `LegacyFriend${index}` })
        .select('id')
        .single();
      if (error) throw new Error(`player: ${error.message}`);
      playerIds.push(data.id);
      puuids.push(puuid);
    }
    const members = await db
      .from('group_memberships')
      .insert(playerIds.map((player_id) => ({ group_id: groupId, player_id })));
    if (members.error) throw new Error(`members: ${members.error.message}`);
  }, 60_000);

  afterAll(async () => {
    await db.from('ai_calls').delete().eq('group_id', groupId);
    await db.from('ai_lines').delete().eq('group_id', groupId);
    await deleteTestGroups(db, [groupId]);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  describe('AI lines for a group whose id is not an RFC uuid (customs, 2026-10-04)', () => {
    it('the Sunday hook writes, publishes and posts the week storyline', async () => {
      const { transport, generateDeps } = deps();
      const hook: StorylineHookDeps = {
        readGate: (id) => readAiGate(db, id),
        readPlayerIds: (list) => readPlayerIds(db, list),
        generate: (input) => generateWeekLine(generateDeps, input),
        discordLine: (input) => loadDiscordStoryline(db, input),
        schedule: () => {},
        budgetMs: 30_000,
      };
      const posted = await runStoryline(
        { groupId, window, timeZone: TZ, rows: rows(), games: 9, stats: null },
        hook,
      );
      expect(posted).toBe(
        "LegacyFriend0 finished first on the week's board with 5 wins from 6 games. LegacyFriend1 took 2nd place with 4 wins.",
      );
      expect(transport.requests).toHaveLength(1);
      const stored = await line('week');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ status: 'published', week_start: weekStart, attempts: 1 });
    });

    it("the daily retry finishes a week line production's Sunday call left pending (board only)", async () => {
      // A week before the one above, claimed from real facts and never finished: what the failed
      // hook left on the hosted customs group.
      const earlier = '2026-09-20';
      const list = buildWeekFacts(
        {
          weekStart: earlier,
          ratedGames: 9,
          board: playerIds.map((playerId, index) => ({ playerId, games: 6, wins: [5, 4, 1][index] as number })),
          climbs: [],
          streaks: [],
          awards: [],
        },
        new Set(),
      );
      if (list === null) throw new Error('no week facts');
      const claimed = await dbLineStore(db).claim({
        groupId,
        subject: { kind: 'week', weekStart: earlier },
        facts: list.facts,
        tokenMap: list.tokenMap,
        factHash: factHash(list),
        model: AI_FEATURES.week.model,
        promptVersion: PROMPT_VERSION,
      });
      expect(claimed.claimed).toBe(true);
      const later = deps(() => new Date(Date.now() + PENDING_STALE_MS + 1_000));
      const outcome = await retryStoredLine(later.generateDeps, {
        groupId,
        subject: { kind: 'week', weekStart: earlier },
      });
      expect(outcome.status).toBe('published');
      expect(later.transport.requests).toHaveLength(1);
    });

    it('a scouting report left pending by a dead generation is taken over once stale', async () => {
      const playerId = playerIds[0] as string;
      const player = {
        playerId,
        weekStart,
        ratedGames: 20,
        wins: 12,
        weekGames: 6,
        weekWins: 4,
        champions: [],
        roles: [],
      };
      // What production was left with: a claimed row, never finished.
      const claimed = await dbLineStore(db).claim({
        groupId,
        subject: { kind: 'player', playerId, weekStart },
        facts: [],
        tokenMap: { P1: playerId },
        factHash: 'a'.repeat(64),
        model: 'test-model',
        promptVersion: 'test',
      });
      expect(claimed.claimed).toBe(true);

      // Inside the stale window the row is a live generation's: left alone.
      const early = deps(() => new Date(), '{P1} has 12 wins from 20 rated games in the group.');
      expect(await generatePlayerLine(early.generateDeps, { groupId, player })).toMatchObject({
        status: 'cached',
      });
      expect(early.transport.requests).toHaveLength(0);

      // Past it, the next cron's generation takes it over and finishes it.
      const later = deps(
        () => new Date(Date.now() + PENDING_STALE_MS + 1_000),
        '{P1} has 12 wins from 20 rated games in the group.',
      );
      const outcome = await generatePlayerLine(later.generateDeps, { groupId, player });
      expect(outcome.status === 'published' || outcome.status === 'rejected').toBe(true);
      expect(later.transport.requests.length).toBeGreaterThan(0);
      const stored = await line('player');
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).not.toBe('pending');
    });
  });
}
