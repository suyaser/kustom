import { rebuildCronResponseSchema } from '@customs/db/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '../supabase';
import type { RebuildReport, RebuildResult } from './rebuild';
import { FENCE_RERUNS, type PendingGroup, runRebuildCron } from './rebuildCron';

/**
 * The cron's loop over waiting groups (M14.63): guards come from the fold and are reported, the
 * fence is answered by running again (the command's exit 2), and no fold starts once the budget
 * is gone. Which groups are waiting, and the fold itself, are `rebuildCron.integration.test.ts`.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const client = {} as ServiceClient;

function report(groupId: string, rated: number, problems: string[] = []): RebuildReport {
  return { groupId, rated, problems } as unknown as RebuildReport;
}

const ok = (groupId: string, rated = 3): RebuildResult => ({ ok: true, report: report(groupId, rated) });
const guard: RebuildResult = {
  ok: false,
  code: 'guard',
  message: 'A lobby is live. (lobby x is open)',
  report: null,
};
const fence: RebuildResult = { ok: false, code: 'fence', message: 'New games landed.', report: null };

function pending(...ids: string[]): () => Promise<PendingGroup[]> {
  return async () => ids.map((groupId) => ({ groupId, pendingGames: 1 }));
}

describe('runRebuildCron', () => {
  it('folds every waiting group in order and reports the guard as blocked', async () => {
    const asked: string[] = [];
    const lines = await runRebuildCron(client, {
      elapsedMs: () => 0,
      startBudgetMs: 30_000,
      findPending: pending(A, B),
      rebuild: async (_db, groupId) => {
        asked.push(groupId);
        return groupId === A ? guard : ok(groupId, 4);
      },
    });
    expect(asked).toEqual([A, B]);
    expect(lines).toEqual([
      {
        groupId: A,
        status: 'blocked',
        ratedGames: null,
        pendingGames: 1,
        reason: guard.ok ? null : guard.message,
      },
      { groupId: B, status: 'rated', ratedGames: 4, pendingGames: 1, reason: null },
    ]);
    expect(rebuildCronResponseSchema.safeParse({ ok: true, groups: lines }).success).toBe(true);
  });

  it('runs again on the fence, and gives up after FENCE_RERUNS re-runs', async () => {
    let callsA = 0;
    let callsB = 0;
    const lines = await runRebuildCron(client, {
      elapsedMs: () => 0,
      startBudgetMs: 30_000,
      findPending: pending(A, B),
      rebuild: async (_db, groupId) => {
        if (groupId === A) {
          callsA += 1;
          return callsA === 1 ? fence : ok(A, 2);
        }
        callsB += 1;
        return fence;
      },
    });
    expect(callsA).toBe(2);
    expect(callsB).toBe(1 + FENCE_RERUNS);
    expect(lines.map((line) => line.status)).toEqual(['rated', 'fenced']);
  });

  it('starts no fold once the budget is gone; the rest are deferred', async () => {
    let elapsed = 0;
    const asked: string[] = [];
    const lines = await runRebuildCron(client, {
      elapsedMs: () => elapsed,
      startBudgetMs: 30_000,
      findPending: pending(A, B, C),
      rebuild: async (_db, groupId) => {
        asked.push(groupId);
        elapsed += 31_000;
        return ok(groupId);
      },
    });
    expect(asked).toEqual([A]);
    expect(lines.map((line) => line.status)).toEqual(['rated', 'deferred', 'deferred']);
  });

  it('a throwing group is its own failed line and the next still folds; a data problem still reads rated', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lines = await runRebuildCron(client, {
      elapsedMs: () => 0,
      startBudgetMs: 30_000,
      findPending: pending(A, B),
      rebuild: async (_db, groupId) => {
        if (groupId === A) throw new Error('boom');
        return { ok: true, report: report(B, 5, ['game 7 has the same player twice on the scoreboard']) };
      },
    });
    spy.mockRestore();
    expect(lines).toEqual([
      { groupId: A, status: 'failed', ratedGames: null, pendingGames: 1, reason: 'internal error' },
      {
        groupId: B,
        status: 'rated',
        ratedGames: 5,
        pendingGames: 1,
        reason: 'game 7 has the same player twice on the scoreboard',
      },
    ]);
  });

  it('does nothing when no group is waiting', async () => {
    const rebuild = vi.fn();
    const lines = await runRebuildCron(client, {
      elapsedMs: () => 0,
      startBudgetMs: 30_000,
      findPending: pending(),
      rebuild,
    });
    expect(lines).toEqual([]);
    expect(rebuild).not.toHaveBeenCalled();
  });
});
