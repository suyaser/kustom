/**
 * The companion guards that must outlive the TypeScript companion (M17.14 prep).
 *
 * Until now these lived in `apps/companion/scripts/goldens/goldens.test.ts`, `apps/companion/scripts/
 * configFixtures.test.ts` and `apps/companion/src/config.test.ts`, which M17.14 deletes. Here they read only
 * committed files and `@customs/db`, pointed at what survives: the goldens and the synthetic config trees the
 * Rust engine's tests read, the recorded client fixtures in `packages/lcu/fixtures/`, and the token rule in
 * the Rust source, the server's mint and the shared schema.
 *
 *  1. The goldens' index is whole, and names a golden per route M17.4 promised.
 *  2. The client-write goldens are exactly what the 16.18 client accepted.
 *  3. No golden and no config fixture carries a credential (the fixture guard's rule, plus the golden
 *     harness's own secrets, frozen here as literals because the goldens are frozen too).
 *  4. A companion token is one shape everywhere: what the server mints, what the shared schema accepts, what
 *     the Rust engine checks.
 *  5. The Riot line: no shipped Rust source names a gameplay path or the in-game server, and the only client
 *     writes are the allow-listed lobby writes (the TypeScript scan in `commandRunner.test.ts`, ported to
 *     `crates/engine/src` and `src-tauri/src`; wider than the Rust test's own four-substring scan).
 *
 * The API half of the goldens is `goldens.test.ts` beside this file (M17.3). The queue and commands-done file
 * goldens are round-tripped through the Rust types by `crates/engine/tests/goldens.rs`; they are the
 * companion's own disk format, not a server contract, so they are not checked here.
 *
 * Read as files on purpose: `@customs/db` must not depend on `apps/companion`, `apps/web` or `@customs/lcu`.
 */

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { companionTokenSchema } from '../schemas/index';
import { REDACTED, scanForCredentials } from './credentialScan';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const GOLDENS_DIR = join(REPO, 'apps/companion/crates/engine/tests/goldens');
const CONFIG_FIXTURES_DIR = join(REPO, 'apps/companion/crates/engine/tests/fixtures/config');
const RUST_TOKEN_SOURCE = join(REPO, 'apps/companion/crates/engine/src/config/token.rs');
const SERVER_MINT_SOURCE = join(REPO, 'apps/web/lib/companionAuth.ts');
const ENGINE_SRC = join(REPO, 'apps/companion/crates/engine/src');
const RUST_SOURCE_ROOTS = [ENGINE_SRC, join(REPO, 'apps/companion/src-tauri/src')];
const INDEX_FILE = 'index.json';

/** Every route the goldens carry (the TypeScript generator's `GOLDEN_ROUTES`, frozen with the goldens). */
const GOLDEN_ROUTES = [
  'lobby',
  'game',
  'rank',
  'backfill-scan',
  'commands-poll',
  'command-ack',
  'command-nack',
  'pair',
  'lcu-switch-side',
  'queue-file',
  'commands-done-file',
] as const;

/** M17.4's acceptance list, by name. */
const NAMED_GOLDENS = [
  'lobby--lobby',
  'lobby--lobby--spectator',
  'lobby--lobby--two-players',
  'game--in-progress--gameflow-session',
  'game--eog--eog-stats-block--observed-start',
  'rank--current-ranked-stats--own',
  'rank--ranked-stats-by-puuid--other',
  'backfill-scan--match-history',
  'command-ack--switch-side',
];

/** The golden harness's own secrets (`apps/companion/scripts/goldens/harness.ts`, `scenarios.ts`). */
const HARNESS_LCU_PASSWORD = 'golden-harness-lockfile-pw-7Qx2';
const HARNESS_SECRETS = [
  HARNESS_LCU_PASSWORD,
  'golden-harness-token-0123456789abcdefghijklm',
  'GOLDENxPAIRxTOKENxNOTxREALxxxxxxxxxxxxxxxxx',
  Buffer.from(`riot:${HARNESS_LCU_PASSWORD}`).toString('base64'),
  'Bearer ',
  'Basic ',
];

