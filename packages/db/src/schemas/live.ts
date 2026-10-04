import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * Tonight's live signal (M19.9, `0037_group_live.sql`; decision row 2026-10-04).
 *
 * One `group_live` row per group: a counter, a word and a time, published to Realtime under RLS
 * and readable by anyone. Every write route that changes what a group's Tonight shows calls
 * `bump_group_live(group, kind)` as its **last** statement, once per request, and not at all when it
 * wrote nothing (`apps/web/lib/live/bump.ts`). A page subscribes with the filter
 * `group_id=eq.<id>` and re-reads when `version` moves past the one it was rendered at.
 *
 * This file is the contract for the subscriber (M19.10): parse every Realtime payload's `new`
 * with {@link groupLiveRowSchema} and drop what fails.
 */

/**
 * The kinds, the same list as the migration's `group_live_kind` check. A hint for the page about
 * the **last** change; when one request changes several things it names the strongest
 * ({@link GROUP_LIVE_KIND_PRECEDENCE}).
 *
 * - `lobby`: a lobby roster, side, spectator flag, name or status moved (lobby post, the idle
 *   sweep, `in_progress`), a player's role for tonight, or Start a lobby queued a command.
 * - `split`: Roll or Reroll put teams up.
 * - `game`: an end-of-game block (or a backfilled game) was stored, rated, or closed its lobby.
 * - `mode`: the Mode card moved (mode, Spin, Rated, fearless reset). The name-free card can be
 *   patched from the `group_modes` / `fearless_state` rows (M19.13); every other kind needs a
 *   server render.
 * - `ratings`: ratings moved without a new game (Reset ratings, the rebuild cron, `rebuild-ratings`).
 * - `roster`: group membership or a player link moved (members, owner transfer, join, link). Also
 *   the kind of a row at version 0 (the group's birth).
 */
export const GROUP_LIVE_KINDS = ['lobby', 'split', 'game', 'mode', 'ratings', 'roster'] as const;

export const groupLiveKindSchema = z.enum(GROUP_LIVE_KINDS);
export type GroupLiveKind = z.infer<typeof groupLiveKindSchema>;

/**
 * Strongest first. A request that touched several kinds for one group bumps once, with the first
 * of them in this order: an eog that stores a game, rates it, finishes its lobby and clears the
 * mode rule is one `game` bump. `mode` is last because it is the one kind a page may answer
 * without a server render.
 */
export const GROUP_LIVE_KIND_PRECEDENCE: readonly GroupLiveKind[] = [
  'game',
  'ratings',
  'split',
  'lobby',
  'roster',
  'mode',
];

/**
 * A `group_live` row, as PostgREST returns it and as a Realtime `postgres_changes` payload carries
 * it in `new` (INSERT, UPDATE). Exactly four columns: `.strict()`, so a column added to the table
 * without this schema (and the security review that goes with it) fails the parse.
 *
 * `version` is a Postgres `bigint` that both PostgREST and Realtime send as a JSON number; it will
 * not pass 2^53 at one bump per write. `changed_at` is kept as the string the wire carried.
 */
export const groupLiveRowSchema = z
  .object({
    group_id: groupIdSchema,
    version: z.number().int().nonnegative(),
    kind: groupLiveKindSchema,
    changed_at: z.string().min(1),
  })
  .strict();
export type GroupLiveRow = z.infer<typeof groupLiveRowSchema>;

/** The Realtime filter a page subscribes with: its own group's row and nothing else. */
export function groupLiveFilter(groupId: string): string {
  return `group_id=eq.${groupId}`;
}
