import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The daily guess, per group (M13.4, acceptance 5): two groups get two challenges on the same day,
 * each numbering from its own `#1`, each drawn only from its own games and its own people; a group
 * with no games gets none that day.
 *
 * Three throwaway groups and days in 2032, so nothing here can meet a challenge a person played
 * or another file's walk (`challenge.integration.test.ts` walks 2031).
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the daily guess per group against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

  const { ensureTodayMystery } = await import('@/lib/mystery/ensure');
  const { kindForDay } = await import('@/lib/mystery/select');
  const { loadMysteryPage } = await import('@/lib/mystery/service');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const ZONE = 'UTC';
  const runId = randomUUID().slice(0, 8);
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  const GAMES_PER_GROUP = 10;
  const groups = { a: '', b: '', c: '' };
  const people = {
    a: Array.from({ length: 10 }, (_, i) => `it-${runId}-mga-${i}`),
    b: Array.from({ length: 10 }, (_, i) => `it-${runId}-mgb-${i}`),
  };
  const playerIds = new Map<string, string>();
  const gameIdsOf = { a: [] as string[], b: [] as string[] };

  /** Two days in 2032 that are the same game, so the second is that kind's `#2` in a group. */
  const days = (() => {
    const all = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.UTC(2032, 4, 1) + i * 86_400_000).toISOString().slice(0, 10),
    );
    const first = all[0] as string;
    const second = all.slice(1).find((day) => kindForDay(day) === kindForDay(first)) as string;
    return { first, second };
  })();

  function noonOf(dayKey: string): Date {
    return new Date(`${dayKey}T12:00:00.000Z`);
  }

  async function seedGroup(key: 'a' | 'b'): Promise<void> {
    const stamp = Date.now() % 100_000;
    for (let index = 0; index < GAMES_PER_GROUP; index += 1) {
      const { data: row, error } = await db
        .from('games')
        .insert({
          group_id: groups[key],
          lcu_game_id: Number(`8${key === 'a' ? 1 : 2}${stamp}${String(index).padStart(2, '0')}`),
          started_at: new Date(Date.UTC(2032, 3, 1) + index * 3_600_000).toISOString(),
          duration_s: 1_900 + index,
          winning_side: index % 2 === 0 ? 100 : 200,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      if (error) throw new Error(`seeding ${key}: ${error.message}`);
      gameIdsOf[key].push(row.id);
      const hero = index % 10;
      const { error: seatError } = await db.from('game_players').insert(
        people[key].map((puuid, seat) => ({
          group_id: groups[key],
          game_id: row.id,
          player_id: playerIds.get(puuid) as string,
          side: seat < 5 ? 100 : 200,
          role: ROLES[seat % 5] ?? 'mid',
          champion_id: 100 + seat + index,
          kills: seat === hero ? 18 : 3 + ((seat + index) % 5),
          deaths: seat === hero ? 1 : 6,
          assists: 5 + ((seat + index) % 7),
          gold: 11_000 + seat * 200 + (seat === hero ? 9_000 : 0),
          damage_to_champs: 17_000 + seat * 400 + (seat === hero ? 40_000 : 0),
          cs: 140 + seat * 4 + (seat === hero ? 90 : 0),
          vision_score: 16 + seat + (seat === hero ? 20 : 0),
          damage_self_mitigated: 18_000 + seat * 500,
          damage_to_objectives: 3_000 + seat * 250,
          mu_before: 25,
          sigma_before: 8.333,
          mu_after: 25,
          sigma_after: 8.333,
        })),
      );
      if (seatError) throw new Error(`seeding ${key} seats: ${seatError.message}`);
    }
  }

  beforeAll(async () => {
    Object.assign(
      groups,
      await createTestGroups(db, runId, ['ma', 'mb', 'mc'] as const).then((made) => ({
        a: made.ma,
        b: made.mb,
        c: made.mc,
      })),
    );

    const { data: players, error } = await db
      .from('players')
      .insert([...people.a, ...people.b].map((puuid, i) => ({ puuid, display_name: `Seat ${i}` })))
      .select('id, puuid');
    if (error) throw new Error(error.message);
    for (const row of players ?? []) playerIds.set(row.puuid, row.id);

    await seedGroup('a');
    await seedGroup('b');
  });

  afterAll(async () => {
    // The groups' challenges go before their games (`on delete restrict`), inside the helper.
    await deleteTestGroups(db, Object.values(groups));
    await db
      .from('players')
      .delete()
      .in('puuid', [...people.a, ...people.b]);
  });

  describe('two groups on the same day', () => {
    it('get two challenges, each numbered from its own #1, each drawn from its own games and people', async () => {
      const a = await ensureTodayMystery(db, noonOf(days.first), ZONE, groups.a);
      const b = await ensureTodayMystery(db, noonOf(days.first), ZONE, groups.b);
      if (a === null || b === null) throw new Error('both groups have enough games for a challenge');

      expect(a.id).not.toBe(b.id);
      expect([a.group_id, b.group_id]).toEqual([groups.a, groups.b]);
      expect([a.day, b.day]).toEqual([days.first, days.first]);
      expect([a.challenge_number, b.challenge_number]).toEqual([1, 1]);

      const aPeople = new Set(people.a.map((puuid) => playerIds.get(puuid)));
      const bPeople = new Set(people.b.map((puuid) => playerIds.get(puuid)));
      expect(gameIdsOf.a).toContain(a.game_id);
      expect(gameIdsOf.b).toContain(b.game_id);
      expect(aPeople.has(a.mystery_player_id)).toBe(true);
      expect(bPeople.has(b.mystery_player_id)).toBe(true);
      expect(a.suspect_ids.every((id) => aPeople.has(id))).toBe(true);
      expect(b.suspect_ids.every((id) => bPeople.has(id))).toBe(true);
    });

    it('is a no-op on a second call for the same group and day', async () => {
      const again = await ensureTodayMystery(db, noonOf(days.first), ZONE, groups.a);
      const { count } = await db
        .from('daily_mysteries')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groups.a);
      expect(count).toBe(1);
      expect(again?.challenge_number).toBe(1);
    });

    it("numbers a group's next challenge of that kind #2 without moving the other group's count", async () => {
      const a2 = await ensureTodayMystery(db, noonOf(days.second), ZONE, groups.a);
      expect(a2?.challenge_number).toBe(2);
      // B never played the second day: its own next number for the kind is still 2, not 3.
      const b2 = await ensureTodayMystery(db, noonOf(days.second), ZONE, groups.b);
      expect(b2?.challenge_number).toBe(2);
    });

    it('gives a group with no games no challenge that day, and the empty card', async () => {
      expect(await ensureTodayMystery(db, noonOf(days.first), ZONE, groups.c)).toBeNull();
      const page = await loadMysteryPage(db, {
        now: noonOf(days.first),
        timeZone: ZONE,
        visitorId: null,
        groupId: groups.c,
      });
      expect(page.kind).toBe('empty');
      const { count } = await db
        .from('daily_mysteries')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groups.c);
      expect(count).toBe(0);
    });

    it("serves each group's page its own challenge", async () => {
      const [pageA, pageB] = await Promise.all([
        loadMysteryPage(db, { now: noonOf(days.first), timeZone: ZONE, visitorId: null, groupId: groups.a }),
        loadMysteryPage(db, { now: noonOf(days.first), timeZone: ZONE, visitorId: null, groupId: groups.b }),
      ]);
      if (pageA.kind !== 'play' || pageB.kind !== 'play') throw new Error('expected two playable cards');
      expect(pageA.play.challengeId).not.toBe(pageB.play.challengeId);
    });
  });
}
