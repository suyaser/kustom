import { randomUUID } from 'node:crypto';
import type { Database, Json } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { copyRawStats } from '@/lib/ingest/copyRawStats';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M7.7, extended by M7.14: vision score, damage self-mitigated and damage to objectives land in
 * `game_players`, through the route a companion actually posts to, and onto rows that were
 * written before the columns existed.
 *
 * The briefs' acceptance, in order: a live end-of-game post fills all three for all ten, a
 * backfilled match detail fills them too, a block missing the keys writes null and the game
 * still stores and still rates, and the copy pass fills every stored row whose `games.raw`
 * holds the numbers, is safe to run twice and reports what it touched **per column**.
 *
 * Null is the load-bearing part. `0` would tell the performance score that a tank mitigated
 * nothing and a jungler never touched a dragon.
 *
 * One asymmetry is pinned here on purpose: the backfilled shape carries objective damage under
 * the camelCase key **only** (`03-lcu-reference.md`, M7.13 step 1), so `detailRaw` spells it
 * that way and nothing else, and a reader that regressed to the uppercase key alone would fail
 * these tests rather than quietly leaving the history null.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('vision, mitigation and objectives against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  const { POST: postGame } = await import('@/app/api/companion/game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const ownerPuuid = puuids[0] as string;

  const base = testGameId();
  const liveGameId = base + 1;
  const backfillGameId = base + 2;
  const silentGameId = base + 3;
  const nonsenseGameId = base + 4;
  const allGameIds = [liveGameId, backfillGameId, silentGameId, nonsenseGameId];

  /**
   * The numbers the block says, by index. Real shapes: a support wards, a tank tanks, a
   * jungler takes the map. The `0` in the objectives row is a real zero, not a missing key —
   * somebody in every game did nothing to a tower — and it must still store as `0`.
   */
  const vision = [18, 29, 53, 8, 90, 18, 63, 24, 40, 110];
  const mitigation = [151_130, 111_916, 48_955, 51_175, 19_814, 199_376, 94_610, 42_904, 44_456, 30_154];
  const objectives = [61_152, 12_356, 4_902, 0, 15_440, 28_713, 7_118, 33_207, 1_204, 81_582];

  let token = '';

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  /** An end-of-game shaped `raw`: `teams[].players[].stats` with the uppercase keys. */
  function eogRaw(): Record<string, unknown> {
    return {
      gameMode: 'CLASSIC',
      teams: [100, 200].map((teamId, team) => ({
        teamId,
        isWinningTeam: teamId === 100,
        players: puuids.slice(team * 5, team * 5 + 5).map((puuid, seat) => {
          const index = team * 5 + seat;
          return {
            puuid,
            teamId,
            stats: {
              CHAMPIONS_KILLED: index,
              VISION_SCORE: vision[index],
              TOTAL_DAMAGE_SELF_MITIGATED: mitigation[index],
              TOTAL_DAMAGE_DEALT_TO_OBJECTIVES: objectives[index],
            },
          };
        }),
      })),
    };
  }

  /**
   * The same shape with numbers no `integer` column can hold: a negative (which the `>= 0`
   * check refuses) and a value past int4 (which the check cannot see and Postgres refuses as
   * an overflow). Before the M7.7 review's fix both of these stored the `games` row and then
   * 500'd on the `game_players` insert, for ever, on every retry.
   */
  function nonsenseRaw(): Record<string, unknown> {
    return {
      gameMode: 'CLASSIC',
      teams: [100, 200].map((teamId, team) => ({
        teamId,
        isWinningTeam: teamId === 100,
        players: puuids.slice(team * 5, team * 5 + 5).map((puuid, seat) => {
          const index = team * 5 + seat;
          return {
            puuid,
            teamId,
            stats: {
              VISION_SCORE: index % 2 === 0 ? -3 : 4_000_000_000,
              TOTAL_DAMAGE_SELF_MITIGATED: index % 2 === 0 ? 9_999_999_999 : -1,
              TOTAL_DAMAGE_DEALT_TO_OBJECTIVES: index % 2 === 0 ? -17 : 5_000_000_000,
            },
          };
        }),
      })),
    };
  }

  /** A match-history shaped `raw`: `participants[]` + `participantIdentities[]`, camelCase. */
  function detailRaw(): Record<string, unknown> {
    return {
      gameMode: 'CLASSIC',
      participantIdentities: puuids.map((puuid, index) => ({
        participantId: index + 1,
        player: { puuid },
      })),
      participants: puuids.map((_puuid, index) => ({
        participantId: index + 1,
        teamId: index < 5 ? 100 : 200,
        stats: {
          visionScore: vision[index],
          damageSelfMitigated: mitigation[index],
          // camelCase only, exactly as the client writes a match-history detail.
          damageDealtToObjectives: objectives[index],
        },
      })),
    };
  }

  async function gameRowId(lcuGameId: number): Promise<string> {
    const { data } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
    return data?.id ?? '';
  }

  type StoredTriple = [number | null, number | null, number | null];

  /** `puuid -> [vision, mitigation, objectives]` for a stored game. */
  async function stored(lcuGameId: number): Promise<Map<string, StoredTriple>> {
    const { data, error } = await db
      .from('game_players')
      .select('vision_score, damage_self_mitigated, damage_to_objectives, players!inner(puuid)')
      .eq('game_id', await gameRowId(lcuGameId));
    if (error) throw new Error(error.message);
    const out = new Map<string, StoredTriple>();
    for (const row of data ?? []) {
      out.set(row.players.puuid, [row.vision_score, row.damage_self_mitigated, row.damage_to_objectives]);
    }
    return out;
  }

  /** What the three columns should read for the player at `index` on a full block. */
  function expected(index: number): StoredTriple {
    return [vision[index] ?? null, mitigation[index] ?? null, objectives[index] ?? null];
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    const { token: raw, tokenHash } = mintCompanionToken();
    await db.from('companion_tokens').insert({
      player_id: ids.get(ownerPuuid) ?? '',
      token_hash: tokenHash,
      label: `it-${runId}-m77`,
    });
    token = raw;
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', allGameIds);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('at ingest', () => {
    it('fills all three columns for all ten off a live end-of-game block', async () => {
      const response = await postGame(
        post(
          eogBody({
            gameId: liveGameId,
            puuids,
            partyId: null,
            startedAt: '2026-09-15T20:00:00.000Z',
            raw: eogRaw(),
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, participants: 10, rated: true });

      const rows = await stored(liveGameId);
      expect(rows.size).toBe(10);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual(expected(index));
      }
    });

    it('fills all three off a backfilled match detail, camelCase and all', async () => {
      const body = eogBody({
        gameId: backfillGameId,
        puuids,
        partyId: null,
        startedAt: '2026-09-14T20:00:00.000Z',
        raw: detailRaw(),
      }) as Record<string, unknown>;
      const { partyId: _dropped, ...rest } = body;

      const response = await postGame(
        post({
          ...rest,
          source: 'backfill',
          participants: (body.participants as Record<string, unknown>[]).map((p) => ({
            ...p,
            role: null,
          })),
        }),
      );
      expect(response.status).toBe(200);
      // Backfill is stored unrated as always; the three numbers do not change that.
      expect(await response.json()).toMatchObject({ created: true, rated: false, reason: 'backfill' });

      const rows = await stored(backfillGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual(expected(index));
      }
    });

    it('writes null in all three for a block that never said, and the game still stores and rates', async () => {
      const response = await postGame(
        post(
          eogBody({
            gameId: silentGameId,
            puuids,
            partyId: null,
            startedAt: '2026-09-15T22:00:00.000Z',
            // A blob with the players but neither key: the pre-16 blocks and any future
            // rename. Null, never 0 — the performance score skips this game rather than scoring it.
            raw: {
              gameMode: 'CLASSIC',
              teams: [
                {
                  teamId: 100,
                  players: puuids.slice(0, 5).map((puuid) => ({ puuid, stats: { ASSISTS: 3 } })),
                },
                {
                  teamId: 200,
                  players: puuids.slice(5).map((puuid) => ({ puuid, stats: { ASSISTS: 1 } })),
                },
              ],
            },
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, participants: 10, rated: true });

      const rows = await stored(silentGameId);
      expect(rows.size).toBe(10);
      for (const pair of rows.values()) expect(pair).toEqual([null, null, null]);
    });

    it('stores null for a number no integer column can hold, instead of 500ing for ever', async () => {
      // The blocking bug the M7.7 review found: `VISION_SCORE: -3` wrote the `games` row and
      // then failed the `game_players` insert on the check constraint. The game was stored,
      // unratable and stuck — `upsertGamePlayers` runs again on every retry, so the companion
      // posted into the same 500 until somebody edited the database by hand. A value past int4
      // did it too, by overflow, which the check could not have caught at all.
      const response = await postGame(
        post(
          eogBody({
            gameId: nonsenseGameId,
            puuids,
            partyId: null,
            startedAt: '2026-09-15T23:00:00.000Z',
            raw: nonsenseRaw(),
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, participants: 10, rated: true });

      // Null, not 0 and not INT32_MAX: a made-up number would be scored by M7.8.
      const rows = await stored(nonsenseGameId);
      expect(rows.size).toBe(10);
      for (const pair of rows.values()) expect(pair).toEqual([null, null, null]);

      // And it really did rate, like any other Rift custom.
      const { data } = await db
        .from('game_players')
        .select('mu_after')
        .eq('game_id', await gameRowId(nonsenseGameId));
      for (const row of data ?? []) expect(row.mu_after).not.toBeNull();
    });

    it('is still a no-op on a second companion’s post', async () => {
      const before = JSON.stringify([...(await stored(liveGameId))].sort());
      const response = await postGame(
        post(
          eogBody({
            gameId: liveGameId,
            puuids,
            partyId: null,
            startedAt: '2026-09-15T20:00:00.000Z',
            raw: eogRaw(),
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: false, participants: 10 });
      expect(JSON.stringify([...(await stored(liveGameId))].sort())).toBe(before);
    });
  });

  describe('the backwards copy pass', () => {
    /** What a row written before migrations 0014 and 0015 looks like. */
    async function blank(lcuGameId: number): Promise<void> {
      const { error } = await db
        .from('game_players')
        .update({ vision_score: null, damage_self_mitigated: null, damage_to_objectives: null })
        .eq('game_id', await gameRowId(lcuGameId));
      if (error) throw new Error(error.message);
    }

    it('fills pre-migration rows from games.raw, counts them, and is safe to run twice', async () => {
      await blank(liveGameId);
      const gameId = await gameRowId(liveGameId);

      // A dry run counts and writes nothing.
      const dry = await copyRawStats(db, { gameId, dryRun: true });
      expect(dry).toMatchObject({
        gamesWithGaps: 1,
        gamesFilled: 1,
        rowsWithGaps: 10,
        rowsFilled: 10,
        visionFilled: 10,
        mitigationFilled: 10,
        // Including the player whose objective damage is a real 0: `storedStat` keeps a zero,
        // so that row is filled, not left short.
        objectivesFilled: 10,
        rowsStillMissing: 0,
        visionStillMissing: 0,
        mitigationStillMissing: 0,
        objectivesStillMissing: 0,
        dryRun: true,
      });
      for (const pair of (await stored(liveGameId)).values()) expect(pair).toEqual([null, null, null]);

      // The real run puts back exactly what ingest wrote.
      const first = await copyRawStats(db, { gameId, dryRun: false });
      expect(first).toMatchObject({ rowsFilled: 10, rowsStillMissing: 0 });
      const rows = await stored(liveGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual(expected(index));
      }

      // Twice changes nothing: it only ever fills a null.
      const second = await copyRawStats(db, { gameId, dryRun: false });
      expect(second).toMatchObject({ gamesWithGaps: 0, rowsWithGaps: 0, rowsFilled: 0 });
      const again = await stored(liveGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(again.get(puuid)).toEqual(expected(index));
      }
    });

    it('fills the column the blob has and leaves the other two null', async () => {
      const gameId = await gameRowId(backfillGameId);
      await blank(backfillGameId);
      // A blob that lost the other two keys: vision comes back, mitigation and objectives stay
      // null.
      const halved = detailRaw();
      halved.participants = (halved.participants as Record<string, unknown>[]).map((p) => ({
        ...p,
        stats: { visionScore: (p.stats as Record<string, number>).visionScore },
      }));
      const { error } = await db
        .from('games')
        .update({ raw: halved as Json })
        .eq('id', gameId);
      if (error) throw new Error(error.message);

      const report = await copyRawStats(db, { gameId, dryRun: false });
      // Part-answered is not answered (M7.7 review): these ten rows are filled *and* still
      // short, because the bonus needs every number and the operator reads this count to decide
      // whether the history can be trusted. A report that said "0 still null" here would be
      // lying about ten rows with two null columns.
      expect(report).toMatchObject({
        rowsFilled: 10,
        visionFilled: 10,
        mitigationFilled: 0,
        objectivesFilled: 0,
        rowsStillMissing: 10,
        visionStillMissing: 0,
        mitigationStillMissing: 10,
        objectivesStillMissing: 10,
      });
      const rows = await stored(backfillGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual([vision[index], null, null]);
      }
    });

    it('reports the objectives shortfall on its own when only that column is short', async () => {
      // The exact shape M7.14's sequencing rule reads: M7.7's two columns already filled, the
      // new one not. The combined `rowsStillMissing` cannot answer "is
      // `damage_to_objectives` zero rows short?" — only the per-column count can, and the core
      // half may not merge until it is zero.
      // The previous test left this game's rows with vision filled and the other two null.
      const gameId = await gameRowId(backfillGameId);
      // Mitigation comes back from the full blob; objectives is knocked out of it.
      const withoutObjectives = detailRaw();
      withoutObjectives.participants = (withoutObjectives.participants as Record<string, unknown>[]).map(
        (p) => {
          const { damageDealtToObjectives: _gone, ...stats } = p.stats as Record<string, number>;
          return { ...p, stats };
        },
      );
      const { error } = await db
        .from('games')
        .update({ raw: withoutObjectives as Json })
        .eq('id', gameId);
      if (error) throw new Error(error.message);

      const report = await copyRawStats(db, { gameId, dryRun: false });
      expect(report).toMatchObject({
        rowsFilled: 10,
        visionFilled: 0,
        mitigationFilled: 10,
        objectivesFilled: 0,
        rowsStillMissing: 10,
        visionStillMissing: 0,
        mitigationStillMissing: 0,
        objectivesStillMissing: 10,
      });
      const rows = await stored(backfillGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual([vision[index], mitigation[index], null]);
      }
    });

    it('does not abort the whole pass on a blob with a number no column can hold', async () => {
      // `copyRawStats` used to throw out of the run on the first bad value — half the history
      // filled, the rest untouched, a stack trace instead of a report. It now stores nothing
      // for that row and counts it as still short, which is the truth.
      const gameId = await gameRowId(nonsenseGameId);
      const report = await copyRawStats(db, { gameId, dryRun: false });
      expect(report).toMatchObject({
        gamesWithGaps: 1,
        gamesFilled: 0,
        rowsWithGaps: 10,
        rowsFilled: 0,
        rowsStillMissing: 10,
        visionStillMissing: 10,
        mitigationStillMissing: 10,
        objectivesStillMissing: 10,
      });
      for (const pair of (await stored(nonsenseGameId)).values()) expect(pair).toEqual([null, null, null]);
    });

    it('leaves a game whose blob never said alone, and says how many rows it could not fill', async () => {
      const gameId = await gameRowId(silentGameId);
      const report = await copyRawStats(db, { gameId, dryRun: false });
      expect(report).toMatchObject({
        gamesWithGaps: 1,
        gamesFilled: 0,
        rowsWithGaps: 10,
        rowsFilled: 0,
        rowsStillMissing: 10,
        visionStillMissing: 10,
        mitigationStillMissing: 10,
        objectivesStillMissing: 10,
      });
      for (const pair of (await stored(silentGameId)).values()) expect(pair).toEqual([null, null, null]);
    });

    it('walks the whole history when given no game, and finds this one', async () => {
      await blank(liveGameId);
      const report = await copyRawStats(db, { dryRun: false });
      expect(report.rowsFilled).toBeGreaterThanOrEqual(10);
      const rows = await stored(liveGameId);
      for (const [index, puuid] of puuids.entries()) {
        expect(rows.get(puuid)).toEqual(expected(index));
      }
    });
  });
}
