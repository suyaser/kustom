/**
 * `pnpm --filter companion make-config-fixtures [--check]` (M17.6): writes **synthetic** config trees, one per
 * config shape a real install can have, with the TypeScript engine's own writers (`saveConfig`,
 * `rememberGroup`, `setLastGroup`, `fileTokenUnderGroup`, `updateConfig`, `GameQueue`), so the Rust config,
 * migration and state code (`crates/engine/src/config/`) is tested against files the TypeScript engine really
 * writes, byte for byte:
 *
 *   synthetic-0.2-top-level              0.2.x/0.3.x host: top-level token, root queue/backfill/executed, stale status.json
 *   synthetic-0.3-host-tokenless-groups  0.3.x host with a top-level token plus tokenless groups (overlay pairings),
 *                                        a lastGroupId, a lockfilePath and an unknown key; root queue
 *   synthetic-0.3-overlay                0.3.x Overlay mode: no token anywhere, tokenless groups
 *   synthetic-0.4-groups                 0.4.0: a token per group, per-group state dirs, the root-state owner record
 *
 * They are synthetic: no real PC wrote them. M17.6's acceptance also wants the user's own redacted 0.3.x tree;
 * it goes beside these as `real-0.3-<date>/` when it arrives (see the M17.6 report). Tokens here are
 * token-shaped fakes; nothing in them is a credential.
 *
 * `--check` regenerates into a temp dir and exits 1 when anything differs from the committed files.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveConfig, updateConfig } from '../src/config.js';
import { fileTokenUnderGroup, rememberGroup, setLastGroup } from '../src/groups.js';
import { GameQueue } from '../src/queue.js';

export const FIXTURES_DIR = fileURLToPath(
  new URL('../crates/engine/tests/fixtures/config/', import.meta.url),
);
const GOLDENS_DIR = fileURLToPath(new URL('../crates/engine/tests/goldens/', import.meta.url));

export const API_BASE = 'https://customs-night.vercel.app';
export const GROUP_CUSTOMS = {
  groupId: '11111111-1111-4111-8111-111111111111',
  slug: 'customs',
  name: 'Customs',
};
export const GROUP_WEEKEND = {
  groupId: '22222222-2222-4222-8222-222222222222',
  slug: 'weekend-crew',
  name: 'Weekend Crew',
};

/** A token-shaped fake: 43 characters of `A-Za-z0-9_-`, readable, never a real credential. */
export function fakeToken(label: string): string {
  const base = `SYNTHETIC_${label}_`;
  return base.padEnd(43, 'x').slice(0, 43);
}

export const TOKENS = {
  topLevel02: fakeToken('topLevel02'),
  topLevel03: fakeToken('topLevel03'),
  customs04: fakeToken('customs04'),
  weekend04: fakeToken('weekend04'),
} as const;

function golden(name: string): { file: unknown } {
  return JSON.parse(readFileSync(join(GOLDENS_DIR, `${name}.json`), 'utf8')) as { file: unknown };
}

const queueGolden = golden('queue-file--eog-stats-block').file as {
  queuedAt: string;
  payload: Parameters<GameQueue['write']>[0];
};
const commandsDone = golden('commands-done-file--switch-side').file;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** What 0.2.x/0.3.x leave behind when they quit (`status.ts`; never removed on exit). */
function staleStatus(dir: string, mode: 'host' | 'overlay'): void {
  writeJson(join(dir, 'status.json'), {
    mode,
    state: 'waiting',
    phase: null,
    playerName: null,
    overlayUrl: 'http://127.0.0.1:52123/',
    overlayVisible: false,
    error: null,
    updatedAt: '2026-10-02T23:41:07.512Z',
  });
}

function backfillCache(dir: string): void {
  writeJson(join(dir, 'backfill.json'), {
    version: 2,
    lastRunAt: '2026-10-02T20:00:00.000Z',
    deepestBegIndex: 40,
    knownGameIds: [4000969091, 4000901234],
    pendingGameIds: [],
    resumeBegIndex: null,
  });
}

function queueBlock(stateDir: string): void {
  const written = new GameQueue({ configDir: stateDir }).write(queueGolden.payload, queueGolden.queuedAt);
  if (written === null) throw new Error('the golden queue block did not queue');
}

function tree02(dir: string): void {
  saveConfig(dir, { apiBase: API_BASE, companionToken: TOKENS.topLevel02 });
  queueBlock(dir);
  backfillCache(dir);
  writeJson(join(dir, 'commands-done.json'), commandsDone);
  staleStatus(dir, 'host');
}

