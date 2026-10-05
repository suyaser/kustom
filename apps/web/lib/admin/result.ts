/**
 * What every `lib/admin/*` write returns.
 *
 * The admin pages have rules the database cannot express — an admin may not remove their own
 * admin flag, a Discord id belongs to at most one player — and a thrown error would give the
 * route handler nothing to say. So a write answers with a value or with the status and the
 * sentence the envelope should carry (`lib/http.ts`).
 */
export type AdminWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string };

export function writeOk<T>(value: T): AdminWriteResult<T> {
  return { ok: true, value };
}

export function writeFailed<T>(status: 400 | 403 | 404 | 409 | 503, error: string): AdminWriteResult<T> {
  return { ok: false, status, error };
}
