import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';

/**
 * The recap waiter (brief 1.2) and Tonight's scheduler (M19.3): on Tonight a recheck is one more
 * change for `TonightLive` to fold in, never a router refresh of its own; elsewhere it refreshes.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { RecapWaiter } = await import('./RecapWaiter');
// The read's schema is a dynamic import (zod stays out of first load): load it up front.
await import('@/app/api/me/recap/status/schema');

const GROUP = '11111111-1111-4111-8111-111111111111';
const GAME = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RecapWaiter', () => {
  it('on Tonight, asks the scheduler at each recheck and never the router', async () => {
    const tonight = holdTonightRefresh();
    render(<RecapWaiter delays={[1_000, 2_000]} />);
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(tonight.asks).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
    tonight.stop();
  });

  it('on any other page, refreshes through the router', async () => {
    render(<RecapWaiter delays={[1_000, 2_000]} />);
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('M19.17: a member asks the recap read, not the page, and re-renders once when the line lands', async () => {
    const tonight = holdTonightRefresh();
    const answers = [false, true];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ landed: answers.shift() ?? true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RecapWaiter delays={[1_000, 2_000, 3_000]} poll={{ groupId: GROUP, gameId: GAME }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect((fetchMock.mock.calls[0] as unknown as [string] | undefined)?.[0]).toBe(
      `/api/me/recap/status?groupId=${GROUP}&gameId=${GAME}`,
    );
    expect(tonight.asks).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(tonight.asks).toHaveLength(1);
    // Landed: the third check asks nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tonight.asks).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    tonight.stop();
    vi.unstubAllGlobals();
  });

  it('M19.17: when the read cannot answer, it falls back to re-rendering the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    render(<RecapWaiter delays={[1_000]} poll={{ groupId: GROUP, gameId: GAME }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
