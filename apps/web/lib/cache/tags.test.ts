import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

const { expireGroupTag, groupTag } = await import('./tags');

describe('groupTag', () => {
  it('is the kind and the group id', () => {
    expect(groupTag('stats', 'g-1')).toBe('stats:g-1');
  });

  it('never collides across groups', () => {
    expect(groupTag('stats', 'g-1')).not.toBe(groupTag('stats', 'g-2'));
  });
});

describe('expireGroupTag', () => {
  beforeEach(() => {
    revalidateTag.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expires the tag at once, never stale-while-revalidate', () => {
    expireGroupTag('stats', 'g-1');
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('stats:g-1', { expire: 0 });
  });

  it('is a quiet no-op outside a Next request (a CLI script, a route test)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    revalidateTag.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag stats:g-1');
    });
    expect(() => expireGroupTag('stats', 'g-1')).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('never fails the writer on any other error, and says so', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    revalidateTag.mockImplementation(() => {
      throw new Error('cache down');
    });
    expect(() => expireGroupTag('stats', 'g-1')).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
  });
});
