import { unstable_cache } from 'next/cache';

/** A cache key part: what `unstable_cache` folds into its key with `JSON.stringify`. */
type KeyPart = string | number | boolean | null;

/**
 * A read kept in Next's server cache across requests (performance plan, phase 2), tagged per call
 * so a writer can drop one group's copy (`lib/cache/tags.ts`).
 *
 * - **Plain JSON in, plain JSON out.** The arguments are the key; the answer is stored as JSON, so
 *   it may hold arrays and records but no `Map`, `Set` or `Date`. Build those outside.
 * - **A thrown read is never cached**: the error reaches the caller, who decides its fallback, and
 *   the next request reads again.
 * - **Nothing per viewer.** Never pass a session, a cookie or anything derived from one; the
 *   answer is shared by everyone who asks with the same arguments.
 * - `name` is part of the key: bump its `-vN` when the answer's shape changes, because the data
 *   cache outlives a deployment.
 * - Outside a Next request (a script, a vitest file calling a loader) there is no cache: the read
 *   just runs.
 *
 * `unstable_cache` is the legacy API; it works in Next 16 without `cacheComponents`. Moving to
 * `'use cache'` + `cacheTag` is a later step (the plan's 5.4).
 */
export function cachedRead<Args extends KeyPart[], R>(
  name: string,
  read: (...args: Args) => Promise<R>,
  options: { tags: (...args: Args) => string[]; revalidate: number },
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    const cached = unstable_cache(read, [name], {
      tags: options.tags(...args),
      revalidate: options.revalidate,
    });
    try {
      return await cached(...args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invariant: incrementalCache missing')) {
        return read(...args);
      }
      throw error;
    }
  };
}
