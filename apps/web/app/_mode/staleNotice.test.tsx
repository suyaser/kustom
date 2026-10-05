import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP, type PageGroup } from '@/lib/groups/pageGroup';
import { applyModeRow, resetModeStoreForTests } from '@/lib/mode/clientStore';
import { resetControlsForTests } from '@/lib/mode/controlsStore';
import { ADMIN_VIEWER, type TonightFixtureOptions, tonightStateFixture } from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * M20.15: an admin's own outcome line never contradicts the card above it. Two admins on Tonight
 * with region wars queued (Ionia vs Noxus): A taps `Redraw regions` (Shurima vs Zaun) while B sets
 * Red's region (Ionia vs Demacia), and B's write lands last (M20 D7: last write wins). Both cards
 * show B's pair; A's `Next game: Shurima vs Zaun.` goes once B's row reaches A, and B's own line
 * stays. A page's own line after its own tap is unchanged (3).
 *
 * The two pages are two Tonight renders side by side. The client mode store and the controls'
 * store are per group, so each page is its own group id here: what one page's channel hears is
 * `applyModeRow` on that page's id, exactly the call `TonightLive` makes for a `group_modes` row.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
const PAGE_A: PageGroup = { ...ORIGINAL_GROUP, id: '00000000-0000-4000-8000-0000000000a1' };
const PAGE_B: PageGroup = { ...ORIGINAL_GROUP, id: '00000000-0000-4000-8000-0000000000b2' };

const A_AT = '2026-09-08T20:31:00.000Z';
const B_AT = '2026-09-08T20:31:00.400Z';
const A_PAIR = { id: 'region' as const, blue: 'shurima', red: 'zaun' };
const B_PAIR = { id: 'region' as const, blue: 'ionia', red: 'demacia' };
const row = (pending: typeof A_PAIR) => ({ standing: 'fearless' as const, pending, rated: null });

function tonight(group: PageGroup, key: 'idle' | 'balanced' | 'in-game', options: TonightFixtureOptions) {
  const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
  return <TonightView {...fixture} viewer={ADMIN_VIEWER} group={group} />;
}

/** The mode route: each page's tap answered with its own write's row and notice. */
function route() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { groupId: string };
    const mine = body.groupId === PAGE_A.id;
    const pending = mine ? A_PAIR : B_PAIR;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        state: { ...row(pending), nextRated: false, updatedAt: mine ? A_AT : B_AT },
        notice: mine ? 'Next game: Shurima vs Zaun.' : 'Next game: Ionia vs Demacia.',
        changed: true,
      }),
    } as Response;
  });
}

const outcome = (page: HTMLElement) => page.querySelector('[data-slot="mode-outcome"]') as HTMLElement;
const status = (page: HTMLElement) =>
  within(page).getByRole('region', { name: /^Mode / }).querySelector('a') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  resetModeStoreForTests();
  resetControlsForTests();
});

