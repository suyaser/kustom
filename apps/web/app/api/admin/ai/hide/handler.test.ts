import { hideAiLineResponseSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { hideAiLineRoute } from './handler';

/**
 * `POST /api/admin/ai/hide` (M16.4): the gate, zod on the body, and the write `hideLine` makes
 * (published -> hidden, scoped to the checked group, stamped with the admin's player). The
 * database half, the line gone from every surface, is `lib/ai/recap.integration.test.ts`.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const LINE = '10000000-0000-4000-8000-000000000001';

const admin: AdminAuthResult = {
  ok: true,
  admin: {
    userId: 'e3b0c442-0000-4000-8000-000000000001',
    discordId: '1',
    playerId: PLAYER,
    groupId: GROUP,
    puuid: 'p',
    displayName: 'Hana',
    email: null,
    discordName: null,
  },
};
const member: AdminAuthResult = { ok: false, status: 403, error: 'not an admin of that group' };
const signedOut: AdminAuthResult = { ok: false, status: 401, error: 'sign in first' };

/** One `ai_lines` row in memory, and every `update` the route makes, recorded. */
function fakeStore(row: { id: string; group_id: string; status: string }) {
  const updates: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {};
      chain.update = (values: Record<string, unknown>) => {
        patch = values;
        return chain;
      };
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === 'groups') return { data: { id: GROUP, slug: 'crew', name: 'Crew' }, error: null };
        const match =
          table === 'ai_lines' &&
          row.id === filters.id &&
          row.group_id === filters.group_id &&
          row.status === filters.status;
        if (match && patch !== null) {
          updates.push(patch);
          row.status = String(patch.status);
        }
        return { data: match ? { id: row.id } : null, error: null };
      };
      return chain;
    },
  } as unknown as ServiceClient;
  return { client, updates, row };
}

const json = (body: unknown) =>
  new Request('http://localhost/api/admin/ai/hide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/admin/ai/hide', () => {
  it('hides a published line of the group for good, stamped with the admin', async () => {
    const store = fakeStore({ id: LINE, group_id: GROUP, status: 'published' });
    const route = hideAiLineRoute({ getClient: () => store.client, authorize: async () => admin });
    const response = await route(json({ groupId: GROUP, lineId: LINE }));
    expect(response.status).toBe(200);
    expect(hideAiLineResponseSchema.parse(await response.json())).toEqual({ ok: true, hidden: true });
    expect(store.row.status).toBe('hidden');
    expect(store.updates[0]).toMatchObject({ status: 'hidden', hidden_by: PLAYER });

    const again = await route(json({ groupId: GROUP, lineId: LINE }));
    expect(await again.json()).toEqual({ ok: true, hidden: false });
    expect(store.updates).toHaveLength(1);
  });

  it("never hides another group's line", async () => {
    const store = fakeStore({ id: LINE, group_id: OTHER, status: 'published' });
    const route = hideAiLineRoute({ getClient: () => store.client, authorize: async () => admin });
    const response = await route(json({ groupId: GROUP, lineId: LINE }));
    expect(await response.json()).toEqual({ ok: true, hidden: false });
    expect(store.row.status).toBe('published');
  });

  it('refuses a member (403) and a visitor (401) and writes nothing', async () => {
    for (const [auth, status] of [
      [member, 403],
      [signedOut, 401],
    ] as const) {
      const store = fakeStore({ id: LINE, group_id: GROUP, status: 'published' });
      const route = hideAiLineRoute({ getClient: () => store.client, authorize: async () => auth });
      const response = await route(json({ groupId: GROUP, lineId: LINE }));
      expect(response.status).toBe(status);
      expect(store.updates).toHaveLength(0);
    }
  });

  it('refuses a body without a valid line id (400)', async () => {
    const store = fakeStore({ id: LINE, group_id: GROUP, status: 'published' });
    const route = hideAiLineRoute({ getClient: () => store.client, authorize: async () => admin });
    const response = await route(json({ groupId: GROUP, lineId: 'nope' }));
    expect(response.status).toBe(400);
    expect(store.updates).toHaveLength(0);
  });

  it('sends a no-JS form post back to the page it came from with the notice', async () => {
    const store = fakeStore({ id: LINE, group_id: GROUP, status: 'published' });
    const route = hideAiLineRoute({ getClient: () => store.client, authorize: async () => admin });
    const response = await route(
      new Request('http://localhost/api/admin/ai/hide', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          groupId: GROUP,
          lineId: LINE,
          redirectTo: '/g/crew/games/abc',
        }).toString(),
      }),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/g/crew/games/abc');
    expect(location.searchParams.get('notice')).toBe("Hidden. It won't come back.");
    expect(store.row.status).toBe('hidden');
  });
});
