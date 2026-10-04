import { randomUUID } from 'node:crypto';
import { config, displayRating, provisionalSeed, rateGame, winProbability } from '@customs/core';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, ROLES_IN_ORDER, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The rating rebuild (M5.2) against the Supabase CLI local stack, seeded through the same
 * ingest path the companion uses — because the claim being tested is that the rebuild
 * reproduces the *live* fold, and a hand-inserted row would not be that fold.
 *
 * The file runs in a **group of its own** (M14.14: a rebuild is a
 * group-wide operation), created at the top and deleted at the bottom: a rebuild cannot be
 * namespaced by row the way every other integration test here is. The original group's ratings
 * are snapshotted and asserted untouched.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('rebuild-ratings against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  // The two public surfaces M7.9 has to reach without being touched (`/leaderboard`'s expand
  // and `/p/[puuid]`'s recent games) read with the anon key, exactly as a phone does.
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { FENCE_MESSAGE, formatRebuildReport, GUARD_MESSAGE, rebuildRatings } = await import('./rebuild');
  // The one place in the app that names an MVP (M7.9), imported here so the test asks the
  // fold's own question rather than reimplementing the score.
  const { gameAward } = await import('./fold');
  const { loadPlayerBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const ownerPuuid = puuids[0] as string;

  const base = testGameId();
  const liveGameIds = [base + 1, base + 2, base + 3];
  const oldBackfillGameId = base + 4;
  const shortGameId = base + 5;
  const shortHandedGameId = base + 6;
  const fenceGameId = base + 7;
  // Two games to the same millisecond, which backfill produces the first time two customs
  // started inside the same second of `gameCreation`.
  const tiedHighGameId = base + 9;
  const tiedLowGameId = base + 8;
  /** One more game, after a rank has moved, for M5.7's "nothing ever rewrites a seed". */
  const afterTheClimbGameId = base + 10;
  /** A night on the Howling Abyss, which the fold walks past (M7.1). */
  const aramGameId = base + 11;
  /** A game whose stat columns are all there, so it has an MVP and an ACE (M7.9). */
  const bonusGameId = base + 12;
  /** The same night with the three nullable columns empty: no MVP, the plain fold. */
  const plainGameId = base + 13;
  const allGameIds = [
    ...liveGameIds,
    oldBackfillGameId,
    shortGameId,
    shortHandedGameId,
    fenceGameId,
    tiedLowGameId,
    tiedHighGameId,
    afterTheClimbGameId,
    aramGameId,
    bonusGameId,
    plainGameId,
  ];

  let token = '';
  /** This file's own group: every game it posts lands here, and every rebuild folds only this. */
  let groupId = '';
  let playerIds: string[] = [];
  let originalGroupRatings = '';

  /**
   * Every rating column and the fold breakdown (M14.58, `0034`), nulled together: the shape a
   * row has before any fold rated it. `0034`'s check refuses a breakdown on a row with no
   * `mu_after`, so wiping the four rating columns alone is not a state the table allows.
   */
  const WIPED = {
    mu_before: null,
    sigma_before: null,
    mu_after: null,
    sigma_after: null,
    fold_p: null,
    base_mu_after: null,
    award: null,
    rated_games_before: null,
    // 0036 (M18.5): an un-rate nulls both Kustom tracks too.
    r_before: null,
    r_after: null,
    k: null,
    share_rank: null,
    week_r_before: null,
    week_r_after: null,
    week_k: null,
    week_fold_p: null,
    week_games_before: null,
  };

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  /**
   * A canonical dump of everything the rebuild is allowed to write: every rating column of
   * every `game_players` row of this group's games, and every `ratings` row. Ordered and
   * serialised, so "byte-identical" is one `expect`.
   */
  async function dump(): Promise<string> {
    const { data: rows, error } = await db
      .from('game_players')
      // The fold breakdown (M14.58, `0034`) is part of what the rebuild writes, so it is part of
      // "two runs are byte-identical" too.
      .select(
        'game_id, player_id, mu_before, sigma_before, mu_after, sigma_after, fold_p, base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank, week_r_before, week_r_after, week_k, week_fold_p, week_games_before',
      )
      .eq('group_id', groupId)
      .order('game_id')
      .order('player_id');
    if (error) throw new Error(error.message);

    const { data: ratings, error: ratingsError } = await db
      .from('ratings')
      // The four seed columns are in the dump because they are part of what the rebuild
      // writes (M5.7): "two runs are byte-identical" has to include the seed, or the second
      // run could quietly move where somebody's history starts.
      .select('player_id, mu, sigma, r, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('group_id', groupId)
      .order('player_id');
    if (ratingsError) throw new Error(ratingsError.message);

    return JSON.stringify({ rows, ratings });
  }

  /**
   * A dump with every number rounded to `RATING_EPSILON`'s nine decimals.
   *
   * **For the wipe-and-refold cases only**, and not for the idempotency ones. Those compare two
   * runs of the same chain and are exact. These compare two *different* chains: the live fold
   * folds each game from ratings it read back out of Postgres — which prints a `double
   * precision` to fifteen significant digits and so hands back that double **rounded** — while
   * a from-scratch rebuild folds the whole group in memory. `rebuild.ts`'s `RATING_EPSILON`
   * says exactly this, and acts on it: rows inside the tolerance are deliberately left alone,
   * which is why a dump taken after a rebuild still holds the live fold's last digit. The two
   * chains agreeing to fifteen printed digits was luck, not a promise; nine decimals of `mu` is
   * six ten-millionths of a display point and is the promise the command actually makes.
   */
  function within(dumped: string): string {
    return JSON.stringify(
      JSON.parse(dumped, (_key, value) => (typeof value === 'number' ? Number(value.toFixed(9)) : value)),
    );
  }

  async function dumpOriginalGroup(): Promise<string> {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games, wins, updated_at')
      .eq('group_id', ORIGINAL_GROUP_ID)
      .order('player_id');
    if (error) throw new Error(error.message);
    return JSON.stringify(data);
  }

  async function ratingColumns(
    lcuGameId: number,
  ): Promise<{ player_id: string; mu_before: number | null; mu_after: number | null }[]> {
    const { data: game } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
    const { data, error } = await db
      .from('game_players')
      .select('player_id, mu_before, mu_after')
      .eq('game_id', game?.id ?? '')
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  function rebuild(options: Partial<Parameters<typeof rebuildRatings>[1]> = {}) {
    return rebuildRatings(db, { groupId, force: true, ...options });
  }

  /** The four seed columns of this group's `ratings` rows, ordered (M5.7). */
  async function seedRows() {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('group_id', groupId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** The rank `beforeAll` gave a player, which for this file never moves unless a case moves it. */
  function rankOf(playerId: string): { tier: string | null; division: string | null } {
    const index = playerIds.indexOf(playerId);
    if (index < 3) return { tier: 'GOLD', division: 'II' };
    if (index < 5) return { tier: 'DIAMOND', division: 'IV' };
    return { tier: null, division: null };
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    playerIds = puuids.map((puuid) => ids.get(puuid) ?? '');

    // Different seeds, so the order of the fold changes the answer and the tests below are
    // measuring something. Ranks stay still for the whole file — the M5.7 caveat is that a rank
    // that moves between a game and a rebuild moves history, and this file controls for it.
    await db
      .from('players')
      .update({ rank_tier: 'GOLD', rank_division: 'II' })
      .in('id', playerIds.slice(0, 3));
    await db
      .from('players')
      .update({ rank_tier: 'DIAMOND', rank_division: 'IV' })
      .in('id', playerIds.slice(3, 5));

    groupId = (await createTestGroups(db, runId, ['rebuild'] as const)).rebuild;
    await setTestMembership(db, groupId, ids.get(ownerPuuid) ?? '', 'member');

    const { token: raw, tokenHash } = mintCompanionToken();
    await db.from('companion_tokens').insert({
      group_id: groupId,
      player_id: ids.get(ownerPuuid) ?? '',
      token_hash: tokenHash,
      label: `it-${runId}-rebuild`,
    });
    token = raw;

    originalGroupRatings = await dumpOriginalGroup();
  });

  /**
   * **The stack is handed back the way it was found, including when a case above failed**
   * (M3.29). Every step runs even if an earlier one throws: this run's games by id (a case that
   * fails before its own cleanup can leave one), then everything the test group owns, then the
   * players.
   */
  afterAll(async () => {
    const problems: string[] = [];
    // `PromiseLike`, because a PostgREST builder is a thenable and not a `Promise`.
    const attempt = async (what: string, step: () => PromiseLike<unknown>) => {
      try {
        const result = (await step()) as { error?: { message?: string } | null } | null;
        if (result?.error) problems.push(`${what}: ${result.error.message ?? 'failed'}`);
      } catch (thrown) {
        problems.push(`${what}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    };

    await attempt('deleting this run’s games', () => db.from('games').delete().in('lcu_game_id', allGameIds));
    await attempt('deleting the test group', () => deleteTestGroups(db, [groupId]));
    await attempt('deleting this run’s players', () => db.from('players').delete().in('puuid', puuids));
    if (problems.length > 0) throw new Error(`rebuild cleanup: ${problems.join('; ')}`);
  });

  describe('the rebuild reproduces the incremental fold', () => {
    it('changes nothing after three games rated inline through the game route', async () => {
      for (const [index, gameId] of liveGameIds.entries()) {
        const response = await postGame(
          post(
            eogBody({
              gameId,
              puuids,
              partyId: null,
              winningSide: index % 2 === 0 ? 100 : 200,
              startedAt: `2026-09-0${index + 2}T20:00:00.000Z`,
              durationS: 1_500 + index,
              // Every one of these three has an MVP and an ACE (M7.9), so every case in this
              // file — the reorder, the tie-break, the wipe-and-refold — is measuring a fold
              // that applied the bonus, not one that never met it.
              performanceStats: true,
            }),
          ),
        );
        expect(response.status).toBe(200);
        expect((await response.json()).rated).toBe(true);
      }

      /**
       * **The first fold that rated each of them wrote their seed** (M5.7). None of these ten
       * had a `ratings` row before the three games above; the live fold created it, and the
       * `{ mu, sigma }` it folded from is stored on it beside the rating it grew into, with the
       * two rank strings that were on their `players` row at the time.
       *
       * **The pair is `provisionalSeed()` for all ten** (2026-09-16), whatever rank each of them
       * wears: ten different ranks, one starting number, and a `sigma` of 12 that belongs to "we
       * have never seen you play a custom" rather than to any tier. The rank strings are still
       * stored, and still say what the client reported that night, but nothing computes a number
       * from them.
       */
      const seeded = await seedRows();
      expect(seeded).toHaveLength(10);
      const first = provisionalSeed();
      expect(first).toEqual({ mu: 20, sigma: 12 });
      for (const row of seeded) {
        const rank = rankOf(row.player_id);
        expect([row.player_id, row.seed_mu, row.seed_sigma]).toEqual([row.player_id, first.mu, first.sigma]);
        expect([row.seed_rank_tier, row.seed_rank_division]).toEqual([rank.tier, rank.division]);
      }

      const before = await dump();
      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.considered).toBe(3);
      expect(result.report.rated).toBe(3);
      // The whole claim: the live fold already wrote exactly what the rebuild computes.
      expect(result.report.gamePlayerRowsChanged).toBe(0);
      expect(result.report.ratingRowsChanged).toBe(0);
      expect(await dump()).toBe(before);
    });

    it('is idempotent: two runs are byte-identical', async () => {
      const first = await rebuild();
      expect(first.ok).toBe(true);
      const afterFirst = await dump();

      const second = await rebuild();
      expect(second.ok).toBe(true);
      expect(await dump()).toBe(afterFirst);
    });

    it('writes nothing on --dry-run, and still says what would change', async () => {
      const before = await dump();
      // Something to change: a row with numbers the fold does not agree with.
      const { data: game } = await db
        .from('games')
        .select('id')
        .eq('lcu_game_id', liveGameIds[0] as number)
        .single();
      await db
        .from('game_players')
        .update({ mu_after: 99 })
        .eq('game_id', game?.id ?? '')
        .eq('player_id', playerIds[0] as string);
      const dirtied = await dump();

      const result = await rebuild({ dryRun: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(1);
      expect(await dump()).toBe(dirtied);

      // And a real run puts it back exactly as the fold says it should be.
      expect((await rebuild()).ok).toBe(true);
      expect(await dump()).toBe(before);
    });
  });

  describe('a backfilled game older than everything else', () => {
    it('folds first, and shifts every later game', async () => {
      const beforeColumns = await ratingColumns(liveGameIds[2] as number);

      const body = eogBody({
        gameId: oldBackfillGameId,
        puuids,
        partyId: null,
        winningSide: 200,
        // Before all three live games: this is exactly what a backfill batch does.
        startedAt: '2026-08-01T19:00:00.000Z',
        durationS: 1_800,
      }) as Record<string, unknown>;
      const { partyId: _dropped, ...rest } = body;
      const response = await postGame(
        post({
          ...rest,
          source: 'backfill',
          participants: (body.participants as Record<string, unknown>[]).map((p) => ({ ...p, role: null })),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, rated: false, reason: 'backfill' });

      // Stored unrated, as M5.1 promises.
      for (const row of await ratingColumns(oldBackfillGameId)) {
        expect(row.mu_before).toBeNull();
        expect(row.mu_after).toBeNull();
      }

      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.considered).toBe(4);
      expect(result.report.rated).toBe(4);
      expect(result.report.gamePlayerRowsChanged).toBeGreaterThan(0);
      // Everybody here already had a rating, so this is a real move and not a first one.
      expect(result.report.firstRatings).toBe(0);
      expect(result.report.largestMuChange).not.toBeNull();

      // The old game is now rated...
      for (const row of await ratingColumns(oldBackfillGameId)) {
        expect(row.mu_before).not.toBeNull();
        expect(row.mu_after).not.toBeNull();
      }
      // ...and it moved the games that came after it: the last game's before-values shifted.
      const afterColumns = await ratingColumns(liveGameIds[2] as number);
      expect(afterColumns).not.toEqual(beforeColumns);
      expect(afterColumns.map((row) => row.player_id)).toEqual(beforeColumns.map((row) => row.player_id));

      // Still idempotent with it in.
      const dumped = await dump();
      expect((await rebuild()).ok).toBe(true);
      expect(await dump()).toBe(dumped);
    });

    it('produces the same numbers as if the four games had arrived in order', async () => {
      // The proof that arrival order does not matter: wipe every rating column and rating row
      // for the group and fold from scratch. Same answer.
      const ordered = await dump();

      const { data: games } = await db.from('games').select('id').eq('group_id', groupId);
      for (const game of games ?? []) {
        await db.from('game_players').update(WIPED).eq('game_id', game.id);
      }
      await db.from('ratings').delete().eq('group_id', groupId);

      const result = await rebuild();
      expect(result.ok).toBe(true);
      expect(within(await dump())).toBe(within(ordered));
    });
  });

  describe('the gate', () => {
    it('skips a 300-second game and a short-handed one, and nulls their columns', async () => {
      // Exactly 300 seconds is not rated (M2.5), and nine players is not a game.
      const short = await postGame(
        post(
          eogBody({
            gameId: shortGameId,
            puuids,
            partyId: null,
            durationS: 300,
            startedAt: '2026-09-06T20:00:00.000Z',
          }),
        ),
      );
      expect(short.status).toBe(200);
      const shortHanded = await postGame(
        post(
          eogBody({
            gameId: shortHandedGameId,
            puuids: puuids.slice(0, 9),
            partyId: null,
            startedAt: '2026-09-07T20:00:00.000Z',
          }),
        ),
      );
      expect(shortHanded.status).toBe(200);

      // Stale numbers from some earlier life, which the rebuild must clear rather than keep.
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', shortGameId).single();
      await db
        .from('game_players')
        .update({ mu_before: 1, sigma_before: 1, mu_after: 2, sigma_after: 2 })
        .eq('game_id', game?.id ?? '');

      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.considered).toBe(6);
      expect(result.report.rated).toBe(4);
      expect(result.report.skipped.duration).toBe(1);
      expect(result.report.skipped['participant-count']).toBe(1);

      for (const row of await ratingColumns(shortGameId)) {
        expect(row.mu_before).toBeNull();
        expect(row.mu_after).toBeNull();
      }
      for (const row of await ratingColumns(shortHandedGameId)) {
        expect(row.mu_after).toBeNull();
      }
    });
  });

  describe('no lock', () => {
    it('refuses while a game has just landed, and runs with --force', async () => {
      // The games above were all posted seconds ago, which is exactly what the guard is for.
      const refused = await rebuildRatings(db, { groupId });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.code).toBe('guard');
      expect(refused.message).toContain(GUARD_MESSAGE);

      expect((await rebuild()).ok).toBe(true);
    });

    it('refuses while a lobby is live', async () => {
      const partyId = `it-party-${runId}-guard`;
      const { data: lobby } = await db
        .from('lobbies')
        .insert({ group_id: groupId, lcu_party_id: partyId, status: 'balanced' })
        .select('id')
        .single();

      const refused = await rebuildRatings(db, {
        groupId,
        now: new Date(Date.now() + 3_600_000),
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe('guard');
        expect(refused.message).toContain(GUARD_MESSAGE);
        expect(refused.message).toContain('balanced');
      }

      await db
        .from('lobbies')
        .delete()
        .eq('id', lobby?.id ?? '');
    });

    it('exits 2 when a game lands between the snapshot and the write, and is fine on the next run', async () => {
      const result = await rebuild({
        afterSnapshot: async () => {
          const { error } = await db.from('games').insert({
            group_id: groupId,
            lcu_game_id: fenceGameId,
            started_at: '2026-09-08T20:00:00.000Z',
            duration_s: 1_500,
            winning_side: 100,
            source: 'eog',
            raw: { gameId: fenceGameId },
          });
          if (error) throw new Error(error.message);
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('fence');
      expect(result.message).toContain(FENCE_MESSAGE);

      // Running it again is the fix, and it is free.
      const again = await rebuild();
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.report.considered).toBe(7);

      await db.from('games').delete().eq('lcu_game_id', fenceGameId);
    });
  });

  describe('the tie-break', () => {
    it('folds two games with the same started_at by lcu_game_id, whatever order they arrived in', async () => {
      const tiedAt = '2026-09-09T20:00:00.000Z';
      // The higher id is posted **first**, so arrival order and fold order disagree.
      for (const gameId of [tiedHighGameId, tiedLowGameId]) {
        const response = await postGame(
          post(eogBody({ gameId, puuids, partyId: null, startedAt: tiedAt, durationS: 1_700 })),
        );
        expect(response.status).toBe(200);
      }

      expect((await rebuild()).ok).toBe(true);

      const low = await ratingColumns(tiedLowGameId);
      const high = await ratingColumns(tiedHighGameId);
      // The lower id folded first: its after-values are the higher id's before-values, for all ten.
      expect(high.map((row) => row.mu_before)).toEqual(low.map((row) => row.mu_after));

      // And the answer does not depend on the order the rows come back in: wipe and refold.
      const ordered = await dump();
      const { data: games } = await db.from('games').select('id').eq('group_id', groupId);
      for (const game of games ?? []) {
        await db.from('game_players').update(WIPED).eq('game_id', game.id);
      }
      await db.from('ratings').delete().eq('group_id', groupId);
      expect((await rebuild()).ok).toBe(true);
      expect(within(await dump())).toBe(within(ordered));
    });
  });

  describe('a ratings row nobody played for', () => {
    it('is reported and left alone, and only --prune deletes it', async () => {
      // Somebody who has a rating in this group but no rated game in it: what a deleted game
      // leaves behind.
      const strayPuuid = `it-${runId}-stray`;
      const ids = await ensurePlayers(db, [{ puuid: strayPuuid }]);
      const strayId = ids.get(strayPuuid) as string;
      await db.from('ratings').insert({
        group_id: groupId,
        player_id: strayId,
        mu: 25,
        sigma: 8,
      });

      const reported = await rebuild();
      expect(reported.ok).toBe(true);
      if (!reported.ok) return;
      expect(reported.report.orphanRatings).toBe(1);
      expect(reported.report.prunedRatings).toBe(0);

      const { count: kept } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .eq('player_id', strayId);
      expect(kept).toBe(1);

      const pruned = await rebuild({ prune: true });
      expect(pruned.ok).toBe(true);
      if (!pruned.ok) return;
      expect(pruned.report.prunedRatings).toBe(1);

      const { count: gone } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .eq('player_id', strayId);
      expect(gone).toBe(0);

      await db.from('players').delete().eq('id', strayId);
    });
  });

  describe('inferred roles (M5.17)', () => {
    /** The pair the fold and the rebuild both have to agree on, by puuid. */
    async function roleRows() {
      const { data, error } = await db
        .from('players')
        .select('puuid, main_role, secondary_role, roles_counted, roles_inferred_at')
        .in('puuid', puuids)
        .order('puuid');
      if (error) throw new Error(error.message);
      return data ?? [];
    }

    it('reaches the pairs the live fold reached, rebuilds them from a wipe, and then moves nothing', async () => {
      // Every game in this file was posted with no party id, so nothing was ever a fill and
      // every rated game counts. The fixture gives each player the same position in all of
      // them, which is what makes the expected answer sayable in one line.
      const live = await roleRows();
      expect(live).toHaveLength(10);
      for (const row of live) {
        const index = puuids.indexOf(row.puuid);
        expect([row.puuid, row.main_role]).toEqual([row.puuid, ROLES_IN_ORDER[index % 5]]);
        expect(row.roles_inferred_at).not.toBeNull();
      }

      // 1. The rebuild reads the same games and reaches the same pairs, so this file's ten are
      //    untouched — the same claim the rating columns make two describes up.
      //
      //    `rolesChanged` is **not** asserted here: the recompute covers every player in the
      //    database (M5.17), and the local stack is shared with files that leave rows behind, so
      //    the first run of any given day may legitimately stamp somebody else's leftovers. What
      //    is asserted is this file's rows, and then that a second run moves nothing at all.
      const first = await rebuild();
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(await roleRows()).toEqual(live);

      // 2. Idempotent: with everybody stamped, a second run writes nothing anywhere, so
      //    `roles_inferred_at` does not creep forward.
      const second = await rebuild();
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.rolesChanged).toBe(0);
      expect(await roleRows()).toEqual(live);

      // 3. From scratch. Wiped pairs, and the rebuild puts them back out of the games alone —
      //    and moves exactly the ten rows that were wiped, because everybody else still agrees.
      await db
        .from('players')
        .update({ main_role: null, secondary_role: null, roles_counted: 0, roles_inferred_at: null })
        .in('id', playerIds);

      const third = await rebuild();
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(third.report.rolesChanged).toBe(10);

      const rebuilt = await roleRows();
      expect(rebuilt.map((row) => [row.puuid, row.main_role, row.secondary_role, row.roles_counted])).toEqual(
        live.map((row) => [row.puuid, row.main_role, row.secondary_role, row.roles_counted]),
      );

      const fourth = await rebuild();
      expect(fourth.ok).toBe(true);
      if (!fourth.ok) return;
      expect(fourth.report.rolesChanged).toBe(0);
      expect(await roleRows()).toEqual(rebuilt);
    });

    it('replaces a hand-set pair on somebody who has never played a game', async () => {
      // The M1-era row nothing else would ever visit: no game, no rating, two roles typed in by
      // an admin in another era. The first recompute after this task is what clears them.
      const idlePuuid = `it-${runId}-idle`;
      const ids = await ensurePlayers(db, [{ puuid: idlePuuid }]);
      const idleId = ids.get(idlePuuid) as string;
      await db
        .from('players')
        .update({ main_role: 'support', secondary_role: 'top', roles_counted: 0, roles_inferred_at: null })
        .eq('id', idleId);

      const result = await rebuild();
      expect(result.ok).toBe(true);

      const { data } = await db
        .from('players')
        .select('main_role, secondary_role, roles_counted, roles_inferred_at')
        .eq('id', idleId)
        .single();
      // Flexible, which is what the balancer already does with somebody it knows nothing about,
      // and stamped, so the next run leaves the row alone.
      expect(data).toMatchObject({ main_role: null, secondary_role: null, roles_counted: 0 });
      expect(data?.roles_inferred_at).not.toBeNull();

      const again = await rebuild();
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.report.rolesChanged).toBe(0);

      await db.from('players').delete().eq('id', idleId);
    });
  });

  describe('other groups', () => {
    it('leaves every other group alone', async () => {
      expect((await rebuild()).ok).toBe(true);
      expect(await dumpOriginalGroup()).toBe(originalGroupRatings);
    });
  });

  describe('the stored seed (M5.7)', () => {
    it('is what the rebuild folds from, even after the rank moves', async () => {
      // The acceptance check, in one case: a player whose `players.rank_tier` changes between
      // their first rated game and a rebuild has byte-identical `game_players` rating columns
      // before and after it. Without the stored seed this player would be re-seeded at
      // Challenger and every number on their page — and on everybody's they played against —
      // would move.
      const climber = playerIds[0] as string;
      const before = await dump();

      await db.from('players').update({ rank_tier: 'CHALLENGER', rank_division: 'I' }).eq('id', climber);

      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(0);
      expect(result.report.ratingRowsChanged).toBe(0);
      expect(result.report.seedsStored).toBe(0);
      expect(await dump()).toBe(before);

      // The seed still names the rank the history was actually built on, not the new one.
      const seeded = (await seedRows()).find((row) => row.player_id === climber);
      expect([seeded?.seed_rank_tier, seeded?.seed_rank_division]).toEqual(['GOLD', 'II']);

      await db.from('players').update({ rank_tier: 'GOLD', rank_division: 'II' }).eq('id', climber);
    });

    it('is backfilled onto rows written before 0012, from the seed the fold used', async () => {
      const seeded = await seedRows();
      const before = await dump();

      // A row from before the migration: rated history, no seed. Every `ratings` row in the
      // database looked like this the moment 0012 was applied.
      const { error } = await db
        .from('ratings')
        .update({ seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null })
        .eq('group_id', groupId);
      if (error) throw new Error(error.message);
      const emptied = await dump();

      // A dry run says how many seeds it would write, and writes none of them.
      const dry = await rebuild({ dryRun: true });
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.report.seedsStored).toBe(10);
      expect(formatRebuildReport(dry.report)).toContain('seeds         10 to store for the first time');
      expect(await dump()).toBe(emptied);

      const run = await rebuild();
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.report.seedsStored).toBe(10);
      expect(formatRebuildReport(run.report)).toContain('seeds         10 stored for the first time');

      // The ranks have not moved, so the backfill puts back exactly what the first fold wrote —
      // and nothing else about the group changed on the way.
      expect(await seedRows()).toEqual(seeded);
      expect(await dump()).toBe(before);

      // And a second run writes nothing at all: the seed is stored once.
      const again = await rebuild();
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.report.seedsStored).toBe(0);
      expect(again.report.ratingRowsChanged).toBe(0);
      expect(await dump()).toBe(before);
    });

    it('is not rewritten by the next game the live fold rates, whatever the rank says now', async () => {
      const climber = playerIds[0] as string;
      const seeded = await seedRows();

      await db.from('players').update({ rank_tier: 'CHALLENGER', rank_division: 'I' }).eq('id', climber);

      const response = await postGame(
        post(
          eogBody({
            gameId: afterTheClimbGameId,
            puuids,
            partyId: null,
            winningSide: 100,
            startedAt: '2026-09-12T20:00:00.000Z',
            durationS: 1_620,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rated).toBe(true);

      // The rating moved — a game was played — and the seed did not, for any of the ten.
      expect(await seedRows()).toEqual(seeded);

      // And the rebuild agrees with the fold that just ran, seed included.
      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(0);
      expect(result.report.ratingRowsChanged).toBe(0);
      expect(result.report.seedsStored).toBe(0);
      expect(await seedRows()).toEqual(seeded);

      await db.from('players').update({ rank_tier: 'GOLD', rank_division: 'II' }).eq('id', climber);
      await db.from('games').delete().eq('lcu_game_id', afterTheClimbGameId);
    });
  });

  /**
   * ARAM never rates (M7.1), from the rebuild's side.
   *
   * **Last in the file on purpose**: every case above counts the group's games, and this one
   * adds one to it.
   */
  describe('the map (M7.1)', () => {
    async function aramGameUuid(): Promise<string> {
      const { data } = await db.from('games').select('id').eq('lcu_game_id', aramGameId).single();
      return data?.id ?? '';
    }

    it('skips an ARAM, leaves its columns null, and moves nobody else by a digit', async () => {
      // Settle the group first. The case above posted a game, let it rate, and then deleted
      // it, so the stored `ratings` still count a game that is gone — true of this file and of
      // nothing this case is about.
      expect((await rebuild()).ok).toBe(true);

      const before = JSON.parse(await dump()) as { rows: { game_id: string }[]; ratings: unknown[] };
      const dry = await rebuild({ dryRun: true });
      if (!dry.ok) throw new Error(`the group would not fold: ${dry.message}`);
      const consideredBefore = dry.report.considered;

      const response = await postGame(
        post(
          eogBody({
            gameId: aramGameId,
            puuids,
            partyId: null,
            startedAt: '2026-09-13T20:00:00.000Z',
            durationS: 1_800,
            raw: { gameMode: 'ARAM' },
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, rated: false, reason: 'game-mode' });

      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.considered).toBe(consideredBefore + 1);
      expect(result.report.skipped['game-mode']).toBe(1);
      expect(formatRebuildReport(result.report)).toContain('1 game-mode');
      // Not a problem: an ARAM night is a night that happened, it just carries no rating.
      expect(result.report.problems).toEqual([]);

      const aramId = await aramGameUuid();
      for (const row of await ratingColumns(aramGameId)) {
        expect(row.mu_before).toBeNull();
        expect(row.mu_after).toBeNull();
      }

      // Acceptance 3: the Rift games' numbers are the ones they had before the ARAM existed,
      // and no `ratings` row counts it.
      const after = JSON.parse(await dump()) as { rows: { game_id: string }[]; ratings: unknown[] };
      expect(after.rows.filter((row) => row.game_id !== aramId)).toEqual(before.rows);
      expect(after.ratings).toEqual(before.ratings);
    });

    it('un-rates an ARAM an older fold already rated, which is what M7.11 will do', async () => {
      // The database as it is today: ARAM games with four rating columns the fold wrote before
      // this gate existed. One rebuild is all it takes to give them back.
      const aramId = await aramGameUuid();
      await db
        .from('game_players')
        .update({ mu_before: 30, sigma_before: 5, mu_after: 31, sigma_after: 4.9 })
        .eq('game_id', aramId);

      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(10);
      for (const row of await ratingColumns(aramGameId)) {
        expect(row.mu_before).toBeNull();
        expect(row.mu_after).toBeNull();
      }
    });

    it('is still idempotent with an ARAM in the group', async () => {
      const first = await rebuild();
      expect(first.ok).toBe(true);
      const afterFirst = await dump();

      const second = await rebuild();
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.gamePlayerRowsChanged).toBe(0);
      expect(second.report.ratingRowsChanged).toBe(0);
      expect(await dump()).toBe(afterFirst);
    });
  });

  /**
   * The MVP / ACE bonus, through both folds (M7.9).
   *
   * The unit tests in `fold.test.ts` pin the arithmetic. What can only be checked here is that
   * the numbers the **live** route wrote and the numbers the **rebuild** computes are the same
   * numbers — which is the whole reason the bonus lives inside `foldGame` — and that a stored
   * game whose three nullable columns are empty still rates exactly as it did before.
   *
   * Last in the file, after the ARAM cases, for the same reason they are last: it adds games.
   */
  describe('the MVP / ACE bonus (M7.9)', () => {
    /** Everything the fold reads off one stored game, ordered the way the fold orders it. */
    async function foldRows(lcuGameId: number) {
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
      const { data, error } = await db
        .from('game_players')
        .select(
          'side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_before, sigma_before, mu_after, sigma_after, players!inner(puuid)',
        )
        .eq('game_id', game?.id ?? '');
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => ({
          playerId: row.players.puuid,
          puuid: row.players.puuid,
          side: row.side as 100 | 200,
          role: row.role,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          damageToChamps: row.damage_to_champs,
          gold: row.gold,
          cs: row.cs,
          visionScore: row.vision_score,
          damageSelfMitigated: row.damage_self_mitigated,
          damageToObjectives: row.damage_to_objectives,
          before: { mu: row.mu_before as number, sigma: row.sigma_before as number },
          after: { mu: row.mu_after as number, sigma: row.sigma_after as number },
        }))
        .sort((a, b) => (a.puuid < b.puuid ? -1 : 1));
    }

    /** `rateGame` alone over the stored before-values: the answer without any bonus. */
    function plainFold(rows: Awaited<ReturnType<typeof foldRows>>, winningSide: 100 | 200) {
      const blue = rows.filter((row) => row.side === 100);
      const red = rows.filter((row) => row.side === 200);
      const rated = rateGame(
        blue.map((row) => row.before),
        red.map((row) => row.before),
        winningSide,
      );
      const out = new Map<string, { mu: number; sigma: number }>();
      blue.forEach((row, index) => {
        out.set(row.puuid, rated.blue[index] as { mu: number; sigma: number });
      });
      red.forEach((row, index) => {
        out.set(row.puuid, rated.red[index] as { mu: number; sigma: number });
      });
      return out;
    }

    it('writes one amplified winner and one reduced loser live, and the rebuild agrees digit for digit', async () => {
      const response = await postGame(
        post(
          eogBody({
            gameId: bonusGameId,
            puuids,
            partyId: null,
            winningSide: 100,
            startedAt: '2026-09-14T20:00:00.000Z',
            durationS: 1_900,
            performanceStats: true,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rated).toBe(true);

      const rows = await foldRows(bonusGameId);
      expect(rows).toHaveLength(10);

      // The three columns really landed, or this case would be measuring the null path.
      for (const row of rows) {
        expect(row.visionScore).not.toBeNull();
        expect(row.damageSelfMitigated).not.toBeNull();
        expect(row.damageToObjectives).not.toBeNull();
        expect(row.role).not.toBeNull();
      }

      const award = gameAward(rows, 100);
      if (award === null) throw new Error('expected this game to have an MVP');
      const plain = plainFold(rows, 100);

      const moved: string[] = [];
      for (const row of rows) {
        const base = plain.get(row.puuid) as { mu: number; sigma: number };
        // `sigma` is the plain fold's for all ten: the bonus never touches it.
        expect(row.after.sigma).toBeCloseTo(base.sigma, 12);
        const factor =
          row.puuid === award.mvp
            ? 1 + config.rating.mvp.bonusFraction
            : row.puuid === award.ace
              ? 1 - config.rating.mvp.aceReliefFraction
              : null;
        if (factor === null) {
          expect(row.after.mu).toBeCloseTo(base.mu, 12);
        } else {
          // Read back off two stored doubles, so this is exact to ~1e-15 and no further
          // (M7.8's own decision row says why).
          expect(row.after.mu).toBeCloseTo(row.before.mu + (base.mu - row.before.mu) * factor, 12);
          moved.push(row.puuid);
        }
      }
      // Two moved, eight untouched — and the winner's side is the MVP's.
      expect(moved.sort()).toEqual([award.ace, award.mvp].sort());
      expect(rows.find((row) => row.puuid === award.mvp)?.side).toBe(100);
      expect(rows.find((row) => row.puuid === award.ace)?.side).toBe(200);

      // Acceptance 3: the rebuild replays the same group and writes nothing, because it
      // reaches the same MVP from the same columns.
      const before = await dump();
      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(0);
      expect(result.report.ratingRowsChanged).toBe(0);
      expect(await dump()).toBe(before);

      // Acceptance 4: and a second run is byte-identical with the bonus in the group.
      expect((await rebuild()).ok).toBe(true);
      expect(await dump()).toBe(before);
    });

    it('rates a game with the three columns empty exactly as the plain fold does', async () => {
      // Acceptance 1: what every game stored before migrations 0014 and 0015 looks like.
      const response = await postGame(
        post(
          eogBody({
            gameId: plainGameId,
            puuids,
            partyId: null,
            winningSide: 200,
            startedAt: '2026-09-14T21:30:00.000Z',
            durationS: 1_700,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rated).toBe(true);

      const rows = await foldRows(plainGameId);
      for (const row of rows) {
        expect([row.visionScore, row.damageSelfMitigated, row.damageToObjectives]).toEqual([
          null,
          null,
          null,
        ]);
      }
      expect(gameAward(rows, 200)).toBeNull();

      const plain = plainFold(rows, 200);
      for (const row of rows) {
        const base = plain.get(row.puuid) as { mu: number; sigma: number };
        expect(row.after.mu).toBeCloseTo(base.mu, 12);
        expect(row.after.sigma).toBeCloseTo(base.sigma, 12);
      }

      // And the rebuild still agrees about both games at once.
      const before = await dump();
      const result = await rebuild();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gamePlayerRowsChanged).toBe(0);
      expect(await dump()).toBe(before);
    });

    /**
     * Acceptance 5, checked and not written: `/p/[puuid]`'s recent games print the stored
     * all-time Kustom pair (M18.6), so the MVP's share reaches the page with **no change to it**.
     * What this case pins is that the pair it carries is the stored one, and that it is the
     * MVP's: the base change times 1.2.
     */
    it('carries the stored Kustom pair, MVP share included, onto the player page', async () => {
      const anon = createPublicClient();
      const rows = await foldRows(bonusGameId);
      const award = gameAward(rows, 100);
      if (award === null) throw new Error('expected this game to have an MVP');
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', bonusGameId).single();
      const { data: mvpPlayer } = await db.from('players').select('id').eq('puuid', award.mvp).single();
      const { data: stored } = await db
        .from('game_players')
        .select('r_before, r_after, k, fold_p, share_rank, award')
        .eq('game_id', game?.id ?? '')
        .eq('player_id', mvpPlayer?.id ?? '')
        .single();

      // The board no longer opens into a game list (M14.15); the player page carries the pair.
      const page = await loadPlayerBoard(anon, award.mvp, { window: 'all-time', groupId });
      const recent = page?.recent.find((entry) => entry.gameId === (game?.id ?? ''));
      expect([recent?.rBefore, recent?.rAfter]).toEqual([stored?.r_before, stored?.r_after]);
      expect(stored).toMatchObject({ share_rank: 1, award: 'mvp' });

      // And that pair is the MVP's: K × (1 − expected) × 1.2.
      const shown = (recent?.rAfter as number) - (recent?.rBefore as number);
      const base = (stored?.k as number) * (1 - (stored?.fold_p as number));
      expect(shown).toBeCloseTo(base * 1.2, 9);
    });

    it('re-folds both games from scratch to the same numbers, in either arrival order', async () => {
      // The strongest form of "the two folds cannot disagree": wipe every rating column in the
      // group and let the rebuild alone produce them. The bonus has to come back on exactly
      // the same two rows of exactly the same game.
      const live = await dump();

      const { data: games } = await db.from('games').select('id').eq('group_id', groupId);
      for (const game of games ?? []) {
        await db.from('game_players').update(WIPED).eq('game_id', game.id);
      }
      await db.from('ratings').delete().eq('group_id', groupId);

      expect((await rebuild()).ok).toBe(true);
      expect(within(await dump())).toBe(within(live));
    });
  });

  /**
   * **The fold breakdown** (M14.58, M14.59, `0034`): the live fold stores, per row, the odds it
   * used for the row's side, the base `mu_after` before the MVP/ACE bonus, the award, and the
   * player's rated games before the game; `rebuild-ratings` fills the same four for every game it
   * folds, and a second run changes nothing. Last in the file: it reads the games the MVP block
   * above added.
   */
  describe('the fold breakdown (M14.58)', () => {
    async function breakdownRows(lcuGameId: number) {
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
      const { data, error } = await db
        .from('game_players')
        .select(
          'side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_before, sigma_before, mu_after, base_mu_after, fold_p, award, rated_games_before, r_before, players!inner(puuid)',
        )
        .eq('game_id', game?.id ?? '');
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => ({
          playerId: row.players.puuid,
          puuid: row.players.puuid,
          side: row.side as 100 | 200,
          role: row.role,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          damageToChamps: row.damage_to_champs,
          gold: row.gold,
          cs: row.cs,
          visionScore: row.vision_score,
          damageSelfMitigated: row.damage_self_mitigated,
          damageToObjectives: row.damage_to_objectives,
          before: { mu: row.mu_before as number, sigma: row.sigma_before as number },
          rBefore: row.r_before as number,
          muAfter: row.mu_after as number,
          baseMuAfter: row.base_mu_after,
          foldP: row.fold_p,
          award: row.award,
          ratedGamesBefore: row.rated_games_before,
        }))
        .sort((a, b) => (a.puuid < b.puuid ? -1 : 1));
    }

    /** Rated games each player had in the group before `lcuGameId`, from the stored rows. */
    async function ratedBefore(lcuGameId: number): Promise<Map<string, number>> {
      const { data: target } = await db
        .from('games')
        .select('started_at, lcu_game_id')
        .eq('lcu_game_id', lcuGameId)
        .single();
      const { data, error } = await db
        .from('game_players')
        .select('mu_after, players!inner(puuid), games!inner(started_at, lcu_game_id)')
        .eq('group_id', groupId)
        .not('mu_after', 'is', null);
      if (error) throw new Error(error.message);
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const earlier =
          row.games.started_at < (target?.started_at ?? '') ||
          (row.games.started_at === target?.started_at && row.games.lcu_game_id < (target?.lcu_game_id ?? 0));
        if (earlier) counts.set(row.players.puuid, (counts.get(row.players.puuid) ?? 0) + 1);
      }
      return counts;
    }

    it('is written by the live fold: the side s odds, the base mu_after, the award and the count', async () => {
      const rows = await breakdownRows(bonusGameId);
      expect(rows).toHaveLength(10);
      const award = gameAward(rows, 100);
      if (award === null) throw new Error('expected this game to have an MVP');
      const sumR = (side: 100 | 200) =>
        rows.filter((row) => row.side === side).reduce((total, row) => total + row.rBefore, 0);
      const counts = await ratedBefore(bonusGameId);

      for (const row of rows) {
        // M18.5: the odds the fold used are Kustom's all-time expected for the row's side, from the
        // exact all-time Ratings going in (the one odds function, `winProbability`).
        const blueP = winProbability(sumR(100), sumR(200));
        expect(row.foldP).toBeCloseTo(row.side === 100 ? blueP : 1 - blueP, 12);
        expect(row.award).toBe(row.puuid === award.mvp ? 'mvp' : row.puuid === award.ace ? 'ace' : 'none');
        expect(row.ratedGamesBefore).toBe(counts.get(row.puuid) ?? 0);
        if (row.award === 'none') expect(row.baseMuAfter).toBe(row.muAfter);
      }
      // Blue's and red's odds are one probability from two sides.
      const blueP = rows.find((row) => row.side === 100)?.foldP as number;
      const redP = rows.find((row) => row.side === 200)?.foldP as number;
      expect(blueP + redP).toBeCloseTo(1, 12);

      // Acceptance 2: base delta times the award multiplier gives the stored delta, for the MVP and
      // the ACE, within one display point.
      for (const [puuid, factor] of [
        [award.mvp, 1 + config.rating.mvp.bonusFraction],
        [award.ace, 1 - config.rating.mvp.aceReliefFraction],
      ] as const) {
        const row = rows.find((candidate) => candidate.puuid === puuid) as (typeof rows)[number];
        const base = displayRating(row.baseMuAfter as number) - displayRating(row.before.mu);
        const stored = displayRating(row.muAfter) - displayRating(row.before.mu);
        expect(Math.abs(base * factor - stored)).toBeLessThanOrEqual(1);
        expect(base).not.toBe(stored);
      }
    });

    it('is filled by the rebuild for rows stored before 0034, reported on a dry run, then still', async () => {
      const filled = await dump();
      const { data: rated, error } = await db
        .from('game_players')
        .select('game_id, player_id')
        .eq('group_id', groupId)
        .not('mu_after', 'is', null);
      expect(error).toBeNull();
      const ratedCount = (rated ?? []).length;
      expect(ratedCount).toBeGreaterThan(0);

      // What every row looked like before 0034: rated, no breakdown (and, since M18.5, no Kustom
      // column either: 0036 refuses a Kustom row without its breakdown).
      const { error: wipeError } = await db
        .from('game_players')
        .update({
          fold_p: null,
          base_mu_after: null,
          award: null,
          rated_games_before: null,
          r_before: null,
          r_after: null,
          k: null,
          share_rank: null,
          week_r_before: null,
          week_r_after: null,
          week_k: null,
          week_fold_p: null,
          week_games_before: null,
        })
        .eq('group_id', groupId);
      expect(wipeError).toBeNull();
      const legacy = await dump();

      const dry = await rebuild({ dryRun: true });
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.report.breakdownsFilled).toBe(ratedCount);
      expect(formatRebuildReport(dry.report)).toContain(
        `breakdowns    ${ratedCount} game_players rows to fill for the first time (0034)`,
      );
      expect(await dump()).toBe(legacy);

      const run = await rebuild();
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.report.breakdownsFilled).toBe(ratedCount);
      expect(run.report.gamePlayerRowsChanged).toBe(ratedCount);
      // Exactly what the live fold had written.
      expect(within(await dump())).toBe(within(filled));

      const { count: missing } = await db
        .from('game_players')
        .select('game_id', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .not('mu_after', 'is', null)
        .is('base_mu_after', null);
      expect(missing).toBe(0);

      // Acceptance 3: a second run changes nothing.
      const afterFirst = await dump();
      const second = await rebuild();
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.breakdownsFilled).toBe(0);
      expect(second.report.gamePlayerRowsChanged).toBe(0);
      expect(await dump()).toBe(afterFirst);
    });

    /** The read the web will use (M14.58 tap-to-explain, M14.59 result line), with the anon key. */
    it('reads back as a stored reason per player and the rating s odds, on the game and the player page', async () => {
      const anon = createPublicClient();
      const { loadGameBreakdowns } = await import('@/lib/breakdown/load');
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', bonusGameId).single();
      const gameId = game?.id ?? '';
      const breakdown = (await loadGameBreakdowns(anon, [gameId])).get(gameId);
      expect(breakdown).toBeDefined();
      // No lobby, so no bot odds: the rating's number is the one shown.
      expect(breakdown?.odds).toMatchObject({ botBluePct: null, differ: false });
      expect(breakdown?.reasons.size).toBe(10);

      const rows = await breakdownRows(bonusGameId);
      const award = gameAward(rows, 100);
      if (award === null) throw new Error('expected an MVP');
      for (const row of rows) {
        const reason = breakdown?.reasons.get(row.puuid);
        expect(reason?.track).toBe('all-time');
        if (reason === null || reason === undefined) continue;
        const sidePct =
          row.side === 100
            ? breakdown?.odds?.ratingBluePct
            : 100 - (breakdown?.odds?.ratingBluePct as number);
        expect(reason.parts.expectedPct).toBe(sidePct);
        if (row.puuid === award.mvp)
          expect(reason.parts).toMatchObject({ award: 'mvp', shareRank: 1, share: 1.2 });
        if (row.puuid === award.ace)
          expect(reason.parts).toMatchObject({ award: 'ace', shareRank: 1, share: 0.8 });
      }

      const page = await loadPlayerBoard(anon, award.mvp, { window: 'all-time', groupId });
      const recent = page?.recent.find((entry) => entry.gameId === gameId);
      expect(recent?.reason).toEqual(breakdown?.reasons.get(award.mvp));
      expect(recent?.odds).toEqual(breakdown?.odds);
    });

    it('leaves a skipped game s rows with no breakdown at all', async () => {
      const { data, error } = await db
        .from('game_players')
        .select('mu_after, fold_p, base_mu_after, award, rated_games_before')
        .eq('group_id', groupId)
        .is('mu_after', null);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
      for (const row of data ?? []) {
        expect([row.fold_p, row.base_mu_after, row.award, row.rated_games_before]).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }
    });
  });
}
