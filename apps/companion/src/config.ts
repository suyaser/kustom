/**
 * The companion's config file: where it lives, what it holds, and the first-run prompt that fills it.
 *
 * Location (`docs/01-architecture.md` "Companion", plus the dev platforms):
 *  - Windows: `%APPDATA%\customs-night\config.json`
 *  - macOS:   `~/Library/Application Support/customs-night/config.json`
 *  - Linux:   `$XDG_CONFIG_HOME/customs-night/config.json` (default `~/.config`)
 *  - any:     `CUSTOMS_NIGHT_CONFIG_DIR` overrides the directory.
 *
 * Shape (M6 one-app, M14.6 groups): `{ mode: 'host' | 'overlay', apiBase, companionToken?, groups?, lastGroupId? }`,
 * where `groups` is `[{ groupId, slug, name, companionToken? }]` (one token per group) and a top-level
 * `companionToken` is the 0.2.x single token, read as that token's group and filed under it once the server
 * says which (`groups.ts`). Plus an optional
 * `lockfilePath` for a non-default League install. Host mode requires a companion token (lobby writes).
 * Overlay mode needs no token. A file with a token and no `mode` is treated as host (0.1.x upgrade).
 * The file is written with mode 0600 (owner only; Windows ignores the mode). Nothing else is ever written to
 * the config directory except `logs/` and `status.json`.
 *
 * The token is never printed or logged; the hidden prompt masks it, and `--show-token` only ever echoes it to
 * the console of the person typing it.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';

export const CONFIG_DIR_ENV = 'CUSTOMS_NIGHT_CONFIG_DIR';
export const CONFIG_DIR_NAME = 'customs-night';
export const CONFIG_FILE_NAME = 'config.json';
export const LOGS_DIR_NAME = 'logs';

/**
 * The API origin used when the config file names none. The packaged exe (M2.6) bakes the deployed origin in
 * through an esbuild `define` (`__CUSTOMS_NIGHT_API_BASE__`); under `pnpm --filter companion dev` the define
 * is absent and this is the local dev server. A `config.json` with its own `apiBase` always wins over it.
 */
declare const __CUSTOMS_NIGHT_API_BASE__: string | undefined;

export const LOCAL_API_BASE = 'http://localhost:3000';

export const DEFAULT_API_BASE: string =
  typeof __CUSTOMS_NIGHT_API_BASE__ === 'string' && __CUSTOMS_NIGHT_API_BASE__.length > 0
    ? __CUSTOMS_NIGHT_API_BASE__
    : LOCAL_API_BASE;

export const apiBaseSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => /^https?:\/\/[^/\s]+$/.test(value), {
    message: 'apiBase must be an origin like https://customs.example (no path)',
  });

/**
 * What a minted token looks like: `apps/web/lib/companionAuth.ts` `mintCompanionToken` is 32 random bytes as
 * base64url without padding, so 43 characters from `A-Z a-z 0-9 - _`. The companion cannot import that file
 * (it must not depend on the web app), so the shape is pinned here and checked in `config.test.ts`. A pasted
 * value of any other shape cannot be a token: it is a corrupted paste, not a credential (M2.19).
 */
export const COMPANION_TOKEN_LENGTH = 43;
export const COMPANION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const TOKEN_SHAPE_MESSAGE = `That does not look like a token from the admin page (expected ${COMPANION_TOKEN_LENGTH} characters, letters, digits, - and _). Try pasting it again.`;

/** How many pastes the first-run prompt accepts before it gives up and says so. */
export const TOKEN_ATTEMPTS = 3;

export function looksLikeCompanionToken(value: string): boolean {
  return COMPANION_TOKEN_PATTERN.test(value);
}

