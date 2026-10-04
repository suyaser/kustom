import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEARLESS_RESET_BUTTON, FEARLESS_RESET_POSTED } from '@/lib/fearless/copy';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { MODE_CHANGE_FAILED, SET_MODE, SETTING_MODE } from '@/lib/mode/copy';
import { RATED_OFF, RATED_ON } from '@/lib/mode/ruleCopy';
import type { ModeSpeech } from '@/lib/mode/speech';
import { SPIN_CYCLE_MS, SPIN_REVEAL_EVENT, SPIN_WAIT_MS } from '@/lib/mode/spinEvents';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import { Announcer } from '../_tonight/Announcer';
import { ModeControls, type ModeControlsProps } from './ModeControls';

/**
 * Set mode and Spin answer at once (QA fix 2026-10-04, the Rated switch's pattern).
 *
 * Both used to move only when the whole Tonight page had been re-read (`router.refresh`): until
 * then `Set mode` stayed on screen and a second tap posted the same choice again, and Spin was
 * live again the moment its post answered, so a double tap during the reveal spun twice. The
 * tests never re-render with new props after a tap unless they say so (the delayed refresh).
 */

const PROPS: ModeControlsProps = {
  groupId: ORIGINAL_GROUP.id,
  mode: 'fearless',
  banned: 0,
  inGame: false,
  redirectTo: '/g/customs',
  resetConfirmHref: '/g/customs/mode/reset',
  selected: 'fearless',
  nextRated: true,
  version: 4,
};

function answer(
  next: { rule: string | null; rated: boolean; version: number; standing?: string },
  spun?: string,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      mode: next.standing ?? 'fearless',
      changed: true,
      next: {
        standing: next.standing ?? 'fearless',
        rule: next.rule,
        rated: next.rated,
        ratedOverride: null,
        version: next.version,
      },
      ...(spun === undefined ? {} : { spun }),
    }),
  } as Response;
}

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
    await net.release(answer({ rule: 'class:Tank', rated: false, version: 5 }));

    // The page has not re-read (still `selected: fearless`, version 4): the choice stands anyway.
    expect(setButton()).toBeNull();
    expect(select().value).toBe('class:Tank');
    expect(outcome()).toHaveTextContent('Next game: Class wars, tanks only. Not rated.');
    fireEvent.submit(select().form as HTMLFormElement);
    expect(bodies(net.mock)).toEqual([{ groupId: ORIGINAL_GROUP.id, mode: 'class:Tank' }]);
  });

  it('M19.3: says Setting… until the new card is on screen, then goes, with focus on the select', async () => {
    const tonight = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    const button = setButton() as HTMLElement;
    button.focus();
    fireEvent.click(button);
    await net.release(answer({ rule: 'class:Tank', rated: false, version: 5 }));
    expect(tonight.asks).toHaveLength(1);

    // Answered, the old card still up: the button stays, pending, and posts nothing again.
    const pendingButton = screen.getByRole('button', { name: SETTING_MODE });
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(spinButton());
    fireEvent.submit(select().form as HTMLFormElement);
    expect(net.mock).toHaveBeenCalledTimes(1);

    // The re-read lands (new props), then the button goes and focus is on the select.
    rerender(<ModeControls {...PROPS} selected="class:Tank" nextRated={false} version={5} />);
    await act(async () => tonight.land());
    await waitFor(() => expect(screen.queryByRole('button', { name: SETTING_MODE })).toBeNull());
    expect(setButton()).toBeNull();
    expect(select()).toHaveFocus();
    tonight.stop();
  });

  it('the Rated switch takes the route answer with it (a rule resets it to the rule default)', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAccessibleDescription(RATED_ON);
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release(answer({ rule: 'class:Tank', rated: false, version: 5 }));
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAccessibleDescription(RATED_OFF);
  });

  it('an older re-read does not move the select back; a newer one (another admin) is taken', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const { rerender } = render(<ModeControls {...PROPS} />);
    fireEvent.change(select(), { target: { value: 'normal' } });
    fireEvent.click(setButton() as HTMLElement);
    await net.release(answer({ rule: null, rated: true, version: 5, standing: 'normal' }));
    rerender(<ModeControls {...PROPS} selected="fearless" version={4} />);
    expect(select().value).toBe('normal');
    expect(setButton()).toBeNull();
    rerender(<ModeControls {...PROPS} mode="normal" selected="normal" version={5} />);
    expect(select().value).toBe('normal');
    rerender(<ModeControls {...PROPS} mode="normal" selected="class:Mage" version={6} />);
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
    await net.release(answer({ rule: 'class:Mage', rated: false, version: 5 }, 'class:Mage'));
    expect(reveals).toEqual([{ rule: 'class:Mage', source: 'local' }]);
    // Answered, but the reveal has not played: still quiet, and a tap posts nothing.
    expect(spinButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(spinButton());
    expect(net.mock).toHaveBeenCalledTimes(1);
    // The select already shows the spin.
    expect(select().value).toBe('class:Mage');

    // The page re-reads the spin; the reveal cycles; then Spin is back.
    rerender(<ModeControls {...PROPS} selected="class:Mage" version={5} />);
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

  it('a page that never re-reads still frees Spin after the reveal wait', async () => {
    vi.useFakeTimers();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(<ModeControls {...PROPS} />);
    fireEvent.click(spinButton());
    await net.release(answer({ rule: 'region', rated: false, version: 5 }, 'region'));
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
    await net.release(answer({ rule: 'class:Mage', rated: false, version: 5 }));
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
    lobbyStatus: null,
  };
  const page = (props: Partial<ModeControlsProps>, speech: ModeSpeech) => (
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
    await net.release(answer({ rule: 'class:Tank', rated: false, version: 5 }));
    const line = 'Next game: Class wars, tanks only. Not rated.';
    expect(outcome()).toHaveTextContent(line);
    // One live region on the page, and it is the Announcer's.
    expect(live()).toHaveLength(1);
    rerender(
      page(
        { selected: 'class:Tank', nextRated: false, version: 5 },
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
    await net.release({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: 'fearless',
        changed: true,
        next: { standing: 'fearless', rule: null, rated: false, ratedOverride: false, version: 5 },
      }),
    } as Response);
    expect(live()).toHaveLength(1);
    rerender(page({ nextRated: false, version: 5 }, { ...before, nextRated: false }));
    expect(live()[0]).toHaveTextContent('Next game is not rated.');
    expect(outcome()).toHaveTextContent('Next game is not rated.');
  });
});
