import type { ModeRow } from '@customs/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEARLESS_RESET_BUTTON, FEARLESS_RESET_POSTED } from '@/lib/fearless/copy';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { resetModeStoreForTests } from '@/lib/mode/clientStore';
import { resetControlsForTests } from '@/lib/mode/controlsStore';
import { MODE_CHANGE_FAILED, SET_MODE, SETTING_MODE } from '@/lib/mode/copy';
import { RATED_OFF, RATED_ON } from '@/lib/mode/ruleCopy';
import type { ModeSpeech } from '@/lib/mode/speech';
import { SPIN_CYCLE_MS, SPIN_REVEAL_EVENT, SPIN_WAIT_MS } from '@/lib/mode/spinEvents';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import { type HarnessProps, ModeControlsHarness as ModeControls } from '@/lib/testing/ModeControlsHarness';
import { Announcer } from '../_tonight/Announcer';

/**
 * Set mode and Spin answer at once (QA fix 2026-10-04, the Rated switch's pattern).
 *
 * Both used to move only when the whole Tonight page had been re-read (`router.refresh`): until
 * then `Set mode` stayed on screen and a second tap posted the same choice again, and Spin was
 * live again the moment its post answered, so a double tap during the reveal spun twice. The
 * tests never re-render with new props after a tap unless they say so (the delayed refresh).
 */

/** `group_modes.updated_at` at minute `m`: the client store's gate (M20.8). */
const T = (m: number) => `2026-10-05T19:${String(m).padStart(2, '0')}:00.000Z`;

/** The row as the page rendered it (at `T(4)`): Fearless, nothing pending, the switch at its default. */
const SERVER: ModeRow = { standing: 'fearless', pending: null, rated: null };

const PROPS: HarnessProps = {
  groupId: ORIGINAL_GROUP.id,
  banned: 0,
  inGame: false,
  redirectTo: '/g/customs',
  resetConfirmHref: '/g/customs/mode/reset',
  server: SERVER,
  serverUpdatedAt: T(4),
};

/** The route's answer (M20.7): `{ state, notice }`, the row after the write and its one line. */
function answer(row: Partial<ModeRow> & { nextRated: boolean; at: string }, notice: string, spun?: string) {
  const { nextRated, at, ...rest } = row;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      state: { ...SERVER, ...rest, nextRated, updatedAt: at },
      notice,
      changed: true,
      ...(spun === undefined ? {} : { spun }),
    }),
  } as Response;
}

const TANKS = { id: 'class', tag: 'Tank' } as const;
const TANKS_LINE = 'Next game: Class wars, tanks only. Not rated.';

/** A fetch whose answers the test releases one at a time. */
function heldFetch() {
  const pending: ((response: Response) => void)[] = [];
  const mock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  return {
    mock,
    async release(response: Response) {
      await act(async () => {
        pending.shift()?.(response);
      });
    },
  };
}

const bodies = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));

const select = () => screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
const setButton = () => screen.queryByRole('button', { name: SET_MODE });
const spinButton = () => screen.getByRole('button', { name: /^Spin/ });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetModeStoreForTests();
  resetControlsForTests();
});

/** The controls' outcome line: shown in place, not a live region (the Announcer speaks). */
const outcome = () => document.querySelector('[data-slot="mode-outcome"]') as HTMLElement;

