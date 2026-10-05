/**
 * The command queue (M4.1, server half). `docs/02-milestones.md` calls this module
 * `apps/web/lib/commands.ts`; it is a directory because the queue's rules, the verification
 * gate, the `onAcked` seam and the `balanced` writer are four different concerns and
 * `@/lib/commands` still resolves here.
 *
 * - `gate.ts`      which kinds may be queued at all (the reference rows, as booleans)
 * - `queue.ts`     write, sweep, hand out, ack, nack, supersede
 * - `switchSide.ts` who is on the wrong side, and what the `balanced` transition writes
 * - `hooks.ts`     the `onAcked` seam (no listener since M22.11 removed the invite fan-out)
 * - `register.ts`  the one import with a side effect: it makes the `balanced` hook listen
 */
export * from './gate';
export * from './hooks';
export * from './queue';
export * from './switchSide';
