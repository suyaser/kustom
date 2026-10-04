/**
 * M14.6's review carry-overs (M14.13): `fileTokenUnderGroup` leaves another top-level token alone, a root
 * queue is never replayed under a different token, and the config's read-modify-write holds a lock so a
 * `--pair` write racing the running engine loses nothing.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigLockTimeoutError,
  configLockPath,
  configPath,
  loadConfig,
  saveConfig,
  updateConfig,
} from './config.js';
import {
  adoptLegacyState,
  fileTokenUnderGroup,
  hostStateDir,
  hostStateDirFor,
  LEGACY_GROUP_ID,
  resolveTopLevelToken,
} from './groups.js';
import { type FakeApi, startFakeApi } from './test-support/fake-api.js';

const TOKEN_A = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const TOKEN_B = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJ';
const PUUID = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const PLAYER_ID = '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';
const G1 = { groupId: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
const G2 = { groupId: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };

const dirs: string[] = [];
const apis: FakeApi[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const api of apis.splice(0)) await api.close();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-carry-'));
  dirs.push(dir);
  return dir;
}

const readRaw = (dir: string) => JSON.parse(readFileSync(configPath(dir), 'utf8'));

describe('fileTokenUnderGroup', () => {
  it('leaves a different top-level token alone', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_B }),
    );
    fileTokenUnderGroup(dir, G1, TOKEN_A);
    const raw = readRaw(dir);
    expect(raw.companionToken).toBe(TOKEN_B);
    expect(raw.groups).toEqual([{ ...G1, companionToken: TOKEN_A }]);
  });

  it('still removes the top-level token when it is the one filed', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A }),
    );
    fileTokenUnderGroup(dir, G1, TOKEN_A);
    expect(readRaw(dir).companionToken).toBeUndefined();
  });
});

describe('the root queue never replays under another token', () => {
  it('a different top-level token gets a directory of its own', () => {
    const dir = tempDir();
    expect(hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_A })).toBe(dir);
    expect(hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_A })).toBe(dir);
    const other = hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_B });
    expect(other).not.toBe(dir);
    expect(other.startsWith(join(dir, 'groups'))).toBe(true);
    expect(hostStateDirFor(dir, { groupId: G1.groupId, token: TOKEN_B })).toBe(hostStateDir(dir, G1.groupId));
  });

  it("another token being filed does not inherit the root state; the owner's token does", () => {
    const dir = tempDir();
    hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_A });
    mkdirSync(join(dir, 'queue'));
    expect(adoptLegacyState(dir, G2.groupId, undefined, TOKEN_B)).toEqual([]);
    expect(existsSync(join(dir, 'queue'))).toBe(true);
    expect(adoptLegacyState(dir, G1.groupId, undefined, TOKEN_A)).toEqual(['queue']);
    expect(existsSync(join(hostStateDir(dir, G1.groupId), 'queue'))).toBe(true);
  });

  it('a multi-group user: /me files a pasted token and the old root queue stays with its owner', async () => {
    const api = await startFakeApi({
      token: TOKEN_B,
      routes: {
        'GET /api/companion/me': [
          {
            status: 200,
            body: {
              ok: true,
              puuid: PUUID,
              playerId: PLAYER_ID,
              displayName: 'Ana',
              group: { id: G2.groupId, slug: G2.slug, name: G2.name },
            },
          },
        ],
      },
    });
    apis.push(api);
    const dir = tempDir();
    hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_A });
    mkdirSync(join(dir, 'queue'));
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'host',
        apiBase: api.baseUrl,
        companionToken: TOKEN_B,
        groups: [{ ...G1, companionToken: TOKEN_A }],
      }),
    );
    const loaded = loadConfig(dir);
    if (loaded.status !== 'ok') throw new Error('bad fixture');
    const filed = await resolveTopLevelToken({ configDir: dir, config: loaded.config });
    expect(filed?.groupId).toBe(G2.groupId);
    expect(existsSync(join(dir, 'queue'))).toBe(true);
    expect(existsSync(join(hostStateDir(dir, G2.groupId), 'queue'))).toBe(false);
    expect(readRaw(dir).groups).toHaveLength(2);
  });
});

describe('the config lock', () => {
  it('releases the lock after a write and after a throwing mutation', () => {
    const dir = tempDir();
    updateConfig(dir, (raw) => ({ ...raw, a: 1 }));
    expect(existsSync(configLockPath(dir))).toBe(false);
    expect(() =>
      updateConfig(dir, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(configLockPath(dir))).toBe(false);
    expect(readRaw(dir).a).toBe(1);
  });

  it('waits for a live lock and then writes on top of what the other process wrote', async () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), JSON.stringify({ before: true }));
    writeFileSync(configLockPath(dir), '999999');
    // "The other process": writes its key then releases the lock 300 ms later.
    const other = spawn(
      process.execPath,
      [
        '-e',
        `const fs=require('fs');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(configPath(dir))},JSON.stringify({before:true,other:true}));fs.unlinkSync(${JSON.stringify(configLockPath(dir))});},300);`,
      ],
      { stdio: 'ignore' },
    );
    const started = Date.now();
    updateConfig(dir, (raw) => ({ ...raw, mine: true }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(readRaw(dir)).toEqual({ before: true, other: true, mine: true });
    await new Promise((resolve) => other.on('exit', resolve));
  });

  it('breaks a stale lock instead of waiting forever', () => {
    const dir = tempDir();
    writeFileSync(configLockPath(dir), '999999');
    const old = new Date(Date.now() - 60_000);
    utimesSync(configLockPath(dir), old, old);
    updateConfig(dir, (raw) => ({ ...raw, ok: true }));
    expect(readRaw(dir).ok).toBe(true);
  });

  it('fails the write on timeout instead of writing without the lock', () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), JSON.stringify({ before: true }));
    writeFileSync(configLockPath(dir), 'someone-else');
    expect(() => updateConfig(dir, (raw) => ({ ...raw, mine: true }), { waitMs: 150 })).toThrow(
      ConfigLockTimeoutError,
    );
    expect(readRaw(dir)).toEqual({ before: true });
    expect(readFileSync(configLockPath(dir), 'utf8')).toBe('someone-else');
  });

  it('never deletes a lock another process took after ours was broken', () => {
    const dir = tempDir();
    updateConfig(dir, (raw) => {
      writeFileSync(configLockPath(dir), 'their-token'); // our lock was broken and re-taken
      return { ...raw, a: 1 };
    });
    expect(readFileSync(configLockPath(dir), 'utf8')).toBe('their-token');
  });

  it('saveConfig takes the lock too, and writes atomically (no temp file left)', () => {
    const dir = tempDir();
    // A fresh foreign lock held by another process: saveConfig waits for it like updateConfig does.
    writeFileSync(configLockPath(dir), 'someone-else');
    const other = spawn(
      process.execPath,
      ['-e', `setTimeout(()=>require('fs').unlinkSync(${JSON.stringify(configLockPath(dir))}),250)`],
      { stdio: 'ignore' },
    );
    const started = Date.now();
    saveConfig(dir, { mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(existsSync(configLockPath(dir))).toBe(false);
    expect(existsSync(`${configPath(dir)}.tmp`)).toBe(false);
    expect(readRaw(dir).companionToken).toBe(TOKEN_A);
    other.kill();
  }, 15_000);

  it("the upgrade case: pasting token B over A never lets B claim A's root queue", () => {
    const dir = tempDir();
    // 0.3.0 PC: token A at the top level, a queued block at the root, no owner record yet.
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A }),
    );
    mkdirSync(join(dir, 'queue'));
    // The paste replaces the token before any 0.4.0 engine has run.
    saveConfig(dir, { mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_B });
    const other = hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_B });
    expect(other).not.toBe(dir);
    expect(adoptLegacyState(dir, G2.groupId, undefined, TOKEN_B)).toEqual([]);
    expect(existsSync(join(dir, 'queue'))).toBe(true);
    // The token that captured it still gets it.
    expect(hostStateDirFor(dir, { groupId: LEGACY_GROUP_ID, token: TOKEN_A })).toBe(dir);
    expect(adoptLegacyState(dir, G1.groupId, undefined, TOKEN_A)).toEqual(['queue']);
  });

  it('the upgrade case via updateConfig: filing the old token elsewhere keeps the queue with it', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A }),
    );
    mkdirSync(join(dir, 'queue'));
    fileTokenUnderGroup(dir, G1, TOKEN_A);
    expect(adoptLegacyState(dir, G2.groupId, undefined, TOKEN_B)).toEqual([]);
    expect(adoptLegacyState(dir, G1.groupId, undefined, TOKEN_A)).toEqual(['queue']);
  });

  it('two processes writing at once lose nothing', async () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), JSON.stringify({ mode: 'overlay' }));
    const here = dirname(fileURLToPath(import.meta.url));
    const script = join(here, 'test-support', 'configWriter.ts');
    const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');
    const writers = ['p', 'q'].map(
      (prefix) =>
        new Promise<number | null>((resolve) => {
          spawn(tsx, [script, dir, prefix, '25'], { stdio: 'ignore' }).on('exit', resolve);
        }),
    );
    expect(await Promise.all(writers)).toEqual([0, 0]);
    const raw = readRaw(dir);
    for (const prefix of ['p', 'q']) {
      for (let i = 0; i < 25; i += 1) expect(raw[`${prefix}${i}`]).toBe(true);
    }
    expect(raw.mode).toBe('overlay');
  }, 60_000);
});
