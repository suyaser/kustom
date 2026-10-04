/**
 * Groups on this PC (M13.8): the 0.2.x config, the picker's exact labels, config writes that keep what they do
 * not know, and filing a token under the group the server names.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type CompanionConfig, configPath, loadConfig, saveConfig } from './config.js';
import {
  adoptLegacyState,
  fetchOverlayGroups,
  fileTokenUnderGroup,
  groupViews,
  hostStateDir,
  LEGACY_GROUP_ID,
  mergeServerGroups,
  NO_GROUPS_SENTENCE,
  noHostTokenLabel,
  overlayGroupParam,
  pickerFor,
  rememberGroup,
  resolveTopLevelToken,
  selectGroup,
  setLastGroup,
  tokenNoLongerWorks,
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-groups-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const api of apis.splice(0)) await api.close();
});

function load(dir: string): CompanionConfig {
  const result = loadConfig(dir);
  if (result.status !== 'ok') throw new Error(`config did not load: ${result.status}`);
  return result.config;
}

function readJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
}

describe('the 0.2.x config (acceptance 1)', () => {
  it('loads with one token and no group list, and is that token as one group on the root state directory', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A }),
    );
    const config = load(dir);
    expect(config).toEqual({ mode: 'host', apiBase: 'https://kustom.example', companionToken: TOKEN_A });
    const views = groupViews(config);
    expect(views).toHaveLength(1);
    const selected = selectGroup(views, 'host', config.lastGroupId);
    expect(selected?.token).toBe(TOKEN_A);
    expect(selected?.groupId).toBe(LEGACY_GROUP_ID);
    // Its queue, backfill cache and executed record stay exactly where 0.2.x put them.
    expect(hostStateDir(dir, LEGACY_GROUP_ID)).toBe(dir);
    // One group: no picker, and no group id goes out with overlay calls.
    expect(pickerFor('host', views, selected)).toBeNull();
    expect(overlayGroupParam(selected)).toBeNull();
  });

  it('is read once from disk without being rewritten', () => {
    const dir = tempDir();
    const body = JSON.stringify({ apiBase: 'https://kustom.example', companionToken: TOKEN_A });
    writeFileSync(configPath(dir), body);
    load(dir);
    expect(readFileSync(configPath(dir), 'utf8')).toBe(body);
  });
});

describe('config with groups', () => {
  it('a host config needs a token on some group, and group tokens alone are enough', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'host',
        apiBase: 'https://kustom.example',
        groups: [{ ...G1 }, { ...G2, companionToken: TOKEN_B }],
        lastGroupId: G2.groupId,
      }),
    );
    const config = load(dir);
    expect(config.mode).toBe('host');
    expect(config.groups).toHaveLength(2);
    expect(config.lastGroupId).toBe(G2.groupId);

    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase: 'https://kustom.example', groups: [{ ...G1 }] }),
    );
    const none = loadConfig(dir);
    expect(none.status).toBe('missing');
    if (none.status === 'missing') expect(none.partial.groups).toEqual([G1]);
  });

  it('drops one broken group entry instead of failing the file', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'overlay',
        apiBase: 'https://kustom.example',
        groups: [{ ...G1, companionToken: 'not-a-token' }, { ...G2 }, { nonsense: true }],
      }),
    );
    const config = load(dir);
    expect(config.groups).toEqual([G2]);
  });

  it('keeps the groups through a first-run save and an overlay save', () => {
    const dir = tempDir();
    saveConfig(dir, {
      apiBase: 'https://kustom.example',
      companionToken: TOKEN_A,
      groups: [{ ...G1 }],
      lastGroupId: G1.groupId,
    });
    expect(readJson(dir).groups).toEqual([G1]);
    expect(readJson(dir).lastGroupId).toBe(G1.groupId);
  });
});

describe('the picker (acceptance 3)', () => {
  const views = [{ ...G1, token: TOKEN_A }, { ...G2 }];

  it('is absent with fewer than two groups, in both modes', () => {
    expect(pickerFor('host', [], null)).toBeNull();
    expect(pickerFor('overlay', [{ ...G1 }], { ...G1 })).toBeNull();
  });

  it('reads exactly "Posting tonight to:" in Host and "Tonight\'s group:" in Overlay', () => {
    expect(pickerFor('host', views, views[0] ?? null)?.label).toBe('Posting tonight to:');
    expect(pickerFor('overlay', views, views[0] ?? null)?.label).toBe("Tonight's group:");
  });

  it('lists a group without a token as "<Group> (no host token)", disabled, in Host only', () => {
    const host = pickerFor('host', views, views[0] ?? null);
    expect(host?.options).toEqual([
      { groupId: G1.groupId, label: 'Customs Night', disabled: false },
      { groupId: G2.groupId, label: 'Duo Club (no host token)', disabled: true },
    ]);
    expect(noHostTokenLabel('X')).toBe('X (no host token)');
    const overlay = pickerFor('overlay', views, views[0] ?? null);
    expect(overlay?.options.every((option) => !option.disabled)).toBe(true);
    expect(overlay?.options[1]?.label).toBe('Duo Club');
  });

  it('defaults to the last group used; Host never selects a group it cannot post for', () => {
    expect(selectGroup(views, 'overlay', G2.groupId)?.groupId).toBe(G2.groupId);
    expect(selectGroup(views, 'host', G2.groupId)?.groupId).toBe(G1.groupId);
    expect(selectGroup(views, 'host', undefined)?.groupId).toBe(G1.groupId);
    expect(selectGroup([{ ...G2 }], 'host', undefined)).toBeNull();
    expect(selectGroup([], 'overlay', undefined)).toBeNull();
  });

  it('keeps the product sentences exact', () => {
    expect(NO_GROUPS_SENTENCE).toBe('Play a game with your group, or ask them for the join link.');
    expect(tokenNoLongerWorks('Duo Club')).toBe(
      'This token no longer works for Duo Club. Ask an admin for a new one.',
    );
  });

  it('sends the selected group id with overlay calls, never the unfiled token', () => {
    expect(overlayGroupParam(views[0] ?? null)).toBe(G1.groupId);
    expect(
      overlayGroupParam({ groupId: LEGACY_GROUP_ID, slug: '', name: 'Your group', token: TOKEN_A }),
    ).toBeNull();
  });
});

describe('config writes keep what they do not know', () => {
  it('rememberGroup adds a group to a missing file as apiBase plus groups, with no mode', () => {
    const dir = tempDir();
    rememberGroup(dir, 'https://kustom.example', G1);
    expect(readJson(dir)).toEqual({ apiBase: 'https://kustom.example', groups: [G1] });
  });

  it('rememberGroup refreshes a name and keeps the token, and leaves other keys alone', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'host',
        apiBase: 'https://kustom.example',
        lockfilePath: 'D:\\lol\\lockfile',
        groups: [{ ...G1, companionToken: TOKEN_A }],
        somethingNew: 1,
      }),
    );
    rememberGroup(dir, 'https://other.example', { ...G1, name: 'Renamed' });
    rememberGroup(dir, 'https://other.example', G2);
    const raw = readJson(dir);
    expect(raw.apiBase).toBe('https://kustom.example');
    expect(raw.lockfilePath).toBe('D:\\lol\\lockfile');
    expect(raw.somethingNew).toBe(1);
    expect(raw.groups).toEqual([{ ...G1, name: 'Renamed', companionToken: TOKEN_A }, G2]);
  });

  it('refuses a config that is not JSON and leaves it alone', () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), '{ not json');
    expect(() => rememberGroup(dir, 'https://kustom.example', G1)).toThrow();
    expect(readFileSync(configPath(dir), 'utf8')).toBe('{ not json');
  });

  it('setLastGroup writes lastGroupId only', () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), JSON.stringify({ mode: 'overlay', apiBase: 'https://kustom.example' }));
    setLastGroup(dir, G2.groupId);
    expect(readJson(dir)).toEqual({
      mode: 'overlay',
      apiBase: 'https://kustom.example',
      lastGroupId: G2.groupId,
    });
  });

  it('fileTokenUnderGroup moves the top-level token into its group and replaces a rotated one', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'host',
        apiBase: 'https://kustom.example',
        companionToken: TOKEN_B,
        groups: [{ ...G1, companionToken: TOKEN_A }],
      }),
    );
    fileTokenUnderGroup(dir, G1, TOKEN_B);
    const raw = readJson(dir);
    expect(raw.companionToken).toBeUndefined();
    expect(raw.groups).toEqual([{ ...G1, companionToken: TOKEN_B }]);
    expect(raw.lastGroupId).toBe(G1.groupId);
  });

  it('mergeServerGroups adds new groups, renames, and keeps a tokened group the server dropped', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({
        mode: 'overlay',
        apiBase: 'https://kustom.example',
        groups: [{ ...G1 }, { ...G2, companionToken: TOKEN_B }],
      }),
    );
    mergeServerGroups(dir, 'https://kustom.example', [
      { id: G1.groupId, slug: 'customs', name: 'Customs Night 2' },
    ]);
    expect(readJson(dir).groups).toEqual([
      { ...G1, name: 'Customs Night 2' },
      { ...G2, companionToken: TOKEN_B },
    ]);
  });
});

describe('adoptLegacyState', () => {
  it('moves the queue, backfill cache and executed record into the group directory, once', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'queue'));
    writeFileSync(join(dir, 'queue', '123.json'), '{}');
    writeFileSync(join(dir, 'backfill.json'), '{}');
    writeFileSync(join(dir, 'commands-done.json'), '{}');
    const moved = adoptLegacyState(dir, G1.groupId);
    expect(moved.sort()).toEqual(['backfill.json', 'commands-done.json', 'queue']);
    const target = hostStateDir(dir, G1.groupId);
    expect(existsSync(join(target, 'queue', '123.json'))).toBe(true);
    expect(existsSync(join(dir, 'queue'))).toBe(false);
    expect(adoptLegacyState(dir, G1.groupId)).toEqual([]);
  });
});

describe('talking to the server about groups', () => {
  const me = (extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: { ok: true, puuid: PUUID, playerId: PLAYER_ID, displayName: 'Ana', ...extra },
  });

  async function fake(routes: Parameters<typeof startFakeApi>[0]) {
    const api = await startFakeApi(routes);
    apis.push(api);
    return api;
  }

  function legacyConfig(dir: string, apiBase: string): CompanionConfig {
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'host', apiBase, companionToken: TOKEN_A, lastGroupId: undefined }),
    );
    return load(dir);
  }

  it('files the token under the group /api/companion/me names, and moves the old state with it', async () => {
    const api = await fake({
      token: TOKEN_A,
      routes: {
        'GET /api/companion/me': [me({ group: { id: G1.groupId, slug: G1.slug, name: G1.name } })],
      },
    });
    const dir = tempDir();
    const config = legacyConfig(dir, api.baseUrl);
    writeFileSync(join(dir, 'backfill.json'), '{}');
    const filed = await resolveTopLevelToken({ configDir: dir, config });
    expect(filed).toEqual({ groupId: G1.groupId, slug: G1.slug, name: G1.name });
    const raw = readJson(dir);
    expect(raw.companionToken).toBeUndefined();
    expect(raw.groups).toEqual([{ ...G1, companionToken: TOKEN_A }]);
    expect(existsSync(join(hostStateDir(dir, G1.groupId), 'backfill.json'))).toBe(true);
    expect(existsSync(join(dir, 'backfill.json'))).toBe(false);
    // Still one group, one token: it posts exactly as before.
    expect(selectGroup(groupViews(load(dir)), 'host', undefined)?.token).toBe(TOKEN_A);
  });

  it("falls back to the PUUID's only group when the server does not say, and leaves it alone with several", async () => {
    const only = await fake({
      token: TOKEN_A,
      routes: {
        'GET /api/companion/me': [me()],
        [`GET /api/overlay/groups?puuid=${PUUID}`]: [
          { status: 200, body: { ok: true, groups: [{ id: G1.groupId, slug: G1.slug, name: G1.name }] } },
        ],
      },
    });
    const dir = tempDir();
    expect(
      await resolveTopLevelToken({ configDir: dir, config: legacyConfig(dir, only.baseUrl) }),
    ).not.toBeNull();

    const many = await fake({
      token: TOKEN_A,
      routes: {
        'GET /api/companion/me': [me()],
        [`GET /api/overlay/groups?puuid=${PUUID}`]: [
          {
            status: 200,
            body: {
              ok: true,
              groups: [
                { id: G1.groupId, slug: G1.slug, name: G1.name },
                { id: G2.groupId, slug: G2.slug, name: G2.name },
              ],
            },
          },
        ],
      },
    });
    const dir2 = tempDir();
    legacyConfig(dir2, many.baseUrl);
    const before = JSON.stringify(readJson(dir2));
    expect(await resolveTopLevelToken({ configDir: dir2, config: load(dir2) })).toBeNull();
    expect(JSON.stringify(readJson(dir2))).toBe(before);
  });

  it('leaves the token where it is when the server cannot be reached', async () => {
    const dir = tempDir();
    const config = legacyConfig(dir, 'http://127.0.0.1:1');
    expect(await resolveTopLevelToken({ configDir: dir, config })).toBeNull();
    expect(readJson(dir).companionToken).toBe(TOKEN_A);
  });

  it('reads the overlay group list and is null on a refusal', async () => {
    const api = await fake({
      routes: {
        [`GET /api/overlay/groups?puuid=${PUUID}`]: [
          { status: 200, body: { ok: true, groups: [{ id: G1.groupId, slug: G1.slug, name: G1.name }] } },
        ],
        'GET /api/overlay/groups?puuid=x': [{ status: 400, body: { ok: false, error: 'puuid is required' } }],
      },
    });
    expect(await fetchOverlayGroups(api.baseUrl, PUUID)).toEqual([
      { id: G1.groupId, slug: G1.slug, name: G1.name },
    ]);
    expect(await fetchOverlayGroups(api.baseUrl, 'x')).toBeNull();
  });
});
