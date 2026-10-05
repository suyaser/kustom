/**
 * The lobby write (switch side) against the fake client, plus the two guards that keep this package on the
 * right side of the Riot line: the allow-list (nothing POSTs outside `/lol-lobby/...`), and the verification
 * gate, which can never read `verified` while the reference row in docs/03-lcu-reference.md is `unverified`.
 *
 * Create lobby and invite were removed in M22.11 (the server no longer queues them); their fixtures stay as
 * the record of what the client accepted on 16.17 and 16.18.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LcuClient } from './client.js';
import { LIVE_CLIENT_DATA, WRITE_ENDPOINTS } from './endpoints.js';
import { readFixture } from './fixtures.js';
import {
  type CannedRoute,
  type FakeLcu,
  type RecordedRequest,
  startFakeLcu,
} from './test-support/fake-lcu.js';
import {
  assertLobbyWritePath,
  describeWriteResponse,
  isLobbyWritePath,
  isLobbyWriteVerified,
  LOBBY_WRITE_PATHS,
  LOBBY_WRITE_VERIFICATION,
  type LobbyWriteKind,
  postSwitchSide,
  switchSidePath,
} from './writes.js';

const PASSWORD = 'fake-lockfile-password';
const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const fakes: FakeLcu[] = [];
const clients: LcuClient[] = [];

async function setup(handle: (request: RecordedRequest) => CannedRoute | undefined) {
  const lcu = await startFakeLcu({ password: PASSWORD, handle });
  const client = new LcuClient({ port: lcu.port, password: PASSWORD, tls: { mode: 'pinned', ca: lcu.ca } });
  fakes.push(lcu);
  clients.push(client);
  return { lcu, client, posts: () => lcu.requests.filter((request) => request.method === 'POST') };
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  for (const lcu of fakes.splice(0)) {
    await lcu.close();
  }
});

/** Every non-test source file under src/, relative path -> text. */
function sourceFiles(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'test-support' || entry.name === 'node_modules') {
        continue;
      }
      Object.assign(out, sourceFiles(join(dir, entry.name), rel));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out[rel] = readFileSync(join(dir, entry.name), 'utf8');
    }
  }
  return out;
}

describe('request paths', () => {
  it('switchSidePath names the side in the path, as the client UI does', () => {
    expect(switchSidePath(100)).toBe('/lol-lobby/v2/lobby/team/TEAM1');
    expect(switchSidePath(200)).toBe('/lol-lobby/v2/lobby/team/TEAM2');
  });
});

describe('the 2026-09-12 capture (16.18)', () => {
  it('pins the accepted switch: POST /team/TEAM2 with no body answered 204', () => {
    const read = readFixture('16.18', 'lobby-team');
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.envelope.method).toBe('POST');
    expect(read.envelope.path).toBe('/lol-lobby/v2/lobby/team/TEAM2');
    expect(read.envelope.status).toBe(204);
    expect(read.envelope.body).toBeNull();
    expect(read.envelope).not.toHaveProperty('request');
  });
});

