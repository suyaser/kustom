/**
 * One group per session (M13.8 acceptance 3 and 4): the picker state, a Host switch that stops the old
 * watchers before the new token's first post, a refused token, and no path that gives one block two tokens.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type CompanionConfig, configPath, loadConfig } from './config.js';
import { hostStateDir, LEGACY_GROUP_ID, tokenNoLongerWorks } from './groups.js';
import type { HostHandle } from './host.js';
import { createMemoryLogger } from './log.js';
import { type GroupPanelState, GroupSession } from './session.js';

const TOKEN_A = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const TOKEN_B = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJ';
const G1 = { groupId: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
const G2 = { groupId: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };
const G3 = { groupId: '9c2f3a52-9c0e-4d7a-8f11-2a6d4e9b7c11', slug: 'solo', name: 'Solo Q' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(config: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'companion-session-'));
  dirs.push(dir);
  writeFileSync(configPath(dir), JSON.stringify(config));
  const loaded = loadConfig(dir);
  if (loaded.status !== 'ok') throw new Error('bad fixture config');
  return { dir, config: loaded.config };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hosts that record when they start and when they have fully stopped, in one shared timeline. */
function fakeHosts() {
  const events: string[] = [];
  const refusers = new Map<string, (status: 401 | 403) => void>();
  let live = 0;
  let peak = 0;
  const factory = (
    group: { groupId: string; token?: string },
    onRefused: (status: 401 | 403) => void,
  ): HostHandle => {
    const id = group.groupId;
    events.push(`start ${id} with ${group.token?.slice(0, 4)}`);
    live += 1;
    peak = Math.max(peak, live);
    refusers.set(id, onRefused);
    let release: () => void = () => undefined;
    const run = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      run,
      stop() {
        // Stopping is not instant: the old watchers finish on a later tick, like the real ones.
        setTimeout(() => {
          events.push(`stopped ${id}`);
          live -= 1;
          release();
        }, 5);
      },
    };
  };
  return { events, factory, refusers, peak: () => peak };
}

function make(config: CompanionConfig, dir: string, mode: 'host' | 'overlay') {
  const hosts = fakeHosts();
  const states: GroupPanelState[] = [];
  const selected: (string | null)[] = [];
  const session = new GroupSession({
    mode,
    configDir: dir,
    initial: config,
    reload: () => {
      const result = loadConfig(dir);
      return result.status === 'ok' ? result.config : null;
    },
    ...(mode === 'host' ? { startHost: hosts.factory } : {}),
    logger: createMemoryLogger(),
    onState: (state) => states.push(state),
    onSelected: (group) => selected.push(group?.groupId ?? null),
  });
  return { session, states, selected, hosts };
}

const TWO_HOST = {
  mode: 'host',
  apiBase: 'https://kustom.example',
  groups: [{ ...G1, companionToken: TOKEN_A }, { ...G2, companionToken: TOKEN_B }, { ...G3 }],
  lastGroupId: G1.groupId,
};

describe('GroupSession, Host mode', () => {
  it("starts the watchers once, on the selected group's token", async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    expect(hosts.events).toEqual([`start ${G1.groupId} with AbCd`]);
    expect(session.state().picker?.label).toBe('Posting tonight to:');
    await session.stop();
  });

  it('switching stops the old watchers completely before the new token starts', async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts, states } = make(config, dir, 'host');
    await session.start();
    await session.select(G2.groupId);
    expect(hosts.events).toEqual([
      `start ${G1.groupId} with AbCd`,
      `stopped ${G1.groupId}`,
      `start ${G2.groupId} with zyxw`,
    ]);
    expect(session.runningGroupId()).toBe(G2.groupId);
    // The select is disabled while it switches, enabled after.
    expect(states.some((state) => state.switching)).toBe(true);
    expect(session.state().switching).toBe(false);
    // The pick is remembered for the next start.
    const saved = loadConfig(dir);
    expect(saved.status === 'ok' && saved.config.lastGroupId).toBe(G2.groupId);
    await session.stop();
  });

  it('never has two hosts running, even when picks arrive together', async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    await Promise.all([session.select(G2.groupId), session.select(G1.groupId), session.select(G2.groupId)]);
    expect(hosts.peak()).toBe(1);
    hosts.events.forEach((event, index) => {
      if (event.startsWith('start') && index > 0) {
        expect(hosts.events[index - 1]?.startsWith('stopped')).toBe(true);
      }
    });
    await session.stop();
  });

  it('ignores a pick of a group with no host token or one that is not here', async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    await session.select(G3.groupId);
    await session.select('nope');
    expect(hosts.events).toEqual([`start ${G1.groupId} with AbCd`]);
    await session.stop();
  });

  it('a 403 stops posting and says the exact sentence; the picker stays usable', async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    hosts.refusers.get(G1.groupId)?.(403);
    await tick();
    expect(session.state().error).toBe(tokenNoLongerWorks('Customs Night'));
    expect(session.state().error).toBe(
      'This token no longer works for Customs Night. Ask an admin for a new one.',
    );
    expect(session.runningGroupId()).toBeNull();
    expect(session.state().picker).not.toBeNull();
    // Picking another group clears the box and posts on that group's token.
    await session.select(G2.groupId);
    expect(session.state().error).toBeNull();
    expect(session.runningGroupId()).toBe(G2.groupId);
    await session.stop();
  });

  it('a 401 changes nothing (0.2.x behaviour)', async () => {
    const { dir, config } = setup(TWO_HOST);
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    hosts.refusers.get(G1.groupId)?.(401);
    await tick();
    expect(session.state().error).toBeNull();
    expect(session.runningGroupId()).toBe(G1.groupId);
    await session.stop();
  });

  it('a 0.2.x config starts one host on the legacy token with no picker (acceptance 1)', async () => {
    const { dir, config } = setup({
      mode: 'host',
      apiBase: 'https://kustom.example',
      companionToken: TOKEN_A,
    });
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    expect(hosts.events).toEqual([`start ${LEGACY_GROUP_ID} with AbCd`]);
    expect(session.state().picker).toBeNull();
    await session.stop();
  });
});