// ESC [ params intermediates final (CSI, e.g. bracketed paste's ESC[200~), ESC O x (SS3), or ESC + one char.
const ESC = String.fromCharCode(0x1b);
const ESCAPE_SEQUENCE = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|O[@-~]|[\\s\\S])`, 'g');
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}${String.fromCharCode(0xfeff)}]`,
  'g',
);
const SURROUNDING_QUOTES = /^["'`\u201c\u201d\u2018\u2019]+|["'`\u201c\u201d\u2018\u2019]+$/gu;

/**
 * A pasted token as a person meant it: terminal escape sequences gone (a terminal with bracketed paste wraps a
 * paste in `ESC[200~` ... `ESC[201~`, and a cooked-mode read may still hand them over), control characters
 * gone, whitespace and quotes around it gone. Pure; used on every path the token comes in by.
 */
export function cleanTokenInput(raw: string): string {
  return raw
    .replace(ESCAPE_SEQUENCE, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .replace(SURROUNDING_QUOTES, '')
    .trim();
}

export const companionTokenSchema = z
  .string()
  .transform(cleanTokenInput)
  .refine(looksLikeCompanionToken, { message: TOKEN_SHAPE_MESSAGE });

/**
 * One group this PC knows (M13.8): what pairing and `GET /api/overlay/groups` return, plus the host token if
 * this PC has one for it. A group without a token is still listed (Overlay uses every group; Host shows it as
 * `(no host token)`).
 */
export const groupEntrySchema = z.object({
  groupId: z.string().min(1),
  slug: z.string(),
  name: z.string(),
  companionToken: companionTokenSchema.optional(),
});

export type GroupEntry = z.infer<typeof groupEntrySchema>;

/**
 * The groups of a raw config object, entry by entry: an entry that does not parse (a corrupted token, a
 * hand edit) is dropped rather than failing the file, so one bad row never costs a friend the others.
 */
export function sanitizeGroups(raw: unknown): GroupEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GroupEntry[] = [];
  for (const item of raw) {
    const parsed = groupEntrySchema.safeParse(item);
    if (parsed.success && !seen.has(parsed.data.groupId)) {
      seen.add(parsed.data.groupId);
      out.push(parsed.data);
    }
  }
  return out;
}

const groupFields = {
  groups: z.array(groupEntrySchema).optional(),
  lastGroupId: z.string().min(1).optional(),
};

export const appModeSchema = z.enum(['host', 'overlay']);
export type AppMode = z.infer<typeof appModeSchema>;

const lockfilePathSchema = z.string().trim().min(1).optional();

/** Host mode: token required. Writes to the client and the API. */
export const hostConfigSchema = z
  .object({
    mode: z.literal('host'),
    apiBase: apiBaseSchema,
    /** The 0.2.x single token (no group known yet), or one a paste just wrote. See `groups.ts`. */
    companionToken: companionTokenSchema.optional(),
    /** A non-default League install. Tried before the platform default lockfile paths. */
    lockfilePath: lockfilePathSchema,
    ...groupFields,
  })
  .refine((config) => config.companionToken !== undefined || (config.groups ?? []).some(hasToken), {
    message: 'host mode needs a companion token',
    path: ['companionToken'],
  });

function hasToken(group: GroupEntry): boolean {
  return group.companionToken !== undefined;
}

/** Overlay mode: no token. Fearless + lobby synergy panel only. */
export const overlayModeConfigSchema = z.object({
  mode: z.literal('overlay'),
  apiBase: apiBaseSchema,
  lockfilePath: lockfilePathSchema,
  ...groupFields,
});

export const configSchema = z.discriminatedUnion('mode', [hostConfigSchema, overlayModeConfigSchema]);

export type HostConfig = z.infer<typeof hostConfigSchema>;
export type OverlayModeConfig = z.infer<typeof overlayModeConfigSchema>;
export type CompanionConfig = z.infer<typeof configSchema>;

/** Host-shaped input for `saveConfig` / first-run; `mode` defaults to host. */
export type HostConfigInput = {
  apiBase: string;
  companionToken: string;
  lockfilePath?: string;
  mode?: AppMode;
  groups?: GroupEntry[];
  lastGroupId?: string;
};

export function isHostConfig(config: CompanionConfig): config is HostConfig {
  return config.mode === 'host';
}

/**
 * Files written before M6 have no `mode`. A present token means host; overlay is only explicit.
 * Never invent overlay from a token-less file — that is still the CLI first-run prompt.
 */
function withInferredMode(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.mode !== undefined) return raw;
  if (typeof record.companionToken === 'string' && record.companionToken.trim().length > 0) {
    return { ...record, mode: 'host' };
  }
  if (sanitizeGroups(record.groups).some(hasToken)) {
    return { ...record, mode: 'host' };
  }
  return raw;
}

