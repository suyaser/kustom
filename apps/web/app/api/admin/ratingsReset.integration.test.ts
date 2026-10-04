import { randomUUID } from 'node:crypto';
import { provisionalSeed } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FINISH_TONIGHT_FIRST, ONLY_OWNER_RESETS, RESET_NEEDS_SLUG } from '@/lib/admin/ratingsReset';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { mintCompanionToken } from '@/lib/companionAuth';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The owner's `Reset ratings` (M14.18) against the local stack: the route, the `0027` definer
 * function, the live fold and `rebuild-ratings --group` after it, and the Discord post.
 *
 * **Needs `0027` applied** (and runs the same before or after `0026`). Until the lead applies it,
 * the file skips with that sentence instead of failing; without the stack it skips like every
 * other integration file.
 *
 * Group R is reset: Rae owns it, Ari is its admin, eight members. Group O is another group Rae has
 * a rating in, which the reset must not touch.
 */

const stack = await resolveLocalStack();
const probe =
  stack === null
    ? null
    : await createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } })
        .from('groups')
        .select('ratings_since')
        .limit(1);
const migrated = probe !== null && probe.error === null;

if (stack === null || !migrated) {
  describe.skip('Reset ratings against the local Supabase stack', () => {
    it(
      stack === null
        ? 'needs the local stack: run `pnpm db:start`'
        : 'needs migration 0027_ratings_reset.sql applied to the local stack (the lead applies it after 0026)',
      () => {
        expect(true).toBe(true);
      },
    );
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  const { ratingsResetRoute } = await import('./ratings/reset/handler');
  const { POST: postGame } = await import('../companion/game/route');
  const { rebuildRatings } = await import('@/lib/ingest/rebuild');
  const { loadBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const puuids = testPuuids(runId);
  const players: string[] = [];
  const discordIds = puuids.map((_, index) => `7${digits}${String(index).padStart(3, '0')}`);
  const OWNER = 0;
  const ADMIN = 1;
  const MEMBER = 2;
  const groups = { r: '', o: '' };
  let slug = '';
  let token = '';
  const base = testGameId();
  const beforeGames = [base + 1, base + 2];
  const afterGame = base + 3;
  const lateOldGame = base + 4;
  const allGames = [...beforeGames, afterGame, lateOldGame];
  const webhookCalls: unknown[] = [];

  const fakeDiscord: typeof fetch = async (_url, init) => {
    webhookCalls.push(JSON.parse(String(init?.body ?? 'null')));
    return new Response(null, { status: 204 });
  };

  function as(index: number): AdminRouteOptions & { fetchImpl: typeof fetch } {
    const user: SessionUserLike = {
      id: randomUUID(),
      email: `${discordIds[index]}@example.invalid`,
      identities: [
        { id: discordIds[index] as string, provider: 'discord', identity_data: { full_name: 'tester' } },
      ],
    };
    return {
      getClient: () => db,
      fetchImpl: fakeDiscord,
      authorize: async (_request, client, groupId): Promise<AdminAuthResult> =>
        authorizeAdmin({
          resolveSessionUser: async () => user,
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
        }),
    };
  }

  async function reset(index: number, confirmSlug: string) {
    const response = await ratingsResetRoute(as(index))(
      new Request('http://localhost/api/admin/ratings/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: groups.r, confirmSlug }),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  function post(body: unknown): Request {
    return new Request('http://localhost/api/companion/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  async function ratingsOf(groupId: string) {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games, wins')
      .eq('group_id', groupId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function columnsOf(lcuGameIds: readonly number[]) {
    const { data: games } = await db.from('games').select('id').in('lcu_game_id', lcuGameIds);
    const { data, error } = await db
      .from('game_players')
      .select('game_id, player_id, mu_before, sigma_before, mu_after, sigma_after')
      .in(
        'game_id',
        (games ?? []).map((game) => game.id),
      )
      .order('game_id')
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function backdateGames(minutes: number): Promise<void> {
    const at = new Date(Date.now() - minutes * 60_000).toISOString();
    const { error } = await db.from('games').update({ created_at: at }).eq('group_id', groups.r);
    if (error) throw new Error(error.message);
  }

  /** Nine decimals: the rebuild leaves rows inside `RATING_EPSILON` alone (see rebuild.integration). */
  const within = (value: unknown) =>
    JSON.stringify(value, (_key, v) => (typeof v === 'number' ? Number(v.toFixed(9)) : v));

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    for (const [index, puuid] of puuids.entries()) {
      const id = ids.get(puuid) ?? '';
      players.push(id);
      const { error } = await db
        .from('players')
        .update({ discord_id: discordIds[index] as string })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }
    Object.assign(groups, await createTestGroups(db, runId, ['r', 'o'] as const));
    slug = `it-${runId}-r`.toLowerCase();
    for (const [index, id] of players.entries()) {
      await setTestMembership(
        db,
        groups.r,
        id,
        index === OWNER ? 'owner' : index === ADMIN ? 'admin' : 'member',
      );
    }
    await setTestMembership(db, groups.o, players[OWNER] as string, 'member');
    const other = await db.from('ratings').insert({
      group_id: groups.o,
      player_id: players[OWNER] as string,
      mu: 31.5,
      sigma: 4.25,
      games: 12,
      wins: 7,
    });
    if (other.error) throw new Error(other.error.message);

    const minted = mintCompanionToken();
    const tokenRow = await db.from('companion_tokens').insert({
      group_id: groups.r,
      player_id: players[OWNER] as string,
      token_hash: minted.tokenHash,
      label: `it-${runId}-reset`,
    });
    if (tokenRow.error) throw new Error(tokenRow.error.message);
    token = minted.token;

    // Two rated games before the reset.
    for (const [index, gameId] of beforeGames.entries()) {
      const response = await postGame(
        post(
          eogBody({
            gameId,
            puuids,
            partyId: null,
            winningSide: index === 0 ? 100 : 200,
            // The second one two hours ago: a recent pre-reset game All time has to leave out.
            startedAt:
              index === 0 ? '2026-09-01T20:00:00.000Z' : new Date(Date.now() - 2 * 3_600_000).toISOString(),
            durationS: 1_800,
          }),
        ),
      );
      expect(response.status).toBe(200);
    }
    // The webhook is configured only now, so no game post above reached a real Discord.
    const config = await db.from('discord_config').upsert({
      group_id: groups.r,
      guild_id: `9${digits}`,
      webhook_url: 'https://discord.com/api/webhooks/1/it-reset-fake',
    });
    if (config.error) throw new Error(config.error.message);
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', allGames);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', puuids);
  });

  describe('refusals, each with its sentence (acceptance 4)', () => {
    it('refuses a wrong slug, checked on the server', async () => {
      await backdateGames(60);
      const before = await ratingsOf(groups.r);
      expect(await reset(OWNER, 'not-the-slug')).toEqual({
        status: 400,
        json: { ok: false, error: RESET_NEEDS_SLUG },
      });
      expect(await ratingsOf(groups.r)).toEqual(before);
    });

    it('refuses an admin who is not the owner', async () => {
      expect(await reset(ADMIN, slug)).toEqual({
        status: 403,
        json: { ok: false, error: ONLY_OWNER_RESETS },
      });
    });

    it('refuses a member at the admin gate', async () => {
      expect(await reset(MEMBER, slug)).toEqual({
        status: 403,
        json: { ok: false, error: NOT_A_GROUP_ADMIN },
      });
    });

    it('refuses while a lobby is live', async () => {
      const { data: lobby } = await db
        .from('lobbies')
        .insert({ group_id: groups.r, lcu_party_id: `it-${runId}-live`, status: 'in_game' })
        .select('id')
        .single();
      try {
        expect(await reset(OWNER, slug)).toEqual({
          status: 409,
          json: { ok: false, error: FINISH_TONIGHT_FIRST },
        });
      } finally {
        await db
          .from('lobbies')
          .delete()
          .eq('id', lobby?.id ?? '');
      }
    });

    it('refuses within 15 minutes of a game landing', async () => {
      await backdateGames(5);
      expect(await reset(OWNER, slug)).toEqual({
        status: 409,
        json: { ok: false, error: FINISH_TONIGHT_FIRST },
      });
      await backdateGames(60);
      expect((await ratingsOf(groups.r)).length).toBe(10);
      expect(webhookCalls).toHaveLength(0);
    });
  });

  describe('the reset', () => {
    let historyBefore: unknown[] = [];

    it('puts everyone back to the seed, posts once, and leaves the other group alone (acceptance 2, 5, 6)', async () => {
      historyBefore = await columnsOf(beforeGames);
      const otherBefore = await ratingsOf(groups.o);

      const answer = await reset(OWNER, slug);
      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({ ok: true, groupId: groups.r, post: 'posted' });

      const { data: group } = await db.from('groups').select('ratings_since').eq('id', groups.r).single();
      expect(group?.ratings_since).toBeTruthy();
      // No row is the seed (M5.7): every member's group rating is `provisionalSeed()` now.
      expect(await ratingsOf(groups.r)).toEqual([]);
      expect(await ratingsOf(groups.o)).toEqual(otherBefore);
      // History is untouched.
      expect(await columnsOf(beforeGames)).toEqual(historyBefore);

      expect(webhookCalls).toHaveLength(1);
      const description = (webhookCalls[0] as { embeds: { description: string }[] }).embeds[0]?.description;
      expect(description).toMatch(/^Ratings were reset\. Everyone starts at 1200 again\./);
    });

    it('folds a later game from the seed', async () => {
      // The webhook goes, so the game's result post does not try a real Discord.
      await db.from('discord_config').delete().eq('group_id', groups.r);
      const response = await postGame(
        post(
          eogBody({
            gameId: afterGame,
            puuids,
            partyId: null,
            startedAt: new Date().toISOString(),
            durationS: 1_800,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rated: true });

      const seed = provisionalSeed();
      const rows = await columnsOf([afterGame]);
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect([row.mu_before, row.sigma_before]).toEqual([seed.mu, seed.sigma]);
      }
      const ratings = await ratingsOf(groups.r);
      expect(ratings).toHaveLength(10);
      expect(ratings.every((row) => row.games === 1)).toBe(true);
    });

    it('never rates a game that started before the reset, even one posted after it', async () => {
      const response = await postGame(
        post(
          eogBody({
            gameId: lateOldGame,
            puuids,
            partyId: null,
            startedAt: '2026-09-03T20:00:00.000Z',
            durationS: 1_800,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rated: false, reason: 'before-reset' });
      expect((await columnsOf([lateOldGame])).every((row) => row.mu_after === null)).toBe(true);
    });

    it('rebuild-ratings --group reproduces the same numbers and leaves history alone (acceptance 3)', async () => {
      const ratings = await ratingsOf(groups.r);
      const after = await columnsOf([afterGame]);

      const result = await rebuildRatings(db, { groupId: groups.r, force: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.considered).toBe(1);
      expect(result.report.ratingsSince).toBeTruthy();

      expect(within(await ratingsOf(groups.r))).toBe(within(ratings));
      expect(within(await columnsOf([afterGame]))).toBe(within(after));
      expect(await columnsOf(beforeGames)).toEqual(historyBefore);
      expect((await columnsOf([lateOldGame])).every((row) => row.mu_after === null)).toBe(true);
    });

    it('the board: All time reads Since <day> and counts only games since the reset', async () => {
      const anon = createPublicClient();
      const allTime = await loadBoard(anon, { window: 'all-time', groupId: groups.r, timeZone: 'UTC' });
      expect(allTime.resetDay).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
      expect(allTime.range).toBeNull();
      expect(allTime.games).toBe(1);

      // The weeks are never clipped to the reset (the weekly rating restarts every Sunday), and
      // no window's range half talks about the reset any more: the month form went with M14.48.
      const week = await loadBoard(anon, { window: 'this-week', groupId: groups.r, timeZone: 'UTC' });
      expect(week.range ?? '').not.toContain('since the reset');
    });
  });
}
