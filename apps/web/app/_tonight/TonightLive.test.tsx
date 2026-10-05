import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginTonightPress, getLiveState, requestTonightRefresh, showsLiveDot } from '@/lib/tonight/live';

/**
 * The live half of the tonight page (M3.4; M14.9 acceptance 4; M19.10): the subscription to the
 * page's own group's `group_live` row, a re-render of the server page (`router.refresh()`) when its
 * version moves past the one shown, a version check on every (re)subscribe and visible tab, and the
 * connection state the live tag and the tab dot read, which is never `live` before `SUBSCRIBED`.
 */

const refresh = vi.fn();

/**
 * One server re-render is `refresh` (the count every test reads). By default it lands at once; with
 * `flights.hold` it stays on the wire until the test lands it (`landRender()`), so "an event during
 * a render" is a real render in flight (M19.3). The real hook (`router.refresh()` in a transition,
 * resolved on commit) is `lib/useCommittedRefresh.test.tsx`.
 */
const flights = vi.hoisted(() => ({ hold: false, open: [] as (() => void)[] }));
vi.mock('@/lib/useCommittedRefresh', () => ({
  useCommittedRefresh: () => ({
    refreshing: false,
    refresh: () => {
      refresh();
      if (!flights.hold) return Promise.resolve();
      return new Promise<void>((resolve) => flights.open.push(resolve));
    },
  }),
}));

