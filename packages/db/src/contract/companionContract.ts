import { z } from 'zod';
import * as schemas from '../schemas/index';

/**
 * The companion's API contract, as one list (M17.3): every schema a Kustom build sends or reads on
 * `/api/companion/*`, by the name it is exported under in `@customs/db/schemas`.
 *
 * Two things read this list:
 *
 * - `scripts/export-schemas.ts` writes one JSON Schema per entry into `packages/db/json-schema/`. That
 *   folder is the **drift alarm**: CI regenerates it and fails on a diff, so a schema change shows up as
 *   a file change in the pull request, where the companion lane can see it.
 * - `goldens.test.ts` beside this file, which parses the Rust companion's goldens through the same
 *   schemas. The goldens are the **real contract**; the JSON Schema is the alarm.
 *
 * The JSON Schema is the zod 4 **input** side (`io: 'input'`): what a client may send, or what a
 * client must accept, before any zod `transform` runs. Where zod cannot say a rule in JSON Schema
 * (`z.preprocess`, `.refine`, a `.trim()` before a length check), the exported node carries
 * `x-zod-not-exported` naming what is missing and `json-schema/index.json` lists it, so nobody reads a
 * silent gap as "anything goes". See `NOT_EXPORTED_KINDS`.
 *
 * Not in the list on purpose: `GET /api/overlay*` and `POST /api/companion/pair` in overlay mode are
 * 0.3.x surfaces kept until M17.15 and never called by the Rust companion; the session routes under
 * `/api/me/*` are the site's, not the companion's.
 */

type SchemaName = {
  [K in keyof typeof schemas]: (typeof schemas)[K] extends z.ZodType ? K : never;
}[keyof typeof schemas];

export type ContractSide = 'request' | 'query' | 'response';

export interface ContractEntry {
  /** The file stem in `json-schema/`: `<route>.<side>[.<detail>]`. */
  readonly file: string;
  /** Method and path, as the route handler serves it. */
  readonly route: string;
  readonly side: ContractSide;
  /** The export in `@customs/db/schemas`. */
  readonly schemaName: SchemaName;
  readonly schema: z.ZodType;
  readonly note?: string;
}

function entry(
  file: string,
  route: string,
  side: ContractSide,
  schemaName: SchemaName,
  note?: string,
): ContractEntry {
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: looked up by name so the name in json-schema/ and the schema cannot drift; never bundled (script and tests only).
  const schema = schemas[schemaName];
  return { file, route, side, schemaName, schema, ...(note === undefined ? {} : { note }) };
}

const ACK = 'POST /api/companion/commands/{id}/ack';
const NACK = 'POST /api/companion/commands/{id}/nack';

export const COMPANION_CONTRACT: readonly ContractEntry[] = [
  entry(
    'error.response',
    'every /api/companion/* route',
    'response',
    'companionErrorResponseSchema',
    'The { ok: false } half of every answer, whatever the status code.',
  ),
  entry('me.response', 'GET /api/companion/me', 'response', 'companionMeResponseSchema'),
  entry('pair.request', 'POST /api/companion/pair', 'request', 'companionPairRequestSchema'),
  entry('pair.response', 'POST /api/companion/pair', 'response', 'companionPairResponseSchema'),
  entry('lobby.request', 'POST /api/companion/lobby', 'request', 'companionLobbyPayloadSchema'),
  entry('lobby.response', 'POST /api/companion/lobby', 'response', 'companionLobbyResponseSchema'),
  entry(
    'lobby-leave.request',
    'POST /api/companion/lobby/leave',
    'request',
    'companionLobbyLeavePayloadSchema',
    'M22.9. The Rust companion only; the TypeScript engine never sends it, so there is no golden.',
  ),
  entry(
    'lobby-leave.response',
    'POST /api/companion/lobby/leave',
    'response',
    'companionLobbyLeaveResponseSchema',
  ),
  entry('game.request', 'POST /api/companion/game', 'request', 'companionGamePayloadSchema'),
  entry('game.response', 'POST /api/companion/game', 'response', 'companionGameResponseSchema'),
  entry('rank.request', 'POST /api/companion/rank', 'request', 'companionRankPayloadSchema'),
  entry('rank.response', 'POST /api/companion/rank', 'response', 'companionRankResponseSchema'),
  entry(
    'backfill-scan.request',
    'POST /api/companion/backfill/scan',
    'request',
    'companionBackfillScanRequestSchema',
  ),
  entry(
    'backfill-scan.response',
    'POST /api/companion/backfill/scan',
    'response',
    'companionBackfillScanResponseSchema',
  ),
  entry(
    'commands-poll.query',
    'GET /api/companion/commands',
    'query',
    'companionCommandsQuerySchema',
    'The query string as an object of strings: ?clientConnected=true|false.',
  ),
  entry(
    'commands-poll.response',
    'GET /api/companion/commands',
    'response',
    'companionCommandsResponseSchema',
  ),
  entry(
    'commands-poll.payload.switch_side',
    'GET /api/companion/commands',
    'response',
    'switchSideCommandPayloadSchema',
    'commands[].payload when kind is switch_side.',
  ),
  entry('command-ack.request', ACK, 'request', 'companionCommandAckRequestSchema'),
  entry(
    'command-ack.result.switch_side',
    ACK,
    'request',
    'switchSideCommandResultSchema',
    'result when the command is switch_side.',
  ),
  entry('command-ack.response', ACK, 'response', 'companionCommandAckResponseSchema'),
  entry('command-nack.request', NACK, 'request', 'companionCommandNackRequestSchema'),
  entry(
    'command-nack.reason',
    NACK,
    'request',
    'commandFailureReasonSchema',
    "The word before the first ':' of error. The route stores error verbatim and does not refuse an unknown word.",
  ),
  entry('command-nack.response', NACK, 'response', 'companionCommandAckResponseSchema'),
];