describe('Set mode answers on its own', () => {
  it('the button goes away once the choice is confirmed, and cannot post it again before the re-read', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    expect(setButton()).toBeNull();

    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    fireEvent.click(setButton() as HTMLElement);
    // A second tap while it is in flight is ignored.
    fireEvent.submit(select().form as HTMLFormElement);
    expect(net.mock).toHaveBeenCalledTimes(1);
    await net.release(answer({ pending: TANKS, nextRated: false, at: T(5) }, TANKS_LINE));

    // The page has not re-read (still Fearless at T(4)): the choice stands anyway, and the line is
    // the route's own notice.
    expect(setButton()).toBeNull();
    expect(select().value).toBe('class:Tank');
    expect(outcome()).toHaveTextContent(TANKS_LINE);
    fireEvent.submit(select().form as HTMLFormElement);
    expect(bodies(net.mock)).toEqual([{ groupId: ORIGINAL_GROUP.id, mode: 'class:Tank' }]);
  });

  it('M19.13: says Setting… until the route confirms, then goes with focus on the select; no re-read is asked', async () => {
    const tonight = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    const button = setButton() as HTMLElement;
    button.focus();
    fireEvent.click(button);

    // In flight: the button stays, pending, and posts nothing again.
    const pendingButton = screen.getByRole('button', { name: SETTING_MODE });
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(spinButton());
    fireEvent.submit(select().form as HTMLFormElement);
    expect(net.mock).toHaveBeenCalledTimes(1);

    // Answered: the answer is the card (the client mode store), so the button goes at once.
    await net.release(answer({ pending: TANKS, nextRated: false, at: T(5) }, TANKS_LINE));
    expect(screen.queryByRole('button', { name: SETTING_MODE })).toBeNull();
    expect(setButton()).toBeNull();
    expect(select()).toHaveFocus();
    // Zero server renders per mode change: the controls ask Tonight for nothing.
    expect(tonight.asks).toHaveLength(0);
    tonight.stop();
  });

  it('the Rated switch takes the route answer with it (a rule resets it to the rule default)', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAccessibleDescription(RATED_ON);
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release(answer({ pending: TANKS, nextRated: false, at: T(5) }, TANKS_LINE));
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAccessibleDescription(RATED_OFF);
  });

  it('an older re-read does not move the select back; a newer one (another admin) is taken', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'normal' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release(answer({ standing: 'normal', nextRated: true, at: T(5) }, 'Mode: Normal.'));
    rerender(<ModeControls {...PROPS} server={SERVER} serverUpdatedAt={T(4)} />);
    expect(select().value).toBe('normal');
    expect(setButton()).toBeNull();
    rerender(<ModeControls {...PROPS} server={{ ...SERVER, standing: 'normal' }} serverUpdatedAt={T(5)} />);
    expect(select().value).toBe('normal');
    rerender(
      <ModeControls
        {...PROPS}
        server={{ ...SERVER, standing: 'normal', pending: { id: 'class', tag: 'Mage' } }}
        serverUpdatedAt={T(6)}
      />,
    );
    expect(select().value).toBe('class:Mage');
    expect(setButton()).toBeNull();
  });

  it('a failure says so and puts the select back on the confirmed value', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'mirror' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release({ ok: false, status: 500, json: async () => ({}) } as Response);
    expect(screen.getByRole('alert')).toHaveTextContent(MODE_CHANGE_FAILED);
    expect(select().value).toBe('fearless');
    expect(setButton()).toBeNull();
  });

  it("the server's rule check (409) says the rule has too few champions open", async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'class:Support' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release({ ok: false, status: 409, json: async () => ({}) } as Response);
    expect(screen.getByRole('alert')).toHaveTextContent('That rule has too few champions open tonight.');
    expect(select().value).toBe('fearless');
  });
});

describe('Spin is quiet during its own reveal', () => {
  it('a double tap after the answer never spins twice; it frees once the page has it and the reveal cycled', async () => {
    vi.useFakeTimers();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const reveals: unknown[] = [];
    const onReveal = (event: Event) => reveals.push((event as CustomEvent).detail);
    window.addEventListener(SPIN_REVEAL_EVENT, onReveal);
    const { rerender } = render(<ModeControls {...PROPS} />);

    fireEvent.click(spinButton());
    fireEvent.click(spinButton());
    expect(net.mock).toHaveBeenCalledTimes(1);
    await net.release(
      answer(
        { pending: { id: 'class', tag: 'Mage' }, nextRated: false, at: T(5) },
        'Spin says: Mages only.',
        'class:Mage',
      ),
    );
    expect(reveals).toEqual([{ rule: 'class:Mage', source: 'local' }]);
    // Answered, but the reveal has not played: still quiet, and a tap posts nothing.
    expect(spinButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(spinButton());
    expect(net.mock).toHaveBeenCalledTimes(1);
    // The select already shows the spin.
    expect(select().value).toBe('class:Mage');

    // The page re-reads the spin; the reveal cycles; then Spin is back.
    rerender(
      <ModeControls
        {...PROPS}
        server={{ ...SERVER, pending: { id: 'class', tag: 'Mage' } }}
        serverUpdatedAt={T(5)}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(SPIN_CYCLE_MS - 1);
    });
    expect(spinButton()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(spinButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(spinButton());
    expect(net.mock).toHaveBeenCalledTimes(2);
    window.removeEventListener(SPIN_REVEAL_EVENT, onReveal);
  });

  it('M19.13: with no re-read at all, the answer is the card, so Spin frees after the cycle; region names its pair', async () => {
    vi.useFakeTimers();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const reveals: unknown[] = [];
    const onReveal = (event: Event) => reveals.push((event as CustomEvent).detail);
    window.addEventListener(SPIN_REVEAL_EVENT, onReveal);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(spinButton());
    await net.release(
      answer(
        { pending: { id: 'region', blue: 'zaun', red: 'noxus' }, nextRated: false, at: T(5) },
        'Spin says: Region wars. Blue: Zaun · Red: Noxus.',
        'region',
      ),
    );
    // This page's reveal is the route's answer, pair included (M20.8 acceptance 6).
    expect(reveals).toEqual([{ rule: 'region', source: 'local', blue: 'zaun', red: 'noxus' }]);
    expect(select().value).toBe('region');
    window.removeEventListener(SPIN_REVEAL_EVENT, onReveal);
    await act(async () => {
      vi.advanceTimersByTime(SPIN_CYCLE_MS - 1);
    });
    expect(spinButton()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(spinButton()).not.toHaveAttribute('aria-disabled');
  });

  it('an answer that does not parse still frees Spin after the reveal wait (the page re-reads)', async () => {
    vi.useFakeTimers();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(spinButton());
    await net.release({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, mode: 'fearless', changed: true, spun: 'region' }),
    } as Response);
    await act(async () => {
      vi.advanceTimersByTime(SPIN_WAIT_MS);
    });
    expect(spinButton()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      vi.advanceTimersByTime(SPIN_CYCLE_MS);
    });
    expect(spinButton()).not.toHaveAttribute('aria-disabled');
  });

  it('a refused Spin (nothing to spin) is free at once', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(spinButton());
    await net.release({ ok: false, status: 409, json: async () => ({}) } as Response);
    expect(spinButton()).not.toHaveAttribute('aria-disabled');
  });
});

