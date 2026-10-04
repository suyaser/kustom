import { GROUP_LIVE_KIND_PRECEDENCE, type GroupLiveKind } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * The write side of Tonight's live signal (M19.9, `0037_group_live.sql`, decision row 2026-10-04).
 *
 * **The rule every write route follows:** collect what it changed in a {@link LiveChanges} while
 * it writes, then call {@link flushLive} as its **last** statement, after every other write of the
 * request has finished (the Discord post and its message-id write included), so the subscriber
 * that re-reads on the bump never sees half a change. One bump per group per request, and none at
 * all when the request wrote nothing: a repeated lobby post, a second companion's eog, a roll
 * whose teams were already up. Background work the response does not wait for (`after()`, the AI
 * lines) is not part of the request and does not bump.
 *
 * A failed bump is logged and swallowed, like a failed cache invalidation: the writes have landed,
 * and failing the request would make a companion retry a post that is now a no-op (and so would
 * never bump at all). The page's resubscribe and visibility re-reads cover a lost bump.
 *
 * The routes that bump, and their kind (`packages/db/src/schemas/live.ts` documents the kinds):
 *
 * | Route                                       | Kind            | Bumps when                                   |
 * |---------------------------------------------|-----------------|----------------------------------------------|
 * | `POST /api/companion/lobby`                 | lobby           | the roster, a side, a flag, a name or the status moved, or the idle sweep moved a lobby |
 * | `POST /api/companion/game` `in_progress`    | lobby           | the lobby went `in_game`, or the idle sweep moved one |
 * | `POST /api/companion/game` `eog`/backfill   | game            | the game was stored, its bans merged, rated, a name refreshed, its lobby finished or its rule cleared |
 * | `POST /api/admin/lobbies/[id]/roll`         | split           | the teams went up (`rolled`, not `already_rolled`) |
 * | `POST /api/admin/lobbies/[id]/reroll`       | split           | a new split was chosen                       |
 * | `POST /api/me/lobbies/start`                | lobby           | the `create_lobby` command was queued        |
 * | `POST /api/companion/commands/[id]/ack|nack`| lobby           | a `create_lobby` command was settled (Start a lobby's pending state ends) |
 * | `POST /api/me/role-tonight`                 | lobby           | the role landed                              |
 * | `POST /api/admin/mode`, `/mode/spin`        | mode            | the card changed (`changed`)                 |
 * | `POST /api/admin/fearless/reset`            | mode            | always (the reset writes `reset_at`)         |
 * | `POST /api/admin/ratings/reset`             | ratings         | the reset went through                       |
 * | `GET /api/cron/rebuild`, `rebuild-ratings`  | ratings         | per group whose fold wrote a row             |
 * | `GET /api/cron/sweep`                       | lobby           | per group with a lobby swept                 |
 * | `POST /api/admin/members/remove|role|unlink-discord`, `/admin/owner/transfer` | roster | the change went through |
 * | `POST /api/me/link`, `POST /api/groups/join`| roster          | the link or the membership was written       |
 */
export class LiveChanges {
  readonly #byGroup = new Map<string, GroupLiveKind>();

  /** Note that this request changed `kind` in `groupId`. The strongest kind per group wins. */
  touch(groupId: string, kind: GroupLiveKind): void {
    const previous = this.#byGroup.get(groupId);
    if (previous === undefined || rank(kind) < rank(previous)) this.#byGroup.set(groupId, kind);
  }

  /** The groups touched so far, each with the kind it will be bumped with. */
  get groups(): ReadonlyMap<string, GroupLiveKind> {
    return this.#byGroup;
  }

  get size(): number {
    return this.#byGroup.size;
  }
}

function rank(kind: GroupLiveKind): number {
  return GROUP_LIVE_KIND_PRECEDENCE.indexOf(kind);
}

/**
 * `bump_group_live(group, kind)`: one round trip, `version + 1`. Answers the new version, or
 * `null` when the bump failed (logged, never thrown; see the file comment).
 */
export async function bumpGroupLive(
  client: ServiceClient,
  groupId: string,
  kind: GroupLiveKind,
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc('bump_group_live', { p_group: groupId, p_kind: kind });
    if (error) {
      console.error(`live: bumping group ${groupId} (${kind}) failed: ${error.message}`);
      return null;
    }
    return typeof data === 'number' ? data : null;
  } catch (error) {
    console.error(`live: bumping group ${groupId} (${kind}) failed`, error);
    return null;
  }
}

/**
 * Bump every group the request touched, once each. The route's last statement. A request that
 * touched nothing makes no round trip at all.
 */
export async function flushLive(client: ServiceClient, changes: LiveChanges): Promise<void> {
  for (const [groupId, kind] of changes.groups) {
    await bumpGroupLive(client, groupId, kind);
  }
}

/**
 * Run a route body with a fresh {@link LiveChanges} and flush it when the body is done, whether
 * it answered or threw: a write that landed before a throw is still a change the page must hear.
 * Everything the body awaits happens before the flush, so the bump is the request's last write.
 */
export async function withLiveSignal<T>(
  client: ServiceClient,
  run: (live: LiveChanges) => Promise<T>,
): Promise<T> {
  const live = new LiveChanges();
  try {
    return await run(live);
  } finally {
    await flushLive(client, live);
  }
}

/** One group, one kind, when the request wrote: the common case for a route with one group. */
export async function bumpIfWrote(
  client: ServiceClient,
  groupId: string,
  kind: GroupLiveKind,
  wrote: boolean,
): Promise<void> {
  if (wrote) await bumpGroupLive(client, groupId, kind);
}
