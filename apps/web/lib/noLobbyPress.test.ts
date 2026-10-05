import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M22.11: the lobby press is removed (owner, 2026-10-05: lobbies are the customs the hosts open).
 * This walks every text file of `apps/web` rather than trusting a grep somebody ran once: the
 * control's words or its route coming back anywhere, code, copy, comment or fixture, fails here.
 *
 * The two strings are assembled, so this file is not its own counter-example.
 */

const FORBIDDEN = [['Start', 'a', 'lobby'].join(' '), ['', 'api', 'me', 'lobbies', 'start'].join('/')];

const TEXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.snap',
  '.txt',
  '.yml',
  '.yaml',
]);

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function textFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `.next`, `.turbo` and friends are build output; `node_modules` is not ours.
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) textFiles(path, out);
    else if (TEXT.has(extname(entry.name))) out.push(path);
  }
  return out;
}

describe('M22.11: no lobby press anywhere in apps/web', () => {
  it('has no route directory left', () => {
    expect(existsSync(join(WEB_ROOT, 'app', 'api', 'me', 'lobbies', 'start'))).toBe(false);
  });

  it('names neither the control nor its route in any file', () => {
    const offenders: string[] = [];
    for (const path of textFiles(WEB_ROOT)) {
      const text = readFileSync(path, 'utf8');
      for (const word of FORBIDDEN) {
        if (text.includes(word)) offenders.push(`${path.slice(WEB_ROOT.length)}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
