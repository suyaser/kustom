import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { ADMIN_CANNOT_OPT_IN } from '@/lib/aiLinesCopy';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { authorizeMe, supabaseMeLookup } from '@/lib/me/identity';
import type { MeRouteOptions } from '@/lib/me/route';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M16.3b against the local stack (`0031`, `0033`): `POST /api/admin/ai-lines`, `POST
 * /api/admin/members/ai-opt-out` and `POST /api/me/ai-opt-out`, and the two page loaders.
 *
 * Group P is Premium (set on this scratch group only): Pia owns it, Al is an admin, Mo is a member.
 * Group N is not Premium: Nell owns it, Mo is a member there too. Sal is linked and in neither.
 * Skipped without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the AI switches against the local Supabase stack', () => {
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

  const { aiLinesRoute } = await import('./ai-lines/handler');
  const { memberAiOptOutRoute } = await import('./members/ai-opt-out/handler');
  const { meAiOptOutRoute } = await import('../me/ai-opt-out/handler');
  const { loadPremiumSection, loadWriteAboutMe } = await import('@/lib/ai/switches');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const PIA = `it-${runId}-ai-pia`;
  const AL = `it-${runId}-ai-al`;
  const MO = `it-${runId}-ai-mo`;
  const NELL = `it-${runId}-ai-nell`;
  const SAL = `it-${runId}-ai-sal`;
  const everyPuuid = [PIA, AL, MO, NELL, SAL];
  const discordOf = new Map(
    everyPuuid.map((puuid, index) => [puuid, `8${digits}${String(index).padStart(3, '0')}`]),
  );
  const idOf = new Map<string, string>();
  const groups = { p: '', n: '' };

  function user(puuid: string | null): SessionUserLike | null {
    return puuid === null
      ? null
      : {
          id: randomUUID(),
          email: `${puuid}@example.invalid`,
          identities: [{ id: discordOf.get(puuid) ?? '', provider: 'discord', identity_data: {} }],
        };
  }

  function asAdmin(puuid: string | null): AdminRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<AdminAuthResult> =>
        authorizeAdmin({
          resolveSessionUser: async () => user(puuid),
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
        }),
    };
  }

  function asMe(puuid: string | null): MeRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client) =>
        authorizeMe({
          resolveSessionUser: async () => user(puuid),
          lookupPlayerByDiscordId: supabaseMeLookup(client),
        }),
    };
  }

  async function call(route: (request: Request) => Promise<Response>, body: unknown) {
    const response = await route(
      new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function linesEnabled(groupId: string): Promise<boolean> {
    const { data, error } = await db.from('groups').select('ai_lines_enabled').eq('id', groupId).single();
    if (error) throw new Error(error.message);
    return data.ai_lines_enabled;
  }

  async function optOut(groupId: string, puuid: string): Promise<boolean> {
    const { data, error } = await db
      .from('group_memberships')
      .select('ai_opt_out')
      .eq('group_id', groupId)
      .eq('player_id', idOf.get(puuid) ?? '')
      .single();
    if (error) throw new Error(error.message);
    return data.ai_opt_out;
  }

  beforeAll(async () => {
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
      await createTestGroups(db, runId, ['aip', 'ain'] as const).then((made) => ({
        p: made.aip,
        n: made.ain,
      })),
    );
    const on = await db.from('groups').update({ premium: true }).eq('id', groups.p);
    if (on.error) throw new Error(on.error.message);
    await setTestMembership(db, groups.p, idOf.get(PIA) ?? '', 'owner');
    await setTestMembership(db, groups.p, idOf.get(AL) ?? '', 'admin');
    await setTestMembership(db, groups.p, idOf.get(MO) ?? '', 'member');
    await setTestMembership(db, groups.n, idOf.get(NELL) ?? '', 'owner');
    await setTestMembership(db, groups.n, idOf.get(MO) ?? '', 'member');
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', everyPuuid);
  });

  describe('POST /api/admin/ai-lines', () => {
    it('lets an admin and the owner of a Premium group switch AI lines off and on', async () => {
      const off = await call(aiLinesRoute(asAdmin(AL)), { groupId: groups.p, enabled: false });
      expect(off).toEqual({ status: 200, json: { ok: true, groupId: groups.p, enabled: false } });
      expect(await linesEnabled(groups.p)).toBe(false);
      const on = await call(aiLinesRoute(asAdmin(PIA)), { groupId: groups.p, enabled: true });
      expect(on.status).toBe(200);
      expect(await linesEnabled(groups.p)).toBe(true);
    });

    it('refuses a member (403), nobody (401) and another group’s admin (403)', async () => {
      expect((await call(aiLinesRoute(asAdmin(MO)), { groupId: groups.p, enabled: false })).status).toBe(403);
      expect((await call(aiLinesRoute(asAdmin(null)), { groupId: groups.p, enabled: false })).status).toBe(
        401,
      );
      expect((await call(aiLinesRoute(asAdmin(NELL)), { groupId: groups.p, enabled: false })).status).toBe(
        403,
      );
      expect(await linesEnabled(groups.p)).toBe(true);
    });

    it('is a 404 for a group without Premium, and writes nothing there', async () => {
      const answer = await call(aiLinesRoute(asAdmin(NELL)), { groupId: groups.n, enabled: false });
      expect(answer.status).toBe(404);
      expect(await linesEnabled(groups.n)).toBe(true);
    });

    it('validates the body', async () => {
      expect((await call(aiLinesRoute(asAdmin(AL)), { groupId: groups.p, enabled: 'no' })).status).toBe(400);
    });
  });

  describe("POST /api/admin/members/ai-opt-out (Don't write about <Name>)", () => {
    it('lets an admin switch a member off, and never back on', async () => {
      const off = await call(memberAiOptOutRoute(asAdmin(AL)), {
        groupId: groups.p,
        playerId: idOf.get(MO),
        optOut: true,
      });
      expect(off.status).toBe(200);
      expect(await optOut(groups.p, MO)).toBe(true);
      // Only this group: Mo is still written about in N.
      expect(await optOut(groups.n, MO)).toBe(false);

      const back = await call(memberAiOptOutRoute(asAdmin(PIA)), {
        groupId: groups.p,
        playerId: idOf.get(MO),
        optOut: false,
      });
      expect(back).toEqual({ status: 403, json: { ok: false, error: ADMIN_CANNOT_OPT_IN } });
      expect(await optOut(groups.p, MO)).toBe(true);
    });

    it('is a 404 for someone outside the group and a 403 for a member caller', async () => {
      const stranger = await call(memberAiOptOutRoute(asAdmin(AL)), {
        groupId: groups.p,
        playerId: idOf.get(SAL),
        optOut: true,
      });
      expect(stranger.status).toBe(404);
      const member = await call(memberAiOptOutRoute(asAdmin(MO)), {
        groupId: groups.p,
        playerId: idOf.get(AL),
        optOut: true,
      });
      expect(member.status).toBe(403);
      expect(await optOut(groups.p, AL)).toBe(false);
    });
  });

  describe('POST /api/me/ai-opt-out (Write about me)', () => {
    it('lets the player switch themselves back on, and off again', async () => {
      expect(await optOut(groups.p, MO)).toBe(true);
      const on = await call(meAiOptOutRoute(asMe(MO)), { groupId: groups.p, writeAboutMe: true });
      expect(on).toEqual({ status: 200, json: { ok: true, groupId: groups.p, writeAboutMe: true } });
      expect(await optOut(groups.p, MO)).toBe(false);
      const off = await call(meAiOptOutRoute(asMe(MO)), { groupId: groups.p, writeAboutMe: false });
      expect(off.json).toMatchObject({ writeAboutMe: false });
      expect(await optOut(groups.p, MO)).toBe(true);
    });

    it('refuses someone not in the group (403) and nobody (401)', async () => {
      expect(
        (await call(meAiOptOutRoute(asMe(SAL)), { groupId: groups.p, writeAboutMe: false })).status,
      ).toBe(403);
      expect(
        (await call(meAiOptOutRoute(asMe(null)), { groupId: groups.p, writeAboutMe: false })).status,
      ).toBe(401);
    });
  });

  describe('the page loaders', () => {
    it('draws the admin section for a Premium group only', async () => {
      expect(await loadPremiumSection(db, groups.p, new Date())).toEqual({
        linesEnabled: true,
        pausedUntilDay: null,
      });
      expect(await loadPremiumSection(db, groups.n, new Date())).toBeNull();
    });

    it("draws You's card for a member of a Premium group with AI lines on only", async () => {
      expect(await loadWriteAboutMe(db, { groupId: groups.p, puuid: MO })).toEqual({
        writeAboutMe: false,
      });
      expect(await loadWriteAboutMe(db, { groupId: groups.n, puuid: MO })).toBeNull();
      expect(await loadWriteAboutMe(db, { groupId: groups.p, puuid: SAL })).toBeNull();
      await call(aiLinesRoute(asAdmin(AL)), { groupId: groups.p, enabled: false });
      expect(await loadWriteAboutMe(db, { groupId: groups.p, puuid: MO })).toBeNull();
      expect(await loadPremiumSection(db, groups.p, new Date())).toEqual({
        linesEnabled: false,
        pausedUntilDay: null,
      });
    });
  });
}
