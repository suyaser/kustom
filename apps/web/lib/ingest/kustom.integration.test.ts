import { randomUUID } from 'node:crypto';
import {
  type KustomRow,
  type PerformancePlayer,
  performanceScores,
  type Role,
  rateGameKustom,
} from '@customs/core';
import type { Database } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * The Kustom fold on the local stack (M18.5), both tracks, through the same ingest path the
 * companion uses: the live fold (`rating.ts`) as games land, `rebuild-ratings` (`rebuild.ts`) after.
 *
 * Every stored number is checked against `rateGameKustom` from `@customs/core` run **by hand** in
 * this file on the same inputs (the ten rows read back, core's `performanceScores`, the weekly
 * boundary of `night.ts` in `Africa/Cairo`), to 1e-9 -- the same tolerance the rebuild uses
 * (`RATING_EPSILON`): Postgres prints a double to fifteen significant digits, so the live fold's
 * next game reads back a rounded number. The acceptance list of M18.5, case by case:
 *
 * 1. a fold of the fixture games equals `rateGameKustom` by hand, both tracks;
 * 2. a second rebuild changes nothing;
 * 3. a backfilled game landing in a past week changes that week's weekly rows from it on and the
 *    all-time rows after it, and nothing in another week's weekly rows;
 * 4. a game in a week that also holds a reset: all-time refolds from the reset, the week's points
 *    do not change; a game before the reset folds on the weekly track alone;
 * 5. zero-sum on a stored all-settled game;
 * 6. (M18.2 with M18.5) for a roster unchanged since the roll and no game folded in between, the
 *    split's stored `blue_win_prob` is the fold's blue `fold_p`.
 *
 * Own group, own players; skipped without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();
const TZ = 'Africa/Cairo';
const EPSILON = 1e-9;

