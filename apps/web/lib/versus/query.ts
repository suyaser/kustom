/**
 * `?a=` and `?b=` on `/1v1`. Absent or empty is "nobody picked". A repeated parameter is a
 * 404, the same rule `?window=` follows: two values is not one person.
 */

export function parsePlayerParam(value: string | string[] | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return null;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > 128) return null;
  return trimmed;
}
