import { ONLY_OWNER_RESETS, ONLY_OWNER_UNLINKS_OWNER, OWNER_UNLINKS_SELF } from '../admin/homeCopy';
import { JOIN_NOT_LINKED, PAIRING_NOT_CREATOR } from './copy';
import { NOT_ALLOWED_HERE, SESSION_EXPIRED } from './pageCopy';

/**
 * The sentence an API route answered with (`{ ok: false, error }`, `lib/http.ts`), or null when the
 * body has none (a network failure, an HTML error page). Client-safe.
 */
export function errorSentence(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error = (body as { error: unknown }).error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}

/** The 403s the M13.5 routes word for a person; every other 403 is the session gate's developer text. */
const FRIENDLY_403: readonly string[] = [
  JOIN_NOT_LINKED,
  PAIRING_NOT_CREATOR,
  ONLY_OWNER_RESETS,
  ONLY_OWNER_UNLINKS_OWNER,
  OWNER_UNLINKS_SELF,
];

/**
 * What a page prints for a refusal, in place under its control: a 401 is always
 * {@link SESSION_EXPIRED}; a 403 is the route's own sentence when it is one written for people and
 * {@link NOT_ALLOWED_HERE} otherwise; a 5xx is `fallback`; any other 4xx is the route's sentence
 * (product's: dead link, taken slug, expired code), or `fallback` when it has none. The gate's `sign in required` and `this session has no Discord identity` never reach a page.
 */
export function refusalSentence(status: number, body: unknown, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED;
  // A 5xx says `internal error` or `server is not configured`: developer text, never a person's.
  if (status >= 500) return fallback;
  const sentence = errorSentence(body);
  if (status === 403)
    return sentence !== null && FRIENDLY_403.includes(sentence) ? sentence : NOT_ALLOWED_HERE;
  return sentence ?? fallback;
}

/** The per-field sentences of a 400 (`issues: [{ path, message }]`), keyed by field. */
export function fieldErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof body !== 'object' || body === null || !('issues' in body)) return out;
  const issues = (body as { issues: unknown }).issues;
  if (!Array.isArray(issues)) return out;
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof path === 'string' && typeof message === 'string' && out[path] === undefined) {
      out[path] = message;
    }
  }
  return out;
}
