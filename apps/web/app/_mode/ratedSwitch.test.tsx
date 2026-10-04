import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { MODE_APPLIES_NEXT_GAME, MODE_CHANGE_FAILED } from '@/lib/mode/copy';
import { RATED_OFF, RATED_ON } from '@/lib/mode/ruleCopy';
import { ModeControls, type ModeControlsProps } from './ModeControls';

/**
 * The Rated switch on Tonight's admin row (prod fix, 2026-10-04): "I tap it and nothing changes".
 *
 * The switch used to have no state of its own: its knob, `aria-checked` and sentence were the page's
 * `nextRated` prop, which only moves when the whole Tonight page has been re-read after the write
 * (`router.refresh`). Until then a tap showed nothing, and a second tap posted the stale opposite
 * (the same value again), so it could not be toggled back. These tests never re-render with new
 * props after a tap unless they say so: the switch must answer on its own.
 */

const PROPS: ModeControlsProps = {
  groupId: ORIGINAL_GROUP.id,
  mode: 'fearless',
  banned: 0,
  inGame: false,
  redirectTo: '/g/customs',
  resetConfirmHref: '/g/customs/mode/reset',
  nextRated: true,
  version: 4,
};

function answer(rated: boolean, version: number): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      mode: 'fearless',
      changed: true,
      next: { standing: 'fearless', rule: null, rated, ratedOverride: rated, version },
    }),
  } as Response;
}

/** A fetch whose answers the test releases one at a time. */
function heldFetch() {
  const pending: ((response: Response) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];
  const mock = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) => {
        pending.push(resolve);
        failures.push(reject);
      }),
  );
  return {
    mock,
    async release(response: Response) {
      await act(async () => {
        pending.shift()?.(response);
        failures.shift();
      });
    },
    async fail() {
      await act(async () => {
        pending.shift();
        failures.shift()?.(new TypeError('Failed to fetch'));
      });
    },
  };
}

const bodies = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));

const toggle = () => screen.getByRole('switch', { name: 'Rated' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Rated switch toggles on its own', () => {
  it('flips the moment it is tapped, keeps the answer, and the next tap posts the other way', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(toggle()).toHaveAccessibleDescription(RATED_ON);

    fireEvent.click(toggle());
    // Before the server has answered: the tap shows.
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF);
    expect(toggle()).toHaveAttribute('aria-disabled', 'true');
    await net.release(answer(false, 5));
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('status')).toHaveTextContent('Next game is not rated.');

    // The page has not re-read yet (no new props): the second tap still turns it back on.
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    await net.release(answer(true, 6));
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Next game is rated.');

    expect(bodies(net.mock)).toEqual([
      { groupId: ORIGINAL_GROUP.id, rated: false },
      { groupId: ORIGINAL_GROUP.id, rated: true },
    ]);
  });

  it('a tap while one is in flight is ignored, never a second post', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(net.mock).toHaveBeenCalledTimes(1);
    await net.release(answer(false, 5));
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('the server answer wins over the tap', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    // Another admin's write landed between: the route answers with what the next game really is.
    await net.release(answer(true, 6));
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });
});

describe('a failed write says so and reverts', () => {
  it('a refusal (403) reverts the switch and says it could not change', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    await net.release({ ok: false, status: 403, json: async () => ({ error: 'nope' }) } as Response);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(toggle()).toHaveAccessibleDescription(RATED_ON);
    expect(screen.getByRole('alert')).toHaveTextContent(MODE_CHANGE_FAILED);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('no network reverts too, and the next tap tries the same change again', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    await net.fail();
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(MODE_CHANGE_FAILED);
    fireEvent.click(toggle());
    expect(screen.queryByRole('alert')).toBeNull();
    await net.release(answer(false, 5));
    expect(bodies(net.mock)).toEqual([
      { groupId: ORIGINAL_GROUP.id, rated: false },
      { groupId: ORIGINAL_GROUP.id, rated: false },
    ]);
  });
});

describe('the page re-read and the switch agree', () => {
  it('a re-read older than the write does not flip it back; a newer one (another admin) is taken', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    await net.release(answer(false, 5));
    // A Realtime re-read that started before the write: still version 4, still rated.
    rerender(<ModeControls {...PROPS} nextRated={true} version={4} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    // The re-read of our own write.
    rerender(<ModeControls {...PROPS} nextRated={false} version={5} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    // Another admin picked a mode, which resets the switch to the default.
    rerender(<ModeControls {...PROPS} nextRated={true} version={6} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('with no write of its own, the switch is simply the page', () => {
    const { rerender } = render(<ModeControls {...PROPS} />);
    rerender(<ModeControls {...PROPS} nextRated={false} version={5} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF);
  });
});

describe('after Roll the switch is for the next game', () => {
  it('in game it still toggles, and the row says changes apply from the next game', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} inGame />);
    expect(screen.getByText(MODE_APPLIES_NEXT_GAME)).toBeInTheDocument();
    expect(toggle()).not.toHaveAttribute('aria-disabled');
    expect(toggle()).toHaveAccessibleDescription(RATED_ON);
    fireEvent.click(toggle());
    await net.release(answer(false, 5));
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Next game is not rated.'));
  });
});
