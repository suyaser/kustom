/**
 * Kustom's side of pairing (M13.8 acceptance 2): code plus the League PUUID to the pair route, the group into
 * the config on success, every refusal sentence verbatim.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath } from './config.js';
import {
  normalizePairingCode,
  OPEN_LEAGUE_FIRST,
  PAIR_BAD_CODE,
  PAIR_UNREACHABLE,
  pairWithCode,
  youreIn,
} from './pairing.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PUUID = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const GROUP = { id: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };

const dirs: string[] = [];
let api: FakeApi | undefined;

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  await api?.close();
  api = undefined;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-pair-'));
  dirs.push(dir);
  return dir;
}

async function run(response: FakeApiResponse, code = 'K7QM4X', league = true) {
  api = await startFakeApi({ routes: { 'POST /api/companion/pair': [response] } });
  const dir = tempDir();
  const outcome = await pairWithCode({
    apiBase: api.baseUrl,
    code,
    configDir: dir,
    readPuuid: () => Promise.resolve(league ? { ok: true as const, puuid: PUUID } : { ok: false as const }),
  });
  return { outcome, dir, api };
}

describe('normalizePairingCode', () => {
  it('upper-cases, drops characters outside the alphabet, and stops at six', () => {
    expect(normalizePairingCode('k7qm4x')).toBe('K7QM4X');
    expect(normalizePairingCode('k7q-m4 x')).toBe('K7QM4X');
    expect(normalizePairingCode('K7QM4X99')).toBe('K7QM4X');
    // 0, O, 1, I are not in the alphabet.
    expect(normalizePairingCode('0O1I')).toBe('');
  });
});

describe('pairWithCode', () => {
  it('sends the code with the PUUID League reports, no token, and adds the group to the config', async () => {
    const { outcome, dir, api } = await run({ status: 200, body: { ok: true, group: GROUP } });
    expect(outcome).toEqual({ ok: true, group: GROUP, message: "You're in Duo Club." });
    expect(youreIn(GROUP)).toBe("You're in Duo Club.");
    const request = api.requests.find((r) => r.path === '/api/companion/pair');
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ code: 'K7QM4X', puuid: PUUID });
    expect(request?.authorization).toBeUndefined();
    const raw = JSON.parse(readFileSync(configPath(dir), 'utf8'));
    expect(raw.groups).toEqual([{ groupId: GROUP.id, slug: GROUP.slug, name: GROUP.name }]);
  });

  it('cleans what was typed before sending', async () => {
    const { api } = await run({ status: 200, body: { ok: true, group: GROUP } }, 'k7q m4x');
    expect(JSON.parse(api.requests.find((r) => r.path === '/api/companion/pair')?.body ?? '{}').code).toBe(
      'K7QM4X',
    );
  });

  it.each([
    [404, 'No such code. Get a new one from the page.'],
    [410, 'That code ran out. Get a new one from the page.'],
    [409, 'This Discord account is already linked to Ana.'],
    [409, 'That League account is already linked to someone else.'],
    [429, 'Too many tries. Wait a minute, then type the code again.'],
  ])("prints the server's %i sentence verbatim and writes nothing", async (status, sentence) => {
    const { outcome, dir } = await run({ status, body: { ok: false, error: sentence } });
    expect(outcome).toEqual({ ok: false, message: sentence });
    expect(() => readFileSync(configPath(dir))).toThrow();
  });

  it('says "Open League first" and sends nothing when League is not open', async () => {
    const { outcome, api } = await run({ status: 200, body: { ok: true, group: GROUP } }, 'K7QM4X', false);
    expect(outcome).toEqual({ ok: false, message: OPEN_LEAGUE_FIRST });
    expect(OPEN_LEAGUE_FIRST).toBe('Open League first, then type the code.');
    expect(api.requests.filter((r) => r.path === '/api/companion/pair')).toHaveLength(0);
  });

  it('rejects an incomplete code without a request', async () => {
    const { outcome, api } = await run({ status: 200, body: { ok: true, group: GROUP } }, 'K7Q');
    expect(outcome).toEqual({ ok: false, message: PAIR_BAD_CODE });
    expect(api.requests.filter((r) => r.path === '/api/companion/pair')).toHaveLength(0);
  });

  it('a dropped connection is a sentence, not a throw, and sends the code once', async () => {
    const { outcome, api } = await run({ status: 200, body: {}, drop: true });
    expect(outcome).toEqual({ ok: false, message: PAIR_UNREACHABLE });
    expect(api.requests.filter((r) => r.path === '/api/companion/pair')).toHaveLength(1);
  });

  it('keeps every other key in an existing config when it adds the group', async () => {
    api = await startFakeApi({
      routes: { 'POST /api/companion/pair': [{ status: 200, body: { ok: true, group: GROUP } }] },
    });
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'overlay', apiBase: api.baseUrl, lockfilePath: 'D:\\lockfile' }),
    );
    await pairWithCode({
      apiBase: api.baseUrl,
      code: 'K7QM4X',
      configDir: dir,
      readPuuid: () => Promise.resolve({ ok: true, puuid: PUUID }),
    });
    const raw = JSON.parse(readFileSync(configPath(dir), 'utf8'));
    expect(raw.mode).toBe('overlay');
    expect(raw.lockfilePath).toBe('D:\\lockfile');
    expect(raw.groups).toHaveLength(1);
  });
});
