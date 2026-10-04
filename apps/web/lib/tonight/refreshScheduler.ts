/**
 * Tonight's refresh scheduler (M19.3; `redesign/research/performance.md` 5.2, finding 4).
 *
 * Every change Tonight hears (a Realtime row, the tab coming back, a reconnect, a poll, a control's
 * answer) asks for the whole page again from the server. This decides **when** that re-read runs so
 * one logical change is one render:
 *
 * - **Trailing debounce with a max wait.** A change arms a timer {@link REFRESH_DEBOUNCE_MS} after
 *   the latest change, but never later than {@link REFRESH_MAX_WAIT_MS} after the first one of the
 *   burst: a game end's ten-plus writes are one render, and ten joins 400 ms apart still show.
 * - **Single flight.** At most one re-read runs at a time. A change that lands while one runs marks
 *   the page dirty, and exactly one follow-up runs once it lands: the last change is never dropped,
 *   and never doubled.
 * - **Asks join a covering render.** A control asks with the time its route answered
 *   ({@link RefreshScheduler.ask}). The write is on the server by then, so a render that *started*
 *   at or after that time already shows it: the ask joins it (or, if it has landed, is answered at
 *   once) instead of starting another. The ask's promise resolves when a covering render has
 *   committed, which is what the controls hold their pending state on. An ask goes through the
 *   same debounce as a change: Realtime can deliver the write's own row a little after the route's
 *   answer, and the debounce folds that echo into the same render instead of a follow-up.
 * - **A press holds the page's renders until it answers** ({@link RefreshScheduler.hold}). A
 *   route's own writes reach Realtime before its answer reaches the browser (a roll writes for
 *   about a second), so without this the pressing viewer gets one render mid-write and another for
 *   the answer. Held, the changes wait for the answer and one render covers both. A hold lets go by
 *   itself after {@link PRESS_HOLD_MAX_MS}, so a slow route never freezes the page.
 *
 * Pure apart from the clock and timers it is given, so the rules are unit tests
 * (`refreshScheduler.test.ts`); `TonightLive` supplies `run`, a `router.refresh()` inside a
 * transition that resolves when React has committed the new payload.
 */

/** A burst closes this long after its latest change. */
export const REFRESH_DEBOUNCE_MS = 150;

/** ...but never later than this after its first, so a steady trickle of changes still shows. */
export const REFRESH_MAX_WAIT_MS = 600;

/** The longest a press holds the page's renders while its route works. */
export const PRESS_HOLD_MAX_MS = 3_000;

export interface SchedulerDeps {
  /** One re-read of the page; resolves once the new screen has committed. Never rejects. */
  run: () => Promise<void>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  holdMaxMs?: number;
}

interface Waiter {
  /** A render that started at or after this time covers the ask. */
  after: number;
  resolve: () => void;
}

export class RefreshScheduler {
  private readonly run: () => Promise<void>;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly holdMaxMs: number;

  private timer: unknown = null;
  /** The first and latest change not yet covered by a render that started after them. */
  private firstAt: number | null = null;
  private lastAt = 0;
  /** When the render in flight started, or null with none. */
  private inFlightSince: number | null = null;
  /** When the newest committed render started. */
  private committedSince = Number.NEGATIVE_INFINITY;
  private waiters: Waiter[] = [];
  /** Presses in flight: while any is, renders wait (see the class comment). */
  private holds = 0;
  private disposed = false;

  constructor(deps: SchedulerDeps) {
    this.run = deps.run;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.debounceMs = deps.debounceMs ?? REFRESH_DEBOUNCE_MS;
    this.maxWaitMs = deps.maxWaitMs ?? REFRESH_MAX_WAIT_MS;
    this.holdMaxMs = deps.holdMaxMs ?? PRESS_HOLD_MAX_MS;
  }

  /** Something changed (a Realtime row, visibility, a reconnect, a poll): the page is behind. */
  change(): void {
    if (this.disposed) return;
    const at = this.now();
    this.firstAt ??= at;
    this.lastAt = at;
    // During a flight the follow-up is armed when it lands (single flight).
    if (this.inFlightSince === null) this.arm();
  }

  /**
   * A control's route answered at `answeredAt` (same clock as `now`). Resolves when a render that
   * started at or after it has committed: at once if one already has, with the one in flight if it
   * started late enough, else with the next one, which this schedules.
   */
  ask(answeredAt: number = this.now()): Promise<void> {
    if (this.disposed || this.committedSince >= answeredAt) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ after: answeredAt, resolve });
      if (this.inFlightSince !== null && this.inFlightSince >= answeredAt) return;
      this.change();
    });
  }

  /**
   * A press has gone to its route: hold renders until it answers. Returns the release (call it
   * once the route answered, after {@link ask}, or when the press failed); it also lets go by
   * itself after `holdMaxMs`.
   */
  hold(): () => void {
    if (this.disposed) return () => {};
    this.holds += 1;
    // A render armed but not started waits too; the release arms it again.
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      this.clearTimer(cap);
      this.holds -= 1;
      if (this.holds > 0 || this.disposed) return;
      // The held changes were the press's own writes: the max wait starts again from here, so the
      // answer's debounce still folds in a late echo of them.
      if (this.firstAt !== null) this.firstAt = this.now();
      if (this.inFlightSince === null) this.arm();
    };
    const cap = this.setTimer(release, this.holdMaxMs);
    return release;
  }

  /** Whether a re-read is running or armed: for tests and the bench. */
  get busy(): boolean {
    return this.inFlightSince !== null || this.timer !== null;
  }

  /** The page is going away: no more renders, and nobody is left waiting on one. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) waiter.resolve();
  }

  private arm(): void {
    if (this.firstAt === null || this.holds > 0) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    const due = Math.min(this.lastAt + this.debounceMs, this.firstAt + this.maxWaitMs);
    this.timer = this.setTimer(() => this.fire(), Math.max(0, due - this.now()));
  }

  private fire(): void {
    this.timer = null;
    if (this.disposed) return;
    const since = this.now();
    this.firstAt = null;
    this.inFlightSince = since;
    void this.run()
      .catch(() => {})
      .then(() => this.landed(since));
  }

  private landed(since: number): void {
    this.inFlightSince = null;
    this.committedSince = Math.max(this.committedSince, since);
    const covered = this.waiters.filter((waiter) => waiter.after <= since);
    this.waiters = this.waiters.filter((waiter) => waiter.after > since);
    for (const waiter of covered) waiter.resolve();
    if (this.disposed) return;
    // Changes that arrived during the flight: exactly one follow-up, on the same debounce.
    if (this.firstAt !== null) this.arm();
  }
}
