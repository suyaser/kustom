import { regionPool } from '@customs/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { regionFacts } from '@/lib/mode/card';
import { regionOpenFor, regionPairPasses, regionTargets } from '@/lib/mode/cardView';
import { championTable } from '@/lib/mode/champions';
import { applyModeRow, resetModeStoreForTests } from '@/lib/mode/clientStore';
import { resetControlsForTests } from '@/lib/mode/controlsStore';
import { REGION_PAIR_SHORT } from '@/lib/mode/ruleCopy';
import {
  ADMIN_VIEWER,
  ANON_VIEWER,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * M20.10: region wars' pair as mode state on the Mode card (M20 D9, D11; M20.1's copy). The admin
 * foot carries `Redraw regions` and the `Blue's region` / `Red's region` selects for the next
 * game's pair while region wars is pending (any lobby state) and for this game's while the lobby is
 * balanced; once in game this game's pair is frozen. Members see the pair, never a control. Every
 * control is a no-JS form to the mode route and, with JS, shows the route's notice. The short-pair
 * line (D11) is under the status for everyone while the shown next-game pair fails the draw rule.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
const table = championTable();

function page(
  key: TonightStateKey,
  options: TonightFixtureOptions = {},
  admin = true,
  tweak: (fixture: ReturnType<typeof tonightStateFixture>) => ReturnType<typeof tonightStateFixture> = (f) =>
    f,
) {
  const { connection: _c, ...fixture } = tweak(tonightStateFixture(key, { now: NOW, ...options }));
  return <TonightView {...fixture} viewer={admin ? ADMIN_VIEWER : MEMBER_VIEWER} group={ORIGINAL_GROUP} />;
}

/** A Fearless night with every Ixtal champion banned, and the next game's pair Ixtal vs `red`. */
function ixtalShort(red = 'noxus') {
  return (fixture: ReturnType<typeof tonightStateFixture>) => {
    const ixtal = regionPool('ixtal', table);
    const pending = { id: 'region' as const, blue: 'ixtal', red };
    return {
      ...fixture,
      snapshot: {
        ...fixture.snapshot,
        modeRow: fixture.snapshot.modeRow && { ...fixture.snapshot.modeRow, pending },
        fearless: {
          ...fixture.snapshot.fearless,
          champions: [
            ...fixture.snapshot.fearless.champions.filter((c) => !ixtal.includes(c.id)),
            ...ixtal.map((id) => ({ id, name: `Champion ${id}`, role: null })),
          ],
        },
      },
    };
  };
}

const card = () => screen.getByRole('region', { name: /^Mode / });
const status = () => card().querySelector('a') as HTMLElement;
const blue = () => screen.getByRole('combobox', { name: "Blue's region" }) as HTMLSelectElement;
const red = () => screen.getByRole('combobox', { name: "Red's region" }) as HTMLSelectElement;
const nextPair = () => card().querySelector('[data-slot="region-controls-next"]') as HTMLElement;
const ready = () => screen.findByRole('switch', { name: 'Rated' });

function answer(pending: { blue: string; red: string } | null, notice: string, status = 200) {
  return vi.fn(
    async () =>
      ({
        ok: status === 200,
        status,
        json: async () =>
          status === 200
            ? {
                ok: true,
                state: {
                  standing: 'fearless',
                  pending: pending === null ? null : { id: 'region', ...pending },
                  rated: null,
                  nextRated: false,
                  updatedAt: '2026-09-08T20:31:00.000Z',
                },
                notice,
                changed: true,
              }
            : { ok: false, error: notice },
      }) as Response,
  );
}

const bodyOf = (mock: ReturnType<typeof vi.fn>, call = 0) => {
  const [, init] = mock.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetModeStoreForTests();
  resetControlsForTests();
});

