/**
 * Kustom's side of pairing (M13.8): the code a person typed from the join page, plus the PUUID League says is
 * signed in on this PC, sent to `POST /api/companion/pair` (no token). On success the group goes into the
 * config; on a refusal the server's sentence is returned verbatim for the Link slot.
 *
 * The PUUID is only ever read from the client (`readCurrentPuuid`), never typed. Nothing here writes to the
 * client or touches champion select.
 */

import {
  companionPairRequestSchema,
  companionPairResponseSchema,
  type GroupSummary,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
} from '@customs/db/schemas';
import { ApiClient, type FetchLike } from './api.js';
import { type ConfigGroupInput, fileTokenUnderGroup, rememberGroup } from './groups.js';
import { type CompanionLogger, createMemoryLogger } from './log.js';
import { type PuuidReadResult, readCurrentPuuid } from './panel/lcu.js';

export const PAIR_API_PATH = '/api/companion/pair';

/** Product's sentence (M13.8) for League not being open when a code is sent. */
export const OPEN_LEAGUE_FIRST = 'Open League first, then type the code.';

/** The slot's hint before anything is typed. */
export const JOIN_HINT = 'Type the code from the join page.';

/** Not in the brief: Kustom's own sentence for a server that did not answer. Product may reword. */
export const PAIR_UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

/** Not in the brief: for a code that is not six characters of the alphabet once cleaned. */
export const PAIR_BAD_CODE = 'A code is six letters and numbers. Check the join page and type it again.';

/** Not in the brief: for a 2xx the schema rejected (an old or broken deploy). */
export const PAIR_UNEXPECTED = 'The server answered something Kustom did not understand. Try again later.';

const ALLOWED = new Set(PAIRING_CODE_ALPHABET);

/**
 * The code as the field keeps it: upper-cased, characters outside the code alphabet (spaces, dashes, and the
 * look-alikes the alphabet leaves out) dropped, at most six. Safe because the alphabet is fixed and upper case
 * (M13.5, M13.7).
 */
export function normalizePairingCode(input: string): string {
  let out = '';
  for (const ch of input.toUpperCase()) {
    if (ALLOWED.has(ch)) out += ch;
    if (out.length === PAIRING_CODE_LENGTH) break;
  }
  return out;
}

export type PairOutcome =
  | { readonly ok: true; readonly group: GroupSummary; readonly message: string }
  /**
   * `message` is what the slot shows: the server's sentence verbatim, or one of the three above. `group` is
   * set only for a host-mode refusal (M14.12): the person joined, the group is in the config without a token,
   * and the sentence is the server's `hostRefusal`.
   */
  | { readonly ok: false; readonly message: string; readonly group?: GroupSummary };

export function youreIn(group: Pick<GroupSummary, 'name'>): string {
  return `You're in ${group.name}.`;
}

export interface PairOptions {
  readonly apiBase: string;
  /** The raw field value. */
  readonly code: string;
  /** Where the config lives; the group is added to `config.json` there on success. */
  readonly configDir: string;
  readonly lockfilePath?: string;
  /**
   * `host` asks the server for a host token (answered only for an admin on their own League account); the
   * default `overlay` sends no mode and never stores a token (M14.12, M14.13).
   */
  readonly mode?: 'host' | 'overlay';
  readonly logger?: CompanionLogger;
  /** Injected in tests. */
  readonly readPuuid?: () => Promise<PuuidReadResult>;
  readonly fetch?: FetchLike;
}

/** Never throws; every outcome is a typed result with the sentence to show. */
export async function pairWithCode(options: PairOptions): Promise<PairOutcome> {
  const logger = options.logger ?? createMemoryLogger();
  const code = normalizePairingCode(options.code);
  if (code.length !== PAIRING_CODE_LENGTH) {
    return { ok: false, message: PAIR_BAD_CODE };
  }
  const read =
    options.readPuuid ??
    (() => readCurrentPuuid(options.lockfilePath ? { lockfilePath: options.lockfilePath } : {}));
  const who = await read();
  if (!who.ok) {
    return { ok: false, message: OPEN_LEAGUE_FIRST };
  }
  const body = companionPairRequestSchema.safeParse({
    code,
    puuid: who.puuid,
    ...(options.mode === 'host' ? { mode: 'host' as const } : {}),
  });
  if (!body.success) {
    return { ok: false, message: PAIR_BAD_CODE };
  }
  const api = new ApiClient({
    apiBase: options.apiBase,
    logger,
    // One attempt: a code is single use, so a retry after a lost answer would read `ran out` for a pairing that worked.
    maxAttempts: 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const result = await api.request('POST', PAIR_API_PATH, body.data, companionPairResponseSchema, 1, {
    quiet: true,
  });
  if (!result.ok) {
    if (result.reason === 'http') {
      logger.info('pairing refused', { status: result.status });
      // The envelope's sentence, verbatim. A refusal with no envelope reads `HTTP <n>`: say the generic one.
      return { ok: false, message: /^HTTP \d+$/.test(result.error) ? PAIR_UNREACHABLE : result.error };
    }
    logger.warn('pairing failed', { reason: result.reason });
    return { ok: false, message: result.reason === 'network' ? PAIR_UNREACHABLE : PAIR_UNEXPECTED };
  }
  const group = result.data.group;
  // Only a host-mode request can come back with a token; overlay never stores one, whatever the server sent.
  const token = options.mode === 'host' ? result.data.companionToken : undefined;
  const refusal = options.mode === 'host' ? result.data.hostRefusal : undefined;
  if (token !== undefined) logger.addSecret(token);
  try {
    const entry: ConfigGroupInput = { groupId: group.id, slug: group.slug, name: group.name };
    rememberGroup(options.configDir, options.apiBase, entry);
    if (token !== undefined) {
      fileTokenUnderGroup(
        options.configDir,
        { groupId: group.id, slug: group.slug, name: group.name },
        token,
      );
    }
  } catch (error) {
    logger.error('paired, but the config could not be written', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Paired, but Kustom could not save it. Check the logs and try again.' };
  }
  if (refusal !== undefined) {
    logger.info('joined a group, but the server gave no host token', { groupId: group.id, slug: group.slug });
    return { ok: false, message: refusal, group };
  }
  logger.info('paired with a group', { groupId: group.id, slug: group.slug, hostToken: token !== undefined });
  return { ok: true, group, message: youreIn(group) };
}