describe("M20.15: another admin's later write clears this page's notice", () => {
  for (const key of ['idle', 'in-game'] as const) {
    it(`${key}: A's notice goes once B's later write reaches A, B's stays`, async () => {
      vi.stubGlobal('fetch', route());
      const options: TonightFixtureOptions = key === 'idle' ? { rule: 'region' } : { queued: 'region' };
      const a = render(tonight(PAGE_A, key, options)).container;
      const b = render(tonight(PAGE_B, key, options)).container;
      await within(a).findByRole('switch', { name: 'Rated' });
      await within(b).findByRole('switch', { name: 'Rated' });

      // A redraws; B sets Red's region in the same second.
      await act(async () => {
        fireEvent.click(within(a).getByRole('button', { name: 'Redraw regions' }));
      });
      fireEvent.change(within(b).getByRole('combobox', { name: "Red's region" }), {
        target: { value: 'demacia' },
      });
      await act(async () => {
        fireEvent.click(within(b).getByRole('button', { name: 'Set region' }));
      });
      // (3) Each page's own line, after its own tap, exactly as today.
      expect(outcome(a)).toHaveTextContent('Next game: Shurima vs Zaun.');
      expect(outcome(b)).toHaveTextContent('Next game: Ionia vs Demacia.');

      // Each page's channel hears the other's row: A's (older) reaches B, B's (later) reaches A.
      act(() => {
        applyModeRow(PAGE_B.id, { row: row(A_PAIR), updatedAt: A_AT });
        applyModeRow(PAGE_A.id, { row: row(B_PAIR), updatedAt: B_AT });
      });
      // Both pages show B's pair (before Roll on the status; after it in the next-game selects).
      for (const page of [a, b]) {
        const red = within(page).getByRole('combobox', { name: "Red's region" }) as HTMLSelectElement;
        expect(red.value).toBe('demacia');
      }
      if (key === 'idle') {
        expect(within(status(a)).getByText('Demacia')).toBeInTheDocument();
        expect(within(status(b)).getByText('Demacia')).toBeInTheDocument();
      }
      // (1)(2) A's line said for a card that is gone; B's line is the card.
      expect(outcome(a)).toBeEmptyDOMElement();
      expect(outcome(b)).toHaveTextContent('Next game: Ionia vs Demacia.');
    });
  }

  it("B's row heard before A's own answer arrives: A's line never shows over B's card", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answered = route();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        await held;
        return answered(url, init);
      }),
    );
    const a = render(tonight(PAGE_A, 'idle', { rule: 'region' })).container;
    await within(a).findByRole('switch', { name: 'Rated' });
    await act(async () => {
      fireEvent.click(within(a).getByRole('button', { name: 'Redraw regions' }));
    });
    act(() => {
      applyModeRow(PAGE_A.id, { row: row(B_PAIR), updatedAt: B_AT });
    });
    await act(async () => {
      release();
      await held;
    });
    // The older answer is not taken onto the card (gated on updated_at), and its line goes.
    expect(within(status(a)).getByText('Demacia')).toBeInTheDocument();
    expect(outcome(a)).toBeEmptyDOMElement();
  });

  it("this game's pair: the page's own `New regions` stays through its re-read; another admin's pair clears it", async () => {
    const NEW = "New regions: Shurima vs Zaun. Picks already made stay, and the check uses the new regions.";
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              state: { standing: 'fearless', pending: null, rated: null, nextRated: true, updatedAt: null },
              notice: NEW,
              changed: true,
              thisGame: {
                lobbyId: '00000000-0000-4000-8000-00000000c0de',
                standing: 'fearless',
                mode: A_PAIR,
                rated: null,
                effectiveRated: false,
              },
            }),
          }) as Response,
      ),
    );
    /** Balanced on region wars, this game's pair as the server render read it. */
    const balanced = (pair: { blue: string; red: string } | null) => {
      const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW, rule: 'region' });
      const lobby = fixture.snapshot.lobby;
      const withPair =
        pair === null || lobby?.lock == null
          ? fixture
          : {
              ...fixture,
              snapshot: {
                ...fixture.snapshot,
                lobby: { ...lobby, lock: { ...lobby.lock, mode: { id: 'region' as const, ...pair } } },
              },
            };
      return <TonightView {...withPair} viewer={ADMIN_VIEWER} group={PAGE_A} />;
    };
    const view = render(balanced(null));
    const a = view.container;
    await within(a).findByRole('switch', { name: 'Rated' });
    await act(async () => {
      fireEvent.click(within(a).getByRole('button', { name: 'Redraw regions' }));
    });
    expect(outcome(a)).toHaveTextContent(NEW);
    // The re-read brings this page's own pair: the line stays.
    view.rerender(balanced({ blue: 'shurima', red: 'zaun' }));
    expect(outcome(a)).toHaveTextContent(NEW);
    // Another admin redraws this game's pair: the line goes.
    view.rerender(balanced({ blue: 'ionia', red: 'demacia' }));
    expect(outcome(a)).toBeEmptyDOMElement();
  });

  it('a refusal stays when the card moves (M20.17: it says why)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 409,
            json: async () => ({ ok: false, error: "Teams were just rolled, so those regions are this game's now." }),
          }) as Response,
      ),
    );
    const a = render(tonight(PAGE_A, 'idle', { rule: 'region' })).container;
    await within(a).findByRole('switch', { name: 'Rated' });
    await act(async () => {
      fireEvent.click(within(a).getByRole('button', { name: 'Redraw regions' }));
    });
    act(() => {
      applyModeRow(PAGE_A.id, { row: { standing: 'fearless', pending: null, rated: null }, updatedAt: B_AT });
    });
    expect(within(a).getByRole('alert')).toHaveTextContent(
      "Teams were just rolled, so those regions are this game's now.",
    );
  });
});
