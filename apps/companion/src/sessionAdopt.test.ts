/**
 * The running engine picks up a config written by the one-shot `--pair` process (M14.13): a host token that
 * just arrived starts the watchers, with no paste and no restart.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type CompanionConfig, configPath, loadConfig } from './config.js';
import type { HostHandle } from './host.js';
import { createMemoryLogger } from './log.js';
import { GroupSession } from './session.js';

const TOKEN_A = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const TOKEN_B = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJ';
const G1 = { groupId: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
const G2 = { groupId: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(dir: string, config: Record<string, unknown>): void {
  writeFileSync(configPath(dir), JSON.stringify(config));
}

function load(dir: string): CompanionConfig {
  const result = loadConfig(dir);
  if (result.status !== 'ok') throw new Error('bad fixture');
  return result.config;
}

function make(dir: string, initial: CompanionConfig) {
  const started: string[] = [];
  const refusers = new Map<string, (status: 401 | 403) => void>();
  const session = new GroupSession({
    mode: 'host',
    configDir: dir,
    initial,
    reload: () => {
      const result = loadConfig(dir);
      return result.status === 'ok' ? result.config : null;
    },
    startHost: (group, onRefused): HostHandle => {
      started.push(`${group.groupId}:${group.token?.slice(0, 4)}`);
      refusers.set(group.groupId, onRefused);
      return { run: Promise.resolve(), stop: () => undefined };
    },
    logger: createMemoryLogger(),
    onState: () => undefined,
  });
  return { session, started, refusers };
}

describe('GroupSession.adoptConfig during a game', () => {
  it('defers a replaced token while the game is busy and applies it after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'companion-adopt-'));
    dirs.push(dir);
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [{ ...G1, companionToken: TOKEN_A }],
    });
    const started: string[] = [];
    let busy = true;
    const session = new GroupSession({
      mode: 'host',
      configDir: dir,
      initial: load(dir),
      busyRecheckMs: 20,
      reload: () => {
        const result = loadConfig(dir);
        return result.status === 'ok' ? result.config : null;
      },
      startHost: (group): HostHandle => {
        started.push(`${group.token?.slice(0, 4)}`);
        return { run: Promise.resolve(), stop: () => undefined, busy: () => busy };
      },
      logger: createMemoryLogger(),
      onState: () => undefined,
    });
    await session.start();
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [{ ...G1, companionToken: TOKEN_B }],
    });
    await session.adoptConfig();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(started).toEqual(['AbCd']); // still on the old token mid-game
    busy = false; // the end-of-game block is posted
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(started).toEqual(['AbCd', 'zyxw']);
    await session.stop();
  });
});

describe('GroupSession.adoptConfig', () => {
  it('starts the watchers on a host token a pairing just saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'companion-adopt-'));
    dirs.push(dir);
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [{ ...G1, companionToken: TOKEN_A }],
    });
    const { session, started } = make(dir, load(dir));
    await session.start();
    expect(started).toEqual([`${G1.groupId}:AbCd`]);
    // `--pair` adds a second group with its own token: the running group is left alone, the picker appears.
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [
        { ...G1, companionToken: TOKEN_A },
        { ...G2, companionToken: TOKEN_B },
      ],
      lastGroupId: G1.groupId,
    });
    await session.adoptConfig();
    expect(started).toEqual([`${G1.groupId}:AbCd`]);
    expect(session.state().picker?.options).toHaveLength(2);
    expect(session.runningGroupId()).toBe(G1.groupId);
    await session.stop();
  });

  it('starts from nothing: a group with no token, then the token arrives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'companion-adopt-'));
    dirs.push(dir);
    write(dir, { mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A });
    const config = load(dir);
    const { session, started } = make(dir, {
      ...config,
      companionToken: undefined,
      groups: [],
    } as CompanionConfig);
    await session.start();
    expect(started).toEqual([]);
    await session.adoptConfig();
    expect(started).toEqual([`legacy-token:AbCd`]);
    await session.stop();
  });

  it('restarts on a replaced token, but never relaunches a token the server refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'companion-adopt-'));
    dirs.push(dir);
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [{ ...G1, companionToken: TOKEN_A }],
    });
    const { session, started, refusers } = make(dir, load(dir));
    await session.start();
    refusers.get(G1.groupId)?.(403);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.runningGroupId()).toBeNull();
    await session.adoptConfig(); // same token: stays stopped, error kept
    expect(started).toHaveLength(1);
    expect(session.state().error).not.toBeNull();
    write(dir, {
      mode: 'host',
      apiBase: 'https://kustom.example',
      groups: [{ ...G1, companionToken: TOKEN_B }],
    });
    await session.adoptConfig(); // a new token for the group: posts again, error cleared
    expect(started).toEqual([`${G1.groupId}:AbCd`, `${G1.groupId}:zyxw`]);
    expect(session.state().error).toBeNull();
    await session.stop();
  });
});
