import type { ModeLock } from '@customs/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { resetModeStoreForTests } from '@/lib/mode/clientStore';
import { resetControlsForTests } from '@/lib/mode/controlsStore';
import { MODE_APPLIES_NEXT_GAME } from '@/lib/mode/copy';
import { RATED_OFF_THIS, RATED_ON, RATED_ON_THIS } from '@/lib/mode/ruleCopy';
import { NO_THIS_GAME, THIS_GAME_STAYS } from '@/lib/mode/ruleNotices';
import { SPIN_BROADCAST_EVENT, SPIN_REVEAL_EVENT } from '@/lib/mode/spinEvents';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import {
  ADMIN_VIEWER,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * M20.18, the card half (owner 2026-10-05: "after game starts mode is set and any changes changes
 * next game"). While the lobby is `balanced`, the picker, Spin and the Rated switch act on this
 * game's lock (`game: 'this'`), show the lock's values under the `This game` legend with this
 * game's region pair, and the answer's `thisGame` is on the card at once (no Tonight re-read asked;
 * the route's `group_live` bump does that). In game and before Roll nothing changes.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
/** The lobby's id as the route keys `thisGame` on it (a uuid, as `modeLockStateSchema` wants). */
const LOBBY = '7d0c1a52-55b4-4c9e-9f0e-2f7a8c1d3b6e';

function page(key: TonightStateKey, options: TonightFixtureOptions = {}, admin = true) {
  const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
  const lobby = fixture.snapshot.lobby === null ? null : { ...fixture.snapshot.lobby, id: LOBBY };
  return (
    <TonightView
      {...fixture}
      snapshot={{ ...fixture.snapshot, lobby }}
      viewer={admin ? ADMIN_VIEWER : MEMBER_VIEWER}
      group={ORIGINAL_GROUP}
    />
  );
}

/** The same balanced night with another lock: a re-read after another admin's write. */
function pageWithLock(options: TonightFixtureOptions, lock: ModeLock) {
  const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW, ...options });
  const lobby = fixture.snapshot.lobby === null ? null : { ...fixture.snapshot.lobby, id: LOBBY, lock };
  return (
    <TonightView
      {...fixture}
      snapshot={{ ...fixture.snapshot, lobby }}
      viewer={ADMIN_VIEWER}
      group={ORIGINAL_GROUP}
    />
  );
}

const card = () => screen.getByRole('region', { name: /^Mode / });
const title = () => within(card()).getByRole('heading', { level: 2 }).textContent;
const chip = () => (within(card()).queryByText('Not rated') === null ? 'Rated' : 'Not rated');
const select = () => screen.getByRole('combobox', { name: /^(Mode|Next game)$/ }) as HTMLSelectElement;
const toggle = () => screen.getByRole('switch', { name: 'Rated' });
const ready = () => screen.findByRole('switch', { name: 'Rated' });
const outcome = () => document.querySelector('[data-slot="mode-outcome"]') as HTMLElement;
const formOf = (element: HTMLElement) => element.closest('form') as HTMLFormElement;

/** A `this` answer: the row untouched (minute 4), this game's lock after the write, the notice. */
function thisAnswer(lock: ModeLock, notice: string, extra: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      state: {
        standing: 'fearless',
        pending: null,
        rated: null,
        nextRated: true,
        updatedAt: '2026-09-08T20:04:00.000Z',
      },
      notice,
      changed: true,
      thisGame: {
        lobbyId: LOBBY,
        standing: lock.standing,
        mode: lock.mode,
        rated: lock.rated,
        effectiveRated: lock.rated ?? (lock.mode.id === 'normal' || lock.mode.id === 'fearless'),
      },
      ...extra,
    }),
  } as Response;
}

const refused = (error: string): Response =>
  ({ ok: false, status: 409, json: async () => ({ ok: false, error }) }) as Response;

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

afterEach(() => {
  vi.unstubAllGlobals();
  resetModeStoreForTests();
  resetControlsForTests();
});

