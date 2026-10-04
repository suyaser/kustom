import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESS_HOLD_MAX_MS,
  REFRESH_DEBOUNCE_MS,
  REFRESH_MAX_WAIT_MS,
  RefreshScheduler,
} from './refreshScheduler';

/**
 * Tonight's refresh scheduler (M19.3): one render per logical change. A burst is one render, a
 * steady trickle still shows within the max wait, a change heard mid-render gives exactly one
 * follow-up, and a control's ask joins a render that started after its route answered.
 *
 * `run` is a render the test lands by hand (`land()`), so "in flight" is real.
 */

let flights: { since: number; land: () => void }[];
let scheduler: RefreshScheduler;

function make(): RefreshScheduler {
  return new RefreshScheduler({
    run: () =>
      new Promise<void>((resolve) => {
        flights.push({ since: Date.now(), land: resolve });
      }),
  });
}

/** Land the render in flight and let the scheduler react to it. */
async function land(): Promise<void> {
  const flight = flights.find((one) => one.land !== noop);
  if (flight === undefined) throw new Error('no render in flight');
  flight.land();
  flight.land = noop;
  await vi.advanceTimersByTimeAsync(0);
}

function noop(): void {}

const started = () => flights.length;

beforeEach(() => {
  vi.useFakeTimers();
  flights = [];
  scheduler = make();
});

afterEach(() => {
  scheduler.dispose();
  vi.useRealTimers();
});

describe('changes', () => {
  it('a burst is one render, on the trailing edge', async () => {
    for (let i = 0; i < 10; i += 1) {
      scheduler.change();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(started()).toBe(0);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
  });

  it('a steady trickle still renders within the max wait', async () => {
    const t0 = Date.now();
    // A change every 100 ms never lets the 150 ms debounce close on its own.
    for (let t = 0; t < REFRESH_MAX_WAIT_MS; t += 100) {
      scheduler.change();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(started()).toBe(1);
    expect((flights[0]?.since ?? Number.POSITIVE_INFINITY) - t0).toBe(REFRESH_MAX_WAIT_MS);
  });

  it('a change during a render gives exactly one follow-up, after it lands', async () => {
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);

    // Three more changes while the first render is still on the wire: no second render yet.
    for (let i = 0; i < 3; i += 1) scheduler.change();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(1);

    await land();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(2);
    await land();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(2);
  });

  it('no change during a render means no follow-up', async () => {
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    await land();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(1);
    expect(scheduler.busy).toBe(false);
  });
});

describe("a control's ask", () => {
  it('with nothing running, schedules one render and resolves when it lands', async () => {
    const answered = vi.fn();
    void scheduler.ask(Date.now()).then(answered);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    expect(answered).not.toHaveBeenCalled();
    await land();
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('joins the render Realtime started after the route answered: one render per tap', async () => {
    const answeredAt = Date.now();
    // The write's Realtime row arrives; its render starts 150 ms later...
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    // ...and the control's ask comes in while it is on the wire (a slow response body).
    const answered = vi.fn();
    void scheduler.ask(answeredAt).then(answered);
    await land();
    expect(answered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(1);
  });

  it('an ask after a covering render has landed is answered at once, with no render', async () => {
    const answeredAt = Date.now();
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    await land();
    const answered = vi.fn();
    void scheduler.ask(answeredAt).then(answered);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(answered).toHaveBeenCalledTimes(1);
    expect(started()).toBe(1);
  });

  it('a render that started before the answer does not cover it: one follow-up, and the ask waits for it', async () => {
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    const answered = vi.fn();
    void scheduler.ask(Date.now()).then(answered);
    await land();
    expect(answered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(2);
    await land();
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('an ask and its own Realtime row in the same window are one render', async () => {
    scheduler.change();
    await vi.advanceTimersByTimeAsync(40);
    const answered = vi.fn();
    void scheduler.ask(Date.now()).then(answered);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    await land();
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('nobody is left waiting when the page goes away', async () => {
    const answered = vi.fn();
    void scheduler.ask(Date.now()).then(answered);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(answered).toHaveBeenCalledTimes(1);
    expect(started()).toBe(0);
  });
});

describe('a press holds renders until its route answers', () => {
  it("the route's own rows and its answer are one render, a debounce after the answer", async () => {
    const release = scheduler.hold();
    // A roll writes for about a second; its rows arrive before its answer.
    for (let i = 0; i < 5; i += 1) {
      scheduler.change();
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(started()).toBe(0);
    const answered = vi.fn();
    void scheduler.ask(Date.now()).then(answered);
    release();
    // The write's own row, a little after the answer (Realtime lag), joins the same render.
    await vi.advanceTimersByTimeAsync(60);
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    await land();
    expect(answered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(1);
  });

  it('an armed render waits for the press too', async () => {
    scheduler.change();
    const release = scheduler.hold();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(0);
    void scheduler.ask(Date.now());
    release();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
  });

  it('a press that fails lets the held changes render as usual', async () => {
    const release = scheduler.hold();
    scheduler.change();
    await vi.advanceTimersByTimeAsync(500);
    release();
    release();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
  });

  it('a slow route never freezes the page: the hold lets go by itself', async () => {
    scheduler.hold();
    scheduler.change();
    await vi.advanceTimersByTimeAsync(PRESS_HOLD_MAX_MS - 1);
    expect(started()).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(started()).toBe(1);
  });

  it('a render already on the wire when the press starts still lands; the held changes follow it', async () => {
    scheduler.change();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(1);
    const release = scheduler.hold();
    scheduler.change();
    await land();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toBe(1);
    void scheduler.ask(Date.now());
    release();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(started()).toBe(2);
  });
});
