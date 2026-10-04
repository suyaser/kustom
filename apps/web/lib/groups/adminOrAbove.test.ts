import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **No exact admin check is left in apps/web** (M14.11, acceptance 5). Since `owner` exists, a
 * check that the role *equals* `admin` locks the owner out of the very thing they own; every gate
 * reads `isAtLeast(role, 'admin')` (`@customs/db/schemas`) and every query reads
 * `.in('role', ['owner', 'admin'])`.
 *
 * Walks the app's own sources on every run, like `isAdminUnread.test.ts`, because a grep somebody
 * ran once does not stop the next one. Test files may compare against the word: fixtures do.
 */

/** Assembled rather than spelled, so this file is not its own counter-example. */
const WORD = ['ad', 'min'].join('');
const EXACT_CHECKS = [
  new RegExp(`[!=]==\\s*['"]${WORD}['"]`),
  new RegExp(`['"]${WORD}['"]\\s*[!=]==`),
  new RegExp(`\\.eq\\(\\s*['"]role['"]\\s*,\\s*['"]${WORD}['"]\\s*\\)`),
];

describe('admin-or-above, never exactly admin', () => {
  it('has no exact role check in any source file under apps/web outside the tests', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(path, 'utf8');
        if (EXACT_CHECKS.some((pattern) => pattern.test(source))) offenders.push(path.slice(root.length));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('would catch the shapes it is looking for', () => {
    const quoted = `'${WORD}'`;
    for (const line of [
      `role === ${quoted}`,
      `role !== ${quoted}`,
      `${quoted} === role`,
      `.eq('role', ${quoted})`,
    ]) {
      expect(EXACT_CHECKS.some((pattern) => pattern.test(line))).toBe(true);
    }
    expect(EXACT_CHECKS.some((pattern) => pattern.test(`isAtLeast(role, ${quoted})`))).toBe(false);
  });
});