interface GoldenRequest {
  readonly route: string;
  readonly path: string;
  readonly body: unknown;
}

interface Golden {
  readonly name: string;
  readonly kind: 'request' | 'sequence' | 'file';
  readonly route: string;
  readonly path?: string;
  readonly body?: unknown;
  readonly requests?: readonly GoldenRequest[];
}

interface GoldenIndex {
  readonly counts: { readonly total: number };
  readonly goldens: readonly { readonly file: string; readonly route: string }[];
  readonly scenarios: readonly { readonly name: string; readonly goldens: readonly string[] }[];
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const files = readdirSync(GOLDENS_DIR)
  .filter((name) => name.endsWith('.json') && name !== INDEX_FILE)
  .sort();
const goldens: Golden[] = files.map(
  (name) => JSON.parse(readFileSync(join(GOLDENS_DIR, name), 'utf8')) as Golden,
);
const index = JSON.parse(readFileSync(join(GOLDENS_DIR, INDEX_FILE), 'utf8')) as GoldenIndex;

/** Every client write a golden holds, single or inside a sequence. */
function clientWrites(): { name: string; route: string; path: string; body: unknown }[] {
  return goldens.flatMap((golden) => {
    const requests =
      golden.kind === 'sequence'
        ? (golden.requests ?? [])
        : golden.kind === 'request'
          ? [{ route: golden.route, path: golden.path ?? '', body: golden.body }]
          : [];
    return requests
      .filter((request) => request.route.startsWith('lcu-'))
      .map((request) => ({ name: golden.name, ...request }));
  });
}

describe('goldens: the index', () => {
  it('lists every golden file exactly once, and nothing else', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(index.goldens.map((entry) => entry.file).sort()).toEqual(files);
    expect(index.counts.total).toBe(files.length);
    const named = index.scenarios.flatMap((scenario) => scenario.goldens.map((name) => `${name}.json`));
    expect(named.sort()).toEqual(files);
  });

  it('has a golden per route, and every one M17.4 names', () => {
    const routes = new Set(
      goldens.flatMap((golden) =>
        golden.kind === 'sequence' ? (golden.requests ?? []).map((request) => request.route) : [golden.route],
      ),
    );
    for (const route of GOLDEN_ROUTES) expect(routes, route).toContain(route);
    for (const route of routes) expect(GOLDEN_ROUTES as readonly string[], route).toContain(route);
    for (const name of NAMED_GOLDENS) expect(files, name).toContain(`${name}.json`);
  });
});

describe('goldens: the client accepted every write', () => {
  const writes = clientWrites();

  it('there are client writes to check', () => {
    const kinds = new Set(writes.map((write) => write.route));
    expect([...kinds].sort()).toEqual(['lcu-switch-side']);
  });

  for (const write of writes) {
    it(`${write.name} (${write.route} ${write.path})`, () => {
      switch (write.route) {
        case 'lcu-switch-side':
          expect(write.body).toBeNull();
          expect(write.path).toBe('/lol-lobby/v2/lobby/team/TEAM2');
          return;
        default:
          throw new Error(`a client write this guard does not know: ${write.route}`);
      }
    });
  }
});

