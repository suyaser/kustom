import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { lineOf, sourceFiles, walkNodes } from './sourceScan';

/**
 * Cheap metadata (app-perf, 2026-10-04): a page's `generateMetadata` runs on **every prefetch** of
 * that page, not only on a visit, so it may read the group (`requirePageGroup`, React-cached with
 * the layout and the page) and at most one small single-row read. It never calls a page loader
 * (`load...`): on 2026-10-04 a refresh of Tonight's result screen prefetched four player pages and a
 * game page whose metadata ran their whole loaders, 39 of the refresh's 95 queries.
 *
 * Exceptions are listed with their reason; adding one needs the same.
 */
const ALLOWED_LOADS: Record<string, { calls: readonly string[]; why: string }> = {
  'app/(group)/g/[slug]/mode/page.tsx': {
    calls: ['loadGroupMode', 'loadModeState'],
    why: 'One `group_modes` row between them (`readGroupModeRow`, one request).',
  },
  'app/(group)/g/[slug]/mystery/page.tsx': {
    calls: ['loadTodayMysteryKind'],
    why: "One row, read only (never the page's load, which builds the day and touches the session).",
  },
  'app/(group)/g/[slug]/p/[puuid]/page.tsx': {
    calls: ['loadPlayerHead'],
    why: "`lib/og/heads.ts`: the player row, then three one-row group checks side by side (the page's 404 rule, so another group's PUUID never titles this group's page).",
  },
  'app/(group)/g/[slug]/games/[gameId]/page.tsx': {
    calls: ['loadGameHead'],
    why: '`lib/og/heads.ts`: one `games` row scoped to the group.',
  },
};

function metadataLoads(): { file: string; line: number; call: string }[] {
  const found: { file: string; line: number; call: string }[] = [];
  for (const file of sourceFiles(['app'])) {
    if (!file.text.includes('generateMetadata')) continue;
    for (const node of walkNodes(file.ast)) {
      const isMetadataFunction =
        (ts.isFunctionDeclaration(node) && node.name?.text === 'generateMetadata') ||
        (ts.isVariableDeclaration(node) && node.name.getText(file.ast) === 'generateMetadata');
      if (!isMetadataFunction) continue;
      for (const inner of walkNodes(node)) {
        if (!ts.isCallExpression(inner)) continue;
        const callee = inner.expression.getText(file.ast).split('.').pop() ?? '';
        if (/^load[A-Z]/.test(callee))
          found.push({ file: file.path, line: lineOf(file, inner), call: callee });
      }
    }
  }
  return found;
}

describe('generateMetadata stays cheap', () => {
  const loads = metadataLoads();

  it('calls no page loader outside the listed exceptions', () => {
    const offenders = loads
      .filter((load) => !ALLOWED_LOADS[load.file]?.calls.includes(load.call))
      .map((load) => `${load.file}:${load.line} ${load.call}()`);
    expect(offenders).toEqual([]);
  });

  it('sees the generateMetadata functions it polices', () => {
    const files = sourceFiles(['app']).filter((file) =>
      /export (async )?function generateMetadata/.test(file.text),
    );
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
});
