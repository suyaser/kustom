/**
 * A fake Supabase client that **counts round trips** (app-perf, 2026-10-04): the query budget tests
 * (`lib/perf/queryBudget.test.ts`) run a page's real loader against it and assert how many requests
 * it made and how many **waves** (requests that had to wait for an earlier one) they took. Tests
 * only; no network, so it runs in CI where the local stack does not.
 *
 * - Every `from(...)...` chain is one request, fired when it is awaited, answered one macrotask
 *   later. Requests started in the same tick therefore finish together, so a request's wave is one
 *   more than the deepest wave that had finished when it started: exactly the round trips a page
 *   pays one after another at a real RTT.
 * - Answers come from per-table fixture rows, filtered on plain `eq` / `neq` / `in` / `is` columns
 *   (and an `eq` on an embedded `rel.column` when the fixture row carries `rel` as an object) and
 *   cut by `range` / `limit`, so the loaders take their real paths; anything else (other embedded
 *   filters, JSON paths, comparisons, order) is accepted and ignored. A `count` option answers the
 *   filtered row count.
 * - A `select` naming the whole `games.raw` blob is recorded (`rawSelects`): list loaders must
 *   read `raw->field` paths, never the blob (`lib/perf/rawColumns.test.ts` checks the source).
 */

export type FixtureRow = Record<string, unknown>;
export type Fixtures = Partial<Record<string, FixtureRow[]>>;

export interface RecordedRequest {
  table: string;
  select: string | null;
  wave: number;
}

export interface Recording {
  requests: RecordedRequest[];
  /** The deepest wave: the number of round trips the loader paid one after another. */
  waves: () => number;
  /** How many requests, optionally for one table. */
  count: (table?: string) => number;
  /** Requests whose `select` names `raw` whole (not a `raw->` path). */
  rawSelects: () => RecordedRequest[];
}

interface Filter {
  column: string;
  op: 'eq' | 'neq' | 'in' | 'is';
  value: unknown;
}

/** `raw` as a whole column in a select list, as opposed to a `raw->field` / `raw->>field` path. */
export const BARE_RAW = /(^|[\s,(])raw\s*(,|\)|$)/;

export function recordingClient(fixtures: Fixtures): { client: never; recording: Recording } {
  const requests: RecordedRequest[] = [];
  const finished: number[] = [];

  const run = (table: string, select: string | null, filters: Filter[], shape: Shape) => {
    const wave = 1 + Math.max(0, ...finished);
    const request: RecordedRequest = { table, select, wave };
    requests.push(request);
    return new Promise((resolve) => {
      setTimeout(() => {
        finished.push(wave);
        const rows = (fixtures[table] ?? []).filter((row) => filters.every((f) => matches(row, f)));
        const limited = rows.slice(
          shape.offset,
          shape.limit === null ? undefined : shape.offset + shape.limit,
        );
        const count = shape.count ? rows.length : null;
        if (shape.head) resolve({ data: null, error: null, count });
        else if (shape.single) resolve({ data: limited[0] ?? null, error: null, count });
        else resolve({ data: limited, error: null, count });
      }, 0);
    });
  };

  const client = {
    from(table: string) {
      return builder(table, run);
    },
    rpc(name: string) {
      return builder(`rpc:${name}`, run);
    },
  };

  return {
    client: client as never,
    recording: {
      requests,
      waves: () => Math.max(0, ...requests.map((request) => request.wave)),
      count: (table) =>
        table === undefined ? requests.length : requests.filter((r) => r.table === table).length,
      rawSelects: () =>
        requests.filter((request) => request.select !== null && BARE_RAW.test(request.select)),
    },
  };
}

interface Shape {
  head: boolean;
  count: boolean;
  single: boolean;
  offset: number;
  limit: number | null;
}

type Runner = (table: string, select: string | null, filters: Filter[], shape: Shape) => Promise<unknown>;

function builder(table: string, run: Runner) {
  let select: string | null = null;
  const filters: Filter[] = [];
  const shape: Shape = { head: false, count: false, single: false, offset: 0, limit: null };
  let fired: Promise<unknown> | null = null;

  const self: Record<string, unknown> = {};
  const chain = (): typeof self => self;
  const plain = (column: string) => !column.includes('.') && !column.includes('->') && !column.includes('(');
  const embedded = (column: string) => /^[a-z_]+\.[a-z_]+$/.test(column);

  Object.assign(self, {
    select(columns?: string, options?: { head?: boolean; count?: string }) {
      select = columns ?? '*';
      shape.head = options?.head === true;
      shape.count = options?.count !== undefined;
      return self;
    },
    eq(column: string, value: unknown) {
      if (plain(column) || embedded(column)) filters.push({ column, op: 'eq', value });
      return self;
    },
    neq(column: string, value: unknown) {
      if (plain(column)) filters.push({ column, op: 'neq', value });
      return self;
    },
    in(column: string, values: unknown[]) {
      if (plain(column)) filters.push({ column, op: 'in', value: values });
      return self;
    },
    is(column: string, value: unknown) {
      if (plain(column)) filters.push({ column, op: 'is', value });
      return self;
    },
    filter(column: string, operator: string, value: unknown) {
      if (operator === 'eq' && plain(column)) filters.push({ column, op: 'eq', value });
      return self;
    },
    limit(n: number) {
      shape.limit = n;
      return self;
    },
    range(from: number, to: number) {
      shape.offset = from;
      shape.limit = to - from + 1;
      return self;
    },
    maybeSingle() {
      shape.single = true;
      return self;
    },
    single() {
      shape.single = true;
      return self;
    },
    // Accepted and ignored: they shape the answer, not the round trip count.
    not: chain,
    gt: chain,
    gte: chain,
    lt: chain,
    lte: chain,
    or: chain,
    match: chain,
    imatch: chain,
    ilike: chain,
    like: chain,
    contains: chain,
    order: chain,
    abortSignal: chain,
    // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is a thenable; this fakes one.
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      fired ??= run(table, select, filters, shape);
      return fired.then(onFulfilled, onRejected);
    },
  });
  return self;
}

function matches(row: FixtureRow, filter: Filter): boolean {
  const [rel, nested] = filter.column.split('.');
  if (nested !== undefined && rel !== undefined) {
    const inner = row[rel];
    // An embed the fixture does not carry is not filtered (the old behaviour for every `rel.column`).
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return true;
    return matches(inner as FixtureRow, { ...filter, column: nested });
  }
  const value = row[filter.column];
  if (value === undefined) return true;
  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'neq':
      return value !== filter.value;
    case 'in':
      return (filter.value as unknown[]).includes(value);
    case 'is':
      return filter.value === null ? value === null : value === filter.value;
  }
}
