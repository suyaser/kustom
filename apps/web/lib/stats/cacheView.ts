import type { FunBloodGroup, FunFactsView, FunSection } from './types';

/**
 * What the Stats cache stores (`lib/stats/cached.ts`): the segment's view **as the page prints it**,
 * not the fold's working set (database performance plan, finding 2).
 *
 * The one part of a segment that grows with every game and is never printed whole is the museums'
 * per-game openings: the First Blood museums and the multi-kill halls keep every game behind every
 * holder's count, about 16 MB of a 2,000-game group's 17.5 MB view, which pushed the entry past Next's
 * 2 MB limit so it was never cached. A museum row (`Museum` in `app/_stats/RecordsSegment.tsx`, the
 * only renderer of these lists) prints the holder, their count label, and the newest opening; it reads
 * `openings[0]` and whether there is exactly one. Two openings keep both answers, so the trimmed view
 * renders byte for byte the same page (`cacheView.test.tsx`).
 *
 * Every other list in a segment is already bounded by the roster (one row per person or pair) or by
 * the window's ranked rows, and is kept whole.
 */

/** `openings[0]` and "exactly one?" are all the museum row reads. */
export const MUSEUM_OPENINGS_KEPT = 2;

function trimMuseum(section: FunSection<FunBloodGroup>): FunSection<FunBloodGroup> {
  if (!Array.isArray(section?.rows)) return section;
  return {
    ...section,
    rows: section.rows.map((group) =>
      Array.isArray(group.openings) && group.openings.length > MUSEUM_OPENINGS_KEPT
        ? { ...group, openings: group.openings.slice(0, MUSEUM_OPENINGS_KEPT) }
        : group,
    ),
  };
}

/** `/fun`'s view with the museums' openings cut to what a row prints. Everything else as it was. */
export function funForRender<F extends Partial<Pick<FunFactsView, 'museum' | 'donated' | 'halls'>>>(
  fun: F,
): F {
  return {
    ...fun,
    ...(fun.museum === undefined ? {} : { museum: trimMuseum(fun.museum) }),
    ...(fun.donated === undefined ? {} : { donated: trimMuseum(fun.donated) }),
    ...(Array.isArray(fun.halls) ? { halls: fun.halls.map(trimMuseum) } : {}),
  };
}
