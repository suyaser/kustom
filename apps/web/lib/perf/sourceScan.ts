import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Source scanning for the perf guard tests (app-perf, 2026-10-04): every `.ts` / `.tsx` file of the
 * web app under the given roots, parsed with the TypeScript compiler (no type checking, so it is
 * fast), test files and the dev-only kit left out. Paths are relative to `apps/web`, `/`-separated.
 */

export const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface SourceFile {
  path: string;
  text: string;
  ast: ts.SourceFile;
}

const SKIP_DIRS = new Set(['node_modules', '.next', '(dev)', 'testing']);

export function sourceFiles(
  roots: readonly string[],
  extensions: readonly string[] = ['.ts', '.tsx'],
): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      if (!extensions.some((ext) => name.endsWith(ext))) continue;
      if (/\.test\.tsx?$/.test(name) || name.endsWith('.d.ts')) continue;
      const text = readFileSync(full, 'utf8');
      out.push({
        path: relative(WEB_ROOT, full).split('\\').join('/'),
        text,
        ast: ts.createSourceFile(
          name,
          text,
          ts.ScriptTarget.Latest,
          true,
          name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
      });
    }
  };
  for (const root of roots) walk(join(WEB_ROOT, root));
  return out;
}

/** Every node of the tree, depth first. */
export function* walkNodes(node: ts.Node): Generator<ts.Node> {
  yield node;
  for (const child of node.getChildren()) yield* walkNodes(child);
}

/** The 1-based line of a node, for messages. */
export function lineOf(file: SourceFile, node: ts.Node): number {
  return file.ast.getLineAndCharacterOfPosition(node.getStart(file.ast)).line + 1;
}
