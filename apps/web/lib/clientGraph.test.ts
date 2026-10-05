import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The client import graph (M14.44, `redesign/quality/REPORT.md` P1, P2 and P5).
 *
 * Every `'use client'` module is an entry the bundler ships to the browser, together with
 * everything it imports by value. Three things must never ride along by accident:
 *
 * - **zod** (with every `@customs/db` schema, 87 KB gzip). One import line in `lib/nav.ts`'s
 *   chain once put it on every route, the landing page included. Only the pages that really
 *   validate a write in the browser may reach it: the allow-list below.
 * - **`node:*`** (with the bundler's polyfills, 121 KB gzip on Tonight once). No client module may
 *   reach one, allow-listed or not.
 * - **`supabase-js`** (GoTrue, PostgREST, Storage, Functions). The browser's only Supabase use is
 *   Tonight's live channel, and that is `@supabase/realtime-js` alone (`lib/liveClient.ts`).
 *
 * Pure file reads and the TypeScript parser, so it runs in CI with no local stack and no build.
 * Type-only imports (`import type`, `{ type X }` only) are skipped, as `verbatimModuleSyntax`
 * erases them; everything else is followed, so this is stricter than the bundler's tree shaking
 * and never looser. A dynamic `import()` is not followed: the bundler splits it into a chunk that
 * loads when the line runs, which is how a client control can validate an answer with zod
 * without putting zod in Tonight's first load.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.resolve(WEB, '..', '..', 'packages');

/**
 * Client entries that may reach zod: each validates a write's request or answer in the browser,
 * and each lives on a page that is not one of the read-only ones (`/`, the board, games, stats).
 * Matched against the entry's path from `apps/web`.
 */
const ZOD_ALLOWED_ENTRIES: readonly RegExp[] = [
  /^app\/new\//, // create a group
  /^app\/join\//, // join and pair a host
  /^app\/\(group\)\/g\/\[slug\]\/admin\//, // the group's admin
  /^app\/_mode\/ModeControls\.tsx$/, // the Mode panel's admin controls
];

const SOURCE_DIRS = ['app', 'components', 'lib'];
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function isClientModule(file: string): boolean {
  const source = fs.readFileSync(file, 'utf8');
  return /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(source);
}

function firstFile(base: string): string | null {
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** A workspace package's `exports` entry for a subpath, resolved to a file. */
function resolveWorkspace(spec: string): string | null {
  const match = spec.match(/^@customs\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  const root = path.join(PACKAGES, match[1] ?? '');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>;
  };
  const target = manifest.exports?.[`.${match[2] ?? ''}`];
  if (target === undefined) throw new Error(`clientGraph: ${spec} is not in ${match[1]}'s exports`);
  return path.join(root, target);
}

/** A file path for an import we can follow, or the bare specifier for a package we cannot. */
function resolveImport(from: string, spec: string): string {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = path.join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith('@customs/')) base = resolveWorkspace(spec);
  if (base === null) return spec;
  const file = firstFile(base.replace(/\.(ts|tsx|js)$/, '')) ?? firstFile(base);
  if (file === null) throw new Error(`clientGraph: cannot resolve ${spec} from ${from}`);
  return file;
}

const importCache = new Map<string, string[]>();

/** The value imports and re-exports of one file, resolved. */
function valueImports(file: string): string[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  const specs: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const elements = clause.namedBindings.elements;
        if (elements.length > 0 && elements.every((element) => element.isTypeOnly)) continue;
      }
      if (ts.isStringLiteral(statement.moduleSpecifier)) specs.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause) && clause.elements.length > 0) {
        if (clause.elements.every((element) => element.isTypeOnly)) continue;
      }
      if (ts.isStringLiteral(statement.moduleSpecifier)) specs.push(statement.moduleSpecifier.text);
    }
  }
  const resolved = specs.map((spec) => resolveImport(file, spec));
  importCache.set(file, resolved);
  return resolved;
}

const isZod = (spec: string) => spec === 'zod' || spec.startsWith('zod/');
const isNode = (spec: string) => spec.startsWith('node:') || spec === 'server-only';
/** Every Supabase package but realtime-js, which is the one the browser is meant to have. */
const isFullSupabase = (spec: string) =>
  /^@supabase\/(supabase-js|ssr|auth-js|postgrest-js|storage-js|functions-js)(\/|$)/.test(spec);

