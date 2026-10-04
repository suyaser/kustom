import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLiveState, requestTonightRefresh, showsLiveDot } from '@/lib/tonight/live';

/**
 * The live half of the tonight page (M3.4; M14.9 acceptance 4): the subscription for the page's
 * group, a re-render of the server page (`router.refresh()`) on every event, on `visibilitychange`
 * and on every (re)subscribe, and the connection state the live tag and the tab dot read, which is
 * never `live` before `SUBSCRIBED`.
 */

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

/**
 * No socket in a component test: the channel is a stub. It records what the page asked to hear,
 * `fire` plays a server-delivered event back (the server only delivers what matches a filter),
 * and `status` plays a subscription status back.
 */
type Listener = { config: { table: string; filter?: string }; callback: () => void };
const listeners = vi.hoisted(() => ({
  all: [] as Listener[],
  broadcasts: [] as { event: string; callback: (message: { payload?: unknown }) => void }[],
  sent: [] as unknown[],
  channels: [] as string[],
  status: null as ((status: string) => void) | null,
}));

vi.mock('@/lib/liveClient', () => ({
  createLiveClient: () => ({
    channel: (name: string) => {
      listeners.channels.push(name);
      return {
        on(kind: string, config: Listener['config'] & { event?: string }, callback: () => void) {
          if (kind === 'broadcast') listeners.broadcasts.push({ event: config.event ?? '', callback });
          else listeners.all.push({ config, callback });
          return this;
        },
        send(message: unknown) {
          listeners.sent.push(message);
          return Promise.resolve('ok');
        },
        subscribe(callback: (status: string) => void) {
          listeners.status = callback;
          return this;
        },
      };
    },
    removeChannel: () => Promise.resolve('ok'),
  }),
}));

function fire(table: string, row: Record<string, string>): void {
  for (const { config, callback } of listeners.all) {
    if (config.table !== table) continue;
    if (config.filter !== undefined) {
      const [column, condition] = config.filter.split('=');
      if (column === undefined || condition !== `eq.${row[column]}`) continue;
    }
    callback();
  }
}

const { TonightLive, liveSubscriptions, COALESCE_MS, CONNECT_TIMEOUT_MS, START_POLL_MS, NAME_REREAD_MS } =
  await import('./TonightLive');
const { LiveTag } = await import('./LiveTag');

const GROUP_A = '11111111-1111-4111-8111-111111111111';
const GROUP_B = '22222222-2222-4222-8222-222222222222';

function draw(props: { lobbyLive?: boolean; nameless?: boolean; startPending?: boolean } = {}) {
  return render(
    <>
      <LiveTag lobbyLive={props.lobbyLive ?? true} />
      <TonightLive
        groupId={GROUP_A}
        lobbyLive={props.lobbyLive ?? true}
        nameless={props.nameless}
        startPending={props.startPending}
      />
    </>,
  );
}

const settle = async () => act(async () => vi.advanceTimersByTime(COALESCE_MS + 10));

