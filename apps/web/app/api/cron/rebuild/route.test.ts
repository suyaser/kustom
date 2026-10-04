import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rebuildCronResponseSchema } from '@customs/db/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * The rebuild cron's door, its schedule and its time limit (M14.63). The loop is
 * `lib/ingest/rebuildCron.test.ts`; the fold against a database is the integration file.
 */

const stub = vi.hoisted(() => ({ calls: 0, fail: false, expired: [] as [string, string][] }));

vi.mock('@/lib/cache/tags', () => ({
  expireGroupTag: (kind: string, groupId: string) => {
    stub.expired.push([kind, groupId]);
  },
  invalidateGroup: (groupId: string, kinds: readonly string[]) => {
    for (const kind of kinds) stub.expired.push([kind, groupId]);
  },
}));

vi.mock('@/lib/ingest/rebuildCron', () => ({
  runRebuildCron: async () => {
    stub.calls += 1;
    if (stub.fail) throw new Error('database down');
    return [
      {
        groupId: '00000000-0000-4000-8000-00000000000b',
        status: 'rated',
        ratedGames: 2,
        pendingGames: 1,
        reason: null,
      },
    ];
  },
}));

function get(authorization?: string): Request {
  return new Request('http://localhost/api/cron/rebuild', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../vercel.json', import.meta.url)), 'utf8'),
) as { crons: { path: string; schedule: string }[]; functions?: Record<string, unknown> };
const route = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');

describe('GET /api/cron/rebuild', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.CRON_SECRET = 'secret-value';
    stub.calls = 0;
    stub.fail = false;
    stub.expired = [];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is closed with a 503 while CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(get('Bearer secret-value'));
    expect(response.status).toBe(503);
    expect(stub.calls).toBe(0);
  });

  it('answers 401 with no header or the wrong secret, and folds nothing', async () => {
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get('Bearer nope'))).status).toBe(401);
    expect(stub.calls).toBe(0);
  });

  it('runs the cron and answers its lines', async () => {
    const response = await GET(get('Bearer secret-value'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(rebuildCronResponseSchema.parse(body).groups).toHaveLength(1);
    expect(stub.calls).toBe(1);
  });

  it("expires each folded group's Stats cache after the run, and nothing on a refused or failed run", async () => {
    expect((await GET(get('Bearer nope'))).status).toBe(401);
    expect(stub.expired).toEqual([]);

    expect((await GET(get('Bearer secret-value'))).status).toBe(200);
    expect(stub.expired).toEqual([['stats', '00000000-0000-4000-8000-00000000000b'], ['games', '00000000-0000-4000-8000-00000000000b']]);

    stub.expired = [];
    stub.fail = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await GET(get('Bearer secret-value'))).status).toBe(500);
    expect(stub.expired).toEqual([]);
    error.mockRestore();
  });

  it('is scheduled daily after the 06:00 boundary in both halves of the Cairo year (03:00 / 04:00 UTC)', () => {
    const entry = vercel.crons.find((cron) => cron.path === '/api/cron/rebuild');
    expect(entry).toBeDefined();
    const [minute, hour, ...rest] = (entry?.schedule ?? '').split(' ');
    expect(rest).toEqual(['*', '*', '*']);
    expect(Number(hour) * 60 + Number(minute)).toBeGreaterThan(4 * 60);
  });

  it('keeps maxDuration at 60 and leaves itself time to finish the last fold', () => {
    expect(route).toMatch(/^export const maxDuration = 60;$/m);
    expect(route).toMatch(/^export const START_BUDGET_MS = 30_000;$/m);
    expect(Object.keys(vercel.functions ?? {}).filter((glob) => glob.includes('cron'))).toEqual([]);
  });
});