describe('the allow-list', () => {
  it('holds exactly the two team paths, all under /lol-lobby/', () => {
    expect(LOBBY_WRITE_PATHS).toEqual(['/lol-lobby/v2/lobby/team/TEAM1', '/lol-lobby/v2/lobby/team/TEAM2']);
    for (const path of LOBBY_WRITE_PATHS) {
      expect(path.startsWith('/lol-lobby/')).toBe(true);
      expect(() => assertLobbyWritePath(path)).not.toThrow();
    }
  });

  it('throws for any champion-select, matchmaking, gameflow, spectator-move or in-game path', () => {
    for (const path of [
      '/lol-champ-select/v1/session/actions/1',
      '/lol-lobby/v2/lobby/matchmaking/search',
      '/lol-matchmaking/v1/ready-check/accept',
      '/lol-lobby-team-builder/champ-select/v1/session',
      '/lol-gameflow/v1/session/dodge',
      '/lol-gameflow/v1/pre-end-of-game/complete',
      '/lol-lobby/v1/lobby/custom/start-champ-select',
      '/lol-lobby/v2/lobby/team/SPECTATOR',
      '/lol-lobby/v1/lobby/custom/switch-teams',
      '/lol-lobby/v2/lobby/custom/switch-teams',
      '/liveclientdata/allgamedata',
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby/invitations',
      '/lol-lobby/v2/lobby/',
      'lol-lobby/v2/lobby',
    ]) {
      expect(isLobbyWritePath(path)).toBe(false);
      expect(() => assertLobbyWritePath(path)).toThrow(/refusing to POST outside the lobby allow-list/);
    }
  });

  it('is the only way this package POSTs: no other source file calls post/put/delete/raw on the client', () => {
    const files = sourceFiles(SRC_DIR);
    // Any `.post(` / `.put(` / `.delete(` / `.patch(` at all, whatever the argument, plus the raw/request
    // spellings. client.ts defines the methods (its `post` forwards to `request('POST', ...)`) and socket.ts
    // has a `Set.delete`; neither reaches the client with a write. writes.ts is the one caller.
    const callers = Object.entries(files)
      .filter(([name]) => name !== 'client.ts' && name !== 'socket.ts')
      .filter(([, text]) =>
        /\.(post|put|delete|patch)\(|\.raw\(\s*['"`](POST|PUT|DELETE|PATCH)|\.request\(\s*['"`](POST|PUT|DELETE|PATCH)/.test(
          text,
        ),
      )
      .map(([name]) => name)
      .sort();
    expect(callers).toEqual(['writes.ts']);
    expect(files['client.ts']).toMatch(/post<T>\(path: string, body: unknown/);
    expect(files['socket.ts']).not.toMatch(/\.(post|put|patch)\(/);
  });

  it('names no gameplay path anywhere in the package, and the in-game server only as the documented GET', () => {
    const files = sourceFiles(SRC_DIR);
    const forbidden =
      /['"`]\/lol-champ-select|['"`]\/lol-lobby-team-builder|['"`]\/lol-matchmaking|['"`]\/lol-lobby\/v2\/lobby\/matchmaking|['"`]\/lol-gameflow\/v1\/session\/|['"`]\/lol-lobby\/v1\/lobby\/custom\/(start|cancel)-champ-select|\.post\([^)]*2999/;
    for (const [name, text] of Object.entries(files)) {
      expect(forbidden.test(text), `${name} names a gameplay path`).toBe(false);
    }
    const liveMentions = Object.entries(files)
      .filter(([, text]) => text.includes('liveclientdata') || text.includes('2999'))
      .map(([name]) => name)
      .sort();
    // The catalogue row and the smoke script's GET probe (`--live-port`); nothing else knows the port.
    expect(liveMentions).toEqual(['cli/smoke.ts', 'endpoints.ts']);
    expect(LIVE_CLIENT_DATA.port).toBe(2999);
    expect(LOBBY_WRITE_PATHS.some((path) => path.includes('liveclientdata'))).toBe(false);
  });
});

describe('the verification gate', () => {
  const rowLabels: Record<LobbyWriteKind, string> = {
    switch_side: 'Switch side',
  };

  it('never reads verified while the row in docs/03-lcu-reference.md is unverified, and matches its patch when it is', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', '03-lcu-reference.md'), 'utf8');
    for (const kind of Object.keys(rowLabels) as LobbyWriteKind[]) {
      const line = doc.split('\n').find((candidate) => candidate.startsWith(`| ${rowLabels[kind]} |`));
      expect(line, `docs/03 has a row for ${rowLabels[kind]}`).toBeDefined();
      const cells = (line as string).split('|').map((cell) => cell.trim());
      const status = cells[cells.length - 2] as string;
      expect(WRITE_ENDPOINTS.switchSide).toBeDefined();
      const gate = LOBBY_WRITE_VERIFICATION[kind];
      const rowVerified = /^verified \(([\d.]+), (\d{4}-\d{2}-\d{2})\)/.exec(status);
      if (rowVerified === null) {
        expect(gate.verified, `${kind}: row reads "${status}", so the gate must be off`).toBe(false);
        expect(isLobbyWriteVerified(kind)).toBe(false);
      } else {
        expect(gate, `${kind}: row is verified, so the gate must carry the same patch`).toEqual({
          verified: true,
          patch: rowVerified[1],
          date: rowVerified[2],
        });
      }
    }
  });

  it('the switch-side row names the team path the code uses', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', '03-lcu-reference.md'), 'utf8');
    const line = doc.split('\n').find((candidate) => candidate.startsWith('| Switch side |'));
    expect(line).toContain(WRITE_ENDPOINTS.switchSide.template);
  });
});

describe('writes against the fake client (answers are assumptions, not captures)', () => {
  it('postSwitchSide POSTs the team path for the side asked, with no body (assumed: 204)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby/team/TEAM2'
        ? { status: 204, body: null }
        : undefined,
    );
    const result = await postSwitchSide(client, 200);
    expect(result.path).toBe('/lol-lobby/v2/lobby/team/TEAM2');
    expect(result.body).toBeUndefined();
    expect(result.response.ok && result.response.status).toBe(204);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toBe('');
    expect(posts()[0]?.contentType).toBeUndefined();

    const missing = await postSwitchSide(client, 100);
    expect(missing.path).toBe('/lol-lobby/v2/lobby/team/TEAM1');
    expect(describeWriteResponse(missing.response)).toBe('404 fake lcu: no such route');
  });

  it('describeWriteResponse never includes a body, only status and message', async () => {
    const { client } = await setup(() => ({
      status: 400,
      body: { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'bad', secret: 'do-not-print' },
    }));
    const write = await postSwitchSide(client, 200);
    expect(describeWriteResponse(write.response)).toBe('400 bad');
    const dead = new LcuClient({ port: 1, password: 'x', tls: { mode: 'insecure' }, timeoutMs: 500 });
    clients.push(dead);
    const gone = await postSwitchSide(dead, 200);
    expect(describeWriteResponse(gone.response)).toMatch(/^no answer \(/);
  });
});