beforeEach(() => {
  refresh.mockClear();
  listeners.all.length = 0;
  listeners.broadcasts.length = 0;
  listeners.sent.length = 0;
  listeners.channels.length = 0;
  listeners.status = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Realtime subscription', () => {
  it("filters every published table that has a group_id to the page's group, the mode included", () => {
    expect(liveSubscriptions(GROUP_A)).toEqual([
      { table: 'lobbies', filter: `group_id=eq.${GROUP_A}` },
      // No `group_id` on these two: they reach their group through their lobby.
      { table: 'lobby_members' },
      { table: 'splits' },
      { table: 'games', filter: `group_id=eq.${GROUP_A}` },
      { table: 'game_players', filter: `group_id=eq.${GROUP_A}` },
      { table: 'ratings', filter: `group_id=eq.${GROUP_A}` },
      { table: 'fearless_state', filter: `group_id=eq.${GROUP_A}` },
      { table: 'group_modes', filter: `group_id=eq.${GROUP_A}` },
    ]);
  });

  it('subscribes with those filters, on a channel of its own group', () => {
    draw();
    expect(listeners.channels).toEqual([`tonight:${GROUP_A}`]);
    expect(listeners.all.map((listener) => listener.config)).toEqual(
      liveSubscriptions(GROUP_A).map((subscription) => ({ event: '*', schema: 'public', ...subscription })),
    );
  });

  it('M15.5: says a Spin on the channel, and plays the reveal for a Spin said by another page', () => {
    draw();
    act(() => {
      window.dispatchEvent(new CustomEvent('kustom:spin-broadcast', { detail: { rule: 'class:Tank' } }));
    });
    expect(listeners.sent).toEqual([{ type: 'broadcast', event: 'spin', payload: { rule: 'class:Tank' } }]);

    const revealed: unknown[] = [];
    const onReveal = (event: Event) => revealed.push((event as CustomEvent).detail);
    window.addEventListener('kustom:spin-reveal', onReveal);
    for (const { event, callback } of listeners.broadcasts) {
      if (event !== 'spin') continue;
      callback({ payload: { rule: 'region' } });
      // A forged or unknown rule plays nothing.
      callback({ payload: { rule: 'class:Fighter' } });
    }
    window.removeEventListener('kustom:spin-reveal', onReveal);
    // Marked as a broadcast: `SpinReveal` plays it only if the card's pending rule confirms it.
    expect(revealed).toEqual([{ rule: 'region', source: 'broadcast' }]);
  });

  it('re-renders the page without a reload on its own group, never on another group', async () => {
    draw();
    for (const table of ['games', 'game_players', 'ratings', 'lobbies', 'group_modes']) {
      fire(table, { group_id: GROUP_B });
    }
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    fire('games', { group_id: GROUP_A });
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-renders when a game lands (games, game_players): how Your night updates (M14.36 acceptance 5)', async () => {
    draw({ lobbyLive: false });
    fire('games', { group_id: GROUP_A });
    for (let i = 0; i < 10; i += 1) fire('game_players', { group_id: GROUP_A });
    await settle();
    // One server re-render: the page re-reads Your night with everything else
    // (`TonightView.test.tsx`, "updates in place when the server sends the next game").
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('makes a burst of events one re-render', async () => {
    draw();
    for (let i = 0; i < 10; i += 1) fire('lobby_members', {});
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('re-reading after a gap', () => {
  it('re-renders when the tab becomes visible again, not when it hides', async () => {
    draw();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('re-renders on every SUBSCRIBED: the first one and each reconnect', async () => {
    draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    act(() => listeners.status?.('CHANNEL_ERROR'));
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('re-renders when a control asks (a press was answered)', async () => {
    draw();
    act(() => requestTonightRefresh());
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the live tag and the tab dot', () => {
  it('say Connecting… until SUBSCRIBED, then Live, and the dot only then', () => {
    draw();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    expect(showsLiveDot(getLiveState())).toBe(false);

    act(() => listeners.status?.('SUBSCRIBED'));
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(showsLiveDot(getLiveState())).toBe(true);
  });

  it('say Reconnecting… when the channel drops, and the dot goes', () => {
    draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    act(() => listeners.status?.('TIMED_OUT'));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(showsLiveDot(getLiveState())).toBe(false);
  });

  it('give up connecting after eight seconds without a subscription', () => {
    draw();
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 1));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });

  it('show nothing on an idle page that is connected, and no dot', () => {
    draw({ lobbyLive: false });
    act(() => listeners.status?.('SUBSCRIBED'));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(showsLiveDot(getLiveState())).toBe(false);
  });

  it('turn the dot off when the page goes away', () => {
    const { unmount } = draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    unmount();
    expect(showsLiveDot(getLiveState())).toBe(false);
  });
});

describe('the polls', () => {
  it('asks about a pending create_lobby every five seconds, and stops when it settles', async () => {
    const { rerender } = draw({ startPending: true });
    await act(async () => vi.advanceTimersByTime(START_POLL_MS * 2 + COALESCE_MS * 2));
    expect(refresh).toHaveBeenCalledTimes(2);

    refresh.mockClear();
    rerender(<TonightLive groupId={GROUP_A} lobbyLive startPending={false} />);
    await act(async () => vi.advanceTimersByTime(START_POLL_MS * 4));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-reads names once a minute only while somebody is still nameless', async () => {
    draw({ nameless: false });
    await act(async () => vi.advanceTimersByTime(NAME_REREAD_MS * 2));
    expect(refresh).not.toHaveBeenCalled();
  });
});
