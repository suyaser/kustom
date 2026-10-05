import type { ModeRow } from '@customs/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { applyModeRow } from '@/lib/mode/clientStore';
import { MODE_APPLIES_NEXT_GAME, MODE_CHANGE_FAILED } from '@/lib/mode/copy';
import { RATED_OFF, RATED_ON } from '@/lib/mode/ruleCopy';
import { ruleFromKey } from '@/lib/mode/spinEvents';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import { type HarnessProps, ModeControlsHarness as ModeControls } from '@/lib/testing/ModeControlsHarness';
import { ADMIN_VIEWER, type TonightFixtureOptions, tonightStateFixture } from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * The Rated switch on Tonight's admin row (prod fix, 2026-10-04): "I tap it and nothing changes".
 *
 * The switch used to have no state of its own: its knob, `aria-checked` and sentence were the page's
 * `nextRated` prop, which only moves when the whole Tonight page has been re-read after the write
 * (`router.refresh`). Until then a tap showed nothing, and a second tap posted the stale opposite
 * (the same value again), so it could not be toggled back. These tests never re-render with new
 * props after a tap unless they say so: the switch must answer on its own.
 */

/** `group_modes.updated_at` at minute `m`: the client store's gate (M20.8). */
const T = (m: number) => `2026-10-05T19:${String(m).padStart(2, '0')}:00.000Z`;

/** The row as the page rendered it (at `T(4)`): Fearless, the switch at its default (rated). */
const SERVER: ModeRow = { standing: 'fearless', pending: null, rated: null };
/** A render of the row at minute `m` with the switch at `rated`. */
const at = (m: number, rated: boolean | null = null) => ({
  server: { ...SERVER, rated },
  serverUpdatedAt: T(m),
});

const PROPS: HarnessProps = {
  groupId: ORIGINAL_GROUP.id,
  banned: 0,
  inGame: false,
  redirectTo: '/g/customs',
  resetConfirmHref: '/g/customs/mode/reset',
  server: SERVER,
  serverUpdatedAt: T(4),
};

/** The route's answer to a flip (M20.7): the row after it at minute `m`, and its notice. */
function answer(rated: boolean, m: number): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      state: { ...SERVER, rated, nextRated: rated, updatedAt: T(m) },
      notice: rated ? 'Next game is rated.' : 'Next game is not rated.',
      changed: true,
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

/** The controls' outcome line: shown in place, not a live region (the Announcer speaks). */
const outcome = () => document.querySelector('[data-slot="mode-outcome"]') as HTMLElement;

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
    expect(outcome()).toHaveTextContent('Next game is not rated.');

    // The page has not re-read yet (no new props): the second tap still turns it back on.
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    await net.release(answer(true, 6));
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(outcome()).toHaveTextContent('Next game is rated.');

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