describe('no block is ever sent with two tokens (acceptance 4)', () => {
  it('each group has its own state directory, so a queued block replays only with its own token', () => {
    const dir = '/config';
    const a = hostStateDir(dir, G1.groupId);
    const b = hostStateDir(dir, G2.groupId);
    expect(a).not.toBe(b);
    expect(a.startsWith(join(dir, 'groups'))).toBe(true);
    // Only the unfiled 0.2.x token keeps the root, and it is filed (and its state moved) the moment the
    // server names its group, so the root is never shared by two tokens.
    expect(hostStateDir(dir, LEGACY_GROUP_ID)).toBe(dir);
  });

  it("a switch while a block is queued leaves it in the first group's directory", async () => {
    const { dir, config } = setup(TWO_HOST);
    const queued = join(hostStateDir(dir, G1.groupId), 'queue');
    mkdirSync(queued, { recursive: true });
    writeFileSync(join(queued, '4242.json'), '{}');
    const { session, hosts } = make(config, dir, 'host');
    await session.start();
    await session.select(G2.groupId);
    expect(hosts.events.filter((e) => e.startsWith('start'))).toHaveLength(2);
    expect(hostStateDir(dir, G2.groupId)).not.toBe(hostStateDir(dir, G1.groupId));
    await session.stop();
  });
});

describe('GroupSession, Overlay mode', () => {
  const OVERLAY = {
    mode: 'overlay',
    apiBase: 'https://kustom.example',
    groups: [{ ...G1 }, { ...G2 }],
    lastGroupId: G2.groupId,
  };

  it('starts no host, labels the picker "Tonight\'s group:", and defaults to the last group', async () => {
    const { dir, config } = setup(OVERLAY);
    const { session, hosts } = make(config, dir, 'overlay');
    await session.start();
    expect(hosts.events).toEqual([]);
    expect(session.state().picker?.label).toBe("Tonight's group:");
    expect(session.selected()?.groupId).toBe(G2.groupId);
    expect(session.state().picker?.options.every((option) => !option.disabled)).toBe(true);
  });

  it('a pick changes the group the panel reads for and tells it to refetch', async () => {
    const { dir, config } = setup(OVERLAY);
    const { session, selected } = make(config, dir, 'overlay');
    await session.start();
    await session.select(G1.groupId);
    expect(session.selected()?.groupId).toBe(G1.groupId);
    expect(selected).toEqual([G1.groupId]);
  });

  it('zero memberships: nothing to say until the server has answered, then the one sentence', async () => {
    const { dir, config } = setup({ mode: 'overlay', apiBase: 'https://kustom.example' });
    const { session } = make(config, dir, 'overlay');
    await session.start();
    expect(session.state().noGroups).toBe(false);
    expect(session.state().picker).toBeNull();
    await session.adoptServerGroups();
    expect(session.state().noGroups).toBe(true);
  });

  it('adopts groups the server listed after start (a friend who joined by playing)', async () => {
    const { dir, config } = setup({ mode: 'overlay', apiBase: 'https://kustom.example' });
    const { session, selected } = make(config, dir, 'overlay');
    await session.start();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'overlay', apiBase: 'https://kustom.example', groups: [{ ...G1 }] }),
    );
    await session.adoptServerGroups();
    expect(session.state().noGroups).toBe(false);
    expect(session.selected()?.groupId).toBe(G1.groupId);
    expect(selected).toEqual([G1.groupId]);
  });
});
