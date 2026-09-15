import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { AWARD_CATEGORIES, MYSTERY_CATEGORIES } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The two daily games against real rows (M5.32, M8.4): one challenge per civil day, the kind
 * **stored** rather than re-read off the date, each game counting its own cases, and one
 * locked guess per anonymous visitor whichever game the day is.
 *
 * The rotation's arithmetic and the fallback are pinned without a database in `build.test.ts`.
 * What only a database can answer is here: that `kind` really lands in the column, that the
 * `(kind, challenge_number)` unique makes `Daily Mystery #N` stop skipping, and that fourteen
 * consecutive `ensureTodayMystery` calls write fourteen rows and not fifteen.
 *
 * The walk runs in 2031 so the days are this test's own and cannot collide with a challenge
 * a person actually played, and its games are stamped there too so they sort to the top of
 * the candidate window.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the daily games against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

  const { ensureTodayMystery } = await import('@/lib/mystery/ensure');
  const { kindForDay } = await import('@/lib/mystery/select');
  const { loadMysteryPage, submitGuess } = await import('@/lib/mystery/service');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const ZONE = 'UTC';
  const runId = randomUUID().slice(0, 8);
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  /** Twenty customs, so fourteen days of "not that game again" never empties the pool. */
  const GAMES = 20;
  const DAYS = 14;

  const puuids = Array.from({ length: 10 }, (_, i) => `it-${runId}-m84-${i}`);
  const playerIds = new Map<string, string>();
  const gameIds: string[] = [];
  let seasonId = '';
  const dayKeys = Array.from({ length: DAYS }, (_, i) =>
    new Date(Date.UTC(2031, 2, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );

  function noonOf(dayKey: string): Date {
    return new Date(`${dayKey}T12:00:00.000Z`);
  }

  interface Stored {
    day: string;
    kind: string;
    challenge_number: number;
    category: string;
    mystery_player_id: string;
  }

  async function storedDays(): Promise<Stored[]> {
    const { data, error } = await db
      .from('daily_mysteries')
      .select('day, kind, challenge_number, category, mystery_player_id')
      .in('day', dayKeys)
      .order('day', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Stored[];
  }

  beforeAll(async () => {
    /**
     * A container of this run's own, never the active one. The daily games read every game
     * whatever season it is in, but a rebuild reads one season — so twenty invented customs
     * in the active container would land in `rebuild.integration.test.ts`'s fold, which runs
     * beside this file.
     */
    const { data: container, error: seasonError } = await db
      .from('seasons')
      .insert({ name: `daily games ${runId}`, is_active: false })
      .select('id')
      .single();
    expect(seasonError).toBeNull();
    seasonId = container?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(puuids.map((puuid, i) => ({ puuid, display_name: `Seat ${i}` })))
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) playerIds.set(row.puuid, row.id);

    const stamp = Date.now() % 1_000_000;
    for (let index = 0; index < GAMES; index += 1) {
      const { data: row, error: gameError } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`9${stamp}${String(index).padStart(2, '0')}`),
          season_id: seasonId,
          // Inside the walk's own window, newest first.
          started_at: new Date(Date.UTC(2031, 1, 1) + index * 3_600_000).toISOString(),
          duration_s: 1_900 + index,
          winning_side: index % 2 === 0 ? 100 : 200,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      expect(gameError).toBeNull();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      // A full seven-component scoreboard with a role each: what M7.7 and M7.14 made
      // possible and what Guess the Award needs. A different seat runs away with it each
      // game, so the day's answer is not the same person twenty times.
      const hero = index % 10;
      await db.from('game_players').insert(
        puuids.map((puuid, seat) => ({
          game_id: gameId,
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
    }
  });

  afterAll(async () => {
    // The challenges first: `daily_mysteries.game_id` is `on delete restrict`.
    await db.from('daily_mysteries').delete().in('day', dayKeys);
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    const ids = [...playerIds.values()];
    if (ids.length > 0) await db.from('players').delete().in('id', ids);
    if (seasonId !== '') await db.from('seasons').delete().eq('id', seasonId);
  });

  describe('fourteen consecutive civil days', () => {
    beforeAll(async () => {
      for (const day of dayKeys) {
        await ensureTodayMystery(db, noonOf(day), ZONE);
        // A second call on the same day is a no-op, not a second challenge.
        await ensureTodayMystery(db, noonOf(day), ZONE);
      }
    });

    it('writes one challenge a day, never two', async () => {
      const rows = await storedDays();
      expect(rows).toHaveLength(DAYS);
      expect(rows.map((row) => row.day)).toEqual(dayKeys);
    });

    it('stores the kind, and it is the one the date’s parity asked for', async () => {
      const rows = await storedDays();
      for (const row of rows) {
        expect(row.kind, `${row.day} is ${row.kind}`).toBe(kindForDay(row.day));
      }
      // Both games really did happen over the fortnight.
      expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(['mystery', 'award']));
    });

    it('gives each kind its own categories, which the per-kind check constraint enforces', async () => {
      for (const row of await storedDays()) {
        const allowed: readonly string[] = row.kind === 'award' ? AWARD_CATEGORIES : MYSTERY_CATEGORIES;
        expect(allowed, `${row.day} (${row.kind}) stored ${row.category}`).toContain(row.category);
      }
    });

    it('does not skip a number in either game when the other one has a day', async () => {
      const rows = await storedDays();
      for (const kind of ['mystery', 'award'] as const) {
        const numbers = rows
          .filter((row) => row.kind === kind)
          .map((row) => row.challenge_number)
          .sort((a, b) => a - b);
        expect(numbers.length, `${kind} had days`).toBeGreaterThan(0);
        for (const [index, number] of numbers.entries()) {
          expect(number, `${kind} #${number} follows #${numbers[0]}`).toBe((numbers[0] as number) + index);
        }
      }
    });

    it('never asks the same answer two days running, across the two games', async () => {
      const rows = await storedDays();
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i]?.mystery_player_id, `${rows[i]?.day} repeats ${rows[i - 1]?.day}`).not.toBe(
          rows[i - 1]?.mystery_player_id,
        );
      }
    });
  });

  describe('a visitor, on an award day', () => {
    const day = dayKeys.find((key) => kindForDay(key) === 'award') as string;
    const visitor = `visitor-${runId}-a`;
    const other = `visitor-${runId}-b`;

    it('gets the same challenge as everybody else, with no answer in it', async () => {
      const mine = await loadMysteryPage(db, { now: noonOf(day), timeZone: ZONE, visitorId: visitor });
      const theirs = await loadMysteryPage(db, { now: noonOf(day), timeZone: ZONE, visitorId: other });
      expect(mine.kind).toBe('play');
      expect(theirs.kind).toBe('play');
      if (mine.kind !== 'play' || theirs.kind !== 'play') return;
      expect(mine.play.challengeId).toBe(theirs.play.challengeId);
      expect(mine.play.kind).toBe('award');
      expect(mine.play.revealedClues).toEqual([]);
      expect(JSON.stringify(mine.play)).not.toContain('mysteryPlayerId');

      const { data: row } = await db
        .from('daily_mysteries')
        .select('mystery_player_id')
        .eq('id', mine.play.challengeId)
        .single();
      // The suspects carry the answer among them, and nothing else on the card does.
      const { suspects: _suspects, ...card } = mine.play;
      expect(JSON.stringify(card)).not.toContain(row?.mystery_player_id ?? 'nothing');
    });

    it('locks one guess and writes one row, on the second post as on the first', async () => {
      const page = await loadMysteryPage(db, { now: noonOf(day), timeZone: ZONE, visitorId: visitor });
      if (page.kind !== 'play') throw new Error('expected a playable card');
      const challengeId = page.play.challengeId;
      const guess = page.play.suspects[0]?.playerId as string;

      // A second later: the session's own rate limit refuses two writes in the same instant,
      // which a fixed clock is exactly the shape of.
      const later = (seconds: number): Date => new Date(noonOf(day).getTime() + seconds * 1_000);
      const first = await submitGuess(db, {
        challengeId,
        visitorId: visitor,
        playerId: guess,
        now: later(5),
        timeZone: ZONE,
      });
      expect('result' in first).toBe(true);

      const second = await submitGuess(db, {
        challengeId,
        visitorId: visitor,
        // Even a different name: the visitor's one guess is already locked.
        playerId: page.play.suspects[1]?.playerId as string,
        now: later(10),
        timeZone: ZONE,
      });
      expect('result' in second).toBe(true);
      if ('result' in first && 'result' in second) {
        expect(second.result.personal.guessedPlayerId).toBe(first.result.personal.guessedPlayerId);
        expect(second.result.kind).toBe('award');
      }

      const { count } = await db
        .from('daily_mystery_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_id', challengeId)
        .eq('visitor_id', visitor);
      expect(count).toBe(1);
    });
  });
}
