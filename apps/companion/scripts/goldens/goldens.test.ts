/**
 * The goldens in `crates/engine/tests/goldens/` (M17.4), checked three ways on every `pnpm -r test`:
 *
 *  1. **The client and the disk would accept them.** The client-write goldens match what the 16.18 client
 *     accepted, and the file goldens parse under the engine's own file schemas. **The API bodies are not
 *     checked here:** the canonical "the server accepts every API body" check is
 *     `packages/db/src/contract/goldens.test.ts` (M17.3), which reads the same files through the routes'
 *     zod schemas and outlives this TypeScript engine (M17.14).
 *  2. **No credential is in them.** The fixture guard's rule (`packages/lcu/src/schemas.test.ts`), plus the
 *     harness's own secrets, which must never reach a body.
 *  3. **They are still what the TypeScript engine sends.** The scenarios are re-run and compared with the
 *     committed files, until M17.14 deletes the TypeScript engine (then this third test goes with it).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REDACTED, readFixture } from '@customs/lcu';
import { describe, expect, it } from 'vitest';
import { executedFileSchema } from '../../src/executed.js';
import { queueEntrySchema } from '../../src/queue.js';
import { diffGoldens, GOLDENS_DIR, INDEX_FILE, renderGoldens } from '../make-goldens.js';
import { HARNESS_API_TOKEN, HARNESS_LCU_PASSWORD } from './harness.js';
import {
  GOLDEN_LOBBY_PASSWORD,
  GOLDEN_PAIR_TOKEN,
  GOLDEN_ROUTES,
  type Golden,
  type GoldenRoute,
  runScenarios,
} from './scenarios.js';

interface IndexFile {
  readonly counts: { readonly total: number };
  readonly goldens: readonly { readonly file: string; readonly route: string }[];
  readonly scenarios: readonly { readonly name: string; readonly goldens: readonly string[] }[];
}

const files = readdirSync(GOLDENS_DIR).filter((name) => name.endsWith('.json') && name !== INDEX_FILE);
const goldens: Golden[] = files.map(
  (name) => JSON.parse(readFileSync(join(GOLDENS_DIR, name), 'utf8')) as Golden,
);
const index = JSON.parse(readFileSync(join(GOLDENS_DIR, INDEX_FILE), 'utf8')) as IndexFile;

function fixtureRequest(patch: string, id: string): unknown {
  const read = readFixture(patch, id);
  if (!read.ok) throw new Error(read.reason);
  return read.envelope.request;
}

/**
 * Checks one client-write or file golden. API routes return at once: `packages/db/src/contract/goldens.test.ts`
 * is the canonical check for those (M17.3).
 */
function checkRequest(route: GoldenRoute, path: string, body: unknown): void {
  switch (route) {
    case 'lobby':
    case 'game':
    case 'rank':
    case 'backfill-scan':
    case 'pair':
    case 'commands-poll':
    case 'command-ack':
    case 'command-nack':
      return;
    case 'lcu-create-lobby': {
      // The body the 16.18 client accepted (its capture redacts the password; ours is the synthetic one).
      const sent = structuredClone(body) as { customGameLobby: { lobbyPassword: string } };
      sent.customGameLobby.lobbyPassword = REDACTED;
      const accepted = structuredClone(fixtureRequest('16.18', 'create-lobby')) as {
        queueId: number;
        customGameLobby: { configuration: { mutators: { id: number } } };
      };
      if ((body as { queueId: number }).queueId === 3100) {
        // M17.17: the blind golden is the accepted body with blind's entry (3100) in place of draft's (3110).
        accepted.queueId = 3100;
        accepted.customGameLobby.configuration.mutators.id = 3100;
      }
      expect(sent).toEqual(accepted);
      return;
    }
    case 'lcu-invite':
      expect(body).toEqual(fixtureRequest('16.18', 'lobby-invitations'));
      return;
    case 'lcu-switch-side':
      expect(body).toBeNull();
      expect(path).toBe('/lol-lobby/v2/lobby/team/TEAM2');
      return;
    case 'queue-file':
      queueEntrySchema.parse(body);
      return;
    case 'commands-done-file':
      executedFileSchema.parse(body);
      return;
  }
}

