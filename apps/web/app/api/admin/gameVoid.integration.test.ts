import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { gameVoidResponseSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FINISH_TONIGHT_FIRST } from '@/lib/admin/homeCopy';
import { NO_SUCH_GAME } from '@/lib/admin/voidGame';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { VOID_NOT_RATED, VOIDED_NOTE } from '@/lib/games/copy';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ingestEogGame } from '@/lib/ingest/game';
import { ensurePlayers } from '@/lib/ingest/players';
import { rateStoredGame } from '@/lib/ingest/rating';
import { rebuildRatings } from '@/lib/ingest/rebuild';
import { eogPayload, testGameId } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `POST /api/admin/games/void` (M23.1) against the local stack: the real admin-or-owner check on
 * the body's group, the rebuild guard (nothing written while it holds), the void folding the group
 * as if the game was never played (compared with a group that never had it), a second tap writing
 * nothing, a restore putting the numbers back, another group's game a 404, and a game played not
 * rated refused.
 *
 * Group V: Rae owns it, Ari is its admin, Mo a member; good game, bad game, good game. Group B: the
 * same ten and the two good games only.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('Void game against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  const { gameVoidRoute } = await import('./games/void/handler');
  const { loadGamesList } = await import('@/lib/games/list');
  const { loadGameDetail } = await import('@/lib/games/detail');
  const { createPublicClient } = await import('@/lib/publicClient');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-gv${index}`);
  const discordIds = ten.map((_, index) => `8${digits}${String(index).padStart(3, '0')}`);
  const OWNER = 0;
  const ADMIN = 1;
  const MEMBER = 2;
  const shuffled = [
    ten[0],
    ten[5],
    ten[1],
    ten[6],
    ten[2],
    ten[7],
    ten[3],
    ten[8],
    ten[4],
    ten[9],
  ] as string[];
  const lcuIds: number[] = [];
  const groups = { v: '', b: '' };
  let bad = '';
  let baseGame = '';

  const night = [
    { at: '2026-10-04T20:00:00.000Z', puuids: ten, winningSide: 100 as const, bad: false },
    // Long enough to rate (M23.1's early-end is its own test): the void is the only thing in its way.
    { at: '2026-10-04T21:00:00.000Z', puuids: shuffled, winningSide: 200 as const, bad: true },
    { at: '2026-10-04T22:00:00.000Z', puuids: ten, winningSide: 200 as const, bad: false },
  ];

  async function play(groupId: string, withBad: boolean): Promise<void> {
    for (const game of night) {
      if (game.bad && !withBad) continue;
      const gameId = testGameId();
      lcuIds.push(gameId);
      const stored = await ingestEogGame(
        db,
        eogPayload({
          gameId,
          puuids: game.puuids,
          startedAt: game.at,
          winningSide: game.winningSide,
          durationS: 1_900,
          raw: { gameMode: 'CLASSIC' },
        }),
        { groupId },
      );
      if (stored.outcome !== 'stored') throw new Error('not stored');
      expect((await rateStoredGame(db, stored.gameId)).rated).toBe(true);
      if (game.bad) bad = stored.gameId;
      else if (!withBad) baseGame = stored.gameId;
    }
  }

  function as(index: number | null): AdminRouteOptions {
    const user: SessionUserLike | null =
      index === null
        ? null
        : {
            id: randomUUID(),
            email: `${discordIds[index]}@example.invalid`,
            identities: [
              {
                id: discordIds[index] as string,
                provider: 'discord',
                identity_data: { full_name: 'tester' },
              },
            ],
          };
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<AdminAuthResult> =>
        authorizeAdmin({
          resolveSessionUser: async () => user,
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
        }),
    };
  }

  async function call(index: number | null, body: Record<string, unknown>) {
    const response = await gameVoidRoute(as(index))(
      new Request('http://localhost/api/admin/games/void', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: groups.v, gameId: bad, ...body }),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  const round = (value: number | null) => (value === null ? null : Math.round(value * 1e10) / 1e10);

  async function ratingsOf(groupId: string) {
    const { data, error } = await db
      .from('ratings')
      .select('mu, sigma, games, wins, r, players!inner(puuid)')
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    return Object.fromEntries(
      (data ?? [])
        .map((row) => [
          row.players.puuid,
          { mu: round(row.mu), sigma: round(row.sigma), games: row.games, wins: row.wins, r: round(row.r) },
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }

  async function badRow() {
    const { data, error } = await db.from('games').select('rated, voided_at').eq('id', bad).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function badColumns() {
    const { data, error } = await db
      .from('game_players')
      .select('mu_after, r_after, week_r_after')
      .eq('game_id', bad);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  let original: Awaited<ReturnType<typeof ratingsOf>> = {};

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    Object.assign(groups, await createTestGroups(db, runId, ['v', 'b'] as const));
    for (const groupId of Object.values(groups)) await pinTestGroupMode(db, groupId, 'normal');
    for (const [index, puuid] of ten.entries()) {
      const id = ids.get(puuid) ?? '';
      const { error } = await db
        .from('players')
        .update({ discord_id: discordIds[index] as string })
        .eq('id', id);
      if (error) throw new Error(error.message);
      await setTestMembership(
        db,
        groups.v,
        id,
        index === OWNER ? 'owner' : index === ADMIN ? 'admin' : 'member',
      );
    }
    await play(groups.v, true);
    await play(groups.b, false);
    await rebuildRatings(db, { groupId: groups.v, force: true });
    await rebuildRatings(db, { groupId: groups.b, force: true });
    original = await ratingsOf(groups.v);
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', lcuIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', ten);
  });

  it('the bad game moved the numbers (the premise)', async () => {
    expect(original).not.toEqual(await ratingsOf(groups.b));
  });

  it('refuses a visitor (401), a member (403) and a bad body (400), and writes nothing', async () => {
    expect((await call(null, { action: 'void' })).status).toBe(401);
    expect((await call(MEMBER, { action: 'void' })).status).toBe(403);
    expect((await call(ADMIN, { action: 'nope' })).status).toBe(400);
    expect((await call(ADMIN, { action: 'void', gameId: 'not-a-uuid' })).status).toBe(400);
    expect(await badRow()).toEqual({ rated: true, voided_at: null });
  });

  it("refuses while a game landed in the last 15 minutes, before writing (the rebuild's guard)", async () => {
    const refused = await call(ADMIN, { action: 'void' });
    expect(refused).toEqual({ status: 409, json: expect.objectContaining({ error: FINISH_TONIGHT_FIRST }) });
    expect(await badRow()).toEqual({ rated: true, voided_at: null });
    expect(await ratingsOf(groups.v)).toEqual(original);
  });

  it("is a 404 for another group's game", async () => {
    const at = new Date(Date.now() - 60 * 60_000).toISOString();
    for (const groupId of Object.values(groups)) {
      const { error } = await db.from('games').update({ created_at: at }).eq('group_id', groupId);
      if (error) throw new Error(error.message);
    }
    const other = await call(ADMIN, { action: 'void', gameId: baseGame });
    expect(other).toEqual({ status: 404, json: expect.objectContaining({ error: NO_SUCH_GAME }) });
  });

  it('an admin voids it: ratings are as if it was never played, and it stays stored', async () => {
    const voided = await call(ADMIN, { action: 'void' });
    expect(voided.status).toBe(200);
    expect(gameVoidResponseSchema.parse(voided.json)).toEqual({
      ok: true,
      voided: true,
      changed: true,
      folded: true,
    });
    expect(await ratingsOf(groups.v)).toEqual(await ratingsOf(groups.b));
    const row = await badRow();
    expect(row.rated).toBe(false);
    expect(row.voided_at).not.toBeNull();
    const columns = await badColumns();
    expect(columns).toHaveLength(10);
    expect(columns.every((c) => c.mu_after === null && c.r_after === null && c.week_r_after === null)).toBe(
      true,
    );
  });

  it('stays on Games and its page, marked voided (anon reads)', async () => {
    const anon = createPublicClient();
    const list = await loadGamesList(anon, {
      groupId: groups.v,
      viewerPuuid: null,
      timeZone: 'Europe/London',
      filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
    });
    expect(list.items).toHaveLength(3);
    expect(list.items.filter((item) => item.ruleNote === VOIDED_NOTE).map((item) => item.id)).toEqual([bad]);
    const detail = await loadGameDetail(anon, {
      gameId: bad,
      groupId: groups.v,
      viewerPuuid: null,
      timeZone: 'Europe/London',
    });
    expect(detail).toMatchObject({ voided: true, ratedStamp: false, rated: false });
  });

  it('a second void writes nothing and moves nothing', async () => {
    const { data: before } = await db
      .from('ratings')
      .select('player_id, updated_at')
      .eq('group_id', groups.v);
    const again = await call(OWNER, { action: 'void' });
    expect(again.json).toEqual({ ok: true, voided: true, changed: false, folded: false });
    const { data: after } = await db.from('ratings').select('player_id, updated_at').eq('group_id', groups.v);
    expect(after).toEqual(before);
  });

  it('the owner restores it: the numbers come back', async () => {
    const restored = await call(OWNER, { action: 'restore' });
    expect(restored.json).toEqual({ ok: true, voided: false, changed: true, folded: true });
    expect(await badRow()).toEqual({ rated: true, voided_at: null });
    expect(await ratingsOf(groups.v)).toEqual(original);
    expect((await badColumns()).every((c) => c.r_after !== null && c.week_r_after !== null)).toBe(true);
    // A second restore is a no-op.
    expect((await call(OWNER, { action: 'restore' })).json).toEqual({
      ok: true,
      voided: false,
      changed: false,
      folded: false,
    });
  });

  it('refuses to void a game played not rated (a restore would rate it)', async () => {
    const { error } = await db.from('games').update({ rated: false }).eq('id', bad);
    if (error) throw new Error(error.message);
    const refused = await call(ADMIN, { action: 'void' });
    expect(refused).toEqual({ status: 409, json: expect.objectContaining({ error: VOID_NOT_RATED }) });
    expect(await badRow()).toEqual({ rated: false, voided_at: null });
  });
}
