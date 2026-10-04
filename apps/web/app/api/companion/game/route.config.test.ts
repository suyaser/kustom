import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M16.4 review: the game route runs the AI recap in `after()`, which lives inside the function's
 * timeout. It must allow 60 s, and nothing in `vercel.json` may override it with a shorter limit.
 */
const route = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');
const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../vercel.json', import.meta.url)), 'utf8'),
) as {
  functions?: Record<string, { maxDuration?: number }>;
};

describe('POST /api/companion/game config', () => {
  it('exports maxDuration = 60', () => {
    expect(route).toMatch(/^export const maxDuration = 60;$/m);
  });

  it('is not given a different limit in vercel.json', () => {
    const overrides = Object.entries(vercel.functions ?? {}).filter(([glob]) => glob.includes('companion'));
    expect(overrides).toEqual([]);
  });
});
