/**
 * The server's own guarantee to the Rust companion (M17.3): every API request in its goldens is one the
 * routes accept.
 *
 * The goldens in `apps/companion/crates/engine/tests/goldens/` are the exact bodies the TypeScript engine
 * (Kustom 0.4.0) sent for every recorded client fixture; the Rust engine must produce JSON-equal ones
 * (decision 2026-10-04). Here each body goes through the zod schema its route parses it with, so a schema
 * change in `src/schemas/` that a shipped Kustom's bodies no longer satisfy fails `pnpm -r test` in CI,
 * before anybody runs Kustom.
 *
 * **This is the canonical copy of that check.** M17.4 shipped a minimal one in
 * `apps/companion/scripts/goldens/goldens.test.ts`; its API half was moved here (M17.3) because this one
 * outlives the TypeScript engine (M17.14): the goldens are files, and this test reads only files and
 * `@customs/db`. The client-write goldens (`lcu-*`), the goldens' index and the credential guard moved
 * beside this file into `companionGuards.test.ts` (M17.14 prep); the on-disk goldens (`queue-file`,
 * `commands-done-file`) are the Rust engine's own `tests/goldens.rs`; freshness against the TypeScript
 * engine stays in the companion test and is deleted with it (M17.14).
 *
 * Read as files on purpose: `@customs/db` must not depend on `apps/companion` or `@customs/lcu`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  commandFailureReasonSchema,
  companionBackfillScanRequestSchema,
  companionCommandAckRequestSchema,
  companionCommandNackRequestSchema,
  companionCommandResultSchemas,
  companionCommandsQuerySchema,
  companionGamePayloadSchema,
  companionLobbyPayloadSchema,
  companionPairRequestSchema,
  companionRankPayloadSchema,
} from '../schemas/index';
import { COMPANION_CONTRACT } from './companionContract';

const GOLDENS_DIR = fileURLToPath(
  new URL('../../../../apps/companion/crates/engine/tests/goldens/', import.meta.url),
);
const INDEX_FILE = 'index.json';

/** The `/api/companion/*` routes a golden can name, and the contract file of the body it carries. */
const API_ROUTES = {
  lobby: 'lobby.request',
  game: 'game.request',
  rank: 'rank.request',
  'backfill-scan': 'backfill-scan.request',
  pair: 'pair.request',
  'commands-poll': 'commands-poll.query',
  'command-ack': 'command-ack.request',
  'command-nack': 'command-nack.request',
} as const;
type ApiRoute = keyof typeof API_ROUTES;

/** Goldens of the companion's client writes and files: checked by `companionGuards.test.ts` and the Rust tests. */
const COMPANION_ONLY_ROUTES = new Set(['lcu-switch-side', 'queue-file', 'commands-done-file']);

interface GoldenRequest {
  readonly route: string;
  readonly method?: string;
  readonly path: string;
  readonly body: unknown;
}

interface Golden {
  readonly name: string;
  readonly kind: 'request' | 'sequence' | 'file';
  readonly route: string;
  readonly method?: string;
  readonly path?: string;
  readonly commandKind?: string;
  readonly body?: unknown;
  readonly requests?: readonly GoldenRequest[];
}

const files = readdirSync(GOLDENS_DIR)
  .filter((name) => name.endsWith('.json') && name !== INDEX_FILE)
  .sort();
const goldens: Golden[] = files.map(
  (name) => JSON.parse(readFileSync(join(GOLDENS_DIR, name), 'utf8')) as Golden,
);

function isApiRoute(route: string): route is ApiRoute {
  return Object.hasOwn(API_ROUTES, route);
}

/** Every API request a golden holds, with the command kind an ack or nack answers. */
function apiRequests(golden: Golden): { route: ApiRoute; request: GoldenRequest; commandKind?: string }[] {
  if (golden.kind === 'sequence') {
    return (golden.requests ?? []).flatMap((request) =>
      isApiRoute(request.route) ? [{ route: request.route, request }] : [],
    );
  }
  if (!isApiRoute(golden.route)) return [];
  return [
    {
      route: golden.route,
      request: { route: golden.route, path: golden.path ?? '', body: golden.body },
      ...(golden.commandKind === undefined ? {} : { commandKind: golden.commandKind }),
    },
  ];
}

