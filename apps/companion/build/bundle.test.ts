/**
 * The build's smoke test: the bundle starts under plain `node` on this machine, answers `--version` and
 * `--help`, exits 0, and carries the build-time constants. Host-independent: no League client, no exe, no
 * network. The exe itself can only be run on Windows (README, build section).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BundleResult, bundle } from './bundle.js';
import { apiBaseForBuild, companionVersion, RELEASE_API_BASE } from './config.js';

describe('bundle', () => {
  let dir: string;
  let result: BundleResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'companion-bundle-'));
    result = await bundle({
      outfile: join(dir, 'kustom.cjs'),
      apiBase: 'https://example.test',
      version: '9.9.9',
    });
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return spawnSync(process.execPath, [result.outfile, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CUSTOMS_NIGHT_CONFIG_DIR: join(dir, 'config') },
      timeout: 20_000,
    });
  }

  it('answers --version with the stamped version and exits 0', () => {
    const { status, stdout, stderr } = run('--version');
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('9.9.9');
  });

  it('answers --help and exits 0 without writing anything', () => {
    const { status, stdout } = run('--help');
    expect(status).toBe(0);
    expect(stdout).toContain('Kustom 9.9.9');
    expect(stdout).toContain('--version');
    expect(() => readFileSync(join(dir, 'config', 'config.json'))).toThrow();
  });

  it('is one CommonJS file with the origin and the Riot root certificate baked in, and no import.meta left', () => {
    const text = readFileSync(result.outfile, 'utf8');
    expect(result.bytes).toBeGreaterThan(50_000);
    expect(text).toContain('"https://example.test"');
    expect(text).toContain('-----BEGIN CERTIFICATE-----');
    expect(text).not.toMatch(/\bimport\.meta\b/);
    // Nothing outside Node's builtins and ws's optional accelerators is required at runtime: inside the exe,
    // require() only resolves builtins.
    const builtin = new Set(builtinModules);
    const requires = [...text.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1] ?? '');
    const foreign = requires.filter(
      (name) => !builtin.has(name.replace(/^node:/, '')) && !['bufferutil', 'utf-8-validate'].includes(name),
    );
    expect(foreign).toEqual([]);
  });

  it('defaults to the deployed origin and the package version', () => {
    expect(apiBaseForBuild({})).toBe(RELEASE_API_BASE);
    expect(apiBaseForBuild({ CUSTOMS_NIGHT_API_BASE: 'http://localhost:3000' })).toBe(
      'http://localhost:3000',
    );
    expect(companionVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
