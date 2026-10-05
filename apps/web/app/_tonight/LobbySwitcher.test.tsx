import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { applyModeRow, modeCardKey, resetModeStoreForTests } from '@/lib/mode/clientStore';
import { ROLL_LABEL } from '@/lib/tonight/copy';
import { resetLiveState, setLiveState } from '@/lib/tonight/live';
import { withSelection } from '@/lib/tonight/selection';
import { UNWATCHED_LEAD } from '@/lib/tonight/switcher';
import {
  ADMIN_VIEWER,
  MEMBER_VIEWER,
  TONIGHT_STATES,
  type TonightStateKey,
  tonightStateFixture,
  withLobbies,
} from './fixtures';
import { LobbySwitcher } from './LobbySwitcher';
import { TonightView, type TonightViewProps } from './TonightView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

/**
 * M22.6 (05-design.md 14): the switcher and the per-lobby page. Acceptance 3: one live table renders
 * no switcher element at all. Acceptance 4's render half: a write to lobby 2's card never lands on
 * lobby 1's (the route half is `app/api/admin/modeLobbies.integration.test.ts`).
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');

function fixture(key: TonightStateKey) {
  const { connection: _connection, ...rest } = tonightStateFixture(key, { now: NOW });
  return rest;
}

function draw(props: Omit<TonightViewProps, 'group'>) {
  return render(<TonightView {...props} renderedAt={NOW} group={ORIGINAL_GROUP} />);
}

function two(key: TonightStateKey, selected = 0, extra: Parameters<typeof withLobbies>[1] = { count: 2 }) {
  const { connection: _connection, ...rest } = withLobbies(tonightStateFixture(key, { now: NOW }), {
    ...extra,
    selected,
  });
  return rest;
}

afterEach(() => resetModeStoreForTests());

describe('one live lobby is exactly today (M22 D2, acceptance 3)', () => {
  it('no switcher element, no label, today date line, in every state', () => {
    for (const key of TONIGHT_STATES) {
      const view = draw({ ...fixture(key), viewer: ADMIN_VIEWER });
      expect(screen.queryByRole('navigation', { name: 'Lobbies' })).toBeNull();
      expect(document.querySelector('[data-slot="lobby-switcher"]')).toBeNull();
      expect(document.querySelector('[data-slot="tape-lobby"]')).toBeNull();
      expect(screen.queryByText(/lobbies$/)).toBeNull();
      view.unmount();
    }
  });

  it('a night that had two lobbies and is back to one still draws no switcher element', () => {
    const props = two('filling');
    const one = props.snapshot.lobbies?.slice(0, 1);
    draw({ ...props, snapshot: { ...props.snapshot, lobbies: one }, viewer: MEMBER_VIEWER });
    expect(screen.queryByRole('navigation', { name: 'Lobbies' })).toBeNull();
    expect(document.querySelector('[data-slot="lobby-switcher"]')).toBeNull();
  });
});

describe('two lobbies (14.3, 14.4)', () => {
  it('a chip per lobby, oldest first, the selected one current, YOU on the viewer lobby', () => {
    draw({ ...two('filling'), viewer: MEMBER_VIEWER });
    const nav = screen.getByRole('navigation', { name: 'Lobbies' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).toHaveTextContent(/^Bilal's lobby.*, 6 in.*Fearless, you're in this lobby$/);
    expect(links[1]).toHaveTextContent("Chaos's lobby");
    expect(links[1]).toHaveTextContent('6 in');
    expect(links[1]).toHaveTextContent('Tanks only');
    expect(links[1]).not.toHaveAttribute('aria-current');
    expect(links[1]).toHaveAttribute('href', '/g/customs?lobby=lobby-chaos');
    expect(screen.getByText('Tue 8 Sep, 2 lobbies')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Bilal's lobby: 6 IN THE LOBBY$/);
  });

  it('the page is the selected lobby: its headline, its own card', () => {
    draw({ ...two('filling', 1), viewer: MEMBER_VIEWER });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Chaos's lobby: 6 IN THE LOBBY");
    const card = document.querySelector('[data-slot="mode-card"]') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Class wars');
  });

  it('a tap paints the chip selected at once, before the lobby render lands', () => {
    const props = two('filling');
    draw({ ...props, viewer: MEMBER_VIEWER });
    const links = within(screen.getByRole('navigation', { name: 'Lobbies' })).getAllByRole('link');
    act(() => {
      fireEvent.click(links[1] as HTMLElement, { button: 0 });
    });
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).not.toHaveAttribute('aria-current');
  });

  it('a live render that moves nothing keeps a pinned selection and the order', () => {
    const props = two('filling', 1);
    const view = draw({ ...props, viewer: MEMBER_VIEWER });
    const tables = props.snapshot.lobbies ?? [];
    const second = tables[1];
    if (second === undefined) throw new Error('fixture');
    const moved = {
      ...props.snapshot,
      lobbies: [
        tables[0],
        { ...second, lobby: { ...second.lobby, members: second.lobby.members.slice(0, 5) } },
      ],
      lobby: { ...second.lobby, members: second.lobby.members.slice(0, 5) },
    } as typeof props.snapshot;
    view.rerender(
      <TonightView
        {...props}
        snapshot={moved}
        viewer={MEMBER_VIEWER}
        renderedAt={NOW}
        group={ORIGINAL_GROUP}
      />,
    );
    const links = within(screen.getByRole('navigation', { name: 'Lobbies' })).getAllByRole('link');
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    expect(links[1]).toHaveTextContent('5 in');
    expect(links[0]).toHaveTextContent("Bilal's lobby");
  });

  it('three lobbies: three chips in opening order', () => {
    draw({ ...two('filling', 0, { count: 3 }), viewer: MEMBER_VIEWER });
    const links = within(screen.getByRole('navigation', { name: 'Lobbies' })).getAllByRole('link');
    expect(links.map((link) => link.textContent?.match(/^.*?'s lobby/)?.[0])).toEqual([
      "Bilal's lobby",
      "Chaos's lobby",
      "Mo's lobby",
    ]);
    expect(screen.getByText('Tue 8 Sep, 3 lobbies')).toBeInTheDocument();
  });

  it('the tape names each tile lobby on a several-lobby night', () => {
    draw({ ...two('long-night'), viewer: MEMBER_VIEWER });
    const tiles = Array.from(document.querySelectorAll('[data-slot="tape-lobby"]'));
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.map((tile) => tile.textContent)).toContain(", Chaos's lobby");
  });

  it('a lobby no Kustom watches: the dashed note and no Roll (14.8)', () => {
    draw({ ...two('filling', 0, { count: 2, unwatched: true }), viewer: ADMIN_VIEWER });
    expect(screen.getByText(UNWATCHED_LEAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ROLL_LABEL })).toBeNull();
    const links = within(screen.getByRole('navigation', { name: 'Lobbies' })).getAllByRole('link');
    expect(links[0]).toHaveTextContent('No Kustom');
  });
});

describe("the card writes the selected lobby's mode (14.5, acceptance 4)", () => {
  it('the admin foot names the lobby and every form carries its lobbyId', async () => {
    draw({ ...two('filling', 1), viewer: ADMIN_VIEWER });
    await screen.findByRole('combobox', { name: /^(Mode|Next game)$/ });
    expect(
      screen.getByText(
        "A rule or Rated here is for Chaos's lobby only. Normal or Fearless is for every lobby.",
      ),
    ).toBeInTheDocument();
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lobbyId"]')).map(
      (input) => input.value,
    );
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids)).toEqual(new Set(['lobby-chaos']));
  });

  it('a Set mode tap posts lobbyId in its body', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      draw({ ...two('filling', 1), viewer: ADMIN_VIEWER });
      const select = await screen.findByRole('combobox', { name: /^(Mode|Next game)$/ });
      fireEvent.change(select, { target: { value: 'mirror' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
      });
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body).toMatchObject({ groupId: ORIGINAL_GROUP.id, lobbyId: 'lobby-chaos', mode: 'mirror' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a write heard for lobby 2's card never changes lobby 1's card", () => {
    draw({ ...two('filling', 0), viewer: MEMBER_VIEWER });
    const title = () =>
      within(document.querySelector('[data-slot="mode-card"]') as HTMLElement).getByRole('heading', {
        level: 2,
      }).textContent;
    expect(title()).toBe('Fearless');
    act(() => {
      applyModeRow(modeCardKey(ORIGINAL_GROUP.id, 'party-b'), {
        row: { standing: 'fearless', pending: { id: 'mirror' }, rated: null },
        updatedAt: new Date(NOW).toISOString(),
      });
    });
    expect(title()).toBe('Fearless');
  });

  it("lobby 1's card writes carry lobby 1's id", async () => {
    draw({ ...two('filling', 0), viewer: ADMIN_VIEWER });
    await screen.findByRole('combobox', { name: /^(Mode|Next game)$/ });
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lobbyId"]')).map(
      (input) => input.value,
    );
    expect(new Set(ids)).toEqual(new Set(['lobby-1']));
  });
});

describe('the switcher alone', () => {
  it('renders nothing with fewer than two chips', () => {
    const { container } = render(
      <LobbySwitcher
        chips={[
          { id: 'a', key: 'pa', label: "Ana's lobby", status: { kind: 'teams' }, mode: 'Normal', you: false },
        ]}
        selected="a"
        home="/g/customs"
        renderedAt={NOW}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('opening Tonight (14.12 item 3)', () => {
  const chaos = { kind: 'linked', puuid: 'puuid-chaos', isAdmin: false, isMember: true } as const;
  const chips = () => within(screen.getByRole('navigation', { name: 'Lobbies' })).getAllByRole('link');

  it('a player in the second-opened lobby lands on it with no tap', () => {
    const props = two('filling');
    draw({ ...props, snapshot: withSelection(props.snapshot, { viewerPuuid: chaos.puuid }), viewer: chaos });
    expect(chips()[1]).toHaveAttribute('aria-current', 'page');
    expect(chips()[1]).toHaveTextContent("you're in this lobby");
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Chaos's lobby: 6 IN THE LOBBY");
  });

  it("a Discord link to the other lobby lands on that one, with YOU on the viewer's chip", () => {
    const props = two('filling');
    const snapshot = withSelection(props.snapshot, { requested: 'lobby-1', viewerPuuid: chaos.puuid });
    draw({ ...props, snapshot, viewer: chaos });
    expect(chips()[0]).toHaveAttribute('aria-current', 'page');
    expect(chips()[0]).not.toHaveTextContent("you're in this lobby");
    expect(chips()[1]).toHaveTextContent("you're in this lobby");
  });
});

describe('bans from the other lobby (14.5)', () => {
  it("the dashed note counts the other lobby's game since this lobby's last, and names it", () => {
    const props = two('filling');
    const [first, second] = props.snapshot.lobbies ?? [];
    if (first === undefined || second === undefined) throw new Error('fixture');
    const tile = {
      lobbyId: 'lobby-chaos-0',
      createdAt: new Date(NOW - 10 * 60_000).toISOString(),
      clock: '22:20',
      status: 'finished' as const,
      result: {
        gameId: 'game-chaos',
        winningSide: 100 as const,
        durationS: 1800,
        aram: false,
        rated: true,
        mvp: null,
      },
      blueWinProb: 0.5,
      rank: 1,
      sitters: [],
    };
    const fearless = {
      ...props.snapshot.fearless,
      champions: [
        ...props.snapshot.fearless.champions,
        { id: 9001, name: 'A', role: null, gameId: 'game-chaos' },
        { id: 9002, name: 'B', role: null, gameId: 'game-chaos' },
      ],
    };
    const snapshot = {
      ...props.snapshot,
      fearless,
      lobbies: [first, { ...second, rowIds: ['lobby-chaos-0', ...second.rowIds] }],
      tape: [...props.snapshot.tape, tile],
    };
    draw({ ...props, snapshot, viewer: MEMBER_VIEWER });
    expect(document.querySelector('[data-slot="mode-other-bans"]')).toHaveTextContent(
      "2 more banned from a game in Chaos's lobby.",
    );
  });

  it('no note on a one-lobby night', () => {
    draw({ ...fixture('filling'), viewer: MEMBER_VIEWER });
    expect(document.querySelector('[data-slot="mode-other-bans"]')).toBeNull();
  });
});

describe('refusals and Reset with two lobbies (14.8, 14.11)', () => {
  it("a card write to a lobby that just ended says so instead of the route's Pick a lobby first.", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Pick a lobby first.' }), { status: 409 })),
    );
    try {
      draw({ ...two('filling', 1), viewer: ADMIN_VIEWER });
      const select = await screen.findByRole('combobox', { name: /^(Mode|Next game)$/ });
      fireEvent.change(select, { target: { value: 'mirror' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('That lobby has ended.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the Reset dialog says the bans clear in both lobbies', async () => {
    draw({ ...two('filling', 1), viewer: ADMIN_VIEWER });
    await screen.findByRole('combobox', { name: /^(Mode|Next game)$/ });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset fearless' }));
    });
    expect(
      await screen.findByText(/bans are cleared in both lobbies and every champion is open again/),
    ).toBeInTheDocument();
  });
});

describe('the Live tag is the night, not the selected lobby (designer round 1)', () => {
  afterEach(() => resetLiveState());

  it('shows while the other lobby is in game, with the selected one finished', () => {
    act(() => setLiveState({ connection: 'live' }));
    const view = draw({ ...fixture('finished'), viewer: MEMBER_VIEWER });
    // One lobby, finished: no tag, as before M22.
    expect(document.querySelector('[data-slot="live-tag"]')).toBeNull();
    view.unmount();
    draw({ ...two('finished', 0, { count: 2, other: 'in_game' }), viewer: MEMBER_VIEWER });
    expect(document.querySelector('[data-slot="live-tag"]')).not.toBeNull();
  });
});