describe('balanced: the controls are this game', () => {
  it('render: the picker, Spin, Rated and the pair under `This game`; nothing below for the next game', async () => {
    render(page('balanced', { rule: 'region' }));
    await ready();
    const thisGame = screen.getByRole('group', { name: 'This game' });
    expect(within(thisGame).getByRole('combobox', { name: 'Mode' })).toBe(select());
    expect(within(thisGame).getByRole('button', { name: 'Spin' })).toBeInTheDocument();
    expect(within(thisGame).getByRole('switch', { name: 'Rated' })).toBe(toggle());
    expect(within(thisGame).getByRole('button', { name: 'Redraw regions' })).toBeInTheDocument();
    expect(select().value).toBe('region');
    // Region wars is not rated by default; the sentence says whose game it is.
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF_THIS);
    expect(within(thisGame).getByText('This game only. Then back to Fearless.')).toBeInTheDocument();
    expect(screen.queryByText(MODE_APPLIES_NEXT_GAME)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Next game' })).toBeNull();
    expect(screen.queryByText('Next game')).toBeNull();
  });

  it('no-JS: the picker, Spin and Rated forms carry game=this', async () => {
    render(page('balanced', { mode: 'fearless' }));
    await ready();
    expect(new FormData(formOf(select())).get('game')).toBe('this');
    expect(new FormData(formOf(toggle())).get('game')).toBe('this');
    const spin = screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement;
    expect(new FormData(spin.form as HTMLFormElement).get('game')).toBe('this');
    expect(new FormData(spin.form as HTMLFormElement).get('spin')).toBe('true');
  });

  it('members get the card and no control', async () => {
    render(page('balanced', { rule: 'class:Tank' }, false));
    expect(title()).toBe('Class wars');
    expect(screen.queryByRole('group', { name: 'This game' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Rated' })).toBeNull();
  });

  it('Set mode posts game: this; the card moves on the tap and keeps the answer; no re-read asked', async () => {
    const asks = holdTonightRefresh();
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(page('balanced', { mode: 'fearless' }));
    await ready();
    expect(title()).toBe('Fearless');
    expect(select().value).toBe('fearless');
    fireEvent.change(select(), { target: { value: 'class:Tank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    expect(bodies(net.mock)[0]).toEqual({ groupId: ORIGINAL_GROUP.id, mode: 'class:Tank', game: 'this' });
    // The tap is drafted on this game's lock (a rule resets Rated to its default: not rated).
    expect(title()).toBe('Class wars');
    expect(chip()).toBe('Not rated');
    await net.release(
      thisAnswer(
        { standing: 'fearless', mode: { id: 'class', tag: 'Tank' }, rated: null },
        'This game: Class wars, tanks only. Not rated.',
      ),
    );
    expect(title()).toBe('Class wars');
    expect(card().textContent).toMatch(/Tanks only · \d+ open/);
    expect(select().value).toBe('class:Tank');
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(outcome()).toHaveTextContent('This game: Class wars, tanks only. Not rated.');
    expect(asks.asks).toHaveLength(0);
    asks.stop();
  });

  it('Rated posts game: this; the switch and the chip flip on the tap and keep the answer', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(page('balanced', { mode: 'fearless' }));
    await ready();
    expect(chip()).toBe('Rated');
    expect(toggle()).toHaveAccessibleDescription(RATED_ON_THIS);
    fireEvent.click(toggle());
    expect(bodies(net.mock)[0]).toEqual({ groupId: ORIGINAL_GROUP.id, rated: false, game: 'this' });
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(chip()).toBe('Not rated');
    await net.release(
      thisAnswer({ standing: 'fearless', mode: { id: 'fearless' }, rated: false }, 'This game is not rated.'),
    );
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF_THIS);
    expect(chip()).toBe('Not rated');
    expect(outcome()).toHaveTextContent('This game is not rated.');
    // The next tap posts the other way, from the answer (no re-read in between).
    fireEvent.click(toggle());
    expect(bodies(net.mock)[1]).toEqual({ groupId: ORIGINAL_GROUP.id, rated: true, game: 'this' });
  });

  it("Spin posts game: this, reveals the lock's pick here and sends no broadcast", async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const reveals: unknown[] = [];
    const broadcasts: unknown[] = [];
    const onReveal = (event: Event) => reveals.push((event as CustomEvent).detail);
    const onBroadcast = (event: Event) => broadcasts.push((event as CustomEvent).detail);
    window.addEventListener(SPIN_REVEAL_EVENT, onReveal);
    window.addEventListener(SPIN_BROADCAST_EVENT, onBroadcast);
    render(page('balanced', { mode: 'fearless' }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Spin' }));
    expect(bodies(net.mock)[0]).toEqual({ groupId: ORIGINAL_GROUP.id, spin: true, game: 'this' });
    await net.release(
      thisAnswer(
        { standing: 'fearless', mode: { id: 'region', blue: 'shurima', red: 'zaun' }, rated: null },
        'Spin says: Region wars. Blue: Shurima · Red: Zaun.',
        { spun: 'region' },
      ),
    );
    expect(title()).toBe('Region wars');
    expect(reveals).toEqual([{ rule: 'region', source: 'local', blue: 'shurima', red: 'zaun' }]);
    expect(broadcasts).toEqual([]);
    expect(document.querySelector('[data-slot="spin-reveal"]')).toHaveTextContent(
      'Spin says: Region wars. Blue: Shurima · Red: Zaun.',
    );
    window.removeEventListener(SPIN_REVEAL_EVENT, onReveal);
    window.removeEventListener(SPIN_BROADCAST_EVENT, onBroadcast);
  });

  for (const words of [THIS_GAME_STAYS, NO_THIS_GAME]) {
    it(`a 409 shows the route's words and puts the card back: ${words}`, async () => {
      const net = heldFetch();
      vi.stubGlobal('fetch', net.mock);
      render(page('balanced', { mode: 'fearless' }));
      await ready();
      fireEvent.click(toggle());
      expect(chip()).toBe('Not rated');
      await net.release(refused(words));
      expect(chip()).toBe('Rated');
      expect(toggle()).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(words);
      fireEvent.change(select(), { target: { value: 'normal' } });
      fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
      await net.release(refused(words));
      expect(title()).toBe('Fearless');
      expect(select().value).toBe('fearless');
      expect(screen.getByRole('alert')).toHaveTextContent(words);
    });
  }

  it('the answer holds over an older render; a render with another lock takes over', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    const view = render(page('balanced', { mode: 'fearless' }));
    await ready();
    fireEvent.change(select(), { target: { value: 'class:Mage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    await net.release(
      thisAnswer(
        { standing: 'fearless', mode: { id: 'class', tag: 'Mage' }, rated: null },
        'This game: Class wars, mages only. Not rated.',
      ),
    );
    expect(title()).toBe('Class wars');
    // A render still on the lock the answer was taken over (one that left before the write).
    view.rerender(page('balanced', { mode: 'fearless' }));
    expect(title()).toBe('Class wars');
    expect(select().value).toBe('class:Mage');
    expect(outcome()).toHaveTextContent('This game: Class wars, mages only. Not rated.');
    // Another admin set this game to Normal since: the re-read is the card, and the line goes.
    view.rerender(
      pageWithLock({ mode: 'fearless' }, { standing: 'normal', mode: { id: 'normal' }, rated: null }),
    );
    expect(title()).toBe('Normal');
    expect(select().value).toBe('normal');
    expect(outcome()).toBeEmptyDOMElement();
  });
});

describe('in game and before Roll: unchanged', () => {
  it('in game the picker is the next game, under the caption, and posts no game', async () => {
    const net = heldFetch();
    vi.stubGlobal('fetch', net.mock);
    render(page('in-game', { rule: 'class:Tank' }));
    await ready();
    expect(screen.queryByRole('group', { name: 'This game' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Next game' })).toBe(select());
    expect(screen.getByText(MODE_APPLIES_NEXT_GAME)).toBeInTheDocument();
    expect(toggle()).toHaveAccessibleDescription(RATED_ON);
    expect(new FormData(formOf(select())).get('game')).toBeNull();
    expect(new FormData(formOf(toggle())).get('game')).toBeNull();
    fireEvent.click(toggle());
    expect(bodies(net.mock)[0]).toEqual({ groupId: ORIGINAL_GROUP.id, rated: false });
  });

  it('before Roll the picker is `Mode` and posts no game', async () => {
    render(page('filling', { rule: 'class:Tank' }));
    await ready();
    expect(screen.queryByRole('group', { name: 'This game' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBe(select());
    expect(new FormData(formOf(select())).get('game')).toBeNull();
    expect(screen.queryByText(MODE_APPLIES_NEXT_GAME)).toBeNull();
  });
});