/** Drops unparseable group entries before the schema sees the file; leaves a file with no `groups` alone. */
function withSanitizedGroups(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.groups === undefined) return raw;
  return { ...record, groups: sanitizeGroups(record.groups) };
}

export interface ConfigEnv {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
}

/** The directory the config file and `logs/` live in. */
export function configDir(options: ConfigEnv = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const override = env[CONFIG_DIR_ENV];
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  switch (platform) {
    case 'win32':
      return join(
        env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(home, 'AppData', 'Roaming'),
        CONFIG_DIR_NAME,
      );
    case 'darwin':
      return join(home, 'Library', 'Application Support', CONFIG_DIR_NAME);
    default: {
      const xdg = env.XDG_CONFIG_HOME;
      return join(xdg && xdg.length > 0 ? xdg : join(home, '.config'), CONFIG_DIR_NAME);
    }
  }
}

export function configPath(dir: string): string {
  return join(dir, CONFIG_FILE_NAME);
}

export function logsDir(dir: string): string {
  return join(dir, LOGS_DIR_NAME);
}

/**
 * Why the prompt is needed: no file at all, a file with no token, or a file whose token cannot be one (the
 * corrupted paste of M2.19, saved by 0.1.0). The prompt words its first line by it.
 */
export type MissingConfigReason = 'no_file' | 'no_token' | 'bad_token';

export type LoadConfigResult =
  | { readonly status: 'ok'; readonly config: CompanionConfig; readonly path: string }
  /** No file, or a file without a usable token: the first-run prompt is needed. */
  | {
      readonly status: 'missing';
      readonly path: string;
      readonly partial: Partial<HostConfigInput>;
      readonly reason: MissingConfigReason;
    }
  /** A file that exists but is not JSON. Refuse to overwrite it silently. */
  | { readonly status: 'invalid'; readonly path: string; readonly reason: string };

/** Reads and validates the config file. Never throws. */
export function loadConfig(dir: string): LoadConfigResult {
  const path = configPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') {
      return { status: 'missing', path, partial: {}, reason: 'no_file' };
    }
    return { status: 'invalid', path, reason: error instanceof Error ? error.message : String(error) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    // Never V8's message: it quotes a snippet of the source, which for a hand-edited file may be the token.
    const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
    return { status: 'invalid', path, reason: position ? `not JSON (at position ${position})` : 'not JSON' };
  }
  const parsed = configSchema.safeParse(withInferredMode(withSanitizedGroups(raw)));
  if (parsed.success) {
    return { status: 'ok', config: parsed.data, path };
  }
  // Keep whatever fields are usable so the prompt can offer them as defaults.
  const partial: Partial<HostConfigInput> = {};
  let reason: MissingConfigReason = 'no_token';
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const apiBase = apiBaseSchema.safeParse(record.apiBase);
    if (apiBase.success) {
      partial.apiBase = apiBase.data;
    }
    if (typeof record.lockfilePath === 'string' && record.lockfilePath.trim().length > 0) {
      partial.lockfilePath = record.lockfilePath.trim();
    }
    if (record.mode === 'overlay' || record.mode === 'host') {
      partial.mode = record.mode;
    }
    const groups = sanitizeGroups(record.groups);
    if (groups.length > 0) {
      partial.groups = groups;
    }
    if (typeof record.lastGroupId === 'string' && record.lastGroupId.length > 0) {
      partial.lastGroupId = record.lastGroupId;
    }
    if (typeof record.companionToken === 'string' && record.companionToken.trim().length > 0) {
      reason = 'bad_token';
    }
  }
  return { status: 'missing', path, partial, reason };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes the config atomically: the body goes to `config.json.tmp` and is renamed over the real file, so a
 * reader (the engine's file poll, another process) sees the old file or the new one, never half of one.
 * Callers hold the config lock. A rename Windows refuses for a moment (EPERM/EBUSY, an antivirus or a reader
 * has the file open) is retried.
 */
export const STATE_OWNER_FILE = 'legacy-state-owner';
const ROOT_STATE_NAMES = ['queue', 'backfill.json', 'commands-done.json'] as const;

/** A short, one-way tag of a token: enough to tell two tokens apart, nothing that could be used as one. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function readStateOwner(dir: string): string | null {
  try {
    return readFileSync(join(dir, STATE_OWNER_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Records who owns the config root's queue, backfill and executed state, once. Never throws. */
export function recordStateOwner(dir: string, token: string): void {
  if (readStateOwner(dir) !== null) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, STATE_OWNER_FILE), `${tokenFingerprint(token)}\n`, { mode: 0o600, flag: 'wx' });
  } catch {
    // Not recorded: the next start asks again.
  }
}

