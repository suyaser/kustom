// Dev-only perf logging for the Next server (performance plan, phase 0). Never imported by the app:
// it is loaded into the server process from the outside, so nothing here reaches a bundle.
//
//   KUSTOM_PERF_LOG=1 NODE_OPTIONS="--import ./scripts/perf/preload.mjs" pnpm --filter web start
//
// - KUSTOM_PERF_LOG=1           turn it on (anything else: this file does nothing at all)
// - KUSTOM_PERF_LOG_FILE=<path> append the lines there instead of stderr
// - PERF_SB_DELAY_MS=40         add this much to every Supabase call (models the Vercel-to-Supabase
//                               RTT; local calls take 2 to 5 ms, which hides the waterfalls)
//
// Every page request and every Supabase round trip becomes one `[perf] {json}` line. Supabase calls
// carry the id of the request that made them (AsyncLocalStorage), so concurrent prefetches do not
// blur together. `scripts/perf-tonight.ts` reads these lines.
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

if (process.env.KUSTOM_PERF_LOG === '1') {
  const file = process.env.KUSTOM_PERF_LOG_FILE;
  const delay = Number(process.env.PERF_SB_DELAY_MS ?? 0) || 0;
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const store = new AsyncLocalStorage();
  const now = () => performance.timeOrigin + performance.now();
  let next = 0;
  const emit = (row) => {
    const line = `[perf] ${JSON.stringify(row)}\n`;
    if (file) appendFileSync(file, line);
    else process.stderr.write(line);
  };

  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function perfEmit(event, req, res, ...rest) {
    if (event !== 'request') return originalEmit.call(this, event, req, res, ...rest);
    next += 1;
    const rid = `${process.pid}:${next}`;
    const t0 = now();
    let ttfb = null;
    const first = () => {
      if (ttfb === null) ttfb = now();
    };
    const write = res.write;
    const end = res.end;
    res.write = function perfWrite(...args) {
      first();
      return write.apply(this, args);
    };
    res.end = function perfEnd(...args) {
      first();
      return end.apply(this, args);
    };
    res.on('finish', () => {
      emit({
        k: 'req',
        rid,
        t0,
        ttfb,
        t1: now(),
        status: res.statusCode,
        method: req.method,
        url: req.url,
        rsc: req.headers.rsc ?? null,
        prefetch: req.headers['next-router-prefetch'] ?? null,
        segment: req.headers['next-router-segment-prefetch'] ?? null,
      });
    });
    return store.run(rid, () => originalEmit.call(this, event, req, res, ...rest));
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function perfFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(supabase)) return originalFetch(input, init);
    const t0 = now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await originalFetch(input, init);
    } finally {
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      emit({
        k: 'sb',
        rid: store.getStore() ?? null,
        t0,
        t1: now(),
        method,
        path: url.slice(supabase.length).split('?')[0],
      });
    }
  };
}
