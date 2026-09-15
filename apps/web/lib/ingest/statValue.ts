/**
 * One gate for a number that came out of `games.raw` and is about to become an `integer`
 * column (M7.7).
 *
 * The blob is the League client's, replayed from months-old storage, and nothing upstream
 * constrains it: `scrubValue` only redacts credentials and both raw schemas are
 * `z.looseObject`, so an unlisted stat key reaches the database with whatever the client (or a
 * corrupted row) put there. Two shapes of nonsense actually break a write:
 *
 * - **A negative**, which the `check (vision_score >= 0)` on `0014` rejects. The insert 500s
 *   *after* the `games` row is stored, so the companion retries for ever into the same 500 and
 *   the game is stuck: stored, unratable, unfixable without a hand edit of the database.
 * - **A value past int4**, which the check cannot see at all and which Postgres rejects as an
 *   overflow — the identical loop, from a value the constraint was never able to catch.
 *
 * So the rule is CLAUDE.md's rule: log and drop malformed data, never crash on a bad payload.
 * A number we cannot store honestly becomes `null`, which already has a meaning M7.8 respects
 * — "this game never stored it" — and the game still lands and still rates. It is never
 * clamped to `0` or to `INT32_MAX`: a made-up number would be scored, and a scored made-up
 * number is worse than an absent one.
 *
 * Do not lean on the database check instead of this. By the time Postgres says no, the request
 * has already failed.
 */

/** Postgres `integer` is int4. */
export const INT32_MAX = 2_147_483_647;

/**
 * The value to store for a non-negative integer stat, or `null` when the blob's number is not
 * one we can keep: not finite, negative, or past what an `integer` column holds. A float is
 * truncated, which is what every other stat read does (`rawFacts.ts`).
 */
export function storedStat(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  if (whole < 0 || whole > INT32_MAX) return null;
  return whole;
}
