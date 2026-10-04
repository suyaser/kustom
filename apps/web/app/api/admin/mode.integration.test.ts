import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { mintCompanionToken } from '@/lib/companionAuth';
import { FEARLESS_TITLE } from '@/lib/fearless/copy';
import { loadFearless } from '@/lib/fearless/load';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.29 against the local stack: the group's mode (`0024_group_mode.sql`), `POST
 * /api/admin/mode`, the ingest stamp, the frozen fearless pool, the Discord gate, the reset in
 * Normal and the overlay's `enabled`.
 *
 * Group F is the main stage: Fay owns it, Ali is an admin, Mo is a member, and the ten who play
 * (f0..f9) include all three. Group N is the same ten-seat game played in Normal by ten other
 * fresh players, to show a Normal game rates exactly like a Fearless one. Group X's admin, Xena,
 * is nobody in F. Both F and N have a webhook on the test server below.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`), and fails loudly on a stack that
 * has not applied 0024 (no `group_modes`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the group mode against the local Supabase stack', () => {
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
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { setGroupModeRoute } = await import('./mode/handler');
  const { fearlessResetRoute } = await import('./fearless/reset/handler');
  // Importing the game route registers the Discord hooks (`lib/ingest/discord.ts`).
  const { POST: postGame } = await import('../companion/game/route');
  const { GET: getOverlay } = await import('../overlay/route');
  const { postResultForGame } = await import('@/lib/discord/post');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const fTen = Array.from({ length: 10 }, (_, index) => `it-${runId}-md-f${index}`);
  const nTen = Array.from({ length: 10 }, (_, index) => `it-${runId}-md-n${index}`);
  const xena = `it-${runId}-md-xena`;
  const everyPuuid = [...fTen, ...nTen, xena];
  const discordOf = new Map(
    everyPuuid.map((puuid, index) => [puuid, `7${digits}${String(index).padStart(3, '0')}`]),
  );
  const idOf = new Map<string, string>();
  const groups = { f: '', n: '', x: '' };
  const tokens = { f: '', n: '' };
  const gameIds: number[] = [];

  /** f0 owns F, f1 is an admin, f2 a member; n0 owns N; Xena administers X only. */
  const FAY = fTen[0] ?? '';
  const ALI = fTen[1] ?? '';
  const MO = fTen[2] ?? '';
  const NOOR = nTen[0] ?? '';

  let server: Server | null = null;
  let webhookUrl = '';
  let posts: { path: string; body: Record<string, unknown> }[] = [];

  function as(puuid: string | null): AdminRouteOptions {
    const user: SessionUserLike | null =
      puuid === null
        ? null
        : {
            id: randomUUID(),
            email: `${puuid}@example.invalid`,
            identities: [{ id: discordOf.get(puuid) ?? '', provider: 'discord', identity_data: {} }],
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

  interface Answer {
    status: number;
    json: Record<string, unknown>;
  }

  async function call(route: (request: Request) => Promise<Response>, body: unknown): Promise<Answer> {
    const response = await route(
      new Request('http://localhost/api/admin/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  const setMode = (actor: string | null, mode: unknown, groupId = groups.f) =>
    call(setGroupModeRoute(as(actor)), { groupId, mode });

  /** A Rift game whose ten picks are `firstChampion` .. `firstChampion + 9`. */
  function game(ten: readonly string[], firstChampion: number, startedAt: string): Record<string, unknown> {
    const gameId = testGameId() + gameIds.length;
    gameIds.push(gameId);
    const body = eogBody({ gameId, puuids: ten, startedAt });
    // `raw.participants` is the same array, so the stored blob agrees with the columns.
    (body.participants as Record<string, unknown>[]).forEach((participant, index) => {
      participant.championId = firstChampion + index;
    });
    return body;
  }

  async function play(body: Record<string, unknown>, token: string): Promise<string> {
    const response = await postGame(
      new Request('http://localhost/api/companion/game', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: true, rated: true });
    const { data, error } = await db
      .from('games')
      .select('id')
      .eq('lcu_game_id', Number(body.gameId))
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function stampOf(gameId: string): Promise<string | null> {
    const { data, error } = await db.from('games').select('mode').eq('id', gameId).single();
    if (error) throw new Error(error.message);
    return data.mode;
  }

  async function modeRow(groupId: string) {
    const { data, error } = await db
      .from('group_modes')
      .select('mode, set_by, updated_at')
      .eq('group_id', groupId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function poolIds(groupId: string): Promise<number[]> {
    return (await loadFearless(db, groupId)).champions.map((champion) => champion.id).sort((a, b) => a - b);
  }

  async function overlay(puuid: string, groupId: string): Promise<Record<string, unknown>> {
    const response = await getOverlay(
      new Request(`http://localhost/api/overlay?puuid=${encodeURIComponent(puuid)}&group=${groupId}`),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  beforeAll(async () => {
    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({
          path: incoming.url ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;

    const ids = await ensurePlayers(
      db,
      everyPuuid.map((puuid) => ({ puuid })),
    );
    for (const puuid of everyPuuid) {
      const id = ids.get(puuid) ?? '';
      idOf.set(puuid, id);
      const { error } = await db
        .from('players')
        .update({ discord_id: discordOf.get(puuid) ?? null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }

    Object.assign(
      groups,
      await createTestGroups(db, runId, ['mdf', 'mdn', 'mdx'] as const).then((made) => ({
        f: made.mdf,
        n: made.mdn,
        x: made.mdx,
      })),
    );
    await setTestMembership(db, groups.f, idOf.get(FAY) ?? '', 'owner');
    await setTestMembership(db, groups.f, idOf.get(ALI) ?? '', 'admin');
    await setTestMembership(db, groups.f, idOf.get(MO) ?? '', 'member');
    await setTestMembership(db, groups.n, idOf.get(NOOR) ?? '', 'owner');
    await setTestMembership(db, groups.x, idOf.get(xena) ?? '', 'admin');

    for (const key of ['f', 'n'] as const) {
      const config = await db.from('discord_config').insert({
        guild_id: `it-${runId}-md-${key}`,
        webhook_url: `${webhookUrl}-${key}`,
        group_id: groups[key],
      });
      if (config.error) throw new Error(config.error.message);
      const { token, tokenHash } = mintCompanionToken();
      const host = key === 'f' ? FAY : NOOR;
      const minted = await db.from('companion_tokens').insert({
        player_id: idOf.get(host) ?? '',
        token_hash: tokenHash,
        label: `md-${runId}`,
        group_id: groups[key],
      });
      if (minted.error) throw new Error(minted.error.message);
      tokens[key] = token;
    }
  });

  beforeEach(() => {
    posts = [];
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', everyPuuid);
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  // -------------------------------------------------------------------------
  // Acceptance 1: the migration
  // -------------------------------------------------------------------------

  describe('0024: every group has a mode, every stored game a stamp', () => {
    it('gives every group a group_modes row, and the original group reads fearless', async () => {
      const [{ count: groupCount }, { count: modeCount }] = await Promise.all([
        db.from('groups').select('id', { count: 'exact', head: true }),
        db.from('group_modes').select('group_id', { count: 'exact', head: true }),
      ]);
      expect(modeCount).toBe(groupCount);
      expect((await modeRow(ORIGINAL_GROUP_ID))?.mode).toBe('fearless');
    });

    // Since 0030 (M14.46) a brand-new group starts on Normal: `newGroupsStartNormal.integration.test.ts`
    // (packages/db) owns that. `createTestGroups` puts these on Fearless, set by nobody, so the
    // stages below start where a group that is playing Fearless starts, before and after 0030.
    it('the test groups start on fearless, set by nobody', async () => {
      for (const groupId of [groups.n, groups.x]) {
        expect(await modeRow(groupId)).toMatchObject({ mode: 'fearless', set_by: null });
      }
    });

    it("stamps no stored game null, and none of the original group's games other than fearless, so its pool is unchanged", async () => {
      const unstamped = await db.from('games').select('id', { count: 'exact', head: true }).is('mode', null);
      expect(unstamped.error).toBeNull();
      expect(unstamped.count).toBe(0);
      const notFearless = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', ORIGINAL_GROUP_ID)
        .neq('mode', 'fearless');
      expect(notFearless.count).toBe(0);
    });

    it('refuses a mode value public.modes does not list', async () => {
      const { error } = await db.from('group_modes').update({ mode: 'bravery' }).eq('group_id', groups.x);
      // Since 0032 the standing-mode check (23514) fires before the foreign key (23503).
      expect(['23503', '23514']).toContain(error?.code);
    });

    it('refuses a rule as a standing mode (0032: group_modes_standing)', async () => {
      const { error } = await db.from('group_modes').update({ mode: 'class' }).eq('group_id', groups.x);
      expect(error?.code).toBe('23514');
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 5: the route
  // -------------------------------------------------------------------------

  describe('POST /api/admin/mode', () => {
    it('lets the owner and an admin set it, and posts nothing to Discord', async () => {
      const byOwner = await setMode(FAY, 'normal');
      expect(byOwner).toMatchObject({ status: 200, json: { ok: true, mode: 'normal', changed: true } });
      expect(await modeRow(groups.f)).toMatchObject({ mode: 'normal', set_by: idOf.get(FAY) });

      const byAdmin = await setMode(ALI, 'fearless');
      expect(byAdmin).toMatchObject({ status: 200, json: { ok: true, mode: 'fearless', changed: true } });
      expect(await modeRow(groups.f)).toMatchObject({ mode: 'fearless', set_by: idOf.get(ALI) });

      expect(posts).toEqual([]);
    });

    it('a repeat of the current mode is a 200 that writes nothing', async () => {
      const before = await modeRow(groups.f);
      const again = await setMode(FAY, 'fearless');
      expect(again).toMatchObject({ status: 200, json: { ok: true, mode: 'fearless', changed: false } });
      expect(await modeRow(groups.f)).toEqual(before);
    });

    it('refuses a member (403), a signed-out caller (401) and an admin of another group (403)', async () => {
      const before = await modeRow(groups.f);

      const member = await setMode(MO, 'normal');
      expect([member.status, member.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);
      const signedOut = await setMode(null, 'normal');
      expect(signedOut.status).toBe(401);
      const otherGroup = await setMode(xena, 'normal');
      expect([otherGroup.status, otherGroup.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);

      expect(await modeRow(groups.f)).toEqual(before);
    });

    it('refuses a malformed body or a mode M14 does not know with a 400', async () => {
      const before = await modeRow(groups.f);
      for (const body of [
        { groupId: groups.f, mode: 'class' },
        { groupId: groups.f, mode: 'Normal' },
        { groupId: groups.f },
        { groupId: groups.f, mode: 1 },
      ]) {
        const answer = await call(setGroupModeRoute(as(FAY)), body);
        expect([JSON.stringify(body), answer.status]).toEqual([JSON.stringify(body), 400]);
      }
      const notJson = await call(setGroupModeRoute(as(FAY)), '{not json');
      expect(notJson.status).toBe(400);
      expect(await modeRow(groups.f)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptances 2, 3, 4: Fearless, game A, Normal, game B, Fearless
  // -------------------------------------------------------------------------

  describe('Normal freezes the pool, Fearless resumes it', () => {
    let gameA = '';
    let gameB = '';

    it('Fearless: game A is stamped fearless, joins the pool, and is followed by the fearless post', async () => {
      expect((await modeRow(groups.f))?.mode).toBe('fearless');
      gameA = await play(game(fTen, 1, minutesAgo(3)), tokens.f);

      expect(await stampOf(gameA)).toBe('fearless');
      expect(await poolIds(groups.f)).toEqual(range(1, 10));
      expect(posts.map((post) => post.path)).toEqual(['/webhook-f', '/webhook-f']);
      const second = ((posts[1]?.body.embeds ?? []) as Record<string, unknown>[])[0];
      expect(second?.title).toBe(FEARLESS_TITLE);
    });

    it("Fearless: the overlay is enabled with today's list", async () => {
      const body = await overlay(FAY, groups.f);
      const fearless = body.fearless as { enabled: boolean; champions: { id: number }[]; resetAt: string };
      expect(fearless.enabled).toBe(true);
      expect(fearless.champions.map((champion) => champion.id).sort((a, b) => a - b)).toEqual(range(1, 10));
    });

    it('Normal: game B is stamped normal, stays out of the pool, and gets the result post only', async () => {
      expect((await setMode(ALI, 'normal')).status).toBe(200);
      expect(posts).toEqual([]);

      gameB = await play(game(fTen, 11, minutesAgo(2)), tokens.f);

      expect(await stampOf(gameB)).toBe('normal');
      expect(posts.map((post) => post.path)).toEqual(['/webhook-f']);
      const only = ((posts[0]?.body.embeds ?? []) as Record<string, unknown>[])[0];
      expect(only?.title).not.toBe(FEARLESS_TITLE);

      // The paused pool is still the pool after A, and the view says Normal.
      const pool = await loadFearless(db, groups.f);
      expect(pool.mode).toBe('normal');
      expect(pool.champions.map((champion) => champion.id).sort((a, b) => a - b)).toEqual(range(1, 10));
    });

    it('Normal: the overlay is not enabled and lists no champions', async () => {
      const body = await overlay(FAY, groups.f);
      expect(body.fearless).toMatchObject({ enabled: false, champions: [] });
    });

    it("Normal: the result embed is byte-identical to the same game's in Fearless", async () => {
      const origin = { requestOrigin: 'https://kustom.example' };
      expect((await postResultForGame(db, gameB, origin)).status).toBe('posted');
      const { error } = await db.from('games').update({ mode: 'fearless' }).eq('id', gameB);
      if (error) throw new Error(error.message);
      try {
        expect((await postResultForGame(db, gameB, origin)).status).toBe('posted');
      } finally {
        await db.from('games').update({ mode: 'normal' }).eq('id', gameB);
      }
      expect(posts).toHaveLength(2);
      expect(JSON.stringify(posts[1]?.body)).toBe(JSON.stringify(posts[0]?.body));
    });

    it("Fearless again: the pool equals the pool after A, and B's champions are not in it", async () => {
      expect((await setMode(FAY, 'fearless')).json).toMatchObject({ mode: 'fearless', changed: true });
      expect(await poolIds(groups.f)).toEqual(range(1, 10));
      expect(await stampOf(gameB)).toBe('normal');
      expect(posts).toEqual([]);
    });

    it('a second companion posting game B again keeps its normal stamp', async () => {
      const { data } = await db.from('games').select('lcu_game_id').eq('id', gameB).single();
      const again = game(fTen, 11, minutesAgo(2));
      again.gameId = data?.lcu_game_id;
      (again.raw as Record<string, unknown>).gameId = data?.lcu_game_id;
      const response = await postGame(
        new Request('http://localhost/api/companion/game', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.f}` },
          body: JSON.stringify(again),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: false });
      expect(await stampOf(gameB)).toBe('normal');
      expect(await poolIds(groups.f)).toEqual(range(1, 10));
    });

    it('a Normal Rift game rates exactly like a Fearless one: same input, same deltas', async () => {
      // Group N is on Normal and has never played; its ten are as fresh as F's were before game A.
      expect((await setMode(NOOR, 'normal', groups.n)).status).toBe(200);
      const gameN = await play(game(nTen, 1, minutesAgo(3)), tokens.n);
      expect(await stampOf(gameN)).toBe('normal');

      async function deltas(gameId: string, ten: readonly string[]) {
        const { data, error } = await db
          .from('game_players')
          .select('player_id, mu_before, mu_after, sigma_before, sigma_after')
          .eq('game_id', gameId);
        if (error) throw new Error(error.message);
        return ten.map((puuid) => {
          const row = (data ?? []).find((seat) => seat.player_id === idOf.get(puuid));
          return [row?.mu_before, row?.mu_after, row?.sigma_before, row?.sigma_after];
        });
      }

      const inFearless = await deltas(gameA, fTen);
      const inNormal = await deltas(gameN, nTen);
      expect(inFearless.every((seat) => seat.every((value) => typeof value === 'number'))).toBe(true);
      expect(inNormal).toEqual(inFearless);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 6 and the edge "Normal, then Reset, then Fearless"
  // -------------------------------------------------------------------------

  describe('Reset in Normal', () => {
    it('moves the cursor and answers post: skipped, posting nothing; Fearless then comes back empty', async () => {
      expect((await setMode(FAY, 'normal')).status).toBe(200);
      const before = await db.from('fearless_state').select('reset_at').eq('group_id', groups.f).single();

      const reset = await call(fearlessResetRoute(as(ALI)), { groupId: groups.f });
      expect(reset.status).toBe(200);
      expect(reset.json).toMatchObject({ ok: true, post: 'skipped' });
      expect(posts).toEqual([]);

      const after = await db.from('fearless_state').select('reset_at').eq('group_id', groups.f).single();
      expect(Date.parse(after.data?.reset_at ?? '')).toBeGreaterThan(Date.parse(before.data?.reset_at ?? ''));

      expect((await setMode(FAY, 'fearless')).status).toBe(200);
      expect(await poolIds(groups.f)).toEqual([]);
    });

    it('in Fearless the reset still posts to Discord', async () => {
      const reset = await call(fearlessResetRoute(as(ALI)), { groupId: groups.f });
      expect(reset.json).toMatchObject({ ok: true, post: 'posted' });
      expect(posts.map((post) => post.path)).toEqual(['/webhook-f']);
    });
  });
}
