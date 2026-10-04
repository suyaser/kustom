import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';

/** Reset ratings expires the group's Stats cache after a reset, and only then. */

const stub = vi.hoisted(() => ({
  expired: [] as [string, string][],
  reset: null as null | (() => Promise<unknown>),
}));

vi.mock('@/lib/cache/tags', () => ({
  expireGroupTag: (kind: string, groupId: string) => {
    stub.expired.push([kind, groupId]);
  },
  invalidateGroup: (groupId: string, kinds: readonly string[]) => {
    for (const kind of kinds) stub.expired.push([kind, groupId]);
  },
}));
vi.mock('@/lib/admin/ratingsReset', () => ({
  resetGroupRatings: () => stub.reset?.(),
}));

const { ratingsResetRoute } = await import('./handler');

const GROUP = '00000000-0000-4000-8000-00000000000a';
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

const route = ratingsResetRoute({
  getClient: () => ({}) as unknown as ServiceClient,
  authorize: async () => admin,
});

function post(): Request {
  return new Request('http://localhost/api/admin/ratings/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupId: GROUP, confirmSlug: 'tuesday-crew' }),
  });
}

describe('POST /api/admin/ratings/reset: the Stats cache', () => {
  beforeEach(() => {
    stub.expired = [];
  });

  it("expires the group's stats after a reset", async () => {
    stub.reset = async () => ({
      ok: true,
      value: { ratingsSince: '2026-10-04T00:00:00.000Z', post: 'skipped' },
    });
    const response = await route(post());
    expect(response.status).toBe(200);
    expect(stub.expired).toEqual([
      ['stats', GROUP],
      ['games', GROUP],
    ]);
  });

  it('expires nothing when the reset is refused', async () => {
    stub.reset = async () => ({ ok: false, status: 400, error: 'type the group name' });
    const response = await route(post());
    expect(response.status).toBe(400);
    expect(stub.expired).toEqual([]);
  });

  it('expires nothing when the reset throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stub.reset = async () => {
      throw new Error('database down');
    };
    const response = await route(post());
    expect(response.status).toBe(500);
    expect(stub.expired).toEqual([]);
    error.mockRestore();
  });
});