/**
 * The upgrade gap: a 0.2.x/0.3.0 PC has root state captured under its top-level token and no owner record
 * yet. Before a write replaces that token with a different one, the outgoing token is recorded as the owner,
 * so the new token can never claim the old token's queue.
 */
function protectRootState(dir: string, next: unknown): void {
  if (readStateOwner(dir) !== null) return;
  if (!ROOT_STATE_NAMES.some((name) => existsSync(join(dir, name)))) return;
  let outgoing: unknown;
  try {
    outgoing = (JSON.parse(readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>).companionToken;
  } catch {
    return;
  }
  if (typeof outgoing !== 'string' || outgoing.length === 0) return;
  const incoming =
    next && typeof next === 'object' ? (next as Record<string, unknown>).companionToken : undefined;
  if (incoming !== outgoing) recordStateOwner(dir, outgoing);
}

function writeConfigBody(dir: string, value: unknown): string {
  const path = configPath(dir);
  const tmp = `${path}.tmp`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  protectRootState(dir, value);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; tighten explicitly. Windows has no POSIX modes.
  try {
    chmodSync(tmp, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, path);
      return path;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= 20) {
        try {
          unlinkSync(tmp);
        } catch {
          // nothing to clean
        }
        throw error;
      }
      sleepSync(25);
    }
  }
}

/** Writes the config with owner-only permissions. Creates the directory. Throws on I/O failure. */
export function saveConfig(dir: string, config: CompanionConfig | HostConfigInput): string {
  const extras = {
    ...('groups' in config && config.groups && config.groups.length > 0 ? { groups: config.groups } : {}),
    ...('lastGroupId' in config && config.lastGroupId ? { lastGroupId: config.lastGroupId } : {}),
    ...('lockfilePath' in config && config.lockfilePath ? { lockfilePath: config.lockfilePath } : {}),
  };
  const normalized: CompanionConfig =
    'mode' in config && config.mode === 'overlay'
      ? overlayModeConfigSchema.parse({ mode: 'overlay', apiBase: config.apiBase, ...extras })
      : hostConfigSchema.parse({
          mode: 'host',
          apiBase: config.apiBase,
          ...('companionToken' in config && config.companionToken
            ? { companionToken: config.companionToken }
            : {}),
          ...extras,
        });
  return withConfigLock(dir, CONFIG_LOCK_WAIT_MS, () => writeConfigBody(dir, normalized));
}

/** Thrown by `updateConfig` for a file that exists but is not a JSON object: never overwritten. */
export class ConfigUnreadableError extends Error {
  constructor() {
    super('config.json is not valid JSON; fix or delete it first');
    this.name = 'ConfigUnreadableError';
  }
}