describe('goldens: index', () => {
  it('lists every golden file exactly once, and nothing else', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(index.goldens.map((entry) => entry.file).sort()).toEqual([...files].sort());
    expect(index.counts.total).toBe(files.length);
    const named = index.scenarios.flatMap((scenario) => scenario.goldens.map((name) => `${name}.json`));
    expect(named.sort()).toEqual([...files].sort());
  });

  it('has a golden per route the milestone names', () => {
    const routes = new Set(goldens.map((golden) => golden.route));
    for (const route of GOLDEN_ROUTES) {
      expect(routes, route).toContain(route);
    }
    // M17.4's acceptance list, by name.
    for (const name of [
      'lobby--lobby',
      'lobby--lobby--spectator',
      'lobby--lobby--two-players',
      'game--in-progress--gameflow-session',
      'game--eog--eog-stats-block--observed-start',
      'rank--current-ranked-stats--own',
      'rank--ranked-stats-by-puuid--other',
      'backfill-scan--match-history',
      'command-ack--create-lobby',
      'command-ack--invite--sent',
      'command-ack--switch-side',
    ]) {
      expect(files, name).toContain(`${name}.json`);
    }
  });
});

describe('goldens: the client and the disk would accept every write', () => {
  for (const golden of goldens) {
    it(`${golden.name} (${golden.route})`, () => {
      if (golden.kind === 'sequence') {
        expect(golden.requests?.length ?? 0).toBeGreaterThan(0);
        for (const request of golden.requests ?? []) {
          checkRequest(request.route, request.path, request.body);
        }
        return;
      }
      const route = golden.route as GoldenRoute;
      const body = golden.kind === 'file' ? golden.file : golden.body;
      checkRequest(route, golden.path ?? '', body);
    });
  }
});

describe('goldens: credential guard', () => {
  // The fixture guard's keys (`packages/lcu/src/schemas.test.ts`): a value must be empty or `[redacted]`.
  const SECRET_KEY_VALUE =
    /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword|Token)\\?"\s*:\s*\\?"([^"\\]*)/g;
  const SECRET_KEY_OBJECT =
    /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword)\\?"\s*:\s*[{[]/;
  const HARNESS_SECRETS = [
    HARNESS_LCU_PASSWORD,
    HARNESS_API_TOKEN,
    GOLDEN_PAIR_TOKEN,
    Buffer.from(`riot:${HARNESS_LCU_PASSWORD}`).toString('base64'),
    'Bearer ',
    'Basic ',
  ];

  it('no golden carries a credential value', () => {
    const offenders: string[] = [];
    for (const name of [...files, INDEX_FILE]) {
      const text = readFileSync(join(GOLDENS_DIR, name), 'utf8');
      for (const match of text.matchAll(SECRET_KEY_VALUE)) {
        const key = match[1] ?? '';
        const value = match[2] ?? '';
        // The one password a golden may hold: the synthetic one the create scenario set, as the companion
        // posts it (`lobbyPassword`, M4.2) and sends it to the client.
        const synthetic = key === 'Password' && value === GOLDEN_LOBBY_PASSWORD;
        if (value.length > 0 && value !== REDACTED && !synthetic) {
          offenders.push(`${name}: ${key} = ${value.slice(0, 12)}...`);
        }
      }
      if (SECRET_KEY_OBJECT.test(text)) {
        offenders.push(`${name}: credential key with an object/array value`);
      }
      for (const secret of HARNESS_SECRETS) {
        if (text.includes(secret)) {
          offenders.push(`${name}: carries a harness secret (${secret.slice(0, 6)}...)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the synthetic lobby password only sits where the companion sends a lobby password', () => {
    for (const name of files) {
      const text = readFileSync(join(GOLDENS_DIR, name), 'utf8');
      const count = text.split(GOLDEN_LOBBY_PASSWORD).length - 1;
      const keyed = (text.match(new RegExp(`"lobbyPassword": "${GOLDEN_LOBBY_PASSWORD}"`, 'g')) ?? []).length;
      expect(count, name).toBe(keyed);
    }
  });
});

describe('goldens: still what the TypeScript engine sends', () => {
  it('re-running every scenario reproduces the committed files byte for byte', async () => {
    const rendered = renderGoldens(await runScenarios());
    const committed = new Map(
      [...files, INDEX_FILE].map((name) => [name, readFileSync(join(GOLDENS_DIR, name), 'utf8')] as const),
    );
    expect(diffGoldens(committed, rendered)).toEqual([]);
  }, 120_000);
});
