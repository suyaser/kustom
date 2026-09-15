import { rawFactsFromUnknown } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';
import { storedStat } from './statValue';

/**
 * The backwards half of M7.7, extended by M7.14: copy vision score, damage self-mitigated and
 * damage to objectives out of `games.raw` onto `game_players` rows that were written before
 * migrations `0014` and `0015` added the three columns.
 *
 * Every game the group has ever posted already carries all three numbers — the companion stores
 * the whole block and `scrubRawEogBlock` only redacts credentials (`04-decisions.md`,
 * 2026-09-15). Without this pass the MVP / ACE bonus would be a rule that only applies to games
 * played after the migration, and the next `rebuild-ratings` would fold one history under two
 * models.
 *
 * The rules, and they are the same three every idempotent pass here has:
 *
 * - **It only ever fills a null.** A stored number is never overwritten, so this is safe to run
 *   twice, safe to run while games land, and cannot disagree with what ingest wrote.
 * - **A blob with no number leaves a null.** Never 0 — the performance score skips a game it
 *   cannot score rather than calling a tank's mitigation or a jungler's objective damage
 *   nothing (see `0014_vision_and_mitigation.sql`, `0015_damage_to_objectives.sql`).
 * - **It reads `games.raw` through `rawFactsFromUnknown`**, the same reader ingest and `/fun`
 *   use, and gates every number through the same `storedStat`, so a row filled here is the row
 *   ingest would have written and one nonsense number in one old blob cannot throw out of the
 *   middle of a production run. Both shapes (live end-of-game block and backfilled match
 *   detail) and both key spellings come free with the reader — which is what fills objective
 *   damage on a backfilled game, where the client only ever wrote the camelCase spelling.
 *
 * The count to read afterwards is `rowsStillMissing`: rows that **still** have a null in any of
 * the three columns, including rows this pass part-filled. That is the number that says whether
 * the history can be trusted, and part of an answer is not an answer to a bonus that needs
 * every input. Beside it the report carries a **per-column** still-missing count, so M7.14's
 * own question — is `damage_to_objectives` zero rows short? — can be read on its own without
 * inferring it from a combined number M7.7's two columns also contribute to.
 *
 * The command is `pnpm --filter web copy-raw-stats` (`scripts/copy-raw-stats.ts`); everything
 * except argument parsing and printing lives here, which is what the integration test drives.
 */

/** How many games' ids are looked at per round trip. Raw blobs are big; keep it modest. */
const GAME_PAGE = 200;
const RAW_CHUNK = 25;
const UPDATE_CONCURRENCY = 8;

export interface CopyRawStatsOptions {
  /**
   * Report what would change and write nothing. **Defaults to true**: a caller that means to
   * rewrite history says so. The command's default is the other way round, `--dry-run` opt-in.
   */
  dryRun?: boolean;
  /** Only this game (by `games.id`). Used by the tests; handy for one stubborn row. */
  gameId?: string | null;
}

export interface CopyRawStatsReport {
  /** Games with at least one row missing at least one of the three numbers. */
  gamesWithGaps: number;
  /** Of those, games whose `raw` answered for at least one row. */
  gamesFilled: number;
  /** Rows that were missing at least one of the three numbers before the pass. */
  rowsWithGaps: number;
  /** Rows written (or that would be written, under `--dry-run`). */
  rowsFilled: number;
  visionFilled: number;
  mitigationFilled: number;
  objectivesFilled: number;
  /**
   * Rows that **still have at least one null** when the pass is done — including a row the
   * pass did fill on its other columns. This is the number that answers "can the performance
   * score trust the history yet?", so it counts a part-answered row as unanswered: the bonus
   * needs every input.
   */
  rowsStillMissing: number;
  /**
   * Of those, how many are missing which column. A row short of two counts in each, so these
   * three do not sum to `rowsStillMissing` and are not meant to: each one is read on its own,
   * which is how M7.14 asks whether `damage_to_objectives` in particular is zero rows short.
   */
  visionStillMissing: number;
  mitigationStillMissing: number;
  objectivesStillMissing: number;
  dryRun: boolean;
}

interface GapRow {
  game_id: string;
  player_id: string;
  vision_score: number | null;
  damage_self_mitigated: number | null;
  damage_to_objectives: number | null;
  puuid: string;
}