/**
 * Read-modify-write of the raw config object, keeping every key it does not know about. The group
 * operations (`groups.ts`) go through this so a pairing never costs a friend their mode, token or lockfile
 * path. A missing file starts from `{}`; a file that is not a JSON object throws `ConfigUnreadableError`
 * and is left alone. Throws on I/O failure.
 */
export function updateConfig(
  dir: string,
  mutate: (raw: Record<string, unknown>) => Record<string, unknown>,
  options: { waitMs?: number } = {},
): string {
  // The read happens inside the lock, so the one-shot `--pair` process and the running engine each see the
  // other's finished write and never overwrite it with a stale copy (M14.13).
  return withConfigLock(dir, options.waitMs ?? CONFIG_LOCK_WAIT_MS, () => {
    let raw: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(configPath(dir), 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ConfigUnreadableError();
      }
      raw = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ConfigUnreadableError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'ENOENT') throw new ConfigUnreadableError();
    }
    return writeConfigBody(dir, mutate(raw));
  });
}

/** A lock older than this is a crashed process's; it is broken. */
export const CONFIG_LOCK_STALE_MS = 10_000;
/** Waiting longer than this for a live lock fails the write. It is never taken over a live holder. */
export const CONFIG_LOCK_WAIT_MS = 5_000;

export class ConfigLockTimeoutError extends Error {
  constructor() {
    super('config.json is being written by another Kustom process; try again in a moment');
    this.name = 'ConfigLockTimeoutError';
  }
}