/**
 * What `x-zod-not-exported` can name. Each is a rule the server enforces that the JSON Schema does not
 * say; only the goldens (and the server's own tests) check it.
 */
export const NOT_EXPORTED_KINDS = {
  preprocess:
    'z.preprocess: the server rewrites the value before checking it (companionLobbyPayloadSchema drops bot and placeholder members first). The schema shown is what is checked after the rewrite.',
  refine:
    '.refine / .superRefine: a code check with no JSON Schema form (a placeholder puuid, a safe-integer bound, a token-or-refusal rule).',
  normalised:
    '.trim() (or another overwrite) before a length or pattern check: zod checks the normalised string, JSON Schema checks the raw one.',
  custom: 'z.custom: a code-only type.',
} as const;

export type NotExportedKind = keyof typeof NOT_EXPORTED_KINDS;

export const NOT_EXPORTED_KEY = 'x-zod-not-exported';

interface ZodDefLike {
  readonly type: string;
  readonly checks?: readonly { readonly _zod: { readonly def: { readonly check: string } } }[];
  readonly in?: { readonly _zod: { readonly def: { readonly type: string } } };
}

/** The rules on one zod node that its JSON Schema node cannot carry. */
export function notExportedKinds(schema: z.core.$ZodType): NotExportedKind[] {
  const def = schema._zod.def as unknown as ZodDefLike;
  const checks = (def.checks ?? []).map((check) => check._zod.def.check);
  const kinds: NotExportedKind[] = [];
  if (def.type === 'pipe' && def.in?._zod.def.type === 'transform') kinds.push('preprocess');
  if (checks.includes('custom')) kinds.push('refine');
  const firstOverwrite = checks.indexOf('overwrite');
  if (firstOverwrite !== -1 && checks.slice(firstOverwrite + 1).some((check) => check !== 'overwrite')) {
    kinds.push('normalised');
  }
  if (def.type === 'custom') kinds.push('custom');
  return kinds;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One entry's JSON Schema, with every unexportable rule marked on its node. */
export function exportEntry(contract: ContractEntry): { [key: string]: Json } {
  const json = z.toJSONSchema(contract.schema, {
    io: 'input',
    // A type zod cannot express at all must stop the export, never become a silent `{}`.
    unrepresentable: 'throw',
    override: (ctx) => {
      const kinds = notExportedKinds(ctx.zodSchema);
      if (kinds.length === 0) return;
      const node = ctx.jsonSchema as Record<string, unknown>;
      const already = (node[NOT_EXPORTED_KEY] as NotExportedKind[] | undefined) ?? [];
      node[NOT_EXPORTED_KEY] = [...new Set([...already, ...kinds])].sort();
    },
  }) as { [key: string]: Json };
  return {
    $schema: json.$schema as Json,
    $id: `customs-night/companion/${contract.file}`,
    title: contract.schemaName,
    description: `${contract.route} (${contract.side})${contract.note ? `. ${contract.note}` : ''}`,
    ...Object.fromEntries(Object.entries(json).filter(([key]) => key !== '$schema')),
  };
}

/** JSON pointers of every marked node, in document order. */
export function markedNodes(json: Json, pointer = ''): { pointer: string; kinds: NotExportedKind[] }[] {
  if (json === null || typeof json !== 'object') return [];
  const found: { pointer: string; kinds: NotExportedKind[] }[] = [];
  if (!Array.isArray(json) && Array.isArray(json[NOT_EXPORTED_KEY])) {
    found.push({ pointer: pointer || '/', kinds: json[NOT_EXPORTED_KEY] as NotExportedKind[] });
  }
  const children = Array.isArray(json)
    ? json.map((value, index) => [String(index), value] as const)
    : Object.entries(json);
  for (const [key, value] of children) {
    if (key === NOT_EXPORTED_KEY) continue;
    found.push(...markedNodes(value, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
  }
  return found;
}

export const INDEX_FILE = 'index.json';

function render(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Every file `json-schema/` should hold, by name. Pure, so the export script and its `--check` both
 * call it and a test can too.
 */
export function renderContract(contract: readonly ContractEntry[] = COMPANION_CONTRACT): Map<string, string> {
  const files = new Map<string, string>();
  const index: Json[] = [];
  for (const item of contract) {
    if (files.has(`${item.file}.json`)) throw new Error(`two contract entries write ${item.file}.json`);
    const json = exportEntry(item);
    files.set(`${item.file}.json`, render(json));
    index.push({
      file: `${item.file}.json`,
      route: item.route,
      side: item.side,
      schema: item.schemaName,
      notExported: markedNodes(json).map(({ pointer, kinds }) => ({ pointer, kinds })),
    });
  }
  files.set(
    INDEX_FILE,
    render({
      about:
        'JSON Schema (zod 4 toJSONSchema, input side) of every /api/companion/* request and response schema in @customs/db/schemas (M17.3). GENERATED: do not hand-edit. This folder is the drift alarm: CI regenerates it and fails on a diff. The real contract is the goldens in apps/companion/crates/engine/tests/goldens/, parsed through the zod schemas by packages/db/src/contract/goldens.test.ts.',
      generator:
        'packages/db/scripts/export-schemas.ts (pnpm --filter @customs/db export-schemas; --check to verify)',
      notExportedKey: NOT_EXPORTED_KEY,
      notExportedKinds: NOT_EXPORTED_KINDS,
      schemas: index,
    }),
  );
  return files;
}