function tree03Host(dir: string): void {
  saveConfig(dir, {
    apiBase: API_BASE,
    companionToken: TOKENS.topLevel03,
    lockfilePath: 'D:\\Games\\Riot Games\\League of Legends\\lockfile',
  });
  rememberGroup(dir, API_BASE, GROUP_CUSTOMS);
  rememberGroup(dir, API_BASE, GROUP_WEEKEND);
  setLastGroup(dir, GROUP_WEEKEND.groupId);
  updateConfig(dir, (raw) => ({ ...raw, someLaterKey: { kept: true, list: [1, 2, 3] } }));
  queueBlock(dir);
  backfillCache(dir);
  staleStatus(dir, 'host');
}

function tree03Overlay(dir: string): void {
  saveConfig(dir, {
    mode: 'overlay',
    apiBase: API_BASE,
    groups: [GROUP_CUSTOMS],
    lastGroupId: GROUP_CUSTOMS.groupId,
  });
  staleStatus(dir, 'overlay');
}

function tree04(dir: string): void {
  rememberGroup(dir, API_BASE, GROUP_CUSTOMS);
  fileTokenUnderGroup(dir, GROUP_CUSTOMS, TOKENS.customs04);
  fileTokenUnderGroup(dir, GROUP_WEEKEND, TOKENS.weekend04);
  setLastGroup(dir, GROUP_WEEKEND.groupId);
  updateConfig(dir, (raw) => ({
    ...raw,
    mode: 'host',
    lockfilePath: 'C:\\Riot Games\\League of Legends\\lockfile',
  }));
  queueBlock(join(dir, 'groups', GROUP_CUSTOMS.groupId));
  backfillCache(join(dir, 'groups', GROUP_WEEKEND.groupId));
  writeJson(join(dir, 'groups', GROUP_WEEKEND.groupId, 'commands-done.json'), commandsDone);
  // 0.4.0 records the root's owner the first time a top-level token runs; this PC once had one.
  writeFileSync(join(dir, 'legacy-state-owner'), 'f0e1d2c3b4a59687\n');
}

export const TREES: Record<string, (dir: string) => void> = {
  'synthetic-0.2-top-level': tree02,
  'synthetic-0.3-host-tokenless-groups': tree03Host,
  'synthetic-0.3-overlay': tree03Overlay,
  'synthetic-0.4-groups': tree04,
};

const ABOUT = {
  about:
    'SYNTHETIC config trees for the Rust config/migration tests (M17.6), written by the TypeScript engine (0.4.0 writers) from apps/companion/scripts/make-config-fixtures.ts. No real PC wrote them; tokens are token-shaped fakes. A real, redacted 0.3.x tree from the user goes beside them as real-0.3-<date>/.',
  generator: 'pnpm --filter companion make-config-fixtures (--check to verify)',
  tokens: TOKENS,
  groups: [GROUP_CUSTOMS, GROUP_WEEKEND],
};

export function generate(root: string): void {
  mkdirSync(root, { recursive: true });
  for (const [name, build] of Object.entries(TREES)) {
    const dir = join(root, name);
    // Only the synthetic trees are regenerated; a real-0.3-* tree beside them is never touched.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    build(dir);
  }
  writeJson(join(root, 'index.json'), ABOUT);
}

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(root, path) : [relative(root, path)];
  });
}

/** Paths that differ between two trees. */
export function diffTrees(a: string, b: string): string[] {
  const left = new Set(listFiles(a));
  const right = new Set(listFiles(b));
  const out: string[] = [];
  for (const file of new Set([...left, ...right])) {
    if (!left.has(file) || !right.has(file)) out.push(file);
    else if (readFileSync(join(a, file), 'utf8') !== readFileSync(join(b, file), 'utf8')) out.push(file);
  }
  return out.sort();
}

function main(): number {
  if (process.argv.includes('--check')) {
    const temp = mkdtempSync(join(tmpdir(), 'kustom-config-fixtures-'));
    try {
      generate(temp);
      const diff = diffTrees(temp, FIXTURES_DIR);
      if (diff.length > 0) {
        console.error(`config fixtures are stale: ${diff.join(', ')}`);
        return 1;
      }
      console.log('config fixtures are current');
      return 0;
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  generate(FIXTURES_DIR);
  console.log(`wrote ${Object.keys(TREES).length} synthetic config trees to ${FIXTURES_DIR}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
