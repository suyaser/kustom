import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server cache's two seams (performance plan, phase 2): the tag spelling every reader and
 * writer shares, the `{ expire: 0 }` invalidation that never fails a write, and `cachedRead`'s
 * per-call tags and its no-cache fallback outside a Next request.
 */

const { revalidateTag, unstableCache } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstableCache: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidateTag, unstable_cache: unstableCache }));

const { groupTag, invalidate, invalidateGroup, invalidateGroups, invalidateNames, NAMES_TAG, GROUPS_TAG } =
  await import('./tags');
const { cachedRead } = await import('./cached');

beforeEach(() => {
  revalidateTag.mockReset();
  unstableCache.mockReset();
});

describe('tags', () => {
  it('spells one tag per slice per group, and invalidates it with expire 0 (never stale-while-revalidate)', () => {
    expect(groupTag('games', 'g1')).toBe('games:g1');
    invalidateGroup('g1', ['games', 'roster']);
    expect(revalidateTag.mock.calls).toEqual([
      ['games:g1', { expire: 0 }],
      ['roster:g1', { expire: 0 }],
    ]);
  });

  it('has a global tag for renames and one for the slug lookup', () => {
    invalidateNames();
    invalidateGroups();
    expect(revalidateTag.mock.calls).toEqual([
      [NAMES_TAG, { expire: 0 }],
      [GROUPS_TAG, { expire: 0 }],
    ]);
  });

  it('never throws: silent outside a Next request, logged otherwise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    revalidateTag.mockImplementationOnce(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag games:g1');
    });
    expect(() => invalidate('games:g1')).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    revalidateTag.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => invalidate('games:g1')).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('cachedRead', () => {
  it('tags each call by its arguments and keys it by name', async () => {
    unstableCache.mockImplementation((read: (...args: unknown[]) => Promise<unknown>) => read);
    const read = vi.fn(async (groupId: string) => `rows of ${groupId}`);
    const cached = cachedRead('slice-v1', read, {
      tags: (groupId) => [groupTag('games', groupId), NAMES_TAG],
      revalidate: 60,
    });
    expect(await cached('g2')).toBe('rows of g2');
    expect(unstableCache).toHaveBeenCalledWith(read, ['slice-v1'], {
      tags: ['games:g2', NAMES_TAG],
      revalidate: 60,
    });
  });

  it('just reads outside a Next request, where there is no cache', async () => {
    unstableCache.mockImplementation(() => async () => {
      throw new Error('Invariant: incrementalCache missing in unstable_cache async () => {}');
    });
    const cached = cachedRead('slice-v1', async (groupId: string) => groupId.toUpperCase(), {
      tags: () => [],
      revalidate: 60,
    });
    expect(await cached('g3')).toBe('G3');
  });

  it('passes a failed read through, so the caller falls back and nothing is cached', async () => {
    unstableCache.mockImplementation((read: (...args: unknown[]) => Promise<unknown>) => read);
    const cached = cachedRead(
      'slice-v1',
      async () => {
        throw new Error('read failed');
      },
      { tags: () => [], revalidate: 60 },
    );
    await expect(cached()).rejects.toThrow('read failed');
  });
});