async function landRender(): Promise<void> {
  await act(async () => {
    flights.open.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * No socket in a component test: the channel is a stub. It records what the page asked to hear,
 * `fire` plays a server-delivered event back (the server only delivers what matches a filter),
 * and `status` plays a subscription status back.
 */
type Listener = { config: { table: string; filter?: string }; callback: (payload: unknown) => void };
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
        on(
          kind: string,
          config: Listener['config'] & { event?: string },
          callback: (payload: never) => void,
        ) {
          if (kind === 'broadcast')
            listeners.broadcasts.push({ event: config.event ?? '', callback: callback as never });
          else listeners.all.push({ config, callback: callback as never });
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

/** Plays a `postgres_changes` payload back; the server only delivers what matches a filter. */
function fire(table: string, row: Record<string, unknown>, eventType = 'UPDATE'): void {
  for (const { config, callback } of listeners.all) {
    if (config.table !== table) continue;
    if (config.filter !== undefined) {
      const [column, condition] = config.filter.split('=');
      if (column === undefined || condition !== `eq.${String(row[column])}`) continue;
    }
    callback(eventType === 'DELETE' ? { eventType, new: {}, old: row } : { eventType, new: row, old: {} });
  }
}

/** The group's live row as Realtime carries it (exactly the four public columns). */
function liveRow(at: number, groupId = GROUP_A, extra: Record<string, unknown> = {}) {
  return { group_id: groupId, version: at, kind: 'lobby', changed_at: '2026-10-04T20:00:00+00:00', ...extra };
}

/** A write route's last statement: the group's version moves. */
let version = 0;
function bump(groupId = GROUP_A): void {
  version += 1;
  fire('group_live', liveRow(version, groupId));
}

/** What the version check (`readGroupLive`) answers: the current row, or null (unknown). */
const current = vi.hoisted(() => ({ row: undefined as unknown, fail: false }));
vi.mock('@/lib/tonight/liveSignal', async (original) => {
  const real = await original<typeof import('@/lib/tonight/liveSignal')>();
  return {
    ...real,
    readGroupLive: async () => (current.fail ? null : (current.row ?? null)),
  };
});

const {
  TonightLive,
  liveSubscriptions,
  COALESCE_MS,
  CONNECT_TIMEOUT_MS,
  MODE_ROW_WAIT_MS,
  NAME_REREAD_MS,
  PRESS_BUMP_WAIT_MS,
} = await import('./TonightLive');
const { modeRowParsers } = await import('@/lib/mode/liveRows');
await modeRowParsers();
const { useModeSlice } = await import('@/lib/mode/clientStore');

/** The render's `group_modes.updated_at` (ms after the epoch), in the M19.13 tests. */
const SHOWN_MODE = 4;

/** A `group_modes` row as Realtime carries it (the id columns included, which are never read). */
function modeRow(at: number, extra: Record<string, unknown> = {}) {
  return {
    group_id: GROUP_A,
    mode: 'fearless',
    pending_rule: null,
    pending_class_tag: null,
    pending_region_blue: null,
    pending_region_red: null,
    rated_override: null,
    // M20.7: no version column; the store orders by `updated_at` (here `at` ms after the epoch).
    updated_at: new Date(at).toISOString(),
    set_by: '33333333-3333-4333-8333-333333333333',
    pending_set_by: null,
    ...extra,
  };
}

function fearlessRow(resetAt: string) {
  return { group_id: GROUP_A, id: 1, reset_at: resetAt, reset_by: null, updated_at: resetAt };
}

/** A mode route's last statement: a `mode` bump. */
function modeBump(): void {
  version += 1;
  fire('group_live', liveRow(version, GROUP_A, { kind: 'mode' }));
}

/** What the card reads from the store: its standing, pending rule, Rated switch and reset time. */
function CardProbe() {
  const slice = useModeSlice(GROUP_A, {
    row: { standing: 'fearless', pending: null, rated: null },
    updatedAt: new Date(SHOWN_MODE).toISOString(),
    resetAt: '2026-10-01T16:00:00.000Z',
  });
  const pending = slice.row.pending;
  return (
    <p data-testid="card">
      {slice.row.standing} {pending === null ? '-' : pending.id === 'class' ? pending.tag : pending.id}{' '}
      {slice.row.rated === null ? 'default' : String(slice.row.rated)} {slice.resetAt}
    </p>
  );
}
const { LiveTag } = await import('./LiveTag');
// The strict parser is a dynamic import (zod stays out of Tonight's first load): load it once up
// front, as a page has by the time its first row arrives.
const { groupLiveParser, setGroupLiveSchemaLoaderForTests } = await import('@/lib/tonight/liveSignal');
await groupLiveParser();

const GROUP_A = '11111111-1111-4111-8111-111111111111';
const GROUP_B = '22222222-2222-4222-8222-222222222222';
/** The version the server render showed, in every test unless it says otherwise. */
const SHOWN = 10;

function draw(props: { lobbyLive?: boolean; nameless?: boolean; liveVersion?: number | null } = {}) {
  return render(
    <>
      <LiveTag lobbyLive={props.lobbyLive ?? true} />
      <TonightLive
        groupId={GROUP_A}
        liveVersion={props.liveVersion === undefined ? SHOWN : props.liveVersion}
        lobbyLive={props.lobbyLive ?? true}
        nameless={props.nameless}
      />
    </>,
  );
}

const settle = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(COALESCE_MS + 10);
  });

beforeEach(() => {
  version = SHOWN;
  current.row = liveRow(SHOWN);
  current.fail = false;
  refresh.mockClear();
  flights.hold = false;
  flights.open.length = 0;
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
  it("M19.10: hears its group's live row and the Mode card's two rows, every one filtered to the group", () => {
    expect(liveSubscriptions(GROUP_A)).toEqual([
      { table: 'group_live', filter: `group_id=eq.${GROUP_A}` },
      { table: 'group_modes', filter: `group_id=eq.${GROUP_A}` },
      { table: 'fearless_state', filter: `group_id=eq.${GROUP_A}` },
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

  it('re-renders the page without a reload when its own group moves, never for another group', async () => {
    draw();
    for (let i = 0; i < 3; i += 1) bump(GROUP_B);
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a row at or below the shown version re-reads nothing (a late echo of a render it already has)', async () => {
    draw();
    fire('group_live', liveRow(SHOWN));
    fire('group_live', liveRow(SHOWN - 1));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops a row that does not parse strictly, and says so with only its group and kind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    draw();
    fire('group_live', liveRow(SHOWN + 1, GROUP_A, { lobby_id: 'secret' }));
    fire('group_live', liveRow(SHOWN + 2, GROUP_A, { kind: 'whatever' }));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, 'group_live: dropped a malformed row', {
      group_id: GROUP_A,
      kind: 'lobby',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    warn.mockRestore();
  });

  it('a schema chunk that fails to load once drops that row only: the next row retries and renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = await import('@customs/db/schemas');
    let attempts = 0;
    setGroupLiveSchemaLoaderForTests(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError('Failed to fetch chunk')) : Promise.resolve(real);
    });
    draw();
    bump();
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
    setGroupLiveSchemaLoaderForTests(null);
    await groupLiveParser();
    warn.mockRestore();
  });

  it('a DELETE (the group was deleted) re-reads, and the server answers with not-found', async () => {
    draw();
    fire('group_live', liveRow(SHOWN), 'DELETE');
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the Mode card rows re-read nothing by themselves: their writers bump the live row last', async () => {
    draw();
    fire('group_modes', modeRow(SHOWN_MODE + 1));
    fire('fearless_state', fearlessRow('2026-10-04T20:00:00+00:00'));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a game end is one bump and one render, after the game is written (M14.36 acceptance 5)', async () => {
    draw({ lobbyLive: false });
    bump();
    await settle();
    // One server re-render: the page re-reads Your night with everything else
    // (`TonightView.test.tsx`, "updates in place when the server sends the next game").
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('makes a burst of bumps one re-render', async () => {
    draw();
    for (let i = 0; i < 10; i += 1) bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('M19.13: the Mode card on the client', () => {
  const card = () => screen.getByTestId('card').textContent;
  const drawWithCard = () => {
    draw();
    render(<CardProbe />);
  };
  const wait = async (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('a group_modes row moves the card at once, and its mode bump re-reads nothing (0 server renders)', async () => {
    drawWithCard();
    fire('group_modes', modeRow(SHOWN_MODE + 1, { pending_rule: 'class', pending_class_tag: 'Tank' }));
    await wait(0);
    expect(card()).toContain('fearless Tank default');
    modeBump();
    await wait(MODE_ROW_WAIT_MS + COALESCE_MS + 50);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("another admin's newer row moves the card; an older row is ignored", async () => {
    drawWithCard();
    fire('group_modes', modeRow(SHOWN_MODE + 2, { mode: 'normal' }));
    fire('group_modes', modeRow(SHOWN_MODE + 1, { pending_rule: 'mirror' }));
    await settle();
    expect(card()).toContain('normal - default');
    // A row older than the render itself is ignored too.
    fire('group_modes', modeRow(SHOWN_MODE - 1, { rated_override: false }));
    await settle();
    expect(card()).toContain('normal - default');
  });

  it('a mode bump that arrives before its row waits for it, then re-reads nothing', async () => {
    drawWithCard();
    modeBump();
    await wait(MODE_ROW_WAIT_MS / 2);
    fire('group_modes', modeRow(SHOWN_MODE + 1, { rated_override: false }));
    await wait(MODE_ROW_WAIT_MS + COALESCE_MS + 50);
    expect(card()).toContain('fearless - false');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a mode bump whose row never arrives re-reads the page once the wait has passed', async () => {
    drawWithCard();
    modeBump();
    await wait(MODE_ROW_WAIT_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await wait(COALESCE_MS + 10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a Fearless reset moves the card at once and still re-reads (the pool and the ten are the server's)", async () => {
    drawWithCard();
    fire('fearless_state', fearlessRow('2026-10-04T20:00:00+00:00'));
    modeBump();
    await settle();
    expect(card()).toContain('2026-10-04T20:00:00+00:00');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a DELETE of a mode row is never a patch: it re-reads', async () => {
    drawWithCard();
    fire('group_modes', modeRow(SHOWN_MODE), 'DELETE');
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(card()).toContain('fearless - default');
  });

  it('with the mode panel open over the page, a mode bump re-reads (the panel is a server render)', async () => {
    window.history.pushState({}, '', '/g/customs/mode');
    drawWithCard();
    fire('group_modes', modeRow(SHOWN_MODE + 1, { mode: 'normal' }));
    modeBump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    window.history.pushState({}, '', '/');
  });

  it('a row heard before another kind of change is not saved for a later mode bump', async () => {
    drawWithCard();
    // The eog's compare-and-clear writes the row, then bumps `game`: one render.
    fire('group_modes', modeRow(SHOWN_MODE + 1));
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    // A later mode bump has no row of its own: it waits, then re-reads.
    modeBump();
    await wait(MODE_ROW_WAIT_MS + COALESCE_MS + 50);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('drops a malformed mode row without touching the card', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    drawWithCard();
    fire('group_modes', modeRow(SHOWN_MODE + 1, { mode: 'aram' }));
    await settle();
    expect(card()).toContain('fearless - default');
    expect(warn).toHaveBeenCalledWith('group_modes: dropped a malformed row');
    warn.mockRestore();
  });
});

describe('re-reading after a gap (M19.10: only when the version moved, or is unknown)', () => {
  it('opening the page is one render: the first SUBSCRIBED at the shown version re-reads nothing', async () => {
    draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a stale version on resubscribe re-reads; an equal one does not', async () => {
    draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    // Two writes while the socket was down: the events are not replayed.
    current.row = liveRow(SHOWN + 2);
    act(() => listeners.status?.('CHANNEL_ERROR'));
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => listeners.status?.('TIMED_OUT'));
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an unknown version (the read failed) re-reads', async () => {
    current.fail = true;
    draw();
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a render that knew no version re-reads on its first subscribe', async () => {
    draw({ liveVersion: null });
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the tab becomes visible again and the group moved, not when it hides', async () => {
    draw();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    current.row = liveRow(SHOWN + 1);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    // Visible again with nothing new: no render.
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('re-renders when a control asks (a press was answered)', async () => {
    draw();
    act(() => {
      void requestTonightRefresh();
    });
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('one re-read at a time, once per change (M19.3)', () => {
  it('bumps 40 ms apart for half a second are one render', async () => {
    draw({ lobbyLive: false });
    for (let i = 0; i < 12; i += 1) {
      bump();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
    }
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an event during a render gives exactly one follow-up, once it lands', async () => {
    flights.hold = true;
    draw();
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Three more bumps while the first render is still on the wire: nothing starts beside it.
    for (let i = 0; i < 3; i += 1) bump();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    await landRender();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    await landRender();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a control's ask joins the render its own Realtime row started, and resolves when it lands", async () => {
    flights.hold = true;
    draw();
    const answeredAt = Date.now();
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    const answered = vi.fn();
    act(() => {
      void requestTonightRefresh(answeredAt).then(answered);
    });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(answered).not.toHaveBeenCalled();
    await landRender();
    expect(answered).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an ask after a covering render has landed starts none', async () => {
    draw();
    const answeredAt = Date.now();
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    const answered = vi.fn();
    await act(async () => {
      await requestTonightRefresh(answeredAt).then(answered);
    });
    expect(answered).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a press holds the page's renders: the route's own rows and its answer are one render", async () => {
    flights.hold = true;
    draw();
    const press = beginTonightPress();
    // Its route's bump arrives before its answer does.
    bump();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    const answered = vi.fn();
    act(() => {
      void press.answered(Date.now()).then(answered);
    });
    // Another bump a moment after the answer joins the same render.
    await act(async () => vi.advanceTimersByTime(60));
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(answered).not.toHaveBeenCalled();
    await landRender();
    expect(answered).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("M19.10: an answered press waits for its route's bump, so the bump is never a follow-up", async () => {
    flights.hold = true;
    draw();
    const press = beginTonightPress();
    const answered = vi.fn();
    act(() => {
      void press.answered(Date.now()).then(answered);
    });
    // The answer is in, the bump is not yet: no render while it is on its way.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(refresh).not.toHaveBeenCalled();
    bump();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    await landRender();
    expect(answered).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a route that bumped nothing re-reads once the bump wait has passed', async () => {
    draw();
    const press = beginTonightPress();
    act(() => {
      void press.answered(Date.now());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESS_BUMP_WAIT_MS - 10);
    });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_MS + 20);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a press that failed lets go at once, without waiting for a bump', async () => {
    draw();
    const press = beginTonightPress();
    bump();
    press.release();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a press with no tonight page mounted holds nothing and resolves at once', async () => {
    const press = beginTonightPress();
    await expect(press.answered()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('with no tonight page mounted an ask resolves at once (`/admin`, a test)', async () => {
    await expect(requestTonightRefresh()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a visibility change and a reconnect during a render are one follow-up, not two', async () => {
    flights.hold = true;
    current.fail = true;
    draw({ liveVersion: null });
    act(() => listeners.status?.('SUBSCRIBED'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    act(() => listeners.status?.('CHANNEL_ERROR'));
    act(() => listeners.status?.('SUBSCRIBED'));
    await landRender();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
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
  it('M19.17: never re-renders on a timer for a pending Start a lobby (StartLobby polls its own route)', async () => {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-reads names once a minute while somebody is still nameless (kept by M19.17)', async () => {
    draw({ nameless: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NAME_REREAD_MS + COALESCE_MS + 10);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads names once a minute only while somebody is still nameless', async () => {
    draw({ nameless: false });
    await act(async () => vi.advanceTimersByTime(NAME_REREAD_MS * 2));
    expect(refresh).not.toHaveBeenCalled();
  });
});
