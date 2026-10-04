// From every 'use client' file, follow value imports (not `import type`) and print the shortest
// chain to a target module (zod, @customs/db, node:crypto, @supabase/*, @customs/core).
import fs from 'node:fs';
import path from 'node:path';
const WEB = '/Users/suyaser/lol/.claude/worktrees/agent-a0c760d8aeb72ac17/apps/web/';
const PKG = '/Users/suyaser/lol/.claude/worktrees/agent-a0c760d8aeb72ac17/packages/';
const targets = process.argv.slice(2);
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(e.name) && !/test/.test(e.name)) out.push(p); } return out; }
const files = walk(WEB + 'app').concat(walk(WEB + 'components'), walk(WEB + 'lib'));
const clients = files.filter((f) => /^['"]use client['"]/.test(fs.readFileSync(f, 'utf8')));
function resolve(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = WEB + spec.slice(2);
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec === '@customs/db') base = PKG + 'db/src/index';
  else if (spec === '@customs/db/schemas') base = PKG + 'db/src/schemas/index';
  else if (spec === '@customs/core') base = PKG + 'core/src/index';
  else return spec;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  return spec;
}
function deps(f) {
  if (!fs.existsSync(f)) return [];
  const src = fs.readFileSync(f, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^(import|export)\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gms)) {
    const clause = m[2];
    // skip clauses where every specifier is `type X`
    const inner = clause.match(/\{([^}]*)\}/);
    if (inner && !/^\s*\*/.test(clause) && !clause.replace(/\{[^}]*\}/, '').replace(/[,\s]/g, '') && inner[1].split(',').every((s) => !s.trim() || /^\s*type\s/.test(s))) continue;
    out.push(resolve(f, m[3]));
  }
  for (const m of src.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) out.push(resolve(f, m[1]));
  return out;
}
const short = (p) => p.replace(WEB, '').replace(PKG, 'packages/');
for (const t of targets) {
  console.log(`== chains to ${t}`);
  const seen = new Set();
  for (const c of clients) {
    const q = [[c]]; const vis = new Set([c]);
    while (q.length) {
      const chain = q.shift(); const cur = chain[chain.length - 1];
      if (cur === t || (cur.includes(t) && !cur.startsWith('/'))) { const k = short(c); if (!seen.has(k)) { seen.add(k); console.log('  ' + chain.map(short).join(' -> ')); } break; }
      if (!cur.startsWith('/')) continue;
      for (const d of deps(cur)) if (!vis.has(d)) { vis.add(d); q.push([...chain, d]); }
    }
  }
}
