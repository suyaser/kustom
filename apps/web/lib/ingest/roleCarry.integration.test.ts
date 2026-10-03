import { randomUUID } from 'node:crypto';
import type { Database, RoleValue } from '@customs/db';
import { companionLobbyPayloadSchema, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nightStart } from '@/lib/night';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * A role for tonight lasts the night, against the local stack (M3.6, acceptance checks 4 and
 * 5, and the reviewer's 2026-09-10 second pass).
 *
 * Everything here goes through the real path: `setRoleTonight` writes the player's preference
 * and the live lobby row, `ingestLobby` applies real companion posts, and Postgres compares the
 * expiry. The five cases are the ones a night cannot be run to re-check:
 *
 *   1. tap in the first cycle of the night, drop out of the client lobby, rejoin — the choice
 *      is back on the new row (the defect the reviewer proved on the stack);
 *   2. change it in the next cycle, then drop and rejoin — the **new** role comes back;
 *   3. clear it, then drop and rejoin — nothing comes back;
 *   4. the first lobby of the next night carries nothing;
 *   5. a tap while the teams are up moves nothing now and lands on the next cycle.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the role for tonight against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { ingestLobby } = await import('./lobby');
  const { ensurePlayers } = await import('./players');
  const { moveLobby } = await import('@/lib/lobbyState');
  const { setRoleTonight, supabaseRoleTonightStore } = await import('@/lib/me/roleTonight');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);

  /**
   * The instant every case here treats as "now": one hour into the night the suite is really
   * running in (M3.28).
   *
   * It used to be a plain `new Date()`. A role for tonight expires at the next 06:00 in
   * `CUSTOMS_NIGHT_TZ` (M3.6), and these cases post lobbies at `now + 20` and `now + 30`
   * minutes — so between 05:30 and 06:00 local the *second* cycle of a case landed in the next
   * night, the preference had expired by the clock the ingest was handed, and two cases failed
   * on a suite that passes at every other hour. Found on 2026-09-10 at 05:34 Cairo, which is
   * the same class of defect as M3.24 in the Discord suite and gets the same treatment.
   *
   * One hour past the boundary leaves 22 hours of headroom for every offset in the file, and it
   * is inside the same night as the database's own `now()`, which is what the carry compares
   * against on the rows these cases write.
   */
  const NIGHT_ANCHOR = new Date(nightStart(new Date(), TIME_ZONE).getTime() + 3_600_000);
  /** Four is enough: nothing here balances, so the roster never has to reach ten. */
  const cast = ['a', 'b', 'c', 'd'].map((letter) => `rc-${runId}-${letter}`);
  const partyIds = new Set<string>();
  let ownerPlayerId = '';

  function party(name: string): string {
    const id = `rc-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function post(partyId: string, members: readonly string[], now: Date) {
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'customs night',
      members: members.map((puuid, index) => ({
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

  async function playerIdOf(puuid: string): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const id = ids.get(puuid);
    if (id === undefined) throw new Error(`no player for ${puuid}`);
    return id;
  }

  /**
   * What the tonight page's control does, through the rules the route runs: the player's
   * preference for the night **and** the live lobby row.
   */
  async function tap(lobbyId: string, puuid: string, role: RoleValue | null, now = new Date()) {
    const result = await setRoleTonight(
      supabaseRoleTonightStore(db),
      { playerId: await playerIdOf(puuid), puuid, isAdmin: false },
      { lobbyId, role },
      { now, timeZone: TIME_ZONE },
    );
    if (!result.ok) throw new Error(`tap refused: ${result.error}`);
    return result.value;
  }

  async function overrideOf(lobbyId: string, puuid: string): Promise<RoleValue | null | 'no row'> {
    const { data, error } = await db
      .from('lobby_members')
      .select('role_override')
      .eq('lobby_id', lobbyId)
      .eq('player_id', await playerIdOf(puuid))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data === null ? 'no row' : data.role_override;
  }

  async function preferenceOf(puuid: string): Promise<{ role: RoleValue | null; until: string | null }> {
    const { data, error } = await db
      .from('players')
      .select('role_tonight, role_tonight_until')
      .eq('puuid', puuid)
      .single();
    if (error) throw new Error(error.message);
    return { role: data.role_tonight, until: data.role_tonight_until };
  }

  /** End the cycle the way a game does, so the party's next post opens a new row (M2.14). */
  async function finish(lobbyId: string): Promise<void> {
    await moveLobby(db, { lobbyId, from: ['open', 'balanced'], to: 'in_game' });
    await moveLobby(db, { lobbyId, from: ['in_game'], to: 'finished' });
  }

  /** A friend closes the client lobby for a moment and comes back. */
  async function leaveAndReturn(partyId: string, puuid: string, at: Date): Promise<void> {
    await post(
      partyId,
      cast.filter((other) => other !== puuid),
      at,
    );
    await post(partyId, cast, new Date(at.getTime() + 60_000));
  }

  beforeAll(async () => {
    await ensurePlayers(
      db,
      cast.map((puuid) => ({ puuid })),
    );
    ownerPlayerId = await playerIdOf(cast[0] ?? '');
  });

  afterAll(async () => {
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', cast);
  });

  describe('the role for tonight against the local Supabase stack', () => {
    it('survives a friend dropping out of the lobby and rejoining in the first cycle', async () => {
      const id = party('first-cycle');
      const now = NIGHT_ANCHOR;
      const friend = cast[1] ?? '';

      const first = await post(id, cast, now);
      await tap(first.lobbyId, friend, 'mid', now);
      expect(await overrideOf(first.lobbyId, friend)).toBe('mid');

      // The row is deleted by the post without them and created again by the next one. There
      // is no previous cycle to read from: the preference on `players` is the only memory.
      await leaveAndReturn(id, friend, new Date(now.getTime() + 60_000));

      expect(await overrideOf(first.lobbyId, friend)).toBe('mid');
      expect((await preferenceOf(friend)).role).toBe('mid');
    });

    it('carries the choice onto the night’s next cycle, and a change replaces it', async () => {
      const id = party('next-cycle');
      const now = NIGHT_ANCHOR;
      const friend = cast[1] ?? '';

      const first = await post(id, cast, now);
      await tap(first.lobbyId, friend, 'mid', now);
      await finish(first.lobbyId);

      const second = await post(id, cast, new Date(now.getTime() + 20 * 60_000));
      expect(second.created).toBe(true);
      expect(await overrideOf(second.lobbyId, friend)).toBe('mid');

      // They change their mind in the second cycle, then drop and rejoin: `top`, not `mid`.
      await tap(second.lobbyId, friend, 'top', new Date(now.getTime() + 21 * 60_000));
      await leaveAndReturn(id, friend, new Date(now.getTime() + 22 * 60_000));

      expect(await overrideOf(second.lobbyId, friend)).toBe('top');
      // And the closed row still says what the last teams were built from.
      expect(await overrideOf(first.lobbyId, friend)).toBe('mid');
    });

    it('lets a friend clear it: nothing comes back on the next post', async () => {
      const id = party('cleared');
      const now = NIGHT_ANCHOR;
      const friend = cast[2] ?? '';

      const first = await post(id, cast, now);
      await tap(first.lobbyId, friend, 'adc', now);
      await tap(first.lobbyId, friend, null, new Date(now.getTime() + 60_000));

      expect(await preferenceOf(friend)).toEqual({ role: null, until: null });

      await leaveAndReturn(id, friend, new Date(now.getTime() + 2 * 60_000));
      expect(await overrideOf(first.lobbyId, friend)).toBeNull();
    });

    it('carries nothing into the first lobby of the next night', async () => {
      const id = party('next-night');
      const now = NIGHT_ANCHOR;
      const friend = cast[3] ?? '';

      const first = await post(id, cast, now);
      await tap(first.lobbyId, friend, 'support', now);
      await finish(first.lobbyId);

      // One minute past 06:00 of the following night, in the configured zone. The preference
      // is still on the row — nothing sweeps it — and it simply stops counting.
      const tomorrow = new Date(nightStart(now, TIME_ZONE).getTime() + 24 * 3_600_000 + 60_000);
      const second = await post(id, cast, tomorrow);

      expect(second.created).toBe(true);
      expect(await overrideOf(second.lobbyId, friend)).toBeNull();
      expect((await preferenceOf(friend)).role).toBe('support');
    });

    it('stores a tap made while the teams are up, and applies it to the next cycle', async () => {
      const id = party('balanced');
      const now = NIGHT_ANCHOR;
      const friend = cast[1] ?? '';

      const first = await post(id, cast, now);
      await moveLobby(db, { lobbyId: first.lobbyId, from: ['open'], to: 'balanced' });

      const tapped = await tap(first.lobbyId, friend, 'jungle', new Date(now.getTime() + 60_000));
      // The route says so, and the page prints it: stored, and the teams do not move.
      expect(tapped.status).toBe('balanced');
      expect(await overrideOf(first.lobbyId, friend)).toBe('jungle');

      await finish(first.lobbyId);
      const second = await post(id, cast, new Date(now.getTime() + 30 * 60_000));
      expect(await overrideOf(second.lobbyId, friend)).toBe('jungle');
    });
  });
}
