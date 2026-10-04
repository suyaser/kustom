/**
 * `pnpm --filter @customs/db export-schemas [--check]` (M17.3).
 *
 * Writes the JSON Schema of every companion request and response schema into `packages/db/json-schema/`
 * (see `src/contract/companionContract.ts` for what is in the list and why). With `--check` it writes
 * nothing and exits 1 when the committed folder differs from a fresh export: that is CI's drift alarm.
 * Run it without `--check` after changing a schema in `src/schemas/`, and commit the result with the
 * change.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContract } from '../src/contract/companionContract';

const JSON_SCHEMA_DIR = fileURLToPath(new URL('../json-schema/', import.meta.url));

function committedFiles(): Map<string, string> {
  let names: string[];
  try {
    names = readdirSync(JSON_SCHEMA_DIR).filter((name) => name.endsWith('.json'));
  } catch {
    return new Map();
  }
  return new Map(names.map((name) => [name, readFileSync(join(JSON_SCHEMA_DIR, name), 'utf8')] as const));
}

/** One line per file that is missing, extra or different. Empty means no drift. */
function diffContract(committed: Map<string, string>, fresh: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, text] of fresh) {
    const was = committed.get(name);
    if (was === undefined) problems.push(`missing: ${name}`);
    else if (was !== text) problems.push(`differs: ${name}`);
  }
  for (const name of committed.keys()) {
    if (!fresh.has(name)) problems.push(`extra: ${name}`);
  }
  return problems.sort();
}

function main(argv: readonly string[]): number {
  const fresh = renderContract();
  const committed = committedFiles();
  const problems = diffContract(committed, fresh);

  if (argv.includes('--check')) {
    if (problems.length === 0) {
      console.log(`json-schema: ${fresh.size} files, no drift`);
      return 0;
    }
    console.error(
      'json-schema: the committed export differs from the zod schemas in packages/db/src/schemas:',
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      'A companion schema changed. Run `pnpm --filter @customs/db export-schemas`, read the diff (the Rust ' +
        'companion parses these shapes), and commit packages/db/json-schema/ with the change.',
    );
    return 1;
  }

  mkdirSync(JSON_SCHEMA_DIR, { recursive: true });
  for (const name of committed.keys()) {
    if (!fresh.has(name)) rmSync(join(JSON_SCHEMA_DIR, name));
  }
  for (const [name, text] of fresh) writeFileSync(join(JSON_SCHEMA_DIR, name), text);
  console.log(
    problems.length === 0
      ? `json-schema: ${fresh.size} files, unchanged`
      : `json-schema: ${fresh.size} files written (${problems.join(', ')})`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
