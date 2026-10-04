import { act, render, screen } from '@testing-library/react';
import { Suspense, use, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `useCommittedRefresh` (M19.3): its promise resolves when the refreshed screen has committed, not
 * when the refresh was asked for.
 *
 * The router is a stand-in that behaves like Next's: `refresh()` sets the router's state to a
 * promise of the next payload inside the caller's transition, and the tree reads it with `use()`.
 * Inside a transition React keeps the old screen up and `isPending` true until that promise
 * resolves and the new screen commits, which is exactly what the hook waits on.
 */

const router = vi.hoisted(() => ({
  refresh: () => {},
  push: () => {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { useCommittedRefresh, REFRESH_HOLD_MAX_MS } = await import('./useCommittedRefresh');

let payloads: { promise: Promise<string>; resolve: (value: string) => void }[] = [];

function nextPayload(): Promise<string> {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  payloads.push({ promise, resolve });
  return promise;
}

function Screen({ payload }: { payload: Promise<string> }) {
  return <p data-testid="screen">{use(payload)}</p>;
}

let ask: () => Promise<void> = () => Promise.resolve();

function Page() {
  const [payload, setPayload] = useState<Promise<string>>(() => Promise.resolve('old'));
  router.refresh = () => setPayload(nextPayload());
  const { refresh, refreshing } = useCommittedRefresh();
  ask = refresh;
  return (
    <>
      <Suspense fallback={<p>loading</p>}>
        <Screen payload={payload} />
      </Suspense>
      <p data-testid="pending">{refreshing ? 'pending' : 'idle'}</p>
    </>
  );
}

afterEach(() => {
  payloads = [];
  vi.useRealTimers();
});

describe('useCommittedRefresh', () => {
  it('resolves once the new screen is on, and keeps the old one up until then', async () => {
    await act(async () => {
      render(<Page />);
    });
    expect(screen.getByTestId('screen')).toHaveTextContent('old');

    const landed = vi.fn();
    await act(async () => {
      void ask().then(landed);
    });
    // The server has not answered: the old screen stays (no fallback flash) and nothing resolved.
    expect(screen.getByTestId('screen')).toHaveTextContent('old');
    expect(screen.getByTestId('pending')).toHaveTextContent('pending');
    expect(landed).not.toHaveBeenCalled();

    await act(async () => {
      payloads[0]?.resolve('new');
    });
    expect(screen.getByTestId('screen')).toHaveTextContent('new');
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it('two refreshes asked while one is pending both resolve when the screen settles', async () => {
    await act(async () => {
      render(<Page />);
    });
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => {
      void ask().then(first);
    });
    await act(async () => {
      void ask().then(second);
    });
    await act(async () => {
      for (const payload of payloads) payload.resolve('new');
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a refresh that never lands frees its control after the cap', async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<Page />);
    });
    const landed = vi.fn();
    await act(async () => {
      void ask().then(landed);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_HOLD_MAX_MS - 1);
    });
    expect(landed).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(landed).toHaveBeenCalledTimes(1);
  });
});
