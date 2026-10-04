import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePlayers } from '@/lib/ingest/players';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.43 (scene-walk gap 10): the sit-out rotation reads only the lobby's own group.
 *
 * Two scratch groups, the same eleven people in both. Group A has one old game in which `p10` sat
 * out, and an open lobby of eleven hosted by `p00`. Then group B gets **401 newer games** (more than
 * `SIT_OUT_HISTORY_GAMES`, 400) from a lobby where `p03` was around and never played, one of them
 * tonight with ten of the eleven. Group A's rotation -- the numbers `loadGroupPool` reads and the order
 * `selectTen` makes of them -- must be exactly what it was before B played a game. Before M14.43 the
 * recent-games read was global: B's games pushed A's old sit-out out of the window, handed `p03` a
 * sit-out and everybody a game tonight.
 *
 * It also checks the host rule end to end: `p00` (first by puuid, so first to sit on a tie) is the
 * lobby's host (`reported_by_player_id`) and plays.
 *
 * Rows are written directly with the service role; everything is deleted with the two groups.
 * Skipped without the stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the sit-out rotation per group against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';

  const { loadGroupPool } = await import('./balance');
  const { selectTen } = await import('./selection');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TZ = 'UTC';
  const runId = randomUUID().slice(0, 8);
  const puuids = Array.from({ length: 11 }, (_, i) => `it-${runId}-rot-p${String(i).padStart(2, '0')}`);
  const groups = { a: '', b: '' };
  const playerIds: string[] = [];
  let lobbyA = '';
  const now = new Date();
  const baseGameId = Date.now() * 1_000 + Math.floor(Math.random() * 1_000);

  async function openLobby(groupId: string, party: string, status: 'open' | 'finished', host: string | null) {
    const { data, error } = await db
      .from('lobbies')
      .insert({ group_id: groupId, lcu_party_id: party, status, reported_by_player_id: host })
      .select('id')
      .single();
    if (error) throw new Error(`lobby: ${error.message}`);
    const members = playerIds.map((player_id) => ({ lobby_id: data.id, player_id }));
    const inserted = await db.from('lobby_members').insert(members);
    if (inserted.error) throw new Error(`members: ${inserted.error.message}`);
    return data.id;
  }

  async function game(
    groupId: string,
    lobbyId: string,
    lcuGameId: number,
    startedAt: Date,
    players: string[],
  ) {
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lobby_id: lobbyId,
        lcu_game_id: lcuGameId,
        started_at: startedAt.toISOString(),
        duration_s: 1500,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(`game: ${error.message}`);
    if (players.length > 0) {
      const rows = players.map((player_id, i) => ({
        game_id: data.id,
        group_id: groupId,
        player_id,
        side: i < 5 ? 100 : 200,
      }));
      const inserted = await db.from('game_players').insert(rows);
      if (inserted.error) throw new Error(`game players: ${inserted.error.message}`);
    }
  }

  /** Group A's rotation as the balancer sees it: the numbers, and the order selectTen makes. */
  async function rotationOfA() {
    const pool = await loadGroupPool(db, lobbyA, now, TZ, groups.a);
    const byPuuid = Object.fromEntries(
      pool.map((m) => [
        m.puuid,
        { gamesTonight: m.gamesTonight, lastSitOutAt: m.lastSitOutAt, isHost: m.isHost },
      ]),
    );
    const selection = selectTen(pool);
    return {
      byPuuid,
      sitters: selection.sitters.map((m) => m.puuid),
      playing: selection.playing.map((m) => m.puuid),
    };
  }

  beforeAll(async () => {
    const made = await createTestGroups(db, runId, ['rota', 'rotb'] as const);
    groups.a = made.rota;
    groups.b = made.rotb;
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    for (const puuid of puuids) playerIds.push(ids.get(puuid) ?? '');

    // Group A: an old game three days ago in which p10 sat out, then tonight's open lobby, hosted by p00.
    const oldLobby = await openLobby(groups.a, `it-${runId}-rot-a-old`, 'finished', playerIds[0] ?? null);
    await game(
      groups.a,
      oldLobby,
      baseGameId,
      new Date(now.getTime() - 3 * 86_400_000),
      playerIds.slice(0, 10),
    );
    lobbyA = await openLobby(groups.a, `it-${runId}-rot-a`, 'open', playerIds[0] ?? null);
  }, 60_000);

  afterAll(async () => {
    await deleteTestGroups(db, [groups.a, groups.b]);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('the sit-out rotation per group (M14.43)', () => {
    it("401 newer games in group B leave group A's rotation exactly as it was", async () => {
      const before = await rotationOfA();
      // A's own history: p10 sat out three days ago; nobody has a game tonight in A.
      expect(before.byPuuid[puuids[10] as string]?.lastSitOutAt).not.toBeNull();
      expect(before.byPuuid[puuids[3] as string]?.lastSitOutAt).toBeNull();
      expect(Object.values(before.byPuuid).every((m) => m.gamesTonight === 0)).toBe(true);

      // Group B: 401 games newer than A's, from a lobby where p03 never played; the newest is tonight
      // and has ten of the eleven (all but p03).
      const lobbyB = await openLobby(groups.b, `it-${runId}-rot-b`, 'finished', playerIds[1] ?? null);
      const rows = Array.from({ length: 401 }, (_, i) => ({
        group_id: groups.b,
        lobby_id: lobbyB,
        lcu_game_id: baseGameId + 1 + i,
        started_at: new Date(now.getTime() - 86_400_000 + i * 60_000).toISOString(),
        duration_s: 1500,
        winning_side: 100,
        raw: {},
      }));
      const bulk = await db.from('games').insert(rows);
      expect(bulk.error).toBeNull();
      const tonightPlayers = playerIds.filter((_, i) => i !== 3);
      await game(groups.b, lobbyB, baseGameId + 500, new Date(now.getTime() - 60_000), tonightPlayers);

      const after = await rotationOfA();
      expect(after).toEqual(before);

      // And group B's own rotation does see them (the read is scoped, not broken).
      const poolB = await loadGroupPool(db, lobbyB, now, TZ, groups.b);
      const p03 = poolB.find((m) => m.puuid === puuids[3]);
      expect(p03?.lastSitOutAt).not.toBeNull();
      expect(poolB.find((m) => m.puuid === puuids[0])?.gamesTonight).toBe(1);
    }, 60_000);

    it('never seats out the lobby host, even when the rotation would pick them first', async () => {
      const { byPuuid, sitters, playing } = await rotationOfA();
      expect(byPuuid[puuids[0] as string]?.isHost).toBe(true);
      // Everyone but p10 is tied (no games tonight, never sat out in A), so p00 would sit on puuid order.
      expect(playing).toContain(puuids[0]);
      expect(sitters).toEqual([puuids[1]]);
    });
  });
}
