/**
 * `pnpm --filter companion make-goldens [--check]` (M17.4): runs the TypeScript engine over every recorded
 * fixture (`scripts/goldens/scenarios.ts`) and writes what it sent as goldens under
 * `apps/companion/crates/engine/tests/goldens/`, the contract the Rust port is held to (M17.7 to M17.11):
 *
 *   <name>.json   one golden: the request body (or the ordered request sequence, or the file on disk) plus
 *                 the route, the fixtures that went in, the scenario and a note on what the engine did
 *   index.json    every golden by route and patch, and every scenario with the requests it made in order
 *
 * Generated once from the 0.4.0 TypeScript engine; regenerate only when that engine changes on purpose (it
 * should not before M17.14 deletes it). `--check` regenerates in memory and exits 1 when anything differs
 * from the committed files, writing nothing.
 *
 * No client, no API, no network: the fake client and the stand-in API are in-process.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_ROUTES, type Golden, runScenarios, type ScenarioResult } from './goldens/scenarios.js';

export const GOLDENS_DIR = fileURLToPath(new URL('../crates/engine/tests/goldens/', import.meta.url));
export const INDEX_FILE = 'index.json';

export function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** File name -> content, for every golden and the index. */
export function renderGoldens(results: readonly ScenarioResult[]): Map<string, string> {
  const files = new Map<string, string>();
  const goldens: Golden[] = results.flatMap((result) => result.goldens);
  const names = new Set<string>();
  for (const golden of goldens) {
    if (names.has(golden.name)) {
      throw new Error(`two goldens named ${golden.name}`);
    }
    names.add(golden.name);
    files.set(`${golden.name}.json`, serialise(golden));
  }
  const byRoute: Record<string, number> = {};
  for (const route of [...GOLDEN_ROUTES, 'sequence']) {
    const count = goldens.filter((golden) => golden.route === route).length;
    if (count > 0) byRoute[route] = count;
  }
  const byPatch: Record<string, number> = {};
  for (const golden of goldens) {
    byPatch[golden.patch] = (byPatch[golden.patch] ?? 0) + 1;
  }
  const index = {
    about:
      'Goldens for the Rust companion (M17.4): the exact requests the TypeScript engine (apps/companion/src, Kustom 0.4.0, with the @customs/lcu mappers) made for every recorded fixture in packages/lcu/fixtures/16.17 and 16.18. A Rust body that is not JSON-equal to its golden is a bug in the port. Each <name>.json holds route, method, path, the fixtures fed in, the scenario, a note, and body (one request), requests (an ordered sequence) or file (a file the engine wrote). Clocks are injected; nothing carries the generation time.',
    generator:
      'apps/companion/scripts/make-goldens.ts (pnpm --filter companion make-goldens; --check to verify)',
    checkedBy: [
      "packages/db/src/contract/goldens.test.ts: every API body through its route's real zod schema in @customs/db (the canonical server-side check, M17.3)",
      'apps/companion/scripts/goldens/goldens.test.ts: the client-write and file goldens, the credential guard, and freshness against the TypeScript engine',
      'apps/companion/crates/engine/tests/goldens.rs: every golden deserialised into the engine wire types and serialised back JSON-equal',
    ],
    counts: { total: goldens.length, byRoute, byPatch },
    goldens: goldens.map((golden) => ({
      file: `${golden.name}.json`,
      kind: golden.kind,
      target: golden.target,
      route: golden.route,
      patch: golden.patch,
      scenario: golden.scenario,
      ...(golden.commandKind !== undefined ? { commandKind: golden.commandKind } : {}),
      ...(golden.method !== undefined ? { method: golden.method } : {}),
      ...(golden.path !== undefined ? { path: golden.path } : {}),
    })),
    scenarios: results.map((result) => ({
      name: result.name,
      description: result.description,
      goldens: result.goldens.map((golden) => golden.name),
      apiRequests: result.apiRoutes,
      lcuWrites: result.lcuWrites,
    })),
  };
  files.set(INDEX_FILE, serialise(index));
  return files;
}

function committed(): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(GOLDENS_DIR)) return files;
  for (const name of readdirSync(GOLDENS_DIR)) {
    if (name.endsWith('.json')) {
      files.set(name, readFileSync(join(GOLDENS_DIR, name), 'utf8'));
    }
  }
  return files;
}

/** Names that differ between two renderings: changed, added or removed. */
export function diffGoldens(expected: Map<string, string>, actual: Map<string, string>): string[] {
  const names = new Set([...expected.keys(), ...actual.keys()]);
  return [...names].filter((name) => expected.get(name) !== actual.get(name)).sort();
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const rendered = renderGoldens(await runScenarios());
  if (check) {
    const differing = diffGoldens(committed(), rendered);
    if (differing.length > 0) {
      console.error(`goldens differ from the TypeScript engine's output: ${differing.join(', ')}`);
      process.exit(1);
    }
    console.log(`goldens match (${rendered.size - 1} files + index)`);
    return;
  }
  mkdirSync(GOLDENS_DIR, { recursive: true });
  for (const name of committed().keys()) {
    if (!rendered.has(name)) rmSync(join(GOLDENS_DIR, name));
  }
  for (const [name, content] of rendered) {
    writeFileSync(join(GOLDENS_DIR, name), content);
  }
  const index = JSON.parse(rendered.get(INDEX_FILE) ?? '{}') as { counts: unknown };
  console.log(`wrote ${rendered.size - 1} goldens + ${INDEX_FILE} to ${GOLDENS_DIR}`);
  console.log(JSON.stringify(index.counts, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
