/**
 * The credential rule every committed companion file is held to (M17.14 prep): the same keys as the League
 * fixture guard (`packages/lcu/src/schemas.test.ts`), applied here to files the Rust companion's tests read
 * (its goldens and its synthetic config trees), so the guard outlives the TypeScript companion.
 *
 * The regex accepts both `"key": "value"` and the `\"key\":\"value\"` form inside a JSON string. A value that
 * is empty or `[redacted]` is fine; any other value is an offender unless `allow` says it is a known fake.
 */

export const REDACTED = '[redacted]';

const SECRET_KEY_VALUE =
  /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword|Token)\\?"\s*:\s*\\?"([^"\\]*)/g;
const SECRET_KEY_OBJECT =
  /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword)\\?"\s*:\s*[{[]/;

export interface ScanOptions {
  /** A value this file may hold under a credential key (a synthetic fake). */
  readonly allow?: (key: string, value: string) => boolean;
  /** Literal strings that must never appear anywhere in the file (a harness's own secrets). */
  readonly forbidden?: readonly string[];
}

/** Every credential the text carries, as `<label>: <key> = <first 12 chars>...` lines. Empty when clean. */
export function scanForCredentials(label: string, text: string, options: ScanOptions = {}): string[] {
  const offenders: string[] = [];
  for (const match of text.matchAll(SECRET_KEY_VALUE)) {
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    if (value.length === 0 || value === REDACTED) continue;
    if (options.allow?.(key, value)) continue;
    offenders.push(`${label}: ${key} = ${value.slice(0, 12)}...`);
  }
  if (SECRET_KEY_OBJECT.test(text)) {
    offenders.push(`${label}: credential key with an object/array value`);
  }
  for (const secret of options.forbidden ?? []) {
    if (text.includes(secret))
      offenders.push(`${label}: carries a forbidden string (${secret.slice(0, 6)}...)`);
  }
  return offenders;
}
