import { AI_LINE_STATUSES } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import {
  canMove,
  IllegalLineMove,
  LINE_TRANSITIONS,
  memoryLineStore,
  setAiOptOut,
  subjectKey,
} from './store';

/** M16.3: the line status machine, subjects, and the opt-out's one-way admin path. */

describe('LINE_TRANSITIONS', () => {
  it('is the 0033 trigger`s table, and nothing else moves', () => {
    const allowed = AI_LINE_STATUSES.flatMap((from) =>
      AI_LINE_STATUSES.filter((to) => canMove(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'pending->published',
        'pending->rejected',
        'pending->failed',
        'failed->pending',
        'published->hidden',
      ].sort(),
    );
    expect(LINE_TRANSITIONS.rejected).toEqual([]);
    expect(LINE_TRANSITIONS.hidden).toEqual([]);
  });

  it('the memory store refuses an illegal move', async () => {
    const store = memoryLineStore();
    const claim = await store.claim({
      groupId: 'g',
      subject: { kind: 'week', weekStart: '2026-09-27' },
      facts: [],
      tokenMap: {},
      factHash: 'a'.repeat(64),
      model: 'claude-sonnet-5-5',
      promptVersion: 'v',
    });
    if (!claim.claimed) throw new Error('expected a claim');
    const finish = {
      text: 'x',
      rejectReason: null,
      attempts: 1,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    };
    await store.finish(claim.line.id, { ...finish, status: 'published' }, new Date());
    await expect(
      store.finish(claim.line.id, { ...finish, status: 'rejected' }, new Date()),
    ).rejects.toBeInstanceOf(IllegalLineMove);
    // A published row is never taken over.
    const row = await store.read('g', 'week', '2026-09-27');
    expect(row && (await store.retake(row))).toBeNull();
  });
});

describe('subjectKey', () => {
  it('matches 0033`s subject shape check', () => {
    expect(subjectKey({ kind: 'game', gameId: 'abc' })).toBe('abc');
    expect(subjectKey({ kind: 'week', weekStart: '2026-09-27' })).toBe('2026-09-27');
    expect(subjectKey({ kind: 'player', playerId: 'p', weekStart: '2026-09-27' })).toBe('p:2026-09-27');
  });
});

describe('setAiOptOut', () => {
  function fakeService() {
    const writes: unknown[] = [];
    const service = {
      from() {
        return {
          update(patch: unknown) {
            writes.push(patch);
            const chain = {
              eq: () => chain,
              select: () => chain,
              maybeSingle: async () => ({
                data: { ai_opt_out: (patch as { ai_opt_out: boolean }).ai_opt_out },
                error: null,
              }),
            };
            return chain;
          },
        };
      },
    };
    return { service: service as unknown as ServiceClient, writes };
  }

  it('an admin can switch a member off, never back on (and writes nothing trying)', async () => {
    const { service, writes } = fakeService();
    expect(
      await setAiOptOut(service, { groupId: 'g', playerId: 'p', optOut: true, actor: 'group_admin' }),
    ).toEqual({
      ok: true,
      optOut: true,
    });
    expect(
      await setAiOptOut(service, { groupId: 'g', playerId: 'p', optOut: false, actor: 'group_admin' }),
    ).toEqual({
      ok: false,
      reason: 'admin_cannot_opt_in',
    });
    expect(writes).toEqual([{ ai_opt_out: true }]);
  });

  it('the player switches themselves either way', async () => {
    const { service, writes } = fakeService();
    await setAiOptOut(service, { groupId: 'g', playerId: 'p', optOut: true, actor: 'self' });
    await setAiOptOut(service, { groupId: 'g', playerId: 'p', optOut: false, actor: 'self' });
    expect(writes).toEqual([{ ai_opt_out: true }, { ai_opt_out: false }]);
  });
});
