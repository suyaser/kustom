import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M21.7 acceptance 3: no reader prints `splits.blue_win_prob` without checking that the teams who
 * played are the split's. Every source file under `apps/web` whose code (comments stripped) names
 * the column must either import one of the receipt rule's checks from `lib/games/receipt` or be on
 * {@link ALLOWED} with its reason. A new reader that reads the column and prints it raw fails here.
 */

const WEB = join(__dirname, '..', '..');
const ROOTS = ['app', 'lib', 'components', 'scripts'];

/** The receipt rule's functions that compare the played teams with the split. */
const RULE_CHECKS = [
  'gameReceiptOf',
  'playedOddsOf',
  'rolledOddsOf',
  'splitSidesOf',
  'teamsMatchSplit',
  'calibrationGameOf',
] as const;

/** Files that name the column without being an after-game reader, and why. */
const ALLOWED: Record<string, string> = {
  'lib/ingest/balance.ts': 'the writer: stores the split at roll time',
  'components/receipt/types.ts': "the stored row's type",
  'components/receipt/model.ts':
    'maps a stored row to a StoredSplit; the readers hand it to gameReceiptOf (or, live, the balanced/in-game rolled path)',
  'lib/testing/tonightRows.ts': 'tests only (M22.5): fixture split rows for Tonight snapshots, never printed',
};

/** `kickoff_blue_win_prob` is the kickoff record's own column (M21.4), not the split's. */
const COLUMN = /(?<![A-Za-z0-9_])blue_win_prob(?![A-Za-z0-9_])/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function readsColumn(source: string): boolean {
  return COLUMN.test(stripComments(source));
}

function importsRuleCheck(source: string): boolean {
  const imports = source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g);
  for (const [, names = '', from = ''] of imports) {
    if (!/(^|\/)games\/receipt$|^\.\/receipt$/.test(from)) continue;
    const imported = names.split(',').map((name) => name.trim().replace(/^type\s+/, ''));
    if (RULE_CHECKS.some((check) => imported.includes(check))) return true;
  }
  return false;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

function readers(): { file: string; source: string }[] {
  return ROOTS.flatMap((root) => sourceFiles(join(WEB, root)))
    .map((path) => ({ file: relative(WEB, path).split('\\').join('/'), source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => readsColumn(source));
}

describe("the receipt rule's guard (M21.7)", () => {
  it('every file reading splits.blue_win_prob goes through the rule, or is allowed with a reason', () => {
    const offenders = readers()
      .filter(({ file }) => ALLOWED[file] === undefined)
      .filter(({ source }) => !importsRuleCheck(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('is not vacuous: it sees the known readers, and every allowed file still reads the column', () => {
    const files = new Set(readers().map(({ file }) => file));
    for (const known of [
      'lib/board/load.ts',
      'lib/stats/load.ts',
      'lib/discord/assemble.ts',
      'lib/tonight/load.ts',
    ]) {
      expect(files.has(known), known).toBe(true);
    }
    for (const allowed of Object.keys(ALLOWED)) expect(files.has(allowed), allowed).toBe(true);
  });

  it('flags a reader that prints the column raw, and passes one that checks the teams', () => {
    const raw = "const { data } = await client.from('splits').select('lobby_id, blue_win_prob');";
    expect(readsColumn(raw)).toBe(true);
    expect(importsRuleCheck(raw)).toBe(false);
    const checked = `import { playedOddsOf } from '../games/receipt';\n${raw}`;
    expect(importsRuleCheck(checked)).toBe(true);
    // A type-only import of the rule's types is not a check.
    expect(importsRuleCheck(`import type { GameReceipt } from '../games/receipt';\n${raw}`)).toBe(false);
  });

  it("ignores comments and the kickoff record's own column", () => {
    expect(readsColumn("/** the split's `blue_win_prob` */\n// blue_win_prob\nconst x = 1;")).toBe(false);
    expect(readsColumn("select('kickoff_blue_win_prob')")).toBe(false);
  });
});
