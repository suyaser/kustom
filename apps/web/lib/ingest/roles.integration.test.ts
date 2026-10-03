import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { companionLobbyPayloadSchema, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, ROLES_IN_ORDER, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * Inferred roles (M5.17) against the Supabase CLI local stack, driven through the real ingest:
 * the companion posts games, the fold rates them, and `players.main_role` moves by itself.
 *
 * The three things this file is here to prove:
 *
 * 1. **Three counted games make a pair.** Two do not — under `config.roles.minGames` a player
 *    is flexible, which is the balancer's existing "fill them anywhere" (M1.4).
 * 2. **A game the balancer filled somebody into does not count.** End to end: a real lobby, a
 *    real split from `balance()`, a real end-of-game block whose positions are the ones the
 *    split handed out. The filled players' `counts_for_role_inference` is false and their
 *    counted total does not move; the players the split put on their own role gain one.
 * The third claim — that `rebuild-ratings` reaches the same pairs from scratch and is
 * idempotent — lives in `rebuild.integration.test.ts`, because it is the file that already owns
 * a season of its own. **This one deliberately starts no season**: the active season is a
 * singleton in a shared database, and two files moving it is a class of flake rather than a
 * test. Every row here is namespaced by a run id and deleted at the bottom.
 *
 * Skipped, not failed, without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('inferred roles against the local Supabase stack', () => {
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

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const ownerPuuid = puuids[0] as string;
  const partyId = `roles-${runId}`;
  const base = testGameId();
  const looseGameIds = [base + 1, base + 2, base + 3];
  const filledGameId = base + 4;
  const allGameIds = [...looseGameIds, filledGameId];

  let token = '';
  let ownerPlayerId = '';
  let playerIds: string[] = [];

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  interface RoleRow {
    puuid: string;
    main_role: string | null;
    secondary_role: string | null;
    roles_counted: number;
    roles_inferred_at: string | null;
  }

  async function roleRows(): Promise<RoleRow[]> {
    const { data, error } = await db
      .from('players')
      .select('puuid, main_role, secondary_role, roles_counted, roles_inferred_at')
      .in('puuid', puuids)
      .order('puuid');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function roleRow(puuid: string): Promise<RoleRow> {
    const rows = await roleRows();
    const row = rows.find((entry) => entry.puuid === puuid);
    if (row === undefined) throw new Error(`no player row for ${puuid}`);
    return row;
  }

  /** `counts_for_role_inference` for one game, by puuid. */
  async function guardFlags(lcuGameId: number): Promise<Map<string, boolean>> {
    const { data, error } = await db
      .from('game_players')
      .select('counts_for_role_inference, games!inner(lcu_game_id), players!inner(puuid)')
      .eq('games.lcu_game_id', lcuGameId);
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((row) => [row.players.puuid, row.counts_for_role_inference]));
  }

  function lobbyPost(now: Date) {
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'customs night',
      members: puuids.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 3000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    });
    return ingestLobby(db, payload, ownerPlayerId, { groupId: ORIGINAL_GROUP_ID, now });
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    playerIds = puuids.map((puuid) => ids.get(puuid) ?? '');
    ownerPlayerId = ids.get(ownerPuuid) ?? '';

    // Two seeds, so the balancer has a reason to prefer one arrangement over another.
    await db
      .from('players')
      .update({ rank_tier: 'GOLD', rank_division: 'II' })
      .in('id', playerIds.slice(0, 5));
    await db
      .from('players')
      .update({ rank_tier: 'PLATINUM', rank_division: 'IV' })
      .in('id', playerIds.slice(5));

    const { token: raw, tokenHash } = mintCompanionToken();
    await db.from('companion_tokens').insert({
      group_id: ORIGINAL_GROUP_ID,
      player_id: ownerPlayerId,
      token_hash: tokenHash,
      label: `it-${runId}-roles`,
    });
    token = raw;
  });

  afterAll(async () => {
    // The database is shared with every other integration file, so leaving it as we found it is
    // part of the test. `ratings` first: it references the players.
    await db.from('games').delete().in('lcu_game_id', allGameIds);
    await db.from('ratings').delete().in('player_id', playerIds);
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('the fold infers a pair', () => {
    it('is flexible after two games and has a main after the third', async () => {
      // No party id: these games were played from no lobby, so nobody was filled into anything
      // and every one of them counts (the column's default).
      for (const [index, gameId] of looseGameIds.entries()) {
        const response = await postGame(
          post(
            eogBody({
              gameId,
              puuids,
              partyId: null,
              winningSide: index % 2 === 0 ? 100 : 200,
              startedAt: `2026-09-0${index + 2}T20:00:00.000Z`,
              durationS: 1_500 + index,
            }),
          ),
        );
        expect(response.status).toBe(200);
        expect((await response.json()).rated).toBe(true);

        if (index === 1) {
          // Two counted games is under `config.roles.minGames`: flexible, and the count says
          // why. This is the M1.4 newcomer, unchanged — the balancer fills them anywhere.
          const early = await roleRow(ownerPuuid);
          expect(early.main_role).toBeNull();
          expect(early.secondary_role).toBeNull();
          expect(early.roles_counted).toBe(2);
        }
      }

      // The fixture gives every player the same position in all three games, so the answer is
      // that position, with no second role invented.
      const rows = await roleRows();
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        const index = puuids.indexOf(row.puuid);
        expect([row.puuid, row.main_role]).toEqual([row.puuid, ROLES_IN_ORDER[index % 5]]);
        expect(row.secondary_role).toBeNull();
        expect(row.roles_counted).toBe(3);
        expect(row.roles_inferred_at).not.toBeNull();
      }
    });
  });

  describe('a game the balancer filled somebody into does not count', () => {
    it('marks the filled seats and leaves their counted total alone', async () => {
      // Everybody a mid main, by hand. Two of the ten can be given mid by the balancer and the
      // other eight are filled — which is the situation the guard exists for, and it also sets
      // up the other half of the claim: these hand-set roles are overwritten by the recompute
      // at the end of this game, exactly as M1's roles are.
      await db.from('players').update({ main_role: 'mid', secondary_role: null }).in('id', playerIds);

      const opened = await lobbyPost(new Date());
      expect(opened.status).toBe('open');
      // Ingest never balances (2026-10-03): the admin's roll does.
      const rolled = await rollForTest(db, opened.lobbyId, { timeZone: TIME_ZONE });
      if (rolled.outcome !== 'rolled') throw new Error('the lobby did not balance');
      const balanced = opened;
      const split = rolled.balance.split;

      // The game as it would really be played: the ten in the split's own order, each on the
      // seat the balancer gave them.
      const seats = [...split.blue, ...split.red];
      const played = seats.map((seat) => seat.puuid);
      const roles = seats.map((seat) => seat.role);
      const onRole = seats.filter((seat) => seat.role === 'mid').map((seat) => seat.puuid);
      const filled = seats.filter((seat) => seat.role !== 'mid').map((seat) => seat.puuid);
      expect(onRole.length).toBe(2);
      expect(filled.length).toBe(8);

      // One of the filled seats taps the role the split gave them (M3.6). The tap makes that
      // role their main for the night, so the seat is on-role after all and the game counts —
      // which is the whole way a player deliberately moves, as opposed to being filled.
      const tappedSeat = seats.find((seat) => seat.puuid === filled[0]);
      if (tappedSeat === undefined) throw new Error('no filled seat to tap');
      const tapped = tappedSeat.puuid;
      const { error: tapError } = await db
        .from('lobby_members')
        .update({ role_override: tappedSeat.role })
        .eq('lobby_id', balanced.lobbyId)
        .eq('player_id', playerIds[puuids.indexOf(tapped)] as string);
      if (tapError) throw new Error(tapError.message);

      const response = await postGame(
        post({
          ...eogBody({
            gameId: filledGameId,
            puuids: played,
            partyId,
            winningSide: 100,
            startedAt: '2026-09-05T20:00:00.000Z',
            durationS: 1_800,
            roles,
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rated).toBe(true);

      // The guard, on the row, written by the same update that claimed the rating columns.
      const counted = new Set([...onRole, tapped]);
      const flags = await guardFlags(filledGameId);
      for (const puuid of onRole) expect([puuid, flags.get(puuid)]).toEqual([puuid, true]);
      // The tap wins over the stored pair: this seat was a fill a moment ago and is not one now.
      expect([tapped, flags.get(tapped)]).toEqual([tapped, true]);
      for (const puuid of filled.filter((puuid) => puuid !== tapped)) {
        expect([puuid, flags.get(puuid)]).toEqual([puuid, false]);
      }

      for (const row of await roleRows()) {
        const index = puuids.indexOf(row.puuid);
        // The hand-set `mid` is gone from all ten: the first recompute overwrites it.
        expect([row.puuid, row.main_role]).toEqual([row.puuid, ROLES_IN_ORDER[index % 5]]);
        // Four counted games for the two the split put on their own role and for the one who
        // tapped, three for the seven it filled — that game happened to them and did not change
        // who they are.
        expect([row.puuid, row.roles_counted]).toEqual([row.puuid, counted.has(row.puuid) ? 4 : 3]);
      }
    });
  });
}
