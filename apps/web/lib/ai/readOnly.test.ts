import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M16.6 code review: a page that shows an AI line must never load the generator or the model
 * client. Walks the runtime import graph (type-only imports are erased at build and skipped) from
 * every page that reads a line, inside `apps/web`, and fails on any path to a writer or the SDK.
 */

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PAGES = [
  'app/(group)/g/[slug]/p/[puuid]/page.tsx',
  'app/(group)/g/[slug]/you/page.tsx',
  'app/(group)/g/[slug]/leaderboard/page.tsx',
  'app/(group)/g/[slug]/games/[gameId]/page.tsx',
  'app/(group)/g/[slug]/(tonight)/page.tsx',
];

const WRITERS = [
  'lib/ai/generate.ts',
  'lib/ai/client.ts',
  'lib/ai/afterIngest.ts',
  'lib/ai/scouting.ts',
  'lib/ai/storyline.ts',
];
const SDK = '@anthropic-ai/sdk';

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every runtime path from `entry` to a file or package matching `bad`, as chains of web-relative paths. */
function badPaths(entry: string, bad: (target: string) => boolean): string[][] {
  const found: string[][] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const typeOnly = match[1] !== undefined;
      const specifier = match[2] ?? match[3];
      if (typeOnly || specifier === undefined) continue;
      if (specifier === SDK) {
        found.push([...chain, SDK]);
        continue;
      }
      const target = resolveSpecifier(file, specifier);
      if (target === null) continue;
      const rel = relative(WEB_ROOT, target);
      if (bad(rel)) {
        found.push([...chain, rel]);
        continue;
      }
      walk(target, [...chain, rel]);
    }
  };
  walk(join(WEB_ROOT, entry), [entry]);
  return found;
}

describe('pages that show AI lines load no generator and no model client', () => {
  it.each(PAGES)('%s', (page) => {
    expect(existsSync(join(WEB_ROOT, page)), page).toBe(true);
    expect(badPaths(page, (rel) => WRITERS.includes(rel))).toEqual([]);
  });

  it('the read modules import none of generate, client or afterIngest, directly or not', () => {
    for (const file of [
      'lib/ai/scoutingRead.ts',
      'lib/ai/storylineRead.ts',
      'lib/ai/recap.ts',
      'lib/ai/eligibility.ts',
    ]) {
      expect(
        badPaths(file, (rel) => WRITERS.includes(rel)),
        file,
      ).toEqual([]);
    }
  });

  it('the guard sees a real leak (the cron route reaches the generator)', () => {
    expect(badPaths('app/api/cron/window/route.ts', (rel) => WRITERS.includes(rel)).length).toBeGreaterThan(
      0,
    );
  });
});
