/**
 * One id list, cut into lists short enough to be a URL.
 *
 * **A PostgREST filter is a URL**, and a long enough `in` list is answered `414 URI too long`
 * by the gateway before Postgres sees it — which is not theoretical: reading a busy week's
 * board against a database with a few hundred players hit it on the first try (2026-09-10).
 * Ten rows a game also means ninety games is nine hundred scoreboard rows, which is the other
 * reason this number is small.
 *
 * It lived in `lib/board/load.ts` until M5.21, when the board started reading its streak from
 * `lib/stats/load.ts` — which was already importing this function *out* of the board. One
 * module both loaders import is the whole reason this file exists; there is no cycle to reason
 * about and no second definition of the chunk size.
 */

/** How many ids go in one `in (…)` list. */
const ID_CHUNK = 90;

/**
 * The unique ids, in lists short enough to be a URL. Empty in, nothing out — a caller with no
 * ids makes **no request at all**, which is what `[]` means and `undefined` does not.
 *
 * Exported for its unit test: it is two lines of arithmetic that only fails on a database
 * bigger than any test fixture, which is exactly the kind of code that ships broken.
 */
export function inChunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += ID_CHUNK) {
    chunks.push(unique.slice(start, start + ID_CHUNK));
  }
  return chunks;
}

/** How many chunk reads run at once: enough for any real history, polite to the gateway. */
const CHUNK_CONCURRENCY = 6;

/**
 * Runs `read` over every {@link inChunks} chunk **in parallel** (at most six at a time) and returns
 * the results in chunk order (app-perf, 2026-10-04). A `for ... await` over chunks is one round
 * trip per chunk, one after the other: a 1,000-game history is a dozen waves where this is two.
 * Empty in, no request.
 */
export async function mapChunks<T>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<T>,
): Promise<T[]> {
  return inParallel(inChunks(ids), read);
}

/**
 * `work` over every item, at most `limit` (default six) at a time, answers in item order (so rows
 * come back in the order a one-after-another loop would have appended them). The first failure
 * rejects, as such a loop's first throw did. {@link mapChunks} is this over {@link inChunks}.
 */
export async function inParallel<T, R>(
  items: readonly T[],
  work: (item: T) => PromiseLike<R>,
  limit: number = CHUNK_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