/** The columns this pass is allowed to write, and only where they were null. */
interface Patch {
  vision_score?: number;
  damage_self_mitigated?: number;
  damage_to_objectives?: number;
}

export async function copyRawStats(
  client: ServiceClient,
  options: CopyRawStatsOptions = {},
): Promise<CopyRawStatsReport> {
  const dryRun = options.dryRun ?? true;
  const report: CopyRawStatsReport = {
    gamesWithGaps: 0,
    gamesFilled: 0,
    rowsWithGaps: 0,
    rowsFilled: 0,
    visionFilled: 0,
    mitigationFilled: 0,
    objectivesFilled: 0,
    rowsStillMissing: 0,
    visionStillMissing: 0,
    mitigationStillMissing: 0,
    objectivesStillMissing: 0,
    dryRun,
  };

  /** What this row looks like after the patch: the honest input to the still-missing counts. */
  const countLeftovers = (row: GapRow, patch: Patch | null): void => {
    const vision = row.vision_score ?? patch?.vision_score ?? null;
    const mitigation = row.damage_self_mitigated ?? patch?.damage_self_mitigated ?? null;
    const objectives = row.damage_to_objectives ?? patch?.damage_to_objectives ?? null;
    if (vision === null) report.visionStillMissing += 1;
    if (mitigation === null) report.mitigationStillMissing += 1;
    if (objectives === null) report.objectivesStillMissing += 1;
    if (vision === null || mitigation === null || objectives === null) {
      report.rowsStillMissing += 1;
    }
  };

  for await (const gameIds of gameIdPages(client, options.gameId ?? null)) {
    for (let index = 0; index < gameIds.length; index += RAW_CHUNK) {
      const chunk = gameIds.slice(index, index + RAW_CHUNK);
      const gaps = await selectGaps(client, chunk);
      if (gaps.size === 0) continue;

      report.gamesWithGaps += gaps.size;
      for (const rows of gaps.values()) report.rowsWithGaps += rows.length;

      const raws = await selectRaw(client, [...gaps.keys()]);
      for (const [gameId, rows] of gaps) {
        const raw = raws.get(gameId);
        if (raw === undefined) {
          for (const row of rows) countLeftovers(row, null);
          continue;
        }
        const facts = rawFactsFromUnknown(raw).byPuuid;
        const patches = rows.map((row) => ({ row, patch: patchFor(row, facts[row.puuid]) }));
        for (const entry of patches) countLeftovers(entry.row, entry.patch);

        const writable = patches.filter((entry) => entry.patch !== null);
        if (writable.length === 0) continue;

        report.gamesFilled += 1;
        for (const entry of writable) {
          report.rowsFilled += 1;
          if (entry.patch?.vision_score !== undefined) report.visionFilled += 1;
          if (entry.patch?.damage_self_mitigated !== undefined) report.mitigationFilled += 1;
          if (entry.patch?.damage_to_objectives !== undefined) report.objectivesFilled += 1;
        }
        if (!dryRun) await writePatches(client, writable);
      }
    }
  }

  return report;
}

export function formatCopyRawStatsReport(report: CopyRawStatsReport): string {
  const line = (label: string, value: number, note = ''): string =>
    `  ${label.padEnd(24)}${value.toString().padStart(6)}${note === '' ? '' : `  ${note}`}`;

  return [
    report.dryRun ? 'copy-raw-stats (dry run — nothing written)' : 'copy-raw-stats',
    line('games with a gap', report.gamesWithGaps),
    line('games the blob filled', report.gamesFilled),
    line('rows with a gap', report.rowsWithGaps),
    line(report.dryRun ? 'rows that would fill' : 'rows filled', report.rowsFilled),
    line('  vision score', report.visionFilled),
    line('  damage mitigated', report.mitigationFilled),
    line('  damage to objectives', report.objectivesFilled),
    line('rows still short', report.rowsStillMissing, 'at least one column still null'),
    line('  vision score', report.visionStillMissing),
    line('  damage mitigated', report.mitigationStillMissing),
    line('  damage to objectives', report.objectivesStillMissing),
  ].join('\n');
}

