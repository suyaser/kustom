import { mysteryCronResponseSchema } from '@customs/db/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * The daily-mystery cron's door and its loop over groups (M13.4). What a challenge is, and that
 * each group's is drawn from its own games and numbered from its own `#1`, is
 * `lib/mystery/groups.integration.test.ts`; what is only true here is that every group is asked,
 * in order, and that one group's failure is its own line while the next still gets its challenge.
 */

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';
const GROUP_C = '00000000-0000-4000-8000-00000000000c';

const stub = vi.hoisted(() => ({
  asked: [] as string[],
  throwFor: null as string | null,
  emptyFor: null as string | null,
}));

vi.mock('@/lib/groups/list', () => ({
  listGroups: async () => [
    { id: '00000000-0000-4000-8000-00000000000a', slug: 'a' },
    { id: '00000000-0000-4000-8000-00000000000b', slug: 'b' },
    { id: '00000000-0000-4000-8000-00000000000c', slug: 'c' },
  ],
}));

vi.mock('@/lib/mystery/ensure', () => ({
  ensureTodayMystery: async (_client: unknown, _now: Date, _zone: string, groupId: string) => {
    stub.asked.push(groupId);
    if (groupId === stub.throwFor) throw new Error('boom');
    if (groupId === stub.emptyFor) return null;
    return { id: `11111111-1111-4111-8111-${groupId.slice(-12)}`, kind: 'award' };
  },
}));

function get(authorization?: string): Request {
  return new Request('http://localhost/api/cron/mystery', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('GET /api/cron/mystery', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.CRON_SECRET = 'secret-value';
    stub.asked = [];
    stub.throwFor = null;
    stub.emptyFor = null;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('answers 401 for the wrong secret and asks no group anything', async () => {
    const response = await GET(get('Bearer nope'));
    expect(response.status).toBe(401);
    expect(stub.asked).toEqual([]);
  });

  it('asks every group, in order; a failing group is its own line and the next still gets its challenge', async () => {
    stub.throwFor = GROUP_A;
    stub.emptyFor = GROUP_C;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(get('Bearer secret-value'));
    spy.mockRestore();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mysteryCronResponseSchema.safeParse(body).success).toBe(true);
    expect(stub.asked).toEqual([GROUP_A, GROUP_B, GROUP_C]);
    expect(body.groups).toEqual([
      { groupId: GROUP_A, status: 'failed', challengeId: null, kind: null },
      {
        groupId: GROUP_B,
        status: 'exists',
        challengeId: `11111111-1111-4111-8111-${GROUP_B.slice(-12)}`,
        kind: 'award',
      },
      // Too few games for a challenge today: none, the way the original group's first week went.
      { groupId: GROUP_C, status: 'empty', challengeId: null, kind: null },
    ]);
  });
});
