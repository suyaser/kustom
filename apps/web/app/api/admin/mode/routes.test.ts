import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M14.29 acceptance 6: the mode has one route (`POST /api/admin/mode`) and Reset keeps the one it
 * had (`POST /api/admin/fearless/reset`). No `fearless/enabled` switch, no second reset. M15.3 adds
 * `POST /api/admin/mode/spin` (the milestone's route) and nothing else: no route per mode.
 */
const API = fileURLToPath(new URL('../..', import.meta.url));

/** Every directory under `app/api` that holds a `route.ts`, as a path relative to `app/api`. */
function routes(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'route.ts') found.push(prefix.replace(/\/$/, ''));
    if (entry.isDirectory()) found.push(...routes(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
  }
  return found;
}

describe('mode and fearless routes', () => {
  const all = routes(API);

  it('has the mode route, its Spin (M15.3), and one fearless route, the reset', () => {
    expect(all.filter((route) => /(^|\/)mode(\/|$)/.test(route)).sort()).toEqual([
      'admin/mode',
      'admin/mode/spin',
    ]);
    expect(all.filter((route) => route.includes('fearless'))).toEqual(['admin/fearless/reset']);
  });

  it("has no reset route but the fearless one and the owner's ratings reset (M14.18)", () => {
    expect(all.filter((route) => /reset/.test(route)).sort()).toEqual([
      'admin/fearless/reset',
      'admin/ratings/reset',
    ]);
  });
});
