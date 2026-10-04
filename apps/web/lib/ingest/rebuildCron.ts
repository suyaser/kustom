import type { RebuildCronGroup } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type FoldGatePlayer, gateRatedGame } from './fold';
import { countsForRatings, readRatingsSince } from './ratingsEpoch';
import { type RebuildResult, rebuildRatings } from './rebuild';

/**
 * The daily rebuild cron (M14.63; decision 2026-10-04): a backfilled game is stored unrated
 * (M5.1), and this is what rates it, the morning after it was picked up, with nobody running
 * `rebuild-ratings`.
 *
 * It does no rating of its own. For every group with a backfilled game the fold would rate but
 * has not, it runs {@link rebuildRatings} for that group -- the same per-group fold the command
 * runs, with its guards unchanged: a live lobby or a game in the last fifteen minutes refuses
 * (`blocked`, tomorrow's run tries again), and the fence ("games landed mid-run", the command's
 * exit 2) is answered the way the command's usage says, by running it again, up to
 * {@link FENCE_RERUNS} more times.
 *
 * **Which groups.** A group is folded only when it has a game that is `source = 'backfill'`, has
 * a `game_players` row with no `mu_after`, started at or after the group's ratings epoch, and
 * passes the fold's own gate ({@link gateRatedGame}: ten players five a side, over 300 seconds,
 * the Rift, rated). The gate is the fold's, so an ARAM or a short-handed backfill -- which the
 * fold walks past and leaves null forever -- never makes a group fold every morning.
 *
 * **Time.** One serverless call (`maxDuration` on the route). A fold is not interruptible
 * halfway through its writes, so the budget is checked only before a fold starts: once
 * `startBudgetMs` has gone, the remaining groups are `deferred` to tomorrow.
 */

/** Re-runs after the first when the fence trips (the command's exit 2). */
export const FENCE_RERUNS = 2;

/** PostgREST's `max_rows`. */
const PAGE_SIZE = 1000;

/** Game ids per `in` filter in the second read. */
const ID_CHUNK = 100;

/** A group with backfilled games waiting, and how many. */
export interface PendingGroup {
  groupId: string;
  pendingGames: number;
}

interface Candidate {
  id: string;
  groupId: string;
  startedAt: string;
  durationS: number;
  gameMode: unknown;
}

/**
 * Every group with at least one backfilled game the fold would rate and has not, oldest group
 * first (the order `listGroups` and `rebuildAllGroups` use).
 */
export async function findGroupsWithUnratedBackfill(client: ServiceClient): Promise<PendingGroup[]> {
  // 1. Backfilled, rated-eligible on the columns alone, with at least one row the fold has not
  //    written (the inner join keeps only games with a null `mu_after` row).
  const candidates: Candidate[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('games')
      .select('id, group_id, started_at, duration_s, gameMode:game_mode, game_players!inner(player_id)')
      .eq('source', 'backfill')
      .eq('rated', true)
      .not('winning_side', 'is', null)
      .gt('duration_s', 300)
      .is('game_players.mu_after', null)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`rebuild cron: backfill select failed: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      candidates.push({
        id: row.id,
        groupId: row.group_id,
        startedAt: row.started_at,
        durationS: row.duration_s,
        gameMode: row.gameMode,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  if (candidates.length === 0) return [];

  // 2. The fold's own gate, on every row of each candidate.
  const players = new Map<string, FoldGatePlayer[]>();
  for (let index = 0; index < candidates.length; index += ID_CHUNK) {
    const ids = candidates.slice(index, index + ID_CHUNK).map((candidate) => candidate.id);
    const { data, error } = await client
      .from('game_players')
      .select('game_id, side, players!inner(puuid)')
      .in('game_id', ids);
    if (error) throw new Error(`rebuild cron: players select failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.side !== 100 && row.side !== 200) continue;
      const list = players.get(row.game_id) ?? [];
      list.push({ puuid: row.players.puuid, side: row.side });
      players.set(row.game_id, list);
    }
  }

  // 3. The group's epoch (M14.18): a backfill older than the last reset is never folded.
  const epochs = new Map<string, string | null>();
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const gate = gateRatedGame(
      players.get(candidate.id) ?? [],
      candidate.durationS,
      { gameMode: candidate.gameMode },
      true,
    );
    if (!gate.ok) continue;
    if (!epochs.has(candidate.groupId)) {
      epochs.set(candidate.groupId, await readRatingsSince(client, candidate.groupId));
    }
    if (!countsForRatings(candidate.startedAt, epochs.get(candidate.groupId) ?? null)) continue;
    counts.set(candidate.groupId, (counts.get(candidate.groupId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const { data: groups, error } = await client
    .from('groups')
    .select('id, created_at')
    .in('id', [...counts.keys()])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`rebuild cron: groups select failed: ${error.message}`);
  return (groups ?? []).map((group) => ({ groupId: group.id, pendingGames: counts.get(group.id) ?? 0 }));
}

export interface RebuildCronOptions {
  /** Milliseconds since the run started; checked before each fold starts. */
  elapsedMs(): number;
  /** No fold starts after this many milliseconds. */
  startBudgetMs: number;
  /** The per-group fold. Tests only; the route passes nothing and gets {@link rebuildRatings}. */
  rebuild?: (client: ServiceClient, groupId: string) => Promise<RebuildResult>;
  /** Which groups are waiting. Tests only; defaults to {@link findGroupsWithUnratedBackfill}. */
  findPending?: (client: ServiceClient) => Promise<PendingGroup[]>;
}

/** One line per pending group, in the order they were folded. */
export async function runRebuildCron(
  client: ServiceClient,
  options: RebuildCronOptions,
): Promise<RebuildCronGroup[]> {
  const rebuild =
    options.rebuild ?? ((db: ServiceClient, groupId: string) => rebuildRatings(db, { groupId }));
  const pending = await (options.findPending ?? findGroupsWithUnratedBackfill)(client);
  const lines: RebuildCronGroup[] = [];

  for (const { groupId, pendingGames } of pending) {
    const line = (status: RebuildCronGroup['status'], ratedGames: number | null, reason: string | null) =>
      lines.push({ groupId, status, ratedGames, pendingGames, reason });

    if (options.elapsedMs() >= options.startBudgetMs) {
      line('deferred', null, 'out of time before this group; tomorrow’s run folds it');
      continue;
    }

    try {
      let result = await rebuild(client, groupId);
      // The fence is the command's exit 2: idempotent, so running it again is the fix.
      for (let rerun = 0; rerun < FENCE_RERUNS && !result.ok && result.code === 'fence'; rerun += 1) {
        if (options.elapsedMs() >= options.startBudgetMs) break;
        result = await rebuild(client, groupId);
      }

      if (result.ok) {
        // A data problem (the command's exit 1) does not undo the fold: it wrote. Named in the
        // log and on the line, like the command prints it.
        const problems = result.report.problems;
        if (problems.length > 0) console.error(`cron rebuild: group ${groupId} problems`, problems);
        line('rated', result.report.rated, problems.length > 0 ? problems.join('; ') : null);
      } else if (result.code === 'guard') {
        line('blocked', null, result.message);
      } else {
        line('fenced', null, result.message);
      }
    } catch (error) {
      console.error(`cron rebuild: group ${groupId} failed`, error);
      line('failed', null, 'internal error');
    }
  }
  return lines;
}
