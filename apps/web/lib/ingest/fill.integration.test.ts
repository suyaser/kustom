import { randomUUID } from 'node:crypto';
import { config } from '@customs/core';
import type { Database } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { ROSTER_STABLE_MS } from '@/lib/lobbyState';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `gamesSinceLastFill` (M7.6) against the Supabase CLI local stack, end to end: a real lobby,
 * a real split, a real end-of-game block whose positions are the ones the split handed out,
 * and then `loadPool` reading the number back out of the flags the fold wrote.
 *
 * Nothing here sets `counts_for_role_inference` by hand. That is the point: the fact this task
 * reads is M5.17's, written at fold time, and a fixture that stamped it itself would prove
 * only that this file can write a boolean.
 *
 * Three claims, in the order the brief lists them:
 *
 * 1. Filled in the group's last game reads `0`; three games later, `3`; with no fill in
 *    `config.roles.inferenceWindow` games, `null` again.
 * 2. **Ten around still gets real values.** `loadRotation` returns early at ten or fewer
 *    because nobody sits, and fill protection matters most at exactly ten — every read below
 *    is a ten-player lobby, so a regression that put this read behind that early return fails
 *    here.
 * 3. A player the split put on their own role has no fill at all and reads `null`.
 *
 * Skipped, not failed, without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('gamesSinceLastFill against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { ingestLobby } = await import('./lobby');
  const { activeSeasonId, loadPool } = await import('./balance');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const WINDOW = config.roles.inferenceWindow;
  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const ownerPuuid = puuids[0] as string;
  const partyId = `fill-${runId}`;
  const base = testGameId();
  /** The lobby's game, then `WINDOW` games played from no lobby after it. */
  const filledGameId = base;
  const looseGameIds = Array.from({ length: WINDOW }, (_, index) => base + 1 + index);
  /** An ARAM, half an hour after the fill: stored, never rated (M7.1), never in the window. */
  const aramGameId = base + 1 + WINDOW;
  const allGameIds = [filledGameId, ...looseGameIds, aramGameId];
  /** One game an hour, so `started_at` orders them the way they were posted. */
  const FIRST_GAME_AT = Date.parse('2026-09-05T18:00:00.000Z');

  let token = '';
  let ownerPlayerId = '';
  let playerIds: string[] = [];
  let lobbyId = '';
  /** The eight the split filled and the two it put on mid, by puuid. */
  let filled: string[] = [];
  let onRole: string[] = [];

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  function startedAt(index: number): string {
    return new Date(FIRST_GAME_AT + index * 3_600_000).toISOString();
  }

  function lobbyPost(now: Date) {
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'customs night',
      members: puuids.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 4000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    });
    return ingestLobby(db, payload, ownerPlayerId, { now, timeZone: TIME_ZONE });
  }

  async function lobbyUpdatedAt(id: string): Promise<Date> {
    const { data, error } = await db.from('lobbies').select('updated_at').eq('id', id).single();
    if (error) throw new Error(error.message);
    return new Date(data.updated_at);
  }

  /**
   * What the balancer would be handed right now, by puuid. Ten members, so this is also the
   * assertion that the ten-player early return in `loadRotation` does not reach this number.
   */
  async function gamesSinceLastFill(): Promise<Map<string, number | null>> {
    const pool = await loadPool(db, lobbyId, await activeSeasonId(db), new Date(), TIME_ZONE);
    expect(pool).toHaveLength(10);
    return new Map(pool.map((member) => [member.puuid, member.gamesSinceLastFill ?? null]));
  }

  /** One rated game played from no lobby: nobody was filled, so every seat counts. */
  async function postLooseGame(index: number): Promise<void> {
    const response = await postGame(
      post(
        eogBody({
          gameId: looseGameIds[index] as number,
          puuids,
          partyId: null,
          winningSide: index % 2 === 0 ? 100 : 200,
          startedAt: startedAt(index + 1),
          durationS: 1_500 + index,
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).rated).toBe(true);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    playerIds = puuids.map((puuid) => ids.get(puuid) ?? '');
    ownerPlayerId = ids.get(ownerPuuid) ?? '';

    // Two seeds, so the balancer has a reason to prefer one arrangement over another, and one
    // main for everybody, so eight of the ten have to be filled.
    await db
      .from('players')
      .update({ rank_tier: 'GOLD', rank_division: 'II', main_role: 'mid', secondary_role: null })
      .in('id', playerIds.slice(0, 5));
    await db
      .from('players')
      .update({ rank_tier: 'PLATINUM', rank_division: 'IV', main_role: 'mid', secondary_role: null })
      .in('id', playerIds.slice(5));

    const { token: raw, tokenHash } = mintCompanionToken();
    await db
      .from('companion_tokens')
      .insert({ player_id: ownerPlayerId, token_hash: tokenHash, label: `it-${runId}-fill` });
    token = raw;
  });

  afterAll(async () => {
    // The database is shared with every other integration file, so leaving it as we found it is
    // part of the test.
    await db.from('games').delete().in('lcu_game_id', allGameIds);
    await db.from('ratings').delete().in('player_id', playerIds);
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('a fill the balancer made, read back at the next balance', () => {
    it('reads 0 for everybody it filled in the last game and null for the two it did not', async () => {
      const opened = await lobbyPost(new Date());
      expect(opened.status).toBe('open');
      lobbyId = opened.lobbyId;

      const settled = new Date((await lobbyUpdatedAt(lobbyId)).getTime() + ROSTER_STABLE_MS);
      const balanced = await lobbyPost(settled);
      expect(balanced.status).toBe('balanced');
      const split = balanced.balanced?.split;
      if (split === undefined) throw new Error('the lobby did not balance');

      const seats = [...split.blue, ...split.red];
      onRole = seats.filter((seat) => seat.role === 'mid').map((seat) => seat.puuid);
      filled = seats.filter((seat) => seat.role !== 'mid').map((seat) => seat.puuid);
      expect([onRole.length, filled.length]).toEqual([2, 8]);

      // Before the game exists nobody has any history at all: the `no games` case.
      for (const [puuid, since] of await gamesSinceLastFill()) {
        expect([puuid, since]).toEqual([puuid, null]);
      }

      const response = await postGame(
        post(
          eogBody({
            gameId: filledGameId,
            puuids: seats.map((seat) => seat.puuid),
            partyId,
            winningSide: 100,
            startedAt: startedAt(0),
            durationS: 1_800,
            roles: seats.map((seat) => seat.role),
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rated).toBe(true);

      const since = await gamesSinceLastFill();
      for (const puuid of filled) expect([puuid, since.get(puuid)]).toEqual([puuid, 0]);
      for (const puuid of onRole) expect([puuid, since.get(puuid)]).toEqual([puuid, null]);
    });

    it('does not move for a game nobody rated', async () => {
      // An ARAM (M7.1): stored whole, `rated: false`, so no `mu_after` and no flag. It is
      // neither a fill nor a step away from one, and the number the balancer reads is the one
      // it read before this game existed.
      const response = await postGame(
        post(
          eogBody({
            gameId: aramGameId,
            puuids,
            partyId: null,
            winningSide: 200,
            startedAt: new Date(FIRST_GAME_AT + 1_800_000).toISOString(),
            durationS: 1_100,
            raw: { gameMode: 'ARAM' },
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rated: false });

      const since = await gamesSinceLastFill();
      for (const puuid of filled) expect([puuid, since.get(puuid)]).toEqual([puuid, 0]);
      for (const puuid of onRole) expect([puuid, since.get(puuid)]).toEqual([puuid, null]);
    });

    it('reads 3 three games later', async () => {
      for (const index of [0, 1, 2]) await postLooseGame(index);

      const since = await gamesSinceLastFill();
      for (const puuid of filled) expect([puuid, since.get(puuid)]).toEqual([puuid, 3]);
      // Three more games that count changes nothing for the two who were never filled.
      for (const puuid of onRole) expect([puuid, since.get(puuid)]).toEqual([puuid, null]);
    });

    it(`reads null again once the fill is ${WINDOW} counted games back`, async () => {
      // The window's last game still sees it...
      for (let index = 3; index < WINDOW - 1; index += 1) await postLooseGame(index);
      const inside = await gamesSinceLastFill();
      for (const puuid of filled) expect([puuid, inside.get(puuid)]).toEqual([puuid, WINDOW - 1]);

      // ...and one game later it has fallen out, which is the flat penalty again.
      await postLooseGame(WINDOW - 1);
      for (const [puuid, since] of await gamesSinceLastFill()) {
        expect([puuid, since]).toEqual([puuid, null]);
      }
    });
  });
}
