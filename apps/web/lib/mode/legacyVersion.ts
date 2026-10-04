/**
 * @deprecated M20.8: `group_modes.updated_at` as the number the pre-M20.8 card client orders the
 * card by (it used to be `group_modes.version`, dropped by `0047`). No write reads it. Client-safe:
 * no imports.
 */
export function legacyVersion(updatedAt: string | null): number {
  const ms = updatedAt === null ? Number.NaN : Date.parse(updatedAt);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}
