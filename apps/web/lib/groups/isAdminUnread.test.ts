import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Assembled rather than spelled, so this file is not its own counter-example. */
const RETIRED_FLAG = ['is', 'admin'].join('_');

/**
 * **`players.is_admin` is not read anywhere in the app** (M13.4, acceptance 3; decision row
 * 2026-10-03, "Group admin is a membership role"). Admin is `group_memberships.role = 'admin'` in
 * the request's group; a global flag would make an admin of one group an admin of all.
 *
 * The column stays in the database until a later cleanup migration, and `bootstrap_admin` (SQL)
 * still sets it, so a grep that somebody ran once is not enough: this walks the app's own sources
 * on every test run. Test files may name it — the integration tests set it on a plain member to
 * prove it opens nothing — and nothing else may.
 */
describe('the retired global admin flag', () => {
  it('appears in no source file under apps/web outside the tests', () => {
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
        if (readFileSync(path, 'utf8').includes(RETIRED_FLAG)) offenders.push(path.slice(root.length));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
