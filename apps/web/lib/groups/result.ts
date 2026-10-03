/**
 * What every M13.5 rule module returns: a value, or the status and sentence the route's envelope
 * carries (`lib/http.ts`). The same shape as `lib/admin/result.ts`, with the two statuses pairing
 * adds (410 for a used or expired code, 429 for the rate limit).
 */
export type GroupResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410 | 429; error: string };

export function groupOk<T>(value: T): GroupResult<T> {
  return { ok: true, value };
}

export function groupFailed<T>(status: 400 | 403 | 404 | 409 | 410 | 429, error: string): GroupResult<T> {
  return { ok: false, status, error };
}