describe('focus never drops to the page (QA fix 2026-10-04)', () => {
  it('after Set mode succeeds, focus is on the select (its button is gone)', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'class:Mage' } });
    (setButton() as HTMLElement).focus();
    fireEvent.click(setButton() as HTMLElement);
    await net.release(
      answer(
        { pending: { id: 'class', tag: 'Mage' }, nextRated: false, at: T(5) },
        'Next game: Class wars, mages only. Not rated.',
      ),
    );
    expect(setButton()).toBeNull();
    expect(select()).toHaveFocus();
  });

  it('after Reset fearless, focus is on the outcome line', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} banned={3} />);
    fireEvent.click(screen.getByRole('button', { name: FEARLESS_RESET_BUTTON }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: FEARLESS_RESET_BUTTON }));
    await net.release({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, post: 'posted' }),
    } as Response);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const line = screen.getByText(FEARLESS_RESET_POSTED);
    expect(line).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(line).toHaveFocus());
  });
});

describe('said once, by the Announcer (QA fix 2026-10-04)', () => {
  const before: ModeSpeech = {
    standing: 'fearless',
    pending: null,
    nextRated: true,
    lockedRule: null,
    locked: false,
    lobbyStatus: null,
  };
  const page = (props: Partial<HarnessProps>, speech: ModeSpeech) => (
    <>
      <Announcer text="" mode="fearless" speech={speech} />
      <ModeControls {...PROPS} {...props} />
    </>
  );
  const live = () => screen.getAllByRole('status');

  it('a Set mode: the controls show the line, the one live region says it when the card re-reads', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(page({}, before));
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release(answer({ pending: TANKS, nextRated: false, at: T(5) }, TANKS_LINE));
    const line = TANKS_LINE;
    expect(outcome()).toHaveTextContent(line);
    // One live region on the page, and it is the Announcer's.
    expect(live()).toHaveLength(1);
    rerender(
      page(
        { server: { ...SERVER, pending: TANKS }, serverUpdatedAt: T(5) },
        { ...before, pending: { id: 'class', tag: 'Tank' }, nextRated: false },
      ),
    );
    expect(live()).toHaveLength(1);
    expect(live()[0]).toHaveTextContent(line);
  });

  it('a Rated flip: the same', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(page({}, before));
    fireEvent.click(screen.getByRole('switch', { name: 'Rated' }));
    await net.release(answer({ rated: false, nextRated: false, at: T(5) }, 'Next game is not rated.'));
    expect(live()).toHaveLength(1);
    rerender(
      page({ server: { ...SERVER, rated: false }, serverUpdatedAt: T(5) }, { ...before, nextRated: false }),
    );
    expect(live()[0]).toHaveTextContent('Next game is not rated.');
    expect(outcome()).toHaveTextContent('Next game is not rated.');
  });
});
