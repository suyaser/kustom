import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '@/lib/testing/tonightFixtures';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import type { ViewerState } from '@/lib/tonight/viewer';

/**
 * The one timer on the tonight page that is not a Realtime subscription (M4.2's control).
 *
 * `companion_commands` has no RLS policy and is in no publication, so the browser can neither
 * read tonight's `create_lobby` nor be told that it moved. The page therefore asks its own
 * server components again every five seconds **while the command is live**, and stops the
 * moment it settles — a timer that outlived the command would re-render this page for the rest
 * of the night, which is the failure mode this file exists to catch.
 */

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

/**
 * No socket in a component test: the channel is a stub that never subscribes. It records what
 * the page asked to hear, and `fire` plays a server-delivered event back -- the server only
 * delivers what matches a subscription's filter, which is the rule the group test leans on.
 */
type Listener = { config: { table: string; filter?: string }; callback: () => void };
const listeners = vi.hoisted(() => ({ all: [] as Listener[], channels: [] as string[] }));

vi.mock('@/lib/publicClient', () => ({
  createPublicClient: () => ({
    channel: (name: string) => {
      listeners.channels.push(name);
      return {
        on(_kind: string, config: Listener['config'], callback: () => void) {
          listeners.all.push({ config, callback });
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    removeChannel: () => Promise.resolve('ok'),
  }),
}));

/** What Realtime does with a row change: hand it to every subscription whose filter it matches. */
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

vi.mock('@/lib/tonight/load', () => ({
  loadTonight: vi.fn(async () => snapshot(null)),
}));

const { TonightLive, liveSubscriptions } = await import('./TonightLive');
const { loadTonight } = await import('@/lib/tonight/load');

const GROUP_A = '11111111-1111-4111-8111-111111111111';
const GROUP_B = '22222222-2222-4222-8222-222222222222';

const admin: ViewerState = { kind: 'linked', puuid: 'puuid-hamoodi', isAdmin: true };

function start(status: LobbyStartView['status']): LobbyStartView {
  return {
    status,
    error: status === 'failed' ? 'expired' : null,
    hostName: 'Hamoodi',
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    invited: 0,
  };
}

function draw(lobbyStart: LobbyStartView | null) {
  return render(
    <TonightLive
      groupId={GROUP_A}
      initial={snapshot(null)}
      viewer={admin}
      topPlayers={[]}
      lobbyStart={lobbyStart}
    />,
  );
}

/** Five seconds, the companion's own poll interval (`START_POLL_MS`). */
const TICK = 5_000;

beforeEach(() => {
  refresh.mockClear();
  listeners.all.length = 0;
  listeners.channels.length = 0;
  vi.mocked(loadTonight).mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the create_lobby poll', () => {
  it('runs while the command is pending, and again while it is sent', () => {
    const { unmount } = draw(start('pending'));

    act(() => vi.advanceTimersByTime(TICK * 2));
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();

    refresh.mockClear();
    draw(start('sent'));
    act(() => vi.advanceTimersByTime(TICK));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not run at all on a night nobody pressed the button', () => {
    draw(null);

    act(() => vi.advanceTimersByTime(TICK * 4));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops the moment the row settles, acked or failed', () => {
    for (const settled of ['acked', 'failed'] as const) {
      refresh.mockClear();
      const { unmount } = draw(start(settled));

      act(() => vi.advanceTimersByTime(TICK * 4));
      expect(refresh, settled).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('clears the timer when the page goes away, so it cannot outlive the command', () => {
    const { unmount } = draw(start('pending'));

    act(() => vi.advanceTimersByTime(TICK));
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
    act(() => vi.advanceTimersByTime(TICK * 4));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

/** M13.9 acceptance 5: group A's page never re-reads on group B's game. */
describe('the Realtime subscription', () => {
  it("filters every published table that has a group_id to the page's group", () => {
    expect(liveSubscriptions(GROUP_A)).toEqual([
      { table: 'lobbies', filter: `group_id=eq.${GROUP_A}` },
      // No `group_id` on these two: they reach their group through their lobby.
      { table: 'lobby_members' },
      { table: 'splits' },
      { table: 'games', filter: `group_id=eq.${GROUP_A}` },
      { table: 'game_players', filter: `group_id=eq.${GROUP_A}` },
      { table: 'ratings', filter: `group_id=eq.${GROUP_A}` },
      { table: 'fearless_state', filter: `group_id=eq.${GROUP_A}` },
    ]);
  });

  it('subscribes with those filters, on a channel of its own group', () => {
    draw(null);
    expect(listeners.channels).toEqual([`tonight:${GROUP_A}`]);
    expect(listeners.all.map((listener) => listener.config)).toEqual(
      liveSubscriptions(GROUP_A).map((subscription) => ({ event: '*', schema: 'public', ...subscription })),
    );
  });

  it('does not re-read when a game lands in another group, and does when one lands in its own', async () => {
    draw(null);

    // Everything a game landing writes: the game, its ten rows, the fold's ratings, its lobby.
    for (const table of ['games', 'game_players', 'ratings', 'lobbies']) fire(table, { group_id: GROUP_B });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(loadTonight).not.toHaveBeenCalled();

    fire('games', { group_id: GROUP_A });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(loadTonight).toHaveBeenCalledTimes(1);
    // The re-read is the group's snapshot.
    expect(vi.mocked(loadTonight).mock.calls[0]?.[1]).toMatchObject({ groupId: GROUP_A });
  });
});
