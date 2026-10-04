// Client JS per route: the <script src> chunks each page's HTML loads, raw and gzip, plus the
// biggest chunks with a guess at what is inside (top module markers).
//
// M14.44: paths come from the environment so any worktree can run it, and each route also reports
// `moduleGzKB` -- the module scripts only, leaving out the `noModule` core-js polyfill that modern
// browsers never fetch (the REPORT.md tables use that number). `gzKB` keeps the old meaning (every
// script tag) so older summaries stay comparable. `flags` lists which route chunks contain zod
// (`ZodError`), GoTrue or PostgREST, or Node polyfills.
//
//   NEXT=<apps/web/.next> BASE=http://localhost:3118 node bundle.mjs out.json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const NEXT = process.env.NEXT ?? path.resolve(new URL('.', import.meta.url).pathname, '../../../apps/web/.next');
const BASE = process.env.BASE ?? 'http://localhost:3111';
const G = '7855be62-4526-4fd2-97cd-cab389676ac1';
const routes = ['/', '/how', '/download', '/new', '/g/customs', '/g/customs/leaderboard', '/g/customs/p/audit-p01',
  '/g/customs/games', `/g/customs/games/${G}`, '/g/customs/you', '/g/customs/mode', '/g/customs/stats',
  '/g/customs/stats/champions', '/g/customs/stats/1v1', '/g/customs/mystery', '/g/customs/admin'];

const FLAGS = {
  zod: (t) => t.includes('ZodError'),
  gotrue: (t) => /GoTrueClient|gotrue/i.test(t),
  postgrest: (t) => t.includes('PostgrestClient') || t.includes('PostgrestQueryBuilder'),
  nodePolyfill: (t) => t.includes('secp256k1') || t.includes('string_decoder') || t.includes('pbkdf2'),
};
const size = (file) => { const b = fs.readFileSync(file); return { raw: b.length, gz: zlib.gzipSync(b, { level: 9 }).length }; };
const all = new Map();
const out = { base: BASE, routes: [], chunks: [] };
for (const r of routes) {
  const html = await (await fetch(BASE + r)).text();
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="(\/_next\/static\/chunks\/[^"]+\.js)"[^>]*>/g)];
  const noModule = new Set(tags.filter((m) => /\bnoModule\b/i.test(m[0])).map((m) => m[1]));
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'\s)]+\.js/g)].map((m) => m[0]))];
  let raw = 0, gz = 0, modGz = 0;
  const flags = new Set();
  for (const s of srcs) {
    const f = path.join(NEXT, s.replace('/_next/', ''));
    if (!fs.existsSync(f)) continue;
    const z = size(f); raw += z.raw; gz += z.gz;
    if (!noModule.has(s)) {
      modGz += z.gz;
      const txt = fs.readFileSync(f, 'utf8');
      for (const [k, test] of Object.entries(FLAGS)) if (test(txt)) flags.add(k);
    }
    const e = all.get(s) ?? { ...z, routes: [] }; e.routes.push(r); all.set(s, e);
  }
  out.routes.push({ route: r, chunks: srcs.length, rawKB: +(raw / 1024).toFixed(1), gzKB: +(gz / 1024).toFixed(1),
    moduleGzKB: +(modGz / 1024).toFixed(1), flags: [...flags] });
}
for (const [s, e] of [...all].sort((a, b) => b[1].gz - a[1].gz).slice(0, 14)) {
  const txt = fs.readFileSync(path.join(NEXT, s.replace('/_next/', '')), 'utf8');
  const markers = ['react-dom', 'scheduler', '@supabase', 'realtime', 'phoenix', 'radix', 'zod', 'ZodError', 'openskill', 'tailwind-merge', 'next/dist/client', 'gotrue', 'postgrest', 'champion', 'ddragon', 'tw-merge', 'clsx', 'class-variance']
    .filter((m) => txt.includes(m));
  out.chunks.push({ chunk: s.split('/').pop(), rawKB: +(e.raw / 1024).toFixed(1), gzKB: +(e.gz / 1024).toFixed(1), onRoutes: e.routes.length === routes.length ? 'all' : e.routes, markers });
}
for (const r of out.routes) console.log(r.route.padEnd(56), String(r.moduleGzKB).padStart(6), 'KB module gz', String(r.gzKB).padStart(6), 'KB all', r.flags.join(','));
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
