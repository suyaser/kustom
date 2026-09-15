import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * ARAM never rates (M7.1), through the path a companion actually uses.
 *
 * The four cases are the brief's edge cases: a live ARAM lands and is stored whole and unrated
 * with a 2xx, the lobby it was played from still finishes, a mode nobody has ever seen is
 * treated the same way, and a Rift custom with the *same ten players and the same duration*
 * rates exactly as it did before — so the mode is provably the only thing that changed.
 *
 * Namespaced by run id and cleaned up at the bottom; it folds into whatever season is active,
 * like every other game the route rates. The rebuild's side of this task is
 * `rebuild.integration.test.ts`, which needs a season of its own.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('ARAM ingest against the local Supabase stack', () => {
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
  const aramGameId = base + 1;
  const kiwiGameId = base + 2;
  const riftGameId = base + 3;
  const noModeGameId = base + 4;
  const aramWithLobbyGameId = base + 5;
  const backfilledAramGameId = base + 6;
  const allGameIds = [
    aramGameId,
    kiwiGameId,
    riftGameId,
    noModeGameId,
    aramWithLobbyGameId,
    backfilledAramGameId,
  ];
  const partyId = `it-party-${runId}-aram`;

  let token = '';

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  /** An end-of-game body for these ten, on the map named. `null` is a block with no mode. */
  function body(gameId: number, gameMode: string | null, extra: Record<string, unknown> = {}) {
    return eogBody({
      gameId,
      puuids,
      partyId: null,
      durationS: 1_800,
      startedAt: '2026-09-15T20:00:00.000Z',
      raw: gameMode === null ? {} : { gameMode },
      ...extra,
    });
  }

  /** Every rating column of a game, by player, plus the row count: what "unrated" means. */
  async function rows(lcuGameId: number) {
    const { data: game } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
    const { data, error } = await db
      .from('game_players')
      .select('player_id, side, champion_id, kills, mu_before, sigma_before, mu_after, sigma_after')
      .eq('game_id', game?.id ?? '')
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** This season's `ratings` for the ten, as a string: the thing an unrated game must not move. */
  async function ratings(): Promise<string> {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games, wins, players!inner(puuid)')
      .in('players.puuid', puuids)
      .order('player_id');
    if (error) throw new Error(error.message);
    return JSON.stringify(data);
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
      label: `it-${runId}-aram`,
    });
    token = raw;
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', allGameIds);
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('a live ARAM lands', () => {
    it('is stored whole, is not rated, and still answers 2xx', async () => {
      const before = await ratings();

      const response = await postGame(post(body(aramGameId, 'ARAM')));
      // A non-2xx would make the companion retry a game that will never rate.
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        created: true,
        participants: 10,
        rated: false,
        reason: 'game-mode',
      });

      // Ten rows with their scoreboard, four null rating columns, for ever.
      const stored = await rows(aramGameId);
      expect(stored).toHaveLength(10);
      for (const row of stored) {
        expect(row.champion_id).not.toBeNull();
        expect([row.mu_before, row.sigma_before, row.mu_after, row.sigma_after]).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }

      // And nobody's rating moved.
      expect(await ratings()).toBe(before);
    });

    it('finishes the lobby it was played from: rating is not what ends a lobby', async () => {
      const { data: lobby } = await db
        .from('lobbies')
        .insert({ lcu_party_id: partyId, status: 'in_game' })
        .select('id')
        .single();

      const response = await postGame(post(body(aramWithLobbyGameId, 'ARAM', { partyId })));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rated: false, reason: 'game-mode' });

      const { data: after } = await db
        .from('lobbies')
        .select('status')
        .eq('id', lobby?.id ?? '')
        .single();
      expect(after?.status).toBe('finished');
    });

    it('is a no-op on the second companion’s post, exactly as a rated game is', async () => {
      const before = JSON.stringify(await rows(aramGameId));
      const response = await postGame(post(body(aramGameId, 'ARAM')));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: false, rated: false, reason: 'game-mode' });
      expect(JSON.stringify(await rows(aramGameId))).toBe(before);

      const { count } = await db
        .from('game_players')
        .select('player_id', { count: 'exact', head: true })
        .eq(
          'game_id',
          (await db.from('games').select('id').eq('lcu_game_id', aramGameId).single()).data?.id ?? '',
        );
      expect(count).toBe(10);
    });
  });

  describe('a mode we have never seen', () => {
    it('is stored and never rated', async () => {
      const response = await postGame(post(body(kiwiGameId, 'KIWI')));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, rated: false, reason: 'game-mode' });
      for (const row of await rows(kiwiGameId)) expect(row.mu_after).toBeNull();
    });
  });

  describe('a backfilled ARAM', () => {
    it('is stored unrated as every backfill is, and says so', async () => {
      const raw = body(backfilledAramGameId, 'ARAM') as Record<string, unknown>;
      const { partyId: _dropped, ...rest } = raw;
      const response = await postGame(
        post({
          ...rest,
          source: 'backfill',
          participants: (raw.participants as Record<string, unknown>[]).map((p) => ({ ...p, role: null })),
        }),
      );
      expect(response.status).toBe(200);
      // `backfill` wins the race to explain: nothing is rated inline, whatever the map.
      expect(await response.json()).toMatchObject({ created: true, rated: false, reason: 'backfill' });
      for (const row of await rows(backfilledAramGameId)) expect(row.mu_after).toBeNull();
    });
  });

  describe('the Rift still rates', () => {
    it('rates the same ten in the same 1800 seconds, and a block with no mode too', async () => {
      const rift = await postGame(post(body(riftGameId, 'CLASSIC')));
      expect(rift.status).toBe(200);
      expect(await rift.json()).toMatchObject({ created: true, rated: true, reason: null });
      for (const row of await rows(riftGameId)) {
        expect(row.mu_before).not.toBeNull();
        expect(row.mu_after).not.toBeNull();
      }

      // A row written before the companion stored a mode: Rift, rated, exactly as today.
      const noMode = await postGame(
        post(body(noModeGameId, null, { startedAt: '2026-09-15T21:00:00.000Z' })),
      );
      expect(noMode.status).toBe(200);
      expect(await noMode.json()).toMatchObject({ rated: true, reason: null });
      for (const row of await rows(noModeGameId)) expect(row.mu_after).not.toBeNull();

      // Two rated games for the ten, and not four: the ARAM and the KIWI above counted for
      // nobody.
      const { data } = await db
        .from('ratings')
        .select('games, players!inner(puuid)')
        .in('players.puuid', puuids);
      for (const row of data ?? []) expect(row.games).toBe(2);
    });
  });
}