/** Parses one request exactly as its route does; throws with zod's issues when the route would refuse it. */
function checkRequest(route: ApiRoute, request: GoldenRequest, commandKind: string | undefined): void {
  const { body, path } = request;
  switch (route) {
    case 'lobby':
      companionLobbyPayloadSchema.parse(body);
      // `droppedMembers` is the server's own bookkeeping; a companion never sends it.
      expect(body).not.toHaveProperty('droppedMembers');
      return;
    case 'game':
      companionGamePayloadSchema.parse(body);
      return;
    case 'rank':
      companionRankPayloadSchema.parse(body);
      return;
    case 'backfill-scan':
      companionBackfillScanRequestSchema.parse(body);
      return;
    case 'pair': {
      const pair = companionPairRequestSchema.parse(body);
      // The Rust companion only hosts (M17 inventory row 6).
      expect(pair.mode).toBe('host');
      return;
    }
    case 'commands-poll': {
      expect(body).toBeNull();
      expect(path.split('?')[0]).toBe('/api/companion/commands');
      const query = new URL(path, 'https://customs.invalid').searchParams;
      companionCommandsQuerySchema.parse(Object.fromEntries(query));
      return;
    }
    case 'command-ack': {
      expect(path).toMatch(/^\/api\/companion\/commands\/[0-9a-f-]{36}\/ack$/);
      const ack = companionCommandAckRequestSchema.parse(body);
      // The route's 422: the result must match the acked command's kind.
      const schema = companionCommandResultSchemas[commandKind as keyof typeof companionCommandResultSchemas];
      expect(schema, `an ack golden names its command kind (${commandKind})`).toBeDefined();
      schema.parse(ack.result);
      return;
    }
    case 'command-nack': {
      expect(path).toMatch(/^\/api\/companion\/commands\/[0-9a-f-]{36}\/nack$/);
      const nack = companionCommandNackRequestSchema.parse(body);
      // The word up to the first ':' is one the server's enum names. Only that prefix is contract:
      // the detail after it is free text (decision 2026-10-04, malformed_payload's zod wording).
      commandFailureReasonSchema.parse(nack.error.split(':')[0]);
      return;
    }
  }
}

describe('goldens: what is here', () => {
  it('finds the goldens, and every route they name is one this test or the companion test owns', () => {
    expect(files.length).toBeGreaterThan(0);
    const unknown = goldens.flatMap((golden) => {
      const routes =
        golden.kind === 'sequence' ? (golden.requests ?? []).map((request) => request.route) : [golden.route];
      return routes.filter((route) => !isApiRoute(route) && !COMPANION_ONLY_ROUTES.has(route));
    });
    // A new route in the goldens must be added to API_ROUTES (and the contract), never skipped.
    expect(unknown).toEqual([]);
  });

  it('every request-side contract schema is exercised by at least one golden', () => {
    const exercised = new Set<string>();
    for (const golden of goldens) {
      for (const { route, commandKind } of apiRequests(golden)) {
        exercised.add(API_ROUTES[route]);
        if (route === 'command-ack' && commandKind !== undefined)
          exercised.add(`command-ack.result.${commandKind}`);
        if (route === 'command-nack') exercised.add('command-nack.reason');
      }
    }
    const requestSide = COMPANION_CONTRACT.filter((entry) => entry.side !== 'response').map(
      (entry) => entry.file,
    );
    expect(requestSide.filter((file) => !exercised.has(file))).toEqual([]);
  });

  it('API_ROUTES only names contract files that exist', () => {
    const contractFiles = new Set(COMPANION_CONTRACT.map((entry) => entry.file));
    for (const file of Object.values(API_ROUTES)) expect(contractFiles, file).toContain(file);
  });
});

describe('goldens: the server accepts every API body', () => {
  for (const golden of goldens) {
    const requests = apiRequests(golden);
    if (requests.length === 0) continue;
    it(`${golden.name} (${golden.route}, ${requests.length} request${requests.length === 1 ? '' : 's'})`, () => {
      for (const { route, request, commandKind } of requests) {
        checkRequest(route, request, commandKind);
      }
    });
  }
});
