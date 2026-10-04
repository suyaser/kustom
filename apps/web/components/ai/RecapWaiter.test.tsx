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
});
