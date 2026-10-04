import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eogPayload, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The one-person read (`loadPersonGames` in `load.ts`) against real PostgREST, with the anon key:
 * the `players_public!inner` embed filters the person's rows by puuid, `games!inner` carries the
 * window, and the answer equals the group read's. Twelve people, four games, rosters rotating so
 * each person misses some. Skipped when the stack is not running.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the one-person read against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

  const { ingestEogGame } = await import('../ingest/game');
  const { loadPlayerStats, loadWindowGames } = await import('./load');
  const { playerStatsView } = await import('./player');
  const { youVsEveryone } = await import('../versus/you');

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const db = createClient<Database>(stack.url, stack.serviceRoleKey, options);
  const anon = createClient<Database>(stack.url, stack.anonKey, options);

  const runId = randomUUID().slice(0, 8);
  const people = testPuuids(runId, 12);
  const base = testGameId();
  let groupId = '';

  beforeAll(async () => {
    groupId = (await createTestGroups(db, runId, ['person'] as const)).person;
    for (let g = 0; g < 4; g += 1) {
      const puuids = Array.from({ length: 10 }, (_, seat) => people[(g * 3 + seat) % 12] as string);
      const payload = eogPayload({
        gameId: base + g,
        puuids,
        startedAt: new Date(Date.UTC(2026, 8, 10 + g, 20)).toISOString(),
        winningSide: g % 2 === 0 ? 100 : 200,
        raw: { gameMode: g === 3 ? 'ARAM' : 'CLASSIC' },
      });
      await ingestEogGame(db, payload, { groupId });
    }
  });

  afterAll(async () => {
    await deleteTestGroups(db, [groupId]);
    await db.from('players').delete().in('puuid', people);
  });

  it('gives the player page the group read’s answer for every person', async () => {
    const window = { window: 'all-time' as const, groupId, timeZone: 'Europe/London' };
    const read = await loadWindowGames(anon, window);
    expect(read.games).toHaveLength(4);
    for (const puuid of people) {
      const expected = playerStatsView({
        ...read,
        ...window,
        puuid,
        range: { start: null, end: null },
        capped: false,
        cap: 2_000,
      });
      expect(await loadPlayerStats(anon, puuid, window)).toEqual(expected);
    }
  });

  it('gives You vs them only the viewer’s games, with the group read’s answer', async () => {
    const window = { window: 'all-time' as const, groupId, timeZone: 'Europe/London' };
    const read = await loadWindowGames(anon, window, { withGameMode: true });
    for (const puuid of [people[1] as string, people[5] as string]) {
      const mine = await loadWindowGames(anon, window, { withGameMode: true, onlyPuuid: puuid });
      expect(mine.games.length).toBeLessThan(read.games.length);
      expect(mine.games.every((game) => game.rows.some((row) => row.puuid === puuid))).toBe(true);
      expect(youVsEveryone(mine.games, mine.players, puuid)).toEqual(
        youVsEveryone(read.games, read.players, puuid),
      );
    }
  });

  it('is empty for a puuid nobody has', async () => {
    const view = await loadPlayerStats(anon, `it-${runId}-nobody`, { window: 'all-time', groupId });
    expect(view.games).toBe(0);
  });
}