describe('M19.13: the switch answers on its own, and asks for no re-read', () => {
  it('asks Tonight for nothing (the answer is in the client mode store), and is free at once', async () => {
    const tonight = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(toggle());
    await net.release(answer(false, 5));
    expect(tonight.asks).toHaveLength(0);
    expect(toggle()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(toggle());
    expect(net.mock).toHaveBeenCalledTimes(2);
    tonight.stop();
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
    expect(outcome()).toHaveTextContent('');
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
    // A Realtime re-read that started before the write: still T(4), still rated.
    rerender(<ModeControls {...PROPS} {...at(4)} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    // The re-read of our own write.
    rerender(<ModeControls {...PROPS} {...at(5, false)} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    // Another admin picked a mode, which resets the switch to the default.
    rerender(<ModeControls {...PROPS} {...at(6)} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('with no write of its own, the switch is simply the page', () => {
    const { rerender } = render(<ModeControls {...PROPS} />);
    rerender(<ModeControls {...PROPS} {...at(5, false)} />);
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
    await waitFor(() => expect(outcome()).toHaveTextContent('Next game is not rated.'));
  });
});

/**
 * M19.13 acceptance (3): on Tonight's card, Rated, Set mode and Spin move the card itself with no
 * server render. The page is drawn once and never re-rendered with new props: the client mode store
 * (the tap, the route's answer, another admin's `group_modes` row) is the only thing that moves it.
 */
describe('M19.13: Rated, Set mode and Spin move the card with no server render', () => {
  const NOW = Date.parse('2026-09-08T20:30:00.000Z');
  const card = () => screen.getByRole('region', { name: /^Mode / });
  const title = () => within(card()).getByRole('heading', { level: 2 }).textContent;
  const chip = () => (within(card()).queryByText('Not rated') === null ? 'Rated' : 'Not rated');

  async function tonight(key: 'idle' | 'balanced' = 'idle', options: TonightFixtureOptions = {}) {
    const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
    render(<TonightView {...fixture} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
    await screen.findByRole('switch', { name: 'Rated' });
  }

  /** The route's answer (M20.7): the row after the write (`rule` a select key) and a notice. */
  function cardAnswer(
    next: {
      standing?: 'normal' | 'fearless';
      rule: string | null;
      rated: boolean;
      ratedOverride: boolean | null;
      minute: number;
    },
    spun?: string,
  ): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        state: {
          standing: next.standing ?? 'fearless',
          pending: ruleFromKey(next.rule),
          rated: next.ratedOverride,
          nextRated: next.rated,
          updatedAt: T(next.minute),
        },
        notice: 'The route says so.',
        changed: true,
        ...(spun === undefined ? {} : { spun }),
      }),
    } as Response;
  }

  it('Rated: the chip flips on the tap, stays on the answer, and nothing asks Tonight to re-read', async () => {
    const asks = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    await tonight();
    expect(chip()).toBe('Rated');
    fireEvent.click(toggle());
    expect(chip()).toBe('Not rated');
    await net.release(cardAnswer({ rule: null, rated: false, ratedOverride: false, minute: 4 }));
    expect(chip()).toBe('Not rated');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(asks.asks).toHaveLength(0);
    asks.stop();
  });

  it('Set mode: the card shows the choice on the tap (optimistic), keeps it on the answer; no re-read', async () => {
    const asks = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    await tonight();
    expect(title()).toBe('Fearless');
    const select = screen.getByRole('combobox', { name: 'Mode' });
    fireEvent.change(select, { target: { value: 'class:Tank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    // Before the route has answered: the card is already the new one.
    expect(title()).toBe('Class wars');
    expect(chip()).toBe('Not rated');
    expect(card().textContent).toMatch(/Tanks only · \d+ open/);
    await net.release(cardAnswer({ rule: 'class:Tank', rated: false, ratedOverride: null, minute: 4 }));
    expect(title()).toBe('Class wars');
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
    expect(asks.asks).toHaveLength(0);
    asks.stop();
  });

  it('Set mode refused: the card goes back to what it was', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    await tonight();
    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), { target: { value: 'normal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    expect(title()).toBe('Normal');
    await net.release({ ok: false, status: 403, json: async () => ({}) } as Response);
    expect(title()).toBe('Fearless');
    expect(screen.getByRole('alert')).toHaveTextContent(MODE_CHANGE_FAILED);
  });

  it("Spin: the route's answer is the card at once, and its own reveal plays (local); no re-read", async () => {
    const asks = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    await tonight();
    fireEvent.click(screen.getByRole('button', { name: /^Spin/ }));
    await net.release(cardAnswer({ rule: 'mirror', rated: true, ratedOverride: null, minute: 4 }, 'mirror'));
    expect(title()).toBe('Mirror match');
    expect(document.querySelector('[data-slot="spin-reveal"]')).toHaveTextContent('Spin says:');
    expect(asks.asks).toHaveLength(0);
    asks.stop();
  });

  it("after Roll, the card stays this game's; Set mode moves the admin's next-game line on the tap", async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    await tonight('balanced', { rule: 'class:Tank' });
    expect(title()).toBe('Class wars');
    expect(screen.queryByText('Next game: Mages only.')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), { target: { value: 'class:Mage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    expect(title()).toBe('Class wars');
    expect(screen.getByText('Next game: Mages only.')).toBeInTheDocument();
    await net.release(cardAnswer({ rule: 'class:Mage', rated: false, ratedOverride: null, minute: 4 }));
    expect(screen.getByText('Next game: Mages only.')).toBeInTheDocument();
  });

  it("another admin's newer row moves the card and the switch; an older one does not", async () => {
    await tonight();
    act(() => {
      applyModeRow(ORIGINAL_GROUP.id, {
        row: { standing: 'normal', pending: null, rated: false },
        updatedAt: '2026-09-08T20:29:00.000Z',
      });
    });
    expect(title()).toBe('Normal');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    act(() => {
      applyModeRow(ORIGINAL_GROUP.id, {
        row: { standing: 'fearless', pending: null, rated: null },
        updatedAt: '2026-09-08T20:28:00.000Z',
      });
    });
    expect(title()).toBe('Normal');
  });
});