describe('goldens: credential guard', () => {
  it('no golden carries a credential value', () => {
    const offenders = [...files, INDEX_FILE].flatMap((name) =>
      scanForCredentials(name, readFileSync(join(GOLDENS_DIR, name), 'utf8'), {
        forbidden: HARNESS_SECRETS,
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('no golden carries a lobby password: create lobby is gone (M22.11), and the lobby post sends null', () => {
    for (const name of files) {
      const text = readFileSync(join(GOLDENS_DIR, name), 'utf8');
      expect(text, name).not.toMatch(/"lobbyPassword": "/);
    }
  });
});

describe('config fixtures: only token-shaped fakes', () => {
  const configFiles = listFiles(CONFIG_FIXTURES_DIR).filter((file) => file.endsWith('.json'));
  const isFakeToken = (value: string) =>
    value.startsWith('SYNTHETIC_') && companionTokenSchema.safeParse(value).success;

  it('finds the trees', () => {
    expect(configFiles.some((file) => file.endsWith('config.json'))).toBe(true);
  });

  it('every companionToken is a SYNTHETIC_ fake in the token shape, or redacted', () => {
    const tokens: string[] = [];
    for (const file of configFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/"companionToken"\s*:\s*"([^"]*)"/g)) tokens.push(match[1] ?? '');
    }
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(isFakeToken(token) || token === REDACTED, token.slice(0, 12)).toBe(true);
    }
  });

  it('no file in a tree carries a credential value', () => {
    const offenders = configFiles.flatMap((file) =>
      scanForCredentials(relative(CONFIG_FIXTURES_DIR, file), readFileSync(file, 'utf8'), {
        allow: (key, value) => key === 'Token' && isFakeToken(value),
      }),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the companion token: one shape on the server, in the schema and in the Rust engine', () => {
  it('the server mints 32 random bytes as base64url', () => {
    const source = readFileSync(SERVER_MINT_SOURCE, 'utf8');
    expect(source).toMatch(/export const COMPANION_TOKEN_BYTES = 32;/);
    expect(source).toMatch(/randomBytes\(COMPANION_TOKEN_BYTES\)\.toString\('base64url'\)/);
  });

  it('every token minted that way passes the shared schema, every time', () => {
    for (let i = 0; i < 200; i += 1) {
      const token = randomBytes(32).toString('base64url');
      expect(token).toHaveLength(43);
      expect(companionTokenSchema.safeParse(token).success, token).toBe(true);
    }
  });

  it('the Rust engine checks the same length', () => {
    const source = readFileSync(RUST_TOKEN_SOURCE, 'utf8');
    expect(source).toMatch(/pub const COMPANION_TOKEN_LENGTH: usize = 43;/);
  });
});

/**
 * A Rust file as the scan reads it: its `#[cfg(test)]` tail cut off (tests prove the refusals with the very
 * paths banned here) and comment lines blanked (the docs name what is banned). Line numbers are kept.
 */
function shippedRustLines(file: string): string[] {
  const code = readFileSync(file, 'utf8').split('#[cfg(test)]')[0] ?? '';
  return code.split('\n').map((line) => (line.trimStart().startsWith('//') ? '' : line));
}

const rustFiles = RUST_SOURCE_ROOTS.flatMap(listFiles).filter((file) => file.endsWith('.rs'));

describe('the Riot line: what the shipped Rust sources may name', () => {
  // Bare substrings, so a path built from pieces with `format!` or `concat!` is still caught. `riotclient` is
  // banned only in its path form: `--riotclient-auth-token` is a flag the process scan reads, not a call.
  const BANNED = [
    { text: '/lol-champ-select', why: 'names a gameplay path' },
    { text: '/lol-lobby-team-builder', why: 'names a gameplay path' },
    { text: '/lol-matchmaking', why: 'names a gameplay path' },
    { text: '/lobby/matchmaking', why: 'names a gameplay path' },
    { text: 'ready-check', why: 'names a gameplay path' },
    { text: '/lol-gameflow/v1/session/', why: 'names a gameflow session subpath' },
    { text: '/lol-login', why: 'names a login path' },
    { text: '/riotclient', why: 'names a Riot Client path' },
    { text: '2999', why: 'knows the in-game server port' },
    { text: 'liveclientdata', why: 'knows the in-game server' },
  ];

  it('scans the engine and the Tauri shell, not an empty tree', () => {
    expect(rustFiles.length).toBeGreaterThan(20);
    expect(rustFiles.some((file) => file.includes('/src-tauri/src/'))).toBe(true);
    expect(rustFiles.some((file) => file.endsWith('/lcu/endpoints.rs'))).toBe(true);
  });

  it('no shipped source names a gameplay path or the in-game server', () => {
    const offenders: string[] = [];
    for (const file of rustFiles) {
      shippedRustLines(file).forEach((line, i) => {
        for (const { text, why } of BANNED) {
          if (line.includes(text)) offenders.push(`${relative(REPO, file)}:${i + 1} ${why} (${text})`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the only client write call sites are in lcu/endpoints.rs and lcu/client.rs', () => {
    // The client has no put, delete or patch at all (checked below), so `post`, `raw` and a raw HTTP method
    // are every way to write to it.
    const WRITE_CALL = /\.post\s*(::<[^>]*>)?\s*\(|\braw\s*\(|Method::(POST|PUT|DELETE|PATCH)\b/;
    const LCU_WRITE_FILES = ['lcu/endpoints.rs', 'lcu/client.rs'];
    // Lines that match the shape but are not the League client, each by its exact text: the server API's
    // transport mapping its own method enum, and the lobby watcher's own `post` (it posts to the server).
    const NOT_THE_CLIENT = new Set([
      'api/transport.rs: Method::Post => reqwest::Method::POST,',
      'watchers/lobby.rs: self.post(item);',
      'watchers/lobby.rs: self.post(next);',
    ]);
    const offenders: string[] = [];
    let lcuSites = 0;
    for (const file of rustFiles) {
      const name = relative(ENGINE_SRC, file);
      shippedRustLines(file).forEach((line, i) => {
        if (!WRITE_CALL.test(line) || /\bfn\s+(post|raw)\b/.test(line)) return;
        if (LCU_WRITE_FILES.includes(name)) {
          lcuSites += 1;
          return;
        }
        if (NOT_THE_CLIENT.has(`${name}: ${line.trim()}`)) return;
        offenders.push(`${relative(REPO, file)}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
    expect(lcuSites).toBeGreaterThan(0);
  });

  it('the client refuses any POST outside LOBBY_WRITE_PATHS, which holds exactly the two team paths', () => {
    const endpoints = readFileSync(join(ENGINE_SRC, 'lcu/endpoints.rs'), 'utf8');
    const declared = endpoints.match(/pub const LOBBY_WRITE_PATHS: \[&str; (\d+)\] = \[([\s\S]*?)\];/);
    expect(declared, 'LOBBY_WRITE_PATHS is declared').not.toBeNull();
    expect(declared?.[1]).toBe('2');
    const paths = [...(declared?.[2] ?? '').matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    expect(paths).toEqual(['/lol-lobby/v2/lobby/team/TEAM1', '/lol-lobby/v2/lobby/team/TEAM2']);
    const client = shippedRustLines(join(ENGINE_SRC, 'lcu/client.rs')).join('\n');
    // `post` is crate-private and checks the allow-list before any request; `raw` is private.
    expect(client).toMatch(/pub\(crate\) async fn post</);
    expect(client).toMatch(/if !super::endpoints::LOBBY_WRITE_PATHS\.contains\(&path\)/);
    expect(client).toMatch(/\n\s*async fn raw</);
    expect(client).not.toMatch(/pub(\([^)]*\))? async fn raw/);
    expect(client).not.toMatch(/\bfn\s+(put|delete|patch)\b/);
  });
});

describe('the credential scan itself', () => {
  it('flags a real value, an object value and a forbidden string; passes empty, redacted and allowed values', () => {
    expect(scanForCredentials('x', '{"multiUserChatPassword": "hunter2"}')).toHaveLength(1);
    expect(scanForCredentials('x', '{"mucJwtDto": {"jwt": "a"}}')).toHaveLength(1);
    expect(scanForCredentials('x', '"payload": "{\\"encryptionKey\\":\\"abc\\"}"')).toHaveLength(1);
    expect(scanForCredentials('x', 'Bearer abc', { forbidden: ['Bearer '] })).toHaveLength(1);
    expect(scanForCredentials('x', '{"lobbyPassword": "", "mucJwtDto": "[redacted]"}')).toEqual([]);
    expect(
      scanForCredentials('x', '{"companionToken": "fake"}', { allow: (_, value) => value === 'fake' }),
    ).toEqual([]);
  });
});