export function configLockPath(dir: string): string {
  return `${configPath(dir)}.lock`;
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/**
 * Runs `work` holding `config.json.lock` (an exclusive-create file whose content is this holder's own random
 * token), so two processes' read-modify-writes and saves take turns. Synchronous like the writes it guards.
 * Release deletes the file only if it still holds our token, so a lock someone else took after ours was broken
 * is never deleted by us. A stale lock (a crashed holder) is broken by an atomic rename to a unique name, not
 * an unlink, so of several waiters only one breaks it. On timeout the write fails with
 * `ConfigLockTimeoutError`; it never proceeds without the lock.
 */
function withConfigLock<T>(dir: string, waitMs: number, work: () => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = configLockPath(dir);
  const owner = randomBytes(12).toString('hex');
  const started = Date.now();
  for (;;) {
    try {
      writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    let age: number;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue; // released between the two calls
    }
    if (age > CONFIG_LOCK_STALE_MS) {
      const grave = `${lock}.stale-${randomBytes(6).toString('hex')}`;
      try {
        renameSync(lock, grave);
        // The rename took whatever sat at the path. If it was a fresh lock a faster waiter had just made,
        // put it back (only if the path is still free) instead of leaving its holder unprotected.
        try {
          if (Date.now() - statSync(grave).mtimeMs <= CONFIG_LOCK_STALE_MS && !existsSync(lock)) {
            renameSync(grave, lock);
            continue;
          }
          unlinkSync(grave);
        } catch {
          // nothing to clean
        }
      } catch {
        // someone else broke it first
      }
      continue;
    }
    if (Date.now() - started > waitMs) throw new ConfigLockTimeoutError();
    sleepSync(10);
  }
  try {
    return work();
  } finally {
    try {
      if (readFileSync(lock, 'utf8') === owner) unlinkSync(lock);
    } catch {
      // already gone
    }
  }
}

/** Overlay-mode save used by the Tauri setup UI (no token ever written). */
export function saveOverlayModeConfig(dir: string, config: Omit<OverlayModeConfig, 'mode'>): string {
  return saveConfig(dir, { mode: 'overlay', ...config });
}

/** How the first-run prompt talks to a person. Injected so tests can script it. */
export interface PromptIo {
  /** Prints a line. */
  say(line: string): void;
  /** Asks a question; the answer is echoed as typed. */
  ask(question: string): Promise<string>;
  /** Asks a question without echoing the answer. */
  askHidden(question: string): Promise<string>;
}

/** Reachability check for the typed `apiBase`. Returns null when fine, else a one-line reason. */
export type ApiBaseCheck = (apiBase: string) => Promise<string | null>;

export interface FirstRunOptions {
  readonly io: PromptIo;
  readonly partial?: Partial<HostConfigInput>;
  readonly checkApiBase?: ApiBaseCheck;
  /** Why the prompt is running; words the first line. Default `no_file`. */
  readonly reason?: MissingConfigReason;
}

/** Thrown by `promptFirstRun` after `TOKEN_ATTEMPTS` pastes that could not be a token. */
export const NO_TOKEN_MESSAGE =
  'No token after three tries. Get one from the admin page and start the companion again.';

/**
 * The first-run conversation. When the built-in origin answers `GET /api/health`, the only question is the
 * token (hidden): one paste, not two answers (M2.6). Otherwise it asks for the API origin (default offered),
 * checks it, and lets the person keep an unreachable one (the API may simply be down right now; the client
 * retries forever). A partial config that already names an `apiBase` is offered as the default and confirmed.
 */
export async function promptFirstRun(options: FirstRunOptions): Promise<HostConfig> {
  const { io } = options;
  const partial = options.partial ?? {};
  io.say(
    options.reason === 'bad_token'
      ? 'Kustom companion: the saved token does not look like one from the admin page. Paste it again; it is stored locally only.'
      : 'Kustom companion: first run. Paste the token from the admin page; it is stored locally only.',
  );

  let apiBase = partial.apiBase ?? DEFAULT_API_BASE;
  let settled = false;
  if (partial.apiBase === undefined && options.checkApiBase) {
    const problem = await options.checkApiBase(apiBase);
    if (problem === null) {
      io.say(`  Using ${apiBase}.`);
      settled = true;
    } else {
      io.say(`  ${apiBase} did not answer: ${problem}`);
    }
  }
  while (!settled) {
    const answer = await io.ask(`API address [${apiBase}]: `);
    const parsed = apiBaseSchema.safeParse(answer.trim().length > 0 ? answer : apiBase);
    if (!parsed.success) {
      io.say(`  ${parsed.error.issues[0]?.message ?? 'invalid address'}`);
      continue;
    }
    apiBase = parsed.data;
    if (!options.checkApiBase) {
      break;
    }
    const problem = await options.checkApiBase(apiBase);
    if (problem === null) {
      io.say(`  ${apiBase} answered.`);
      break;
    }
    io.say(`  ${apiBase} did not answer: ${problem}`);
    const keep = await io.ask('  Keep it anyway? [y/N]: ');
    if (/^y(es)?$/i.test(keep.trim())) {
      break;
    }
  }

  // Three pastes. Anything that is not 43 base64url characters cannot be a token (a corrupted paste, a
  // bracketed-paste wrapper, the wrong clipboard); saying so beats a 401 forever with a wrong file.
  let companionToken: string | null = null;
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS && companionToken === null; attempt += 1) {
    const cleaned = cleanTokenInput(await io.askHidden('Companion token (input hidden): '));
    if (cleaned.length === 0) {
      io.say('  A token is required.');
    } else if (!looksLikeCompanionToken(cleaned)) {
      io.say(`  ${TOKEN_SHAPE_MESSAGE}`);
    } else {
      companionToken = cleaned;
    }
  }
  if (companionToken === null) {
    throw new Error(NO_TOKEN_MESSAGE);
  }

  const config: HostConfig = { mode: 'host', apiBase, companionToken };
  if (partial.lockfilePath) {
    config.lockfilePath = partial.lockfilePath;
  }
  // Groups this PC already learned (a pairing before the token) survive the first-run write.
  if (partial.groups && partial.groups.length > 0) {
    config.groups = partial.groups;
  }
  if (partial.lastGroupId) {
    config.lastGroupId = partial.lastGroupId;
  }
  return config;
}

export type HiddenLineEvent =
  | { readonly kind: 'more' }
  | { readonly kind: 'line'; readonly line: string }
  /** Ctrl-C. */
  | { readonly kind: 'interrupt' };