if (stack === null) {
  describe.skip('the Kustom fold against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';
  process.env.CUSTOMS_NIGHT_TZ = TZ;

  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { rebuildRatings, formatRebuildReport } = await import('./rebuild');
  const { findGroupsWithUnratedBackfill } = await import('./rebuildCron');
  const { ingestLobby } = await import('./lobby');
  const { weekStart } = await import('@/lib/night');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  /** Twelve: ten who play every game of week A, and two who rotate in during week B. */
  const puuids = testPuuids(runId, 12);
  const ownerPuuid = puuids[0] as string;
  const base = testGameId();
  const gameIds: number[] = [];
  const nextGameId = () => {
    const id = base + gameIds.length;
    gameIds.push(id);
    return id;
  };

  let token = '';
  let groupId = '';
  let ownerPlayerId = '';

  /** Week A starts Sunday 2026-09-06 06:00 Cairo (03:00Z); week B a week later. */
  const weekA = (day: number, hour: number) => new Date(Date.UTC(2026, 8, 7 + day, 16 + hour)).toISOString();
  const weekB = (day: number, hour: number) => new Date(Date.UTC(2026, 8, 14 + day, 16 + hour)).toISOString();

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  /** One live game: `ten` in order (five blue, five red), stat lines climbing with the index. */
  async function live(options: {
    ten: readonly string[];
    startedAt: string;
    winningSide: 100 | 200;
    scored?: boolean;
    roles?: readonly (string | null)[];
    partyId?: string | null;
  }): Promise<{ lcuGameId: number; rated: boolean }> {
    const lcuGameId = nextGameId();
    const response = await postGame(
      post(
        eogBody({
          gameId: lcuGameId,
          puuids: options.ten,
          partyId: options.partyId ?? null,
          winningSide: options.winningSide,
          startedAt: options.startedAt,
          durationS: 1_800,
          performanceStats: options.scored ?? true,
          ...(options.roles ? { roles: options.roles } : {}),
        }),
      ),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { rated: boolean };
    return { lcuGameId, rated: json.rated };
  }

  async function backfill(
    ten: readonly string[],
    startedAt: string,
    winningSide: 100 | 200,
  ): Promise<number> {
    const lcuGameId = nextGameId();
    const body = eogBody({ gameId: lcuGameId, puuids: ten, partyId: null, winningSide, startedAt }) as Record<
      string,
      unknown
    >;
    const { partyId: _dropped, ...rest } = body;
    const response = await postGame(post({ ...rest, source: 'backfill' }));
    expect(response.status).toBe(200);
    return lcuGameId;
  }

  function rebuild() {
    return rebuildRatings(db, { groupId, force: true, timeZone: TZ });
  }

  interface StoredRow {
    gameId: string;
    lcuGameId: number;
    startedAt: string;
    winningSide: 100 | 200;
    puuid: string;
    side: 100 | 200;
    perf: PerformancePlayer;
    rBefore: number | null;
    rAfter: number | null;
    k: number | null;
    foldP: number | null;
    award: string | null;
    shareRank: number | null;
    ratedGamesBefore: number | null;
    weekRBefore: number | null;
    weekRAfter: number | null;
    weekK: number | null;
    weekFoldP: number | null;
    weekGamesBefore: number | null;
  }

  /** Every `game_players` row of the group with its game, in the fold's order. */
  async function storedRows(): Promise<StoredRow[]> {
    const { data, error } = await db
      .from('game_players')
      .select(
        'game_id, side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, r_before, r_after, k, fold_p, award, share_rank, rated_games_before, week_r_before, week_r_after, week_k, week_fold_p, week_games_before, players!inner(puuid), games!inner(lcu_game_id, started_at, winning_side)',
      )
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => {
        const side = row.side === 100 ? 100 : 200;
        return {
          gameId: row.game_id,
          lcuGameId: row.games.lcu_game_id,
          startedAt: row.games.started_at,
          winningSide: (row.games.winning_side === 100 ? 100 : 200) as 100 | 200,
          puuid: row.players.puuid,
          side: side as 100 | 200,
          perf: {
            puuid: row.players.puuid,
            side: side as 100 | 200,
            role: row.role as Role | null,
            kills: row.kills,
            deaths: row.deaths,
            assists: row.assists,
            damageToChamps: row.damage_to_champs,
            gold: row.gold,
            cs: row.cs,
            visionScore: row.vision_score,
            damageSelfMitigated: row.damage_self_mitigated,
            damageToObjectives: row.damage_to_objectives,
          },
          rBefore: row.r_before,
          rAfter: row.r_after,
          k: row.k,
          foldP: row.fold_p,
          award: row.award,
          shareRank: row.share_rank,
          ratedGamesBefore: row.rated_games_before,
          weekRBefore: row.week_r_before,
          weekRAfter: row.week_r_after,
          weekK: row.week_k,
          weekFoldP: row.week_fold_p,
          weekGamesBefore: row.week_games_before,
        };
      })
      .sort(
        (a, b) =>
          Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
          a.lcuGameId - b.lcuGameId ||
          (a.puuid < b.puuid ? -1 : 1),
      );
  }

  interface Expected {
    allTime: KustomRow | null;
    week: KustomRow;
    allTimeN: number | null;
    weekN: number;
  }

  /**
   * `rateGameKustom` by hand over every stored game of the group (all of them pass the gate here),
   * both tracks: all-time from 1200 and 0 at `epoch`, weekly from 1200 and 0 at every Sunday 06:00
   * Cairo. Keyed `gameId:puuid`.
   */
  function handFold(rows: readonly StoredRow[], epoch: string | null): Map<string, Expected> {
    const games = new Map<string, StoredRow[]>();
    for (const row of rows) games.set(row.gameId, [...(games.get(row.gameId) ?? []), row]);
    const allTime = new Map<string, { r: number; n: number }>();
    let week = new Map<string, { r: number; n: number }>();
    let weekKey = '';
    const out = new Map<string, Expected>();
    for (const [gameId, ten] of games) {
      const first = ten[0] as StoredRow;
      const key = weekStart(new Date(first.startedAt), TZ).toISOString();
      if (key !== weekKey) {
        weekKey = key;
        week = new Map();
      }
      const scores = performanceScores(ten.map((row) => row.perf));
      const scoreOf = new Map((scores ?? []).map((s) => [s.puuid, s.score]));
      const fold = (track: Map<string, { r: number; n: number }>) =>
        rateGameKustom({
          players: ten.map((row) => ({
            puuid: row.puuid,
            side: row.side,
            r: track.get(row.puuid)?.r ?? 1200,
            n: track.get(row.puuid)?.n ?? 0,
            score: scoreOf.get(row.puuid) ?? null,
          })),
          winningSide: first.winningSide,
        });
      const afterEpoch = epoch === null || Date.parse(first.startedAt) >= Date.parse(epoch);
      const weekRows = fold(week);
      const allRows = afterEpoch ? fold(allTime) : null;
      ten.forEach((row, index) => {
        const weekRow = weekRows[index] as KustomRow;
        const allRow = allRows === null ? null : (allRows[index] as KustomRow);
        out.set(`${gameId}:${row.puuid}`, {
          allTime: allRow,
          week: weekRow,
          allTimeN: allRow === null ? null : (allTime.get(row.puuid)?.n ?? 0),
          weekN: week.get(row.puuid)?.n ?? 0,
        });
      });
      ten.forEach((row, index) => {
        const weekRow = weekRows[index] as KustomRow;
        week.set(row.puuid, { r: weekRow.rAfter, n: (week.get(row.puuid)?.n ?? 0) + 1 });
        if (allRows !== null) {
          const allRow = allRows[index] as KustomRow;
          allTime.set(row.puuid, { r: allRow.rAfter, n: (allTime.get(row.puuid)?.n ?? 0) + 1 });
        }
      });
    }
    return out;
  }

  const close = (actual: number | null, expected: number) => {
    expect(actual).not.toBeNull();
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(EPSILON);
  };

  /** Every stored row against the hand fold: the weekly five always, the all-time set after the epoch. */
  async function expectStoredEqualsHand(epoch: string | null): Promise<StoredRow[]> {
    const rows = await storedRows();
    const hand = handFold(rows, epoch);
    for (const row of rows) {
      const expected = hand.get(`${row.gameId}:${row.puuid}`) as Expected;
      close(row.weekRBefore, expected.week.rBefore);
      close(row.weekRAfter, expected.week.rAfter);
      close(row.weekK, expected.week.k);
      close(row.weekFoldP, expected.week.expected);
      expect(row.weekGamesBefore).toBe(expected.weekN);
      expect(row.shareRank).toBe(expected.week.shareRank);
      expect(row.award).toBe(expected.week.award);
      if (expected.allTime !== null) {
        close(row.rBefore, expected.allTime.rBefore);
        close(row.rAfter, expected.allTime.rAfter);
        close(row.k, expected.allTime.k);
        close(row.foldP, expected.allTime.expected);
        expect(row.ratedGamesBefore).toBe(expected.allTimeN);
      }
    }
    return rows;
  }

  async function ratingsR(): Promise<Map<string, { r: number | null; games: number }>> {
    const { data, error } = await db
      .from('ratings')
      .select('r, games, players!inner(puuid)')
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((row) => [row.players.puuid, { r: row.r, games: row.games }]));
  }

  const ten = puuids.slice(0, 10);
  /** A different order of the same ten per game, so seats and share ranks move around. */
  const rotate = (list: readonly string[], by: number) => [...list.slice(by), ...list.slice(0, by)];
  /** The token's player has to be in every game it posts (M1.8), so the owner stays. */
  const weekBTen = [ownerPuuid, ...puuids.slice(3, 10), puuids[10] as string, puuids[11] as string];

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    ownerPlayerId = ids.get(ownerPuuid) ?? '';
    groupId = (await createTestGroups(db, runId, ['kustom'] as const)).kustom;
    await pinTestGroupMode(db, groupId, 'normal');
    await setTestMembership(db, groupId, ownerPlayerId, 'owner');
    const { token: raw, tokenHash } = mintCompanionToken();
    await db.from('companion_tokens').insert({
      group_id: groupId,
      player_id: ownerPlayerId,
      token_hash: tokenHash,
      label: `it-${runId}-kustom`,
    });
    token = raw;
  });

  afterAll(async () => {
    const problems: string[] = [];
    const attempt = async (what: string, step: () => PromiseLike<unknown>) => {
      try {
        const result = (await step()) as { error?: { message?: string } | null } | null;
        if (result?.error) problems.push(`${what}: ${result.error.message ?? 'failed'}`);
      } catch (thrown) {
        problems.push(`${what}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    };
    await attempt('deleting this run’s games', () => db.from('games').delete().in('lcu_game_id', gameIds));
    await attempt('deleting the test group', () => deleteTestGroups(db, [groupId]));
    await attempt('deleting this run’s players', () => db.from('players').delete().in('puuid', puuids));
    if (problems.length > 0) throw new Error(`kustom cleanup: ${problems.join('; ')}`);
  });

  describe('the live fold, both tracks', () => {
    it('equals rateGameKustom by hand, to 1e-9, over eleven games of week A and two of week B', async () => {
      // Week A: the same ten eleven times, one game with no performance score (shares 1.0).
      for (let game = 0; game < 11; game += 1) {
        const outcome = await live({
          ten: rotate(ten, game % 10),
          startedAt: weekA(Math.floor(game / 3), game % 3),
          winningSide: game % 3 === 1 ? 200 : 100,
          scored: game !== 2,
        });
        expect(outcome.rated).toBe(true);
      }
      // Week B: two newcomers rotate in.
      for (let game = 0; game < 2; game += 1) {
        expect(
          (await live({ ten: rotate(weekBTen, game * 3), startedAt: weekB(0, game), winningSide: 100 }))
            .rated,
        ).toBe(true);
      }

      const rows = await expectStoredEqualsHand(null);
      // Everyone's first game of a week is 1200, n 0, K 32 and 50/50 on the weekly track.
      const firstOfWeekB = rows.filter(
        (row) => row.startedAt === rows.find((r) => r.lcuGameId === gameIds[11])?.startedAt,
      );
      for (const row of firstOfWeekB) {
        expect([row.weekRBefore, row.weekGamesBefore, row.weekK, row.weekFoldP]).toEqual([1200, 0, 32, 0.5]);
      }
      // The unscored game: no share rank, nobody named, on both tracks.
      for (const row of rows.filter((r) => r.lcuGameId === gameIds[2])) {
        expect([row.shareRank, row.award]).toEqual([null, 'none']);
      }
      // ratings.r is the last all-time r_after, and the count the rows' n came from.
      const ratings = await ratingsR();
      for (const puuid of puuids) {
        const last = rows.filter((row) => row.puuid === puuid).at(-1) as StoredRow;
        close(ratings.get(puuid)?.r ?? null, last.rAfter as number);
        expect(ratings.get(puuid)?.games).toBe(rows.filter((row) => row.puuid === puuid).length);
      }
    });

    it('is zero-sum on a stored game where all ten are settled (n >= 10) and shares exist', async () => {
      const rows = (await storedRows()).filter((row) => row.lcuGameId === gameIds[10]);
      expect(rows).toHaveLength(10);
      for (const row of rows) expect(row.ratedGamesBefore).toBe(10);
      expect(rows.every((row) => row.shareRank !== null)).toBe(true);
      const sum = rows.reduce((total, row) => total + ((row.rAfter as number) - (row.rBefore as number)), 0);
      expect(Math.abs(sum)).toBeLessThanOrEqual(EPSILON);
    });
  });

  describe('rebuild-ratings', () => {
    it('reproduces the live fold, then a second run changes nothing (idempotent)', async () => {
      const before = await storedRows();
      const first = await rebuild();
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.report.gamePlayerRowsChanged).toBe(0);
      expect(first.report.kustom).toEqual({ gamePlayerRows: 130, ratingRows: 12, weeks: 2 });
      expect(formatRebuildReport(first.report)).toContain(
        'kustom        130 game_players rows, 12 ratings rows, 2 weeks',
      );
      expect(await storedRows()).toEqual(before);

      const second = await rebuild();
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.gamePlayerRowsChanged).toBe(0);
      expect(second.report.ratingRowsChanged).toBe(0);
      expect(await storedRows()).toEqual(before);
    });

    it('refolds both tracks from a wipe to the same numbers', async () => {
      const before = await storedRows();
      const { error } = await db
        .from('game_players')
        .update({
          mu_before: null,
          sigma_before: null,
          mu_after: null,
          sigma_after: null,
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
      expect(error).toBeNull();
      expect((await rebuild()).ok).toBe(true);
      const after = await expectStoredEqualsHand(null);
      expect(after.map((row) => [row.gameId, row.puuid, row.award, row.shareRank])).toEqual(
        before.map((row) => [row.gameId, row.puuid, row.award, row.shareRank]),
      );
    });

    it('a backfill in a past week moves that week from it on and every all-time row after it, no other week', async () => {
      const before = await storedRows();
      // Between week A's games 4 and 5 (day 1, 22:30 UTC).
      const backfilled = await backfill(
        rotate(ten, 4),
        new Date(Date.UTC(2026, 8, 8, 22, 30)).toISOString(),
        200,
      );
      // Stored unrated, and the daily cron sees it waiting.
      expect((await findGroupsWithUnratedBackfill(db)).some((group) => group.groupId === groupId)).toBe(true);
      expect((await rebuild()).ok).toBe(true);
      const after = await expectStoredEqualsHand(null);

      const at = Date.parse(after.find((row) => row.lcuGameId === backfilled)?.startedAt as string);
      const weekBStart = weekStart(new Date(weekB(0, 0)), TZ).getTime();
      const byKey = new Map(after.map((row) => [`${row.gameId}:${row.puuid}`, row]));
      let movedWeekA = 0;
      let movedAllTime = 0;
      for (const old of before) {
        const now = byKey.get(`${old.gameId}:${old.puuid}`) as StoredRow;
        const t = Date.parse(old.startedAt);
        const weekly = [now.weekRBefore, now.weekRAfter, now.weekFoldP, now.weekGamesBefore];
        const weeklyBefore = [old.weekRBefore, old.weekRAfter, old.weekFoldP, old.weekGamesBefore];
        const allTime = [now.rBefore, now.rAfter, now.foldP, now.ratedGamesBefore];
        const allTimeBefore = [old.rBefore, old.rAfter, old.foldP, old.ratedGamesBefore];
        if (t < at) {
          // Earlier games: nothing moves on either track.
          expect(weekly).toEqual(weeklyBefore);
          expect(allTime).toEqual(allTimeBefore);
        } else if (t >= weekBStart) {
          // Another week: its weekly rows are untouched; its all-time rows moved.
          expect(weekly).toEqual(weeklyBefore);
          if (JSON.stringify(allTime) !== JSON.stringify(allTimeBefore)) movedAllTime += 1;
        } else {
          if (JSON.stringify(weekly) !== JSON.stringify(weeklyBefore)) movedWeekA += 1;
          if (JSON.stringify(allTime) !== JSON.stringify(allTimeBefore)) movedAllTime += 1;
        }
      }
      expect(movedWeekA).toBeGreaterThan(0);
      expect(movedAllTime).toBeGreaterThan(0);
      // The cron has nothing left to do for this group.
      expect((await findGroupsWithUnratedBackfill(db)).some((group) => group.groupId === groupId)).toBe(
        false,
      );
    });

    it('a reset inside a week refolds all-time from it and leaves the week s points; a game before it is weekly only', async () => {
      const before = await storedRows();
      const weekBStart = weekStart(new Date(weekB(0, 0)), TZ).getTime();
      const weekBGames = [
        ...new Set(before.filter((row) => Date.parse(row.startedAt) >= weekBStart).map((r) => r.lcuGameId)),
      ];
      expect(weekBGames).toEqual([gameIds[11], gameIds[12]]);
      // The reset lands between week B's two games: what `reset_group_ratings()` does (0027).
      const epoch = new Date(Date.UTC(2026, 8, 14, 16, 30)).toISOString();
      expect((await db.from('groups').update({ ratings_since: epoch }).eq('id', groupId)).error).toBeNull();
      expect((await db.from('ratings').delete().eq('group_id', groupId)).error).toBeNull();

      const run = await rebuild();
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.report.weeklyOnly).toBe(13);
      const after = await expectStoredEqualsHand(epoch);
      const byKey = new Map(after.map((row) => [`${row.gameId}:${row.puuid}`, row]));
      for (const old of before) {
        const now = byKey.get(`${old.gameId}:${old.puuid}`) as StoredRow;
        // The week's points do not change: every weekly column is where it was.
        expect([now.weekRBefore, now.weekRAfter, now.weekK, now.weekFoldP, now.weekGamesBefore]).toEqual([
          old.weekRBefore,
          old.weekRAfter,
          old.weekK,
          old.weekFoldP,
          old.weekGamesBefore,
        ]);
        if (old.lcuGameId === gameIds[12]) {
          // After the reset: all-time from 1200 and 0.
          expect([now.rBefore, now.ratedGamesBefore, now.k]).toEqual([1200, 0, 32]);
        } else {
          // Before it: history, kept as it was.
          expect([now.rBefore, now.rAfter, now.foldP, now.ratedGamesBefore]).toEqual([
            old.rBefore,
            old.rAfter,
            old.foldP,
            old.ratedGamesBefore,
          ]);
        }
      }
      const ratings = await ratingsR();
      expect([...ratings.values()].every((row) => row.games === 1)).toBe(true);

      // A game that started before the reset, landing now: the weekly track alone (a legal 0036
      // row), no ratings write. It sits between week B's two games, so the rebuild then moves the
      // second game's weekly rows and none of its all-time ones.
      const late = await live({
        ten: weekBTen,
        startedAt: new Date(Date.UTC(2026, 8, 14, 16, 15)).toISOString(),
        winningSide: 200,
      });
      expect(late.rated).toBe(false);
      const lateRows = (await storedRows()).filter((row) => row.lcuGameId === late.lcuGameId);
      expect(lateRows).toHaveLength(10);
      for (const row of lateRows) {
        expect(row.weekRAfter).not.toBeNull();
        expect([row.rBefore, row.rAfter, row.k, row.foldP, row.ratedGamesBefore]).toEqual([
          null,
          null,
          null,
          null,
          null,
        ]);
      }
      expect(await ratingsR()).toEqual(ratings);

      const beforeRefold = await storedRows();
      expect((await rebuild()).ok).toBe(true);
      const refolded = await expectStoredEqualsHand(epoch);
      const lastGame = (rows: readonly StoredRow[]) => rows.filter((row) => row.lcuGameId === gameIds[12]);
      for (const [old, now] of lastGame(beforeRefold).map(
        (row, i) => [row, lastGame(refolded)[i] as StoredRow] as const,
      )) {
        expect([now.rBefore, now.rAfter, now.foldP]).toEqual([old.rBefore, old.rAfter, old.foldP]);
      }
      expect(
        lastGame(refolded).some((row, i) => row.weekRBefore !== lastGame(beforeRefold)[i]?.weekRBefore),
      ).toBe(true);
    });
  });

  describe('the roll and the fold read the same Ratings (M18.2, M18.5)', () => {
    it("stores the split's blue_win_prob equal to the fold's blue fold_p, to 1e-9", async () => {
      const partyId = `kustom-${runId}`;
      const payload = companionLobbyPayloadSchema.parse({
        partyId,
        lobbyName: 'customs night',
        members: weekBTen.map((puuid, index) => ({
          puuid,
          gameName: `Player${index}`,
          tagLine: 'EUW',
          summonerId: 7000 + index,
          side: index < 5 ? 100 : 200,
          isSpectator: false,
        })),
      });
      const ingested = await ingestLobby(db, payload, ownerPlayerId, { groupId, now: new Date() });
      const lobbyId = (ingested as { lobbyId: string }).lobbyId;
      await rollForTest(db, lobbyId, { timeZone: TZ });

      const { data: split, error } = await db
        .from('splits')
        .select('blue, red, blue_win_prob, odds_model')
        .eq('lobby_id', lobbyId)
        .eq('is_chosen', true)
        .single();
      expect(error).toBeNull();
      if (split === null) throw new Error('no chosen split');
      expect(split.odds_model).toBe('kustom');
      const order = [
        ...(split.blue as { puuid: string; role: string }[]),
        ...(split.red as { puuid: string; role: string }[]),
      ];

      // Played as rolled, after everything above, so no game folds between the roll and this one.
      const played = await live({
        ten: order.map((seat) => seat.puuid),
        roles: order.map((seat) => seat.role),
        startedAt: new Date(Date.UTC(2026, 8, 15, 18)).toISOString(),
        winningSide: 100,
        partyId,
      });
      expect(played.rated).toBe(true);
      const rows = (await storedRows()).filter((row) => row.lcuGameId === played.lcuGameId);
      const blueFoldP = rows.find((row) => row.side === 100)?.foldP as number;
      expect(Math.abs(blueFoldP - split.blue_win_prob)).toBeLessThanOrEqual(EPSILON);
    });
  });
}