/**
 * Only the columns we may write, and only when the row has a hole the blob can fill with a
 * number we can honestly store. `null` means "nothing to do for this row".
 *
 * Every value goes through `storedStat` (M7.7 review): one negative or out-of-int4 number in
 * one old blob would otherwise throw out of the whole pass — half the history filled, the rest
 * untouched, and the operator staring at a stack trace instead of a report. A row the blob
 * answers with nonsense simply stays null and is counted as still missing, which is the truth.
 */
function patchFor(
  row: GapRow,
  facts:
    | {
        visionScore: number | null;
        damageSelfMitigated: number | null;
        damageToObjectives: number | null;
      }
    | undefined,
): Patch | null {
  if (facts === undefined) return null;
  const patch: Patch = {};
  const vision = storedStat(facts.visionScore);
  const mitigation = storedStat(facts.damageSelfMitigated);
  const objectives = storedStat(facts.damageToObjectives);
  if (row.vision_score === null && vision !== null) patch.vision_score = vision;
  if (row.damage_self_mitigated === null && mitigation !== null) {
    patch.damage_self_mitigated = mitigation;
  }
  if (row.damage_to_objectives === null && objectives !== null) {
    patch.damage_to_objectives = objectives;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

async function writePatches(
  client: ServiceClient,
  entries: readonly { row: GapRow; patch: Patch | null }[],
): Promise<void> {
  for (let index = 0; index < entries.length; index += UPDATE_CONCURRENCY) {
    const slice = entries.slice(index, index + UPDATE_CONCURRENCY);
    await Promise.all(
      slice.map(async (entry) => {
        if (entry.patch === null) return;
        const { error } = await client
          .from('game_players')
          .update(entry.patch)
          .eq('game_id', entry.row.game_id)
          .eq('player_id', entry.row.player_id);
        if (error) {
          throw new Error(
            `copyRawStats: update ${entry.row.game_id}/${entry.row.player_id} failed: ${error.message}`,
          );
        }
      }),
    );
  }
}

/** Every game id with a stored blob, oldest first, a page at a time. */
async function* gameIdPages(client: ServiceClient, gameId: string | null): AsyncGenerator<string[]> {
  if (gameId !== null) {
    yield [gameId];
    return;
  }
  for (let page = 0; ; page += 1) {
    const { data, error } = await client
      .from('games')
      .select('id')
      .not('raw', 'is', null)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page * GAME_PAGE, page * GAME_PAGE + GAME_PAGE - 1);
    if (error) throw new Error(`copyRawStats: games page failed: ${error.message}`);
    if (data === null || data.length === 0) return;
    yield data.map((row) => row.id);
    if (data.length < GAME_PAGE) return;
  }
}

/** The rows of these games missing any of the three, grouped by game, with their PUUIDs. */
async function selectGaps(client: ServiceClient, gameIds: readonly string[]): Promise<Map<string, GapRow[]>> {
  const { data, error } = await client
    .from('game_players')
    .select(
      'game_id, player_id, vision_score, damage_self_mitigated, damage_to_objectives, players!inner(puuid)',
    )
    .in('game_id', gameIds)
    .or('vision_score.is.null,damage_self_mitigated.is.null,damage_to_objectives.is.null');
  if (error) throw new Error(`copyRawStats: game_players select failed: ${error.message}`);

  const byGame = new Map<string, GapRow[]>();
  for (const row of data ?? []) {
    const puuid = row.players?.puuid;
    if (typeof puuid !== 'string' || puuid === '') continue;
    const rows = byGame.get(row.game_id) ?? [];
    rows.push({
      game_id: row.game_id,
      player_id: row.player_id,
      vision_score: row.vision_score,
      damage_self_mitigated: row.damage_self_mitigated,
      damage_to_objectives: row.damage_to_objectives,
      puuid,
    });
    byGame.set(row.game_id, rows);
  }
  return byGame;
}

async function selectRaw(client: ServiceClient, gameIds: readonly string[]): Promise<Map<string, unknown>> {
  const { data, error } = await client.from('games').select('id, raw').in('id', gameIds);
  if (error) throw new Error(`copyRawStats: games raw select failed: ${error.message}`);
  const raws = new Map<string, unknown>();
  for (const row of data ?? []) {
    if (row.raw === null) continue;
    raws.set(row.id, row.raw);
  }
  return raws;
}
