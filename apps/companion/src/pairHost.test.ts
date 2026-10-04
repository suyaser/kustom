/**
 * Host pairing on the wire (M14.13): `mode: 'host'` goes out, a returned token is filed under its group and
 * never logged, a refusal sentence comes back as the error line, and Overlay is unchanged and never stores a
 * token.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, loadConfig } from './config.js';
import { createMemoryLogger } from './log.js';
import { pairWithCode } from './pairing.js';
import { type FakeApi, startFakeApi } from './test-support/fake-api.js';

const PUUID = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const GROUP = { id: '5b1f3a52-9c0e-4d7a-8f11-2a6d4e9b7c10', slug: 'duo', name: 'Duo Club' };
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

const dirs: string[] = [];
let api: FakeApi | undefined;

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  await api?.close();
  api = undefined;
});

async function run(mode: 'host' | 'overlay' | undefined, body: unknown, status = 200) {
  api = await startFakeApi({ routes: { 'POST /api/companion/pair': [{ status, body }] } });
  const dir = mkdtempSync(join(tmpdir(), 'companion-pairhost-'));
  dirs.push(dir);
  const logger = createMemoryLogger();
  const outcome = await pairWithCode({
    apiBase: api.baseUrl,
    code: 'K7QM4X',
    configDir: dir,
    logger,
    ...(mode ? { mode } : {}),
    readPuuid: () => Promise.resolve({ ok: true as const, puuid: PUUID }),
  });
  const sent = JSON.parse(api.requests.find((r) => r.path === '/api/companion/pair')?.body ?? '{}');
  return { outcome, dir, sent, logger };
}

const readRaw = (dir: string) => JSON.parse(readFileSync(configPath(dir), 'utf8'));

describe('pairWithCode in Host mode', () => {
  it("sends mode 'host' and saves the returned token under its group, never logging it", async () => {
    const { outcome, dir, sent, logger } = await run('host', {
      ok: true,
      group: GROUP,
      companionToken: TOKEN,
    });
    expect(sent).toEqual({ code: 'K7QM4X', puuid: PUUID, mode: 'host' });
    expect(outcome).toEqual({ ok: true, group: GROUP, message: "You're in Duo Club." });
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    const raw = readRaw(dir);
    expect(raw.groups).toEqual([
      { groupId: GROUP.id, slug: GROUP.slug, name: GROUP.name, companionToken: TOKEN },
    ]);
    expect(raw.lastGroupId).toBe(GROUP.id);
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN);
    // A host config: the engine starts watchers on this token with no paste.
    const loaded = loadConfig(dir);
    expect(loaded.status === 'ok' && loaded.config.mode).toBe('host');
  });

  it('passes hostRefusal out as the error and adds the group without a token', async () => {
    const sentence = "You're in Duo Club. Only an admin can host; ask one for a host token.";
    const { outcome, dir } = await run('host', { ok: true, group: GROUP, hostRefusal: sentence });
    expect(outcome).toEqual({ ok: false, message: sentence, group: GROUP });
    expect(readRaw(dir).groups).toEqual([{ groupId: GROUP.id, slug: GROUP.slug, name: GROUP.name }]);
  });

  it("passes the 409 'This code is for <name>'s League account' sentence through and writes nothing", async () => {
    const sentence = "This code is for Ana's League account. Sign in to that one, then type the code.";
    const { outcome, dir } = await run('host', { ok: false, error: sentence }, 409);
    expect(outcome).toEqual({ ok: false, message: sentence });
    expect(() => readFileSync(configPath(dir))).toThrow();
  });

  it('a pair answer carrying both a token and a refusal is unusable (shared schema) and writes nothing', async () => {
    const { outcome, dir } = await run('host', {
      ok: true,
      group: GROUP,
      companionToken: TOKEN,
      hostRefusal: 'no',
    });
    expect(outcome.ok).toBe(false);
    expect(() => readFileSync(configPath(dir))).toThrow();
  });
});

describe('pairWithCode in Overlay mode', () => {
  it('sends no mode, adds the group, and stores no token even if the server sent one', async () => {
    const { outcome, dir, sent } = await run('overlay', { ok: true, group: GROUP, companionToken: TOKEN });
    expect(sent).toEqual({ code: 'K7QM4X', puuid: PUUID });
    expect(outcome.ok).toBe(true);
    const raw = readRaw(dir);
    expect(raw.groups).toEqual([{ groupId: GROUP.id, slug: GROUP.slug, name: GROUP.name }]);
    expect(JSON.stringify(raw)).not.toContain(TOKEN);
  });

  it('no mode given behaves as Overlay', async () => {
    const { sent, dir } = await run(undefined, { ok: true, group: GROUP });
    expect(sent).toEqual({ code: 'K7QM4X', puuid: PUUID });
    expect(readRaw(dir).groups).toHaveLength(1);
  });
});