/** The shortest chain from `entry` to an import matching `hit`, or null. */
function chainTo(entry: string, hit: (spec: string) => boolean): string[] | null {
  const queue: string[][] = [[entry]];
  const seen = new Set([entry]);
  while (queue.length > 0) {
    const chain = queue.shift() ?? [];
    const current = chain[chain.length - 1] ?? '';
    if (!path.isAbsolute(current)) {
      if (hit(current)) return chain;
      continue;
    }
    for (const next of valueImports(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return null;
}

/** The shortest chain from `entry` to a source file matching `hit`, or null. */
function chainToFile(entry: string, hit: (file: string) => boolean): string[] | null {
  const queue: string[][] = [[entry]];
  const seen = new Set([entry]);
  while (queue.length > 0) {
    const chain = queue.shift() ?? [];
    const current = chain[chain.length - 1] ?? '';
    if (!path.isAbsolute(current)) continue;
    if (current !== entry && hit(current)) return chain;
    for (const next of valueImports(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return null;
}

const short = (file: string) =>
  path.isAbsolute(file)
    ? path.relative(WEB, file).startsWith('..')
      ? `packages/${path.relative(PACKAGES, file)}`
      : path.relative(WEB, file)
    : file;

const clientEntries = SOURCE_DIRS.flatMap((dir) => listSources(path.join(WEB, dir)))
  .filter(isClientModule)
  .sort();

describe('the client import graph', () => {
  it('finds the client modules', () => {
    // A sanity floor: a broken detector would pass every check below by finding nothing.
    expect(clientEntries.length).toBeGreaterThan(40);
    expect(clientEntries.map(short)).toContain('components/shell/TabBar.tsx');
  });

  it('reaches zod only from the allow-listed write surfaces', () => {
    const offenders = clientEntries
      .filter((entry) => !ZOD_ALLOWED_ENTRIES.some((allowed) => allowed.test(short(entry))))
      .map((entry) => chainTo(entry, isZod))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map(short).join(' -> '));
    expect(offenders).toEqual([]);
  });

  it('never reaches a node: module or a server-only one', () => {
    const offenders = clientEntries
      .map((entry) => chainTo(entry, isNode))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map(short).join(' -> '));
    expect(offenders).toEqual([]);
  });

  it('never reaches supabase-js: the browser has realtime-js alone', () => {
    const offenders = clientEntries
      .map((entry) => chainTo(entry, isFullSupabase))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map(short).join(' -> '));
    expect(offenders).toEqual([]);
    expect(
      chainTo(path.join(WEB, 'app/_tonight/TonightLive.tsx'), (spec) => spec === '@supabase/realtime-js'),
    ).not.toBeNull();
  });

  it('keeps the every-page base free of feature copy and core (M19.18)', () => {
    // The root error boundaries and the bare shell's top-bar islands load on every page, the static
    // Kustom pages included, so whatever they import is first-load JavaScript everywhere. `lib/nav.ts`
    // pulls the games, stats, daily, versus and tonight copy (and `@customs/core` through them):
    // about 6 KB gzip that `Wordmark` once brought in for one string.
    const base = [
      'app/error.tsx',
      'app/global-error.tsx',
      'components/landing/KustomSignIn.tsx',
      'components/shell/ThemeToggle.tsx',
    ];
    const banned = (file: string) => {
      const name = short(file);
      return name === 'lib/nav.ts' || name.startsWith('packages/core/');
    };
    const offenders = base
      .map((entry) => chainToFile(path.join(WEB, entry), banned))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map(short).join(' -> '));
    expect(offenders).toEqual([]);
    // The detector works: a group page's top bar does reach the nav.
    expect(chainToFile(path.join(WEB, 'components/shell/TabBar.tsx'), banned)).not.toBeNull();
  });

  it('every allow-list row still matches a client module', () => {
    // A row that matches nothing is a row nobody will notice is stale.
    const unused = ZOD_ALLOWED_ENTRIES.filter(
      (allowed) => !clientEntries.some((entry) => allowed.test(short(entry))),
    );
    expect(unused.map(String)).toEqual([]);
  });
});
