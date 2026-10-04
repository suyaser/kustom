import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '@/lib/supabase';
import {
  classifyRequest,
  expectBumpedLast,
  installWriteRecorder,
  type RecordedWrite,
} from '@/lib/testing/writeRecorder';
import { bumpGroupLive, bumpIfWrote, flushLive, LiveChanges, withLiveSignal } from './bump';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

/** A client whose only method is `rpc`, logging every call into `log`. */
function rpcClient(
  log: string[],
  answer: () => Promise<{ data: unknown; error: { message: string } | null }>,
) {
  return {
    rpc: (name: string, args: { p_group: string; p_kind: string }) => {
      log.push(`${name}(${args.p_group},${args.p_kind})`);
      return answer();
    },
  } as unknown as ServiceClient;
}

describe('LiveChanges (M19.9)', () => {
  it('keeps one kind per group, the strongest', () => {
    const live = new LiveChanges();
    live.touch(A, 'mode');
    live.touch(A, 'lobby');
    live.touch(A, 'game');
    live.touch(A, 'lobby');
    live.touch(B, 'roster');
    expect([...live.groups]).toEqual([
      [A, 'game'],
      [B, 'roster'],
    ]);
    expect(live.size).toBe(2);
  });
});

describe('flushLive / bumpGroupLive', () => {
  it('bumps every touched group exactly once and nothing for an untouched request', async () => {
    const log: string[] = [];
    const client = rpcClient(log, async () => ({ data: 1, error: null }));
    await flushLive(client, new LiveChanges());
    expect(log).toEqual([]);

    const live = new LiveChanges();
    live.touch(A, 'lobby');
    live.touch(B, 'lobby');
    live.touch(A, 'split');
    await flushLive(client, live);
    expect(log).toEqual([`bump_group_live(${A},split)`, `bump_group_live(${B},lobby)`]);
  });

  it('answers the new version, and null (logged, never thrown) when the bump fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log: string[] = [];
    expect(
      await bumpGroupLive(
        rpcClient(log, async () => ({ data: 7, error: null })),
        A,
        'game',
      ),
    ).toBe(7);
    expect(
      await bumpGroupLive(
        rpcClient(log, async () => ({ data: null, error: { message: 'nope' } })),
        A,
        'game',
      ),
    ).toBeNull();
    expect(
      await bumpGroupLive(
        rpcClient(log, async () => {
          throw new Error('socket');
        }),
        A,
        'game',
      ),
    ).toBeNull();
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('bumpIfWrote bumps only when the request wrote', async () => {
    const log: string[] = [];
    const client = rpcClient(log, async () => ({ data: 1, error: null }));
    await bumpIfWrote(client, A, 'mode', false);
    await bumpIfWrote(client, A, 'mode', true);
    expect(log).toEqual([`bump_group_live(${A},mode)`]);
  });

  it('withLiveSignal flushes after the body, also when the body throws', async () => {
    const log: string[] = [];
    const client = rpcClient(log, async () => ({ data: 1, error: null }));
    const answer = await withLiveSignal(client, async (live) => {
      live.touch(A, 'lobby');
      log.push('body done');
      return 'answer';
    });
    expect(answer).toBe('answer');
    expect(log).toEqual(['body done', `bump_group_live(${A},lobby)`]);

    log.length = 0;
    await expect(
      withLiveSignal(client, async (live) => {
        live.touch(B, 'game');
        throw new Error('fold failed');
      }),
    ).rejects.toThrow('fold failed');
    expect(log).toEqual([`bump_group_live(${B},game)`]);
  });
});

describe('the write recorder the route tests use', () => {
  const URL_BASE = 'http://127.0.0.1:54321';
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('classifies PostgREST writes and nothing else', () => {
    const rest = `${URL_BASE}/rest/v1/`;
    expect(classifyRequest(rest, `${rest}lobbies?id=eq.1`, 'PATCH')).toEqual({
      target: 'lobbies',
      method: 'PATCH',
    });
    expect(classifyRequest(rest, `${rest}lobbies?select=id`, 'GET')).toBeNull();
    expect(classifyRequest(rest, `${rest}rpc/bump_group_live`, 'POST')).toEqual({
      target: 'rpc:bump_group_live',
      method: 'POST',
    });
    expect(classifyRequest(rest, `${rest}rpc/ai_month_spend`, 'POST')).toBeNull();
    expect(classifyRequest(rest, `${URL_BASE}/auth/v1/token`, 'POST')).toBeNull();
  });

  async function run(steps: readonly [string, string, unknown?][]): Promise<RecordedWrite[]> {
    const base = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const recorder = installWriteRecorder(URL_BASE, base);
    restore = recorder.restore;
    const mark = recorder.mark();
    for (const [method, path, body] of steps) {
      await fetch(`${URL_BASE}/rest/v1/${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    return recorder.since(mark);
  }

  it('passes a route whose bump is its last write', async () => {
    const writes = await run([
      ['POST', 'games'],
      ['GET', 'games?select=id'],
      ['PATCH', 'lobbies?id=eq.1'],
      ['POST', 'rpc/bump_group_live', { p_group: A, p_kind: 'game' }],
    ]);
    expect(expectBumpedLast(writes, [{ groupId: A, kind: 'game' }]).map((w) => w.target)).toEqual([
      'games',
      'lobbies',
    ]);
  });

  it('fails a route that writes after its bump', async () => {
    const writes = await run([
      ['POST', 'games'],
      ['POST', 'rpc/bump_group_live', { p_group: A, p_kind: 'game' }],
      ['PATCH', 'ratings?group_id=eq.1'],
    ]);
    expect(() => expectBumpedLast(writes, [{ groupId: A, kind: 'game' }])).toThrow(
      /write\(s\) after the bump/,
    );
  });

  it('fails a route that bumps twice, or bumps when it should not', async () => {
    const twice = await run([
      ['POST', 'rpc/bump_group_live', { p_group: A, p_kind: 'lobby' }],
      ['POST', 'rpc/bump_group_live', { p_group: A, p_kind: 'lobby' }],
    ]);
    expect(() => expectBumpedLast(twice, [{ groupId: A, kind: 'lobby' }])).toThrow(/expected bumps/);
    const silent = await run([['POST', 'rpc/bump_group_live', { p_group: A, p_kind: 'lobby' }]]);
    expect(() => expectBumpedLast(silent, [])).toThrow(/expected bumps/);
    expect(expectBumpedLast(await run([['GET', 'lobbies']]), [])).toEqual([]);
  });
});
