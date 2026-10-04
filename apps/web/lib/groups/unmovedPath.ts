import type { GroupDestination } from '../nav';

/**
 * Where an unknown `/g/<slug>/...` path should go for the original group while a page has not moved
 * under `/g/<slug>` yet (M14.7; used by `app/(group)/g/[slug]/[...rest]/page.tsx`).
 */

const SINGLE: Readonly<Record<string, GroupDestination>> = {};

/**
 * One path segment, percent-decoded, or `null` when it is not valid percent-encoding. Next hands
 * catch-all segments over **undecoded** (`/p/100%25` arrives as `100%25`), so the decode is ours, and
 * a malformed sequence is a 404, never a thrown `URIError` (a 500).
 */
export function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The unmoved destination `rest` names, or `null` for a 404. The board and the player page moved
 * under the group in M14.15, so a `/g/<slug>/p/<puuid>` never reaches here any more.
 */
export function unmovedDestination(rest: readonly string[]): GroupDestination | null {
  const [first] = rest;
  if (rest.length === 1 && first !== undefined)
    return Object.hasOwn(SINGLE, first) ? (SINGLE[first] ?? null) : null;
  return null;
}
