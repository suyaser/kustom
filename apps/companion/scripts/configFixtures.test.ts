/**
 * The synthetic config trees in `crates/engine/tests/fixtures/config/` (M17.6) are still exactly what the
 * TypeScript engine's writers produce, and every token in them is a fake.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeCompanionToken } from '../src/config.js';
import { diffTrees, FIXTURES_DIR, generate, TOKENS, TREES } from './make-config-fixtures.js';

describe('synthetic config fixtures', () => {
  it('are current (pnpm --filter companion make-config-fixtures)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kustom-config-fixtures-'));
    try {
      generate(temp);
      expect(diffTrees(temp, FIXTURES_DIR).filter((file) => !file.startsWith('real-'))).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('carry only token-shaped fakes', () => {
    for (const token of Object.values(TOKENS)) {
      expect(looksLikeCompanionToken(token)).toBe(true);
      expect(token.startsWith('SYNTHETIC_')).toBe(true);
    }
    for (const name of Object.keys(TREES)) {
      const config = readFileSync(join(FIXTURES_DIR, name, 'config.json'), 'utf8');
      for (const match of config.matchAll(/"companionToken": "([^"]*)"/g)) {
        expect(match[1]?.startsWith('SYNTHETIC_')).toBe(true);
      }
    }
  });
});