describe('next game: region wars chosen, before Roll', () => {
  for (const key of ['empty-admin', 'idle', 'filling'] as const) {
    it(`${key}: Redraw regions and both side selects, showing the pair, under no heading`, async () => {
      render(page(key, { rule: 'region' }));
      await ready();
      expect(blue().value).toBe('ionia');
      expect(red().value).toBe('noxus');
      expect(screen.getByRole('button', { name: 'Redraw regions' })).toBeInTheDocument();
      // Before Roll the pair belongs to the mode picker above it: no `This game` / `Next game` head.
      const foot = card().querySelector('[data-slot="region-controls-next"]') as HTMLElement;
      expect(foot).not.toBeNull();
      expect(within(foot).queryByText('Next game')).toBeNull();
      expect(card().querySelector('[data-slot="region-controls-this"]')).toBeNull();
      // 13 regions, no Random, no `unaffiliated`.
      expect(blue().options).toHaveLength(13);
      expect([...blue().options].map((o) => o.textContent)).not.toContain('Random');
      // A select never posts on change: Set region only once the choice differs.
      expect(screen.queryByRole('button', { name: 'Set region' })).toBeNull();
    });
  }

  it('members and visitors see the pair and no control', async () => {
    render(page('idle', { rule: 'region' }, false));
    expect(within(status()).getByText('Ionia')).toBeInTheDocument();
    expect(within(status()).getByText('Noxus')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redraw regions' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: "Blue's region" })).toBeNull();
    expect(screen.queryByRole('combobox', { name: "Red's region" })).toBeNull();
  });

  it('no controls when region wars is not pending', async () => {
    render(page('idle', { rule: 'class:Tank' }));
    await ready();
    expect(screen.queryByRole('button', { name: 'Redraw regions' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: "Blue's region" })).toBeNull();
  });

  it('every control is a no-JS form to the mode route, for the next game', async () => {
    render(page('idle', { rule: 'region' }));
    await ready();
    const redraw = screen.getByRole('button', { name: 'Redraw regions' }).closest('form') as HTMLFormElement;
    expect(redraw).toHaveAttribute('method', 'post');
    expect(redraw).toHaveAttribute('action', '/api/admin/mode');
    expect(Object.fromEntries(new FormData(redraw))).toEqual({
      groupId: ORIGINAL_GROUP.id,
      redirectTo: '/g/customs',
      redraw: 'true',
      game: 'next',
    });
    for (const [side, select, region] of [
      ['blue', blue(), 'ionia'],
      ['red', red(), 'noxus'],
    ] as const) {
      const form = select.closest('form') as HTMLFormElement;
      expect(form).toHaveAttribute('action', '/api/admin/mode');
      expect(Object.fromEntries(new FormData(form))).toEqual({
        groupId: ORIGINAL_GROUP.id,
        redirectTo: '/g/customs',
        side,
        game: 'next',
        region,
      });
    }
  });

  it('a no-JS post comes back with the route notice in the outcome line', async () => {
    render(
      page('idle', { rule: 'region' }, true, (f) => ({
        ...f,
        modeNotice: { notice: 'Next game: Shurima vs Zaun.', error: null },
      })),
    );
    await ready();
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent(
      'Next game: Shurima vs Zaun.',
    );
  });

  it('Redraw posts { redraw, game: next }; the card and the selects take the answer, the line is its notice', async () => {
    const fetchMock = answer({ blue: 'shurima', red: 'zaun' }, 'Next game: Shurima vs Zaun.');
    vi.stubGlobal('fetch', fetchMock);
    render(page('idle', { rule: 'region' }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Redraw regions' }));
    await act(async () => {});
    expect(bodyOf(fetchMock)).toEqual({ groupId: ORIGINAL_GROUP.id, redraw: true, game: 'next' });
    expect(within(status()).getByText('Shurima')).toBeInTheDocument();
    expect(within(status()).getByText('Zaun')).toBeInTheDocument();
    expect(blue().value).toBe('shurima');
    expect(red().value).toBe('zaun');
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent(
      'Next game: Shurima vs Zaun.',
    );
  });

  it('a side change posts { side, region, game: next } from Set region', async () => {
    const fetchMock = answer({ blue: 'shurima', red: 'noxus' }, 'Next game: Shurima vs Noxus.');
    vi.stubGlobal('fetch', fetchMock);
    render(page('filling', { rule: 'region' }));
    await ready();
    fireEvent.change(blue(), { target: { value: 'shurima' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set region' }));
    await act(async () => {});
    expect(bodyOf(fetchMock)).toEqual({
      groupId: ORIGINAL_GROUP.id,
      side: 'blue',
      region: 'shurima',
      game: 'next',
    });
    expect(blue().value).toBe('shurima');
    expect(red().value).toBe('noxus');
    expect(screen.queryByRole('button', { name: 'Set region' })).toBeNull();
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent(
      'Next game: Shurima vs Noxus.',
    );
  });

  it('a refusal shows the route 409 words and puts the select back', async () => {
    vi.stubGlobal('fetch', answer(null, 'Pick two different regions.', 409));
    render(page('idle', { rule: 'region' }));
    await ready();
    fireEvent.change(red(), { target: { value: 'ionia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set region' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Pick two different regions.');
    expect(red().value).toBe('noxus');
    expect(within(status()).getByText('Noxus')).toBeInTheDocument();
  });
});

describe('this game: the balanced lobby locked region wars', () => {
  it('this game controls under a This game heading; members get none', async () => {
    const view = render(page('balanced', { rule: 'region' }));
    await ready();
    // M20.18: the `This game` legend heads everything that changes this game (the picker, Spin,
    // this game's pair and Rated); the pair's own fieldset sits inside it.
    const group = screen.getByRole('group', { name: 'This game' });
    expect(group).toHaveAttribute('data-slot', 'mode-this-game');
    expect(group.querySelector('[data-slot="region-controls-this"]')).not.toBeNull();
    expect((within(group).getByRole('combobox', { name: "Blue's region" }) as HTMLSelectElement).value).toBe(
      'ionia',
    );
    // Roll moved the rule: nothing pending, so no next-game pair.
    expect(card().querySelector('[data-slot="region-controls-next"]')).toBeNull();
    const redraw = within(group)
      .getByRole('button', { name: 'Redraw regions' })
      .closest('form') as HTMLFormElement;
    expect(new FormData(redraw).get('game')).toBe('this');
    view.unmount();
    render(page('balanced', { rule: 'region' }, false));
    expect(screen.queryByRole('button', { name: 'Redraw regions' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'This game' })).toBeNull();
  });

  it('Redraw and a side change post game: this and show the route notice', async () => {
    const notice =
      'New regions: Shurima vs Noxus. Picks already made stay, and the check uses the new regions.';
    const fetchMock = answer(null, notice);
    vi.stubGlobal('fetch', fetchMock);
    render(page('balanced', { rule: 'region' }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Redraw regions' }));
    await act(async () => {});
    expect(bodyOf(fetchMock)).toEqual({ groupId: ORIGINAL_GROUP.id, redraw: true, game: 'this' });
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent(notice);
    fireEvent.change(blue(), { target: { value: 'shurima' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set region' }));
    await act(async () => {});
    expect(bodyOf(fetchMock, 1)).toEqual({
      groupId: ORIGINAL_GROUP.id,
      side: 'blue',
      region: 'shurima',
      game: 'this',
    });
  });

  it('with region wars queued again, each pair has its own controls', async () => {
    render(page('balanced', { rule: 'region', queued: 'region' }));
    await ready();
    const thisGame = screen.getByRole('group', { name: 'This game' });
    const next = nextPair();
    // M20.18: balanced, the picker is this game's, so the next game's pair is the only thing left
    // below the hairline, and it is headed `Next game` itself (the picker no longer says it).
    expect(next.querySelector('legend')).toHaveTextContent('Next game');
    expect(screen.getByRole('group', { name: 'Next game' })).toBe(next);
    expect(screen.getAllByRole('button', { name: 'Redraw regions' })).toHaveLength(2);
    // The next-game group opens on a hairline, never under this game's Redraw; no caption there
    // (nothing below it is a mode change).
    const group = next.parentElement as HTMLElement;
    expect(group.className).toContain('border-t');
    expect(group).not.toContainElement(thisGame);
    expect(thisGame).not.toContainElement(next);
    expect(screen.queryByText('Changes apply from the next game.')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Next game' })).toBeNull();
    expect(screen.queryByText('Next game: Region wars.')).toBeNull();
    expect(screen.getAllByText('Next game')).toHaveLength(1);
  });
});

describe('in game: this game pair is frozen', () => {
  it('no region control for this game', async () => {
    render(page('in-game', { rule: 'region' }));
    await ready();
    expect(screen.queryByRole('button', { name: 'Redraw regions' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: "Blue's region" })).toBeNull();
    expect(within(status()).getByText('Ionia')).toBeInTheDocument();
  });

  it('region wars queued for the next game keeps its controls, under the Next game picker', async () => {
    render(page('in-game', { rule: 'class:Tank', queued: 'region' }));
    await ready();
    expect(screen.queryByRole('group', { name: 'This game' })).toBeNull();
    const next = nextPair();
    // In game there is no this-game group, so no hairline: the caption sits in the foot itself.
    expect(screen.getByText('Changes apply from the next game.').parentElement).toHaveTextContent(
      'Admins and the owner',
    );
    expect(
      new FormData(
        within(next).getByRole('button', { name: 'Redraw regions' }).closest('form') as HTMLFormElement,
      ).get('game'),
    ).toBe('next');
  });
});

describe('too few open and the short pair (M20 D11)', () => {
  it('a region under 8 open is a disabled (too few open) option; the current region stays selectable', async () => {
    render(page('idle', { rule: 'region' }, true, ixtalShort()));
    await ready();
    const ixtalBlue = [...blue().options].find((o) => o.value === 'ixtal') as HTMLOptionElement;
    expect(ixtalBlue.textContent).toBe('Ixtal (too few open)');
    expect(ixtalBlue.disabled).toBe(false);
    const ixtalRed = [...red().options].find((o) => o.value === 'ixtal') as HTMLOptionElement;
    expect(ixtalRed.textContent).toBe('Ixtal (too few open)');
    expect(ixtalRed.disabled).toBe(true);
    const shurima = [...red().options].find((o) => o.value === 'shurima') as HTMLOptionElement;
    expect(shurima.disabled).toBe(false);
    expect(shurima.textContent).toBe('Shurima');
  });

  for (const admin of [false, true]) {
    it(`${admin ? 'admin' : 'member'}: the short-pair line is under the status, once`, async () => {
      render(page('idle', { rule: 'region' }, admin, ixtalShort()));
      if (admin) await ready();
      expect(within(status()).getByText(REGION_PAIR_SHORT)).toBeInTheDocument();
      expect(screen.getAllByText(REGION_PAIR_SHORT)).toHaveLength(1);
    });
  }

  it('no line while the pair passes', async () => {
    render(page('idle', { rule: 'region' }, false));
    expect(screen.queryByText(REGION_PAIR_SHORT)).toBeNull();
  });

  it('on a Normal night the bans do not count, so no line', async () => {
    render(page('idle', { rule: 'region', mode: 'normal' }, false, ixtalShort()));
    expect(screen.queryByText(REGION_PAIR_SHORT)).toBeNull();
  });
});

describe("M20.16: the next game's regions for everyone while a game is on", () => {
  const VIEWERS = [
    ['a signed-out visitor', ANON_VIEWER],
    ['a member', MEMBER_VIEWER],
    ['an admin', ADMIN_VIEWER],
  ] as const;
  const night = (
    key: 'balanced' | 'in-game',
    viewer: (typeof VIEWERS)[number][1],
    tweak: (fixture: ReturnType<typeof tonightStateFixture>) => ReturnType<typeof tonightStateFixture> = (
      f,
    ) => f,
  ) => {
    const { connection: _c, ...fixture } = tweak(
      tonightStateFixture(key, { now: NOW, mode: 'fearless', queued: 'region' }),
    );
    return <TonightView {...fixture} viewer={viewer} group={ORIGINAL_GROUP} />;
  };
  const nextLine = () => card().querySelector('[data-slot="mode-next-region"]');

  for (const key of ['balanced', 'in-game'] as const) {
    for (const [who, viewer] of VIEWERS) {
      it(`${key}, ${who}: \`Next game: Region wars, Shurima vs Zaun.\` under this game's status`, async () => {
        render(night(key, viewer));
        if (viewer === ADMIN_VIEWER) await ready();
        expect(nextLine()).toHaveTextContent('Next game: Region wars, Shurima vs Zaun.');
        // Inside the status block (the card's link), after this game's lines.
        expect(status()).toContainElement(nextLine() as HTMLElement);
        expect(within(status()).queryByText(REGION_PAIR_SHORT)).toBeNull();
      });

      it(`${key}, ${who}: the short-pair line under it when the pair fails the draw rule`, async () => {
        render(night(key, viewer, ixtalShort()));
        if (viewer === ADMIN_VIEWER) await ready();
        expect(nextLine()).toHaveTextContent('Next game: Region wars, Ixtal vs Noxus.');
        const short = within(status()).getByText(REGION_PAIR_SHORT);
        expect(nextLine()?.nextElementSibling).toBe(short);
        // Said once on the card: the admin's next-game pair has no second copy.
        expect(screen.getAllByText(REGION_PAIR_SHORT)).toHaveLength(1);
      });
    }
  }

  it('changes without a refresh when an admin redraws (the row the channel hears)', async () => {
    render(night('in-game', ANON_VIEWER));
    expect(nextLine()).toHaveTextContent('Next game: Region wars, Shurima vs Zaun.');
    act(() => {
      applyModeRow(ORIGINAL_GROUP.id, {
        row: {
          standing: 'fearless',
          pending: { id: 'region', blue: 'shadow-isles', red: 'ionia' },
          rated: null,
        },
        updatedAt: '2026-09-08T20:35:00.000Z',
      });
    });
    expect(nextLine()).toHaveTextContent('Next game: Region wars, Shadow Isles vs Ionia.');
    // Region wars taken off the next game: the line goes.
    act(() => {
      applyModeRow(ORIGINAL_GROUP.id, {
        row: { standing: 'fearless', pending: null, rated: null },
        updatedAt: '2026-09-08T20:36:00.000Z',
      });
    });
    expect(nextLine()).toBeNull();
  });

  it('no line before Roll (the status is the pair) or with no region pair queued', () => {
    const { unmount } = render(page('idle', { rule: 'region' }, false));
    expect(nextLine()).toBeNull();
    unmount();
    render(page('in-game', { rule: 'class:Tank', queued: 'class:Mage' }, false));
    expect(nextLine()).toBeNull();
  });
});

describe('regionFacts and regionTargets: the route check, on the client', () => {
  it('agrees with core pairDrawable on every pair, with and without bans', async () => {
    const { pairDrawable } = await import('@customs/core');
    const ixtal = regionPool('ixtal', table);
    const facts = regionFacts(ixtal, table);
    const regions = [
      'bandle-city',
      'bilgewater',
      'demacia',
      'freljord',
      'ionia',
      'ixtal',
      'mount-targon',
      'noxus',
      'piltover',
      'shadow-isles',
      'shurima',
      'void',
      'zaun',
    ];
    for (const [standing, bans] of [
      ['fearless', ixtal],
      ['normal', []],
    ] as const) {
      const open = regionOpenFor(standing, facts);
      for (const a of regions)
        for (const b of regions)
          expect(regionPairPasses({ blue: a, red: b }, open), `${standing} ${a} ${b}`).toBe(
            pairDrawable(a, b, table, bans),
          );
    }
  });

  it('this game only while balanced; the next game whatever the lobby', () => {
    const facts = regionFacts([], table);
    const row = {
      standing: 'normal' as const,
      pending: { id: 'region' as const, blue: 'ionia', red: 'noxus' },
      rated: null,
    };
    const lock = {
      standing: 'normal' as const,
      mode: { id: 'region' as const, blue: 'demacia', red: 'zaun' },
      rated: null,
    };
    const balanced = regionTargets({ row, lobbyStatus: 'balanced', lock, facts });
    expect(balanced.this).toMatchObject({ game: 'this', blue: 'demacia', red: 'zaun', short: false });
    expect(balanced.next).toMatchObject({ game: 'next', blue: 'ionia', red: 'noxus' });
    const inGame = regionTargets({ row, lobbyStatus: 'in_game', lock, facts });
    expect(inGame.this).toBeNull();
    expect(inGame.next).not.toBeNull();
    expect(regionTargets({ row: { ...row, pending: null }, lobbyStatus: null, lock: null, facts })).toEqual({
      this: null,
      next: null,
    });
  });
});
