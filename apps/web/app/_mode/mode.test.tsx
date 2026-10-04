import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { preload } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEARLESS_SEARCH_EMPTY, fearlessAvailable, fearlessBanned } from '@/lib/fearless/copy';
import type { FearlessChampion } from '@/lib/fearless/types';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { MODE_ANNOUNCEMENTS, MODE_CHANGE_FAILED } from '@/lib/mode/copy';
import { parseLane } from '@/lib/mode/view';
import { ModeControlsHarness } from '@/lib/testing/ModeControlsHarness';
import { Announcer } from '../_tonight/Announcer';
import { demoPool } from '../_tonight/fixtures';
import { FearlessPool } from './FearlessPool';
import { ModeCard } from './ModeCard';
import { ModeControls } from './ModeControls';
import { ModePanelBody } from './ModePanelBody';

/**
 * The Mode card's controls, the panel body and the fearless pool (M14.30), by role and text.
 * Tonight's per-state card variants are in `app/_tonight/TonightView.test.tsx`.
 */

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn(actual.preload) };
});

const POOL: FearlessChampion[] = [
  { id: 103, name: 'Ahri', role: 'mid' },
  { id: 222, name: 'Jinx', role: 'adc' },
  { id: 64, name: 'Lee Sin', role: 'jungle' },
  { id: 99_999, name: 'Champion 99999', role: null },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('region wars sides: no empty column (QA fix 2026-10-04)', () => {
  const sides = [
    {
      side: 'blue' as const,
      title: 'BLUE Ionia',
      region: 'Ionia',
      within: [103, 64],
      emptyLane: { top: 'No champion from Ionia usually plays here. Any of them will do.' },
    },
    { side: 'red' as const, title: 'RED Noxus', region: 'Noxus', within: [222] },
  ];

  it("a side's lane with none of its champions keeps its row with the side's sentence", () => {
    render(<FearlessPool banned={[]} initialLane="top" viewerLane={null} sides={sides} />);
    const top = screen.getByRole('region', { name: 'BLUE Ionia top' });
    expect(
      within(top).getByText('No champion from Ionia usually plays here. Any of them will do.'),
    ).toBeInTheDocument();
    // A side with no sentences keeps the old shape: no row for a lane it has nothing in.
    expect(screen.queryByRole('region', { name: 'RED Noxus top' })).toBeNull();
  });

  it('typing drops the sentence rows (the find answers instead)', () => {
    render(<FearlessPool banned={[]} initialLane="all" viewerLane={null} sides={sides} />);
    fireEvent.change(screen.getByLabelText('Find a champion'), { target: { value: 'ahri' } });
    expect(screen.queryByText(/usually plays here/)).toBeNull();
  });
});

describe('the fearless pool in the panel', () => {
  it('opens on ?lane= with one lane, and All shows every lane plus other', () => {
    render(<FearlessPool banned={POOL} initialLane="jungle" viewerLane={null} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^jungle/),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const lanes = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.split(/\d/)[0]);
    expect(lanes).toEqual(['top', 'jungle', 'mid', 'adc', 'support', 'other']);
  });

  it('is a single-select group named Lane, pressed state by aria-pressed', () => {
    render(<FearlessPool banned={POOL} initialLane="all" viewerLane={null} />);
    const group = screen.getByRole('group', { name: 'Lane' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All', 'top', 'jungle', 'mid', 'adc', 'support']);
    fireEvent.click(within(group).getByRole('button', { name: 'mid' }));
    expect(
      within(group)
        .getAllByRole('button', { pressed: true })
        .map((b) => b.textContent),
    ).toEqual(['mid']);
  });

  it('says Your lane this game on the viewer lane, with Show every lane', () => {
    render(<FearlessPool banned={POOL} initialLane="support" viewerLane="support" />);
    expect(screen.getByText('Your lane this game: support.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show every lane' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(1);
  });

  it('typing ignores the lane control, opens every Banned fold and hides the counts', () => {
    render(<FearlessPool banned={POOL} initialLane="top" viewerLane={null} />);
    fireEvent.change(screen.getByLabelText('Find a champion'), { target: { value: 'ahri' } });
    const mid = screen.getByRole('region', { name: 'mid' });
    expect(within(mid).getByText('Ahri').closest('details')).toHaveAttribute('open');
    expect(within(mid).queryByText(/open$/)).toBeNull();
  });

  it("answers in M10.2 / M10.3's three strings, byte for byte", () => {
    render(<FearlessPool banned={POOL} initialLane="all" viewerLane={null} />);
    const box = screen.getByLabelText('Find a champion');
    fireEvent.change(box, { target: { value: 'Ahri' } });
    expect(screen.getByRole('status')).toHaveTextContent(fearlessBanned('Ahri'));
    expect(fearlessBanned('Ahri')).toBe('Ahri is on the ban list.');
    fireEvent.change(box, { target: { value: 'garen' } });
    expect(screen.getByRole('status')).toHaveTextContent(fearlessAvailable('Garen'));
    expect(fearlessAvailable('Garen')).toBe('Garen is still open.');
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status')).toHaveTextContent(FEARLESS_SEARCH_EMPTY);
  });

  it('draws a sprite box for a known champion, none for an unknown id, and drops every box on a sheet error', () => {
    const images: { onerror: (() => void) | null }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        src = '';
        constructor() {
          images.push(this);
        }
      },
    );
    const { container } = render(<FearlessPool banned={POOL} initialLane="all" viewerLane={null} />);
    const ahri = screen.getByText('Ahri').closest('li');
    expect(ahri?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    const unknown = screen.getByText('Champion 99999').closest('li');
    expect(unknown?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(images).toHaveLength(6);
    act(() => images[2]?.onerror?.());
    expect(container.firstElementChild).toHaveAttribute('data-icons', 'off');
  });
});

describe('the Mode card on Tonight loads only the icons it shows (M14.45)', () => {
  const TEN: FearlessChampion[] = [
    { id: 266, name: 'Aatrox', role: 'top' },
    { id: 86, name: 'Garen', role: 'top' },
    { id: 64, name: 'Lee Sin', role: 'jungle' },
    { id: 99_999, name: 'Champion 99999', role: 'mid' },
  ];
  // React dedupes `preload` per document for good, so the calls are counted, not the `<link>`s.
  const sheetPreloads = () =>
    vi.mocked(preload).mock.calls.filter(([href]) => /img\/sprite\/champion\d\.png/.test(href));
  const card = (variant: 'finished' | 'filling' = 'finished') =>
    render(
      <ModeCard
        group={ORIGINAL_GROUP}
        mode="fearless"
        fearless={demoPool(false)}
        variant={variant}
        bannedNext={{ champions: TEN, gameNumber: 4 }}
      />,
    );

  afterEach(() => {
    vi.mocked(preload).mockClear();
  });

  it("draws Banned next game's chips as their own lazy 24 x 24 squares, through the image optimizer", () => {
    card();
    const img = screen.getByText('Aatrox').closest('li')?.querySelector('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width', '24');
    expect(img).toHaveAttribute('height', '24');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.getAttribute('src')).toMatch(
      /^\/_next\/image\?url=.*16\.19\.1%2Fimg%2Fchampion%2FAatrox\.png/,
    );
    // An id the pin does not ship: no box at all.
    expect(screen.getByText('Champion 99999').closest('li')?.querySelector('img')).toBeNull();
  });

  it('preloads no sprite sheet on render, and all six on intent (pointerenter on the link)', () => {
    card();
    expect(sheetPreloads()).toHaveLength(0);
    fireEvent.pointerEnter(screen.getByRole('link', { name: /See what's open/ }));
    expect(sheetPreloads()).toHaveLength(6);
  });

  it('filling: no sheets on render either; focusing a lane tile warms them', () => {
    card('filling');
    expect(sheetPreloads()).toHaveLength(0);
    fireEvent.focus(screen.getByRole('link', { name: /^top/ }));
    expect(sheetPreloads()).toHaveLength(6);
  });

  it('the panel still preloads all six when it renders, so it paints its icons on open', () => {
    render(
      <ModePanelBody
        mode="fearless"
        fearless={demoPool(false)}
        lane="all"
        viewerLane={null}
        isAdmin={false}
        poolSince="Thu 1 Oct"
        cardHref="/g/customs#mode"
        heading="h2"
        headingId="t"
      />,
    );
    expect(sheetPreloads()).toHaveLength(6);
  });
});

describe('?lane=', () => {
  it('pre-selects a lane and falls back to All for anything else', () => {
    expect(parseLane('jungle')).toBe('jungle');
    expect(parseLane(['mid', 'top'])).toBe('mid');
    expect(parseLane('bot')).toBe('all');
    expect(parseLane(undefined)).toBe('all');
  });
});

describe('the panel body', () => {
  const body = (over: Partial<Parameters<typeof ModePanelBody>[0]> = {}) =>
    render(
      <ModePanelBody
        mode="fearless"
        fearless={demoPool(false)}
        lane="all"
        viewerLane={null}
        isAdmin={false}
        poolSince="Thu 1 Oct"
        cardHref="/g/customs#mode"
        heading="h2"
        headingId="t"
        {...over}
      />,
    );

  it('Fearless: the pool since, the counts open first, the pool tool', () => {
    body();
    expect(screen.getByRole('heading', { level: 2, name: 'Fearless' })).toBeInTheDocument();
    expect(
      screen.getByText('Pool since Thu 1 Oct, 4 games. Every champion locked since then is banned.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Find a champion')).toBeInTheDocument();
  });

  it('A6: the lanes sit one level under the title (h3 under the overlay h2, h2 under the page h1)', () => {
    const lanesAt = (level: number) =>
      screen.getAllByRole('heading', { level }).map((h) => h.textContent?.split(/\d/)[0]);
    const overlay = body();
    expect(lanesAt(3)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    overlay.unmount();
    body({ heading: 'h1' });
    expect(screen.getByRole('heading', { level: 1, name: 'Fearless' })).toBeInTheDocument();
    expect(lanesAt(2)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
  });

  it('Normal: every champion open, the paused line, and no pool tool', () => {
    body({ mode: 'normal' });
    expect(screen.getByText('Every champion is open, and games are rated as usual.')).toBeInTheDocument();
    expect(
      screen.getByText(/^Fearless is paused with \d+ banned\. When an admin picks Fearless again/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Find a champion')).toBeNull();
  });

  it('no control in the panel; an admin gets the line pointing at the card', () => {
    body({ isAdmin: true, heading: 'h1' });
    expect(screen.getByRole('heading', { level: 1, name: 'Fearless' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mode card on Tonight' })).toHaveAttribute(
      'href',
      '/g/customs#mode',
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
  });
});

describe('the admin controls on the card', () => {
  const draw = (mode: 'normal' | 'fearless' = 'fearless', banned = 3) =>
    render(
      <ModeControls
        groupId={ORIGINAL_GROUP.id}
        mode={mode}
        banned={banned}
        inGame={false}
        redirectTo="/g/customs"
        resetConfirmHref="/g/customs/mode/reset"
      />,
    );

  it('never submits on change: Set mode appears once the choice differs, then posts the route', async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    draw();
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), {
      target: { value: 'normal' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/mode');
    expect(JSON.parse(String(init.body))).toEqual({ groupId: ORIGINAL_GROUP.id, mode: 'normal' });
    expect(await screen.findByText(MODE_ANNOUNCEMENTS.normal)).toBeInTheDocument();
  });

  it('says a failure in place and puts the select back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null }) as Response),
    );
    draw();
    const select = screen.getByRole('combobox', { name: 'Mode' });
    fireEvent.change(select, { target: { value: 'normal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MODE_CHANGE_FAILED);
    expect(select).toHaveValue('fearless');
  });

  it('Reset opens the AlertDialog with focus on Cancel, and confirming posts the reset route', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, resetAt: 'x', post: 'skipped' }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Reset fearless' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset the fearless pool?' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(within(dialog).getByText(/All 3 bans are cleared/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset fearless' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/admin/fearless/reset');
  });

  it('has no Reset in Normal or with an empty pool', () => {
    const { unmount } = draw('normal');
    expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
    unmount();
    draw('fearless', 0);
    expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
  });
});

describe('M15.5: rules, Spin and Rated on the admin row', () => {
  const draw = (props: Partial<Parameters<typeof ModeControls>[0]> = {}) =>
    render(
      <ModeControls
        groupId={ORIGINAL_GROUP.id}
        mode="fearless"
        banned={3}
        inGame={false}
        redirectTo="/g/customs"
        resetConfirmHref="/g/customs/mode/reset"
        {...props}
      />,
    );

  it('lists the rule optgroups, with a too-small rule disabled and suffixed', () => {
    draw({ tooFew: ['class:Marksman'] });
    const select = screen.getByRole('combobox', { name: 'Mode' });
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label);
    expect(groups).toEqual(['Class wars (one game)', 'Region wars (one game)', 'Mirror match (one game)']);
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Normal',
      'Fearless',
      'Tanks only',
      'Marksmen only (too few open)',
      'Mages only',
      'Assassins only',
      'Supports only',
      'Region wars, sides drawn at roll',
      'Mirror match',
    ]);
    expect(within(select).getByRole('option', { name: 'Marksmen only (too few open)' })).toBeDisabled();
  });

  it('a rule chosen says it is for the next game only; after Roll, changes are for the next game', () => {
    const queued = draw({ selected: 'class:Tank', inGame: true, nextLine: 'Next game: Mages only.' });
    // `Next game:` says it; `Changes apply…` is not repeated under it (design round 1).
    expect(screen.getByText('For the next game only. Then back to Fearless.')).toBeInTheDocument();
    expect(screen.getByText('Next game: Mages only.')).toBeInTheDocument();
    expect(screen.queryByText(/Changes apply from the next game/)).toBeNull();
    queued.unmount();
    draw({ selected: 'class:Tank', inGame: true });
    expect(screen.getByText('For the next game only. Then back to Fearless.')).toBeInTheDocument();
    // M14.76: said once, at the top of `Admins and the owner`, not under the picker and the switch.
    expect(screen.getAllByText(/Changes apply from the next game\./)).toHaveLength(1);
    expect(screen.getByText('Changes apply from the next game.')).toBeInTheDocument();
  });

  it('Spin posts the spin route and reveals the server pick on this page and the channel', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, mode: 'fearless', changed: true, spun: 'class:Tank' }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: string[] = [];
    const record = (event: Event) => events.push(`${event.type}:${(event as CustomEvent).detail.rule}`);
    window.addEventListener('kustom:spin-reveal', record);
    window.addEventListener('kustom:spin-broadcast', record);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Spin' }));
    await waitFor(() => expect(events).toHaveLength(2));
    window.removeEventListener('kustom:spin-reveal', record);
    window.removeEventListener('kustom:spin-broadcast', record);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/mode/spin');
    expect(JSON.parse(String(init.body))).toEqual({ groupId: ORIGINAL_GROUP.id });
    expect(events).toEqual(['kustom:spin-reveal:class:Tank', 'kustom:spin-broadcast:class:Tank']);
  });

  it('Spin works without JS: a form post to the spin route that comes back to Tonight', () => {
    draw();
    const spin = screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement;
    expect(spin.type).toBe('submit');
    const form = spin.form as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('/api/admin/mode/spin');
    expect(form.getAttribute('method')).toBe('post');
    expect((form.elements.namedItem('redirectTo') as HTMLInputElement).value).toBe('/g/customs');
  });

  it('Spin with nothing left says so in place', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => null }) as Response),
    );
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Spin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing to spin right now: every rule is too small tonight.',
    );
  });

  it('Rated is a switch for the next game that posts the opposite, and works as a form post', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            mode: 'fearless',
            changed: true,
            next: { standing: 'fearless', rule: null, rated: false, ratedOverride: false, version: 5 },
          }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    // As the card feeds it (M19.13): the switch is the client mode store's, which the answer moves.
    render(
      <ModeControlsHarness
        groupId={ORIGINAL_GROUP.id}
        banned={3}
        inGame={false}
        redirectTo="/g/customs"
        resetConfirmHref="/g/customs/mode/reset"
        server={{ standing: 'fearless', pending: null, ratedOverride: null, version: 4 }}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Rated' }) as HTMLButtonElement;
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAccessibleDescription('Next game is rated.');
    expect(toggle.name).toBe('rated');
    expect(toggle.value).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ groupId: ORIGINAL_GROUP.id, rated: false });
    expect(await screen.findByText('Next game is not rated.')).toBeInTheDocument();
    // Prod fix 2026-10-04: the switch itself moved, not only the line (`ratedSwitch.test.tsx`).
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('not rated reads as recorded, not rated', () => {
    draw({ nextRated: false });
    expect(screen.getByRole('switch', { name: 'Rated' })).toHaveAccessibleDescription(
      'Next game is recorded, not rated.',
    );
  });
});

describe("Tonight's announcer on a mode change (acceptance 11)", () => {
  it('says the mode line once when the mode changes under the page, never on first paint', () => {
    const { rerender } = render(<Announcer text="Teams are set." mode="fearless" />);
    expect(screen.getByRole('status')).toHaveTextContent('Teams are set.');
    rerender(<Announcer text="Teams are set." mode="normal" />);
    expect(screen.getByRole('status')).toHaveTextContent(MODE_ANNOUNCEMENTS.normal);
    rerender(<Announcer text="Game started." mode="normal" />);
    expect(screen.getByRole('status')).toHaveTextContent('Game started.');
  });
});

describe('where the mode is controlled (acceptance 7, 13)', () => {
  // Vitest runs from apps/web.
  const root = process.cwd();
  const sources = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'api' && dir === 'app' ? [] : sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const all = [...sources('app'), ...sources('components')];

  it('only the Mode card posts the mode and reset routes (and its no-JS reset confirm page)', () => {
    const callers = all.filter((path) =>
      /admin\/(mode|fearless\/reset)['"`]/.test(readFileSync(join(root, path), 'utf8')),
    );
    expect(callers.sort()).toEqual([
      'app/(group)/g/[slug]/mode/reset/page.tsx',
      'app/_mode/ModeControls.tsx',
    ]);
  });

  it('without JS, Reset goes to the confirm page instead of posting', () => {
    render(
      <ModeControls
        groupId={ORIGINAL_GROUP.id}
        mode="fearless"
        banned={2}
        inGame={false}
        redirectTo="/g/customs"
        resetConfirmHref="/g/customs/mode/reset"
      />,
    );
    const form = screen.getByRole('button', { name: 'Reset fearless' }).closest('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/g/customs/mode/reset');
  });

  it('never lazy-loads a sprite or uses communitydragon in the mode code, and preconnects to Data Dragon', () => {
    const mine = all.filter((path) => path.startsWith('app/_mode/'));
    for (const path of mine) {
      const source = readFileSync(join(root, path), 'utf8');
      expect(source, path).not.toMatch(/communitydragon/);
      // The one lazy image is the Mode card's own square (M14.45); a sprite cell never is (8.8).
      expect(source.match(/loading=["']lazy/g) ?? [], path).toHaveLength(
        path.endsWith('ChampChip.tsx') ? 1 : 0,
      );
    }
    expect(readFileSync(join(root, 'app/_mode/ChampChip.tsx'), 'utf8')).not.toMatch(/from 'next\/image'/);
    expect(readFileSync(join(root, 'app/_mode/sprites.ts'), 'utf8')).toContain('preconnect(DDRAGON_ORIGIN)');
  });

  it('no Mode card on You or Stats', () => {
    for (const path of all.filter((p) => /you|stats/i.test(p))) {
      expect(readFileSync(join(root, path), 'utf8'), path).not.toMatch(/ModeCard/);
    }
  });
});
