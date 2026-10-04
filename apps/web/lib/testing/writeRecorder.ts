/**
 * Records every write a test's Supabase clients send to PostgREST, in the order they started and
 * finished (M19.9, acceptance 3: "every route has a test that it bumps last; a write after the
 * bump fails the test"). Tests only; nothing in the app imports this.
 *
 * It wraps `globalThis.fetch`, so it must be installed **before** the first client is created in
 * the test file (supabase-js resolves `fetch` when a client is built). Reads (`GET`, `HEAD`) and
 * the read-only RPCs below are not writes and are not recorded; Realtime is a WebSocket and never
 * passes through here.
 *
 * {@link expectBumpedLast} is the assertion: exactly the expected `bump_group_live` calls, one per
 * group, and every other write of the request finished before the first bump started.
 */

export interface RecordedWrite {
  /** `rpc:<function>` or the table name. */
  target: string;
  method: string;
  /** The parsed JSON body, when there was one. */
  body: unknown;
  /** Ticks on one counter shared by starts and ends, so "finished before it started" is exact. */
  startedAt: number;
  endedAt: number | null;
}

/** RPCs that only read: not writes, never recorded. */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set(['ai_month_spend']);

export interface WriteRecorder {
  /** Where the log stands now; pass it to {@link WriteRecorder.since}. */
  mark(): number;
  /** Every write recorded after `mark`. */
  since(mark: number): RecordedWrite[];
  /** Put the original `fetch` back. */
  restore(): void;
}

/**
 * Classify one request: `null` when it is not a PostgREST write. Exported for the unit test.
 */
export function classifyRequest(
  restBase: string,
  url: string,
  method: string,
): { target: string; method: string } | null {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD') return null;
  if (!url.startsWith(restBase)) return null;
  const path = url.slice(restBase.length).split('?')[0] ?? '';
  const [first, second] = path.split('/');
  if (first === 'rpc') {
    const name = second ?? '';
    return READ_ONLY_RPCS.has(name) ? null : { target: `rpc:${name}`, method: upper };
  }
  return first ? { target: first, method: upper } : null;
}

export function installWriteRecorder(stackUrl: string, base: typeof fetch = globalThis.fetch): WriteRecorder {
  const restBase = `${stackUrl.replace(/\/$/, '')}/rest/v1/`;
  const writes: RecordedWrite[] = [];
  let tick = 0;
  const original = globalThis.fetch;

  const recording: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    const kind = classifyRequest(restBase, url, method);
    if (kind === null) return base(input, init);

    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    tick += 1;
    const write: RecordedWrite = { ...kind, body, startedAt: tick, endedAt: null };
    writes.push(write);
    try {
      return await base(input, init);
    } finally {
      tick += 1;
      write.endedAt = tick;
    }
  };

  globalThis.fetch = recording;
  return {
    mark: () => writes.length,
    since: (mark) => writes.slice(mark),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export interface ExpectedBump {
  groupId: string;
  kind: string;
}

/** The `bump_group_live` calls in a write log, in order. */
export function bumpsIn(writes: readonly RecordedWrite[]): ExpectedBump[] {
  return writes
    .filter((write) => write.target === 'rpc:bump_group_live')
    .map((write) => {
      const body = (write.body ?? {}) as { p_group?: unknown; p_kind?: unknown };
      return { groupId: String(body.p_group), kind: String(body.p_kind) };
    });
}

/**
 * Throws (with the whole log in the message) unless the log holds exactly `expected` bumps, in
 * that order, and every other write ended before the first bump started. `expected: []` asserts
 * the request bumped nothing. Returns the non-bump writes for further assertions.
 */
export function expectBumpedLast(
  writes: readonly RecordedWrite[],
  expected: readonly ExpectedBump[],
  options: {
    /**
     * Only these groups' bumps are compared with `expected`. For a route that also sweeps the
     * whole stack's idle lobbies: another file's stale lobby is another group's bump, still
     * required to come last, but not this test's to count.
     */
    groups?: readonly string[];
  } = {},
): RecordedWrite[] {
  const describe = () =>
    writes.map((w) => `${w.startedAt}-${w.endedAt ?? '?'} ${w.method} ${w.target}`).join('\n  ');
  const scope = options.groups;
  const bumps = bumpsIn(writes).filter((bump) => scope === undefined || scope.includes(bump.groupId));
  const same =
    bumps.length === expected.length &&
    bumps.every(
      (bump, index) => bump.groupId === expected[index]?.groupId && bump.kind === expected[index]?.kind,
    );
  if (!same) {
    throw new Error(
      `expected bumps ${JSON.stringify(expected)}, got ${JSON.stringify(bumps)}; writes:\n  ${describe()}`,
    );
  }
  const others = writes.filter((write) => write.target !== 'rpc:bump_group_live');
  const firstBump = writes.find((write) => write.target === 'rpc:bump_group_live');
  if (firstBump !== undefined) {
    const late = others.filter((write) => write.endedAt === null || write.endedAt > firstBump.startedAt);
    if (late.length > 0) {
      throw new Error(
        `${late.length} write(s) after the bump (${late.map((w) => `${w.method} ${w.target}`).join(', ')}); writes:\n  ${describe()}`,
      );
    }
  }
  return others;
}
