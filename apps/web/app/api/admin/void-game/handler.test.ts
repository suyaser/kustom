import { describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { gameVoidRoute } from './handler';

/**
 * `POST /api/admin/void-game` (M23.1): the gate and zod, with no stack (CI). The write, the guard and
 * the rebuild are `app/api/admin/gameVoid.integration.test.ts`.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const GAME = '10000000-0000-4000-8000-000000000001';

/** Any read or write fails the test: none of these requests may reach the database. */
const untouchable = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the database was touched');
    },
  },
) as ServiceClient;

const json = (body: unknown) =>
  new Request('http://localhost/api/admin/void-game', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const route = (auth: AdminAuthResult) =>
  gameVoidRoute({ getClient: () => untouchable, authorize: async () => auth });

describe('POST /api/admin/void-game', () => {
  it('refuses a visitor (401) and a member (403)', async () => {
    const body = { groupId: GROUP, gameId: GAME, action: 'void' };
    expect((await route({ ok: false, status: 401, error: 'sign in first' })(json(body))).status).toBe(401);
    expect(
      (await route({ ok: false, status: 403, error: 'not an admin of that group' })(json(body))).status,
    ).toBe(403);
  });

  it('refuses a bad body (400) before any write', async () => {
    const admin: AdminAuthResult = {
      ok: true,
      admin: {
        userId: 'e3b0c442-0000-4000-8000-000000000001',
        discordId: '1',
        playerId: '11111111-1111-4111-8111-111111111111',
        groupId: GROUP,
        puuid: 'p',
        displayName: 'Hana',
        email: null,
        discordName: null,
      },
    };
    for (const body of [
      { groupId: GROUP, gameId: GAME, action: 'delete' },
      { groupId: GROUP, gameId: 'nope', action: 'void' },
      { groupId: GROUP, action: 'restore' },
    ]) {
      expect((await route(admin)(json(body))).status).toBe(400);
    }
  });
});
