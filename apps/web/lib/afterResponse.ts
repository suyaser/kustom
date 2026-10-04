import { after } from 'next/server';

/**
 * Work that runs once the response has gone out (M21.6's `Game on` post): Next's `after()`, which
 * on Vercel keeps the function alive for it (bounded by the route's `maxDuration`). A task never
 * delays the answer or the route's `group_live` flush, and its failure never reaches the caller.
 *
 * Outside a request scope (a script, a test calling the route handler directly) `after` throws;
 * the task then runs detached. Detached tasks are tracked so an integration test can wait for
 * them with {@link settleDetached} instead of sleeping.
 *
 * `lib/ai/afterIngest.ts` has its own copy of the same scheduler for the AI line (M16.4); it was
 * left alone to keep this change out of the AI module.
 */

export type Scheduler = (task: () => Promise<unknown>) => void;

const detached = new Set<Promise<unknown>>();

export const afterResponse: Scheduler = (task) => {
  const run = () =>
    task().catch((error: unknown) => {
      console.error('after-response task failed', error instanceof Error ? error.message : 'unknown error');
    });
  try {
    after(run);
  } catch {
    const pending = run();
    detached.add(pending);
    void pending.finally(() => detached.delete(pending));
  }
};

/** Tests only: resolves once every detached task (including ones they started) has finished. */
export async function settleDetached(): Promise<void> {
  while (detached.size > 0) await Promise.all([...detached]);
}