const CTRL_C = String.fromCharCode(0x03);
const DEL = String.fromCharCode(0x7f);

/**
 * Reads one line of raw-mode terminal input a chunk at a time, the way the hidden token prompt sees it, and
 * keeps only the printable characters. A terminal escape sequence is swallowed whole even when a chunk
 * boundary falls inside it: `ESC [` then parameter (`0-?`) and intermediate (space-`/`) bytes up to a final
 * byte (`@-~`) — bracketed paste's `ESC[200~` / `ESC[201~`, arrow keys — `ESC O x`, or `ESC` plus one
 * character. 0.1.0 dropped the ESC and kept `[200~`, which is how a valid token became a 401 (M2.19).
 * Backspace and DEL erase; CR or LF ends the line; other control characters are dropped.
 */
export class HiddenLineReader {
  private line = '';
  private escape: 'none' | 'esc' | 'csi' = 'none';

  feed(text: string): HiddenLineEvent {
    for (const ch of text) {
      if (this.escape === 'csi') {
        // Parameter and intermediate bytes continue the sequence; a final byte (or anything odd) ends it.
        if (!(ch >= '0' && ch <= '?') && !(ch >= ' ' && ch <= '/')) {
          this.escape = 'none';
        }
        continue;
      }
      if (this.escape === 'esc') {
        this.escape = ch === '[' || ch === 'O' ? 'csi' : 'none';
        continue;
      }
      if (ch === ESC) {
        this.escape = 'esc';
        continue;
      }
      if (ch === CTRL_C) {
        return { kind: 'interrupt' };
      }
      if (ch === '\r' || ch === '\n') {
        const line = this.line;
        this.line = '';
        return { kind: 'line', line };
      }
      if (ch === DEL || ch === '\b') {
        this.line = this.line.slice(0, -1);
        continue;
      }
      if (ch >= ' ') {
        this.line += ch;
      }
    }
    return { kind: 'more' };
  }
}

export interface StdioPromptOptions {
  /**
   * `--show-token` / `CUSTOMS_NIGHT_SHOW_TOKEN=1`: the token prompt echoes what is typed, for a terminal that
   * cannot paste into a hidden prompt. Console only; the logger never sees the prompt either way.
   */
  readonly showToken?: boolean;
}

/**
 * A `PromptIo` over the process's stdin/stdout. The hidden prompt puts a TTY into raw mode and reads keys
 * itself so the token is never echoed; on a non-TTY stdin (piped input), or with `showToken`, it is a plain
 * line read. Both go through `cleanTokenInput` in `promptFirstRun`, so an escape sequence that survives a
 * cooked-mode read is stripped there too.
 */
export function stdioPrompt(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
  options: StdioPromptOptions = {},
): PromptIo {
  const say = (line: string): void => {
    output.write(`${line}\n`);
  };
  const askLine = async (question: string): Promise<string> => {
    const rl = createInterface({ input, output, terminal: false });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
  const askHidden = (question: string): Promise<string> => {
    if (options.showToken) {
      return askLine(question.replace('(input hidden)', '(shown as you type)'));
    }
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return askLine(question);
    }
    output.write(question);
    return new Promise((resolve) => {
      const reader = new HiddenLineReader();
      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();
      const finish = (value: string): void => {
        input.off('data', onData);
        input.setRawMode(wasRaw);
        input.pause();
        output.write('\n');
        resolve(value);
      };
      const onData = (chunk: Buffer | string): void => {
        const event = reader.feed(chunk.toString('utf8'));
        if (event.kind === 'interrupt') {
          // Ctrl-C during the prompt: leave the terminal sane and exit.
          input.setRawMode(wasRaw);
          output.write('\n');
          process.exit(130);
        }
        if (event.kind === 'line') {
          finish(event.line);
        }
      };
      input.on('data', onData);
    });
  };
  return { say, ask: askLine, askHidden };
}
