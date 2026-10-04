import 'server-only';
import { discordRecapText } from '../discord/aiEdit';
import type { WeekPostSource } from '../discord/post';
import type { ClosedWindow } from '../night';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import { BEST_OFF_ROLE } from '../stats/copy';
import type { StatsView } from '../stats/types';
import { getServiceClient, type ServiceClient } from '../supabase';
import { afterResponse, type Scheduler } from './afterIngest';
import type { WeekFactsInput } from './facts';
import {
  type GenerateDeps,
  type GenerateOutcome,
  generateDepsFor,
  generateWeekLine,
  retryStoredLine,
} from './generate';
import { loadShownLine } from './store';
import { readLineNames, weekStartDay } from './storylineRead';

// The read side lives in `storylineRead.ts` (no generator, no model client); re-exported here for
// the callers that already write lines.
export {
  type BoardStoryline,
  loadBoardStoryline,
  loadBoardStorylineOrNone,
  readLineNames,
  weekStartDay,
} from './storylineRead';

/**
 * The weekly storyline (M16.5; brief m16.1 1.2, 1.3, 4.1, 4.5; decision M16.1 D8). One paragraph
 * per group-week, written on the Sunday job from **the Sunday post's own numbers**, stored once
 * (`ai_lines`, kind `week`, subject the week's Sunday) and never rewritten: a rating rebuild, a
 * second cron call or a page view never calls the model again.
 *
 * - **The post** (`GET /api/cron/window` -> `postClosedWindow`'s `storyline` hook): for a group
 *   whose AI gate is open, the facts come from the board and stats the post just read, the line is
 *   generated (Sonnet, at most two attempts, `generateWeekLine`), then read back through
 *   `loadShownLine` so a hidden line, an opted-out player or a group switched off never reaches
 *   Discord. A generation that has not finished within {@link STORYLINE_POST_BUDGET_MS} does not
 *   hold the post: the post goes without it and the generation finishes in `after()` for the
 *   board.
 * - **The board's Last week** ({@link loadBoardStoryline}): the same stored line, read only.
 *
 * Everything here fails closed and silently (brief 4.6): any error is no storyline.
 */

/** How long the Sunday post waits for the storyline before going out without it. */
export const STORYLINE_POST_BUDGET_MS = 30_000;

/* ---------------------------------------------------------------------------------------------
 * Facts from the post (pure)
 * ------------------------------------------------------------------------------------------- */

/**
 * The week's fact input, from what the Sunday post read. Pure, and it computes nothing the post
 * does not: the board's order, games and wins and net points (M14.57), the stats' longest win
 * streak, and the awards' winners. **`Cursed duo` is left out on purpose**: it names a pair for
 * losing together, and the storyline only teases up (brief 4.3, D5). Players are keyed by
 * `players.id` (`idOf`, puuid -> id); a row with no id is left out. Null when nobody is left.
 */
export function weekFactsFromPost(input: {
  weekStart: string;
  games: number;
  rows: WeekPostSource['rows'];
  stats: StatsView | null;
  idOf: ReadonlyMap<string, string>;
}): WeekFactsInput | null {
  const { idOf } = input;
  const board: WeekFactsInput['board'] = [];
  const climbs: WeekFactsInput['climbs'] = [];
  for (const row of input.rows) {
    const playerId = idOf.get(row.puuid);
    if (playerId === undefined) continue;
    board.push({ playerId, games: row.games, wins: row.wins });
    if (row.points !== null && row.points > 0) climbs.push({ playerId, climb: row.points });
  }
  if (board.length === 0) return null;

  const streaks: WeekFactsInput['streaks'] = [];
  const longest = input.stats?.longestWin ?? null;
  if (longest !== null) {
    for (const holder of longest.holders) {
      const playerId = idOf.get(holder.puuid);
      if (playerId !== undefined) streaks.push({ playerId, wins: longest.length });
    }
  }

  const awards: WeekFactsInput['awards'] = [];
  const view = input.stats?.awards ?? null;
  if (view !== null && view.kind === 'closed') {
    for (const block of view.blocks) {
      if (!block.won || block.label !== BEST_OFF_ROLE) continue;
      for (const line of block.lines) {
        for (const puuid of line.key.split('|')) {
          const playerId = idOf.get(puuid);
          if (playerId !== undefined) awards.push({ label: block.label, playerId, value: null, unit: null });
        }
      }
    }
  }

  return { weekStart: input.weekStart, ratedGames: input.games, board, climbs, streaks, awards };
}

/* ---------------------------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------------------------- */

/** puuid -> `players.id` for the given puuids. Throws on a database error. */
export async function readPlayerIds(
  service: ServiceClient,
  puuids: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const unique = [...new Set(puuids)];
  if (unique.length === 0) return ids;
  const { data, error } = await service.from('players').select('id, puuid').in('puuid', unique);
  if (error) throw new Error(`ai storyline: player read failed: ${error.message}`);
  for (const row of data ?? []) ids.set(row.puuid, row.id);
  return ids;
}

/**
 * The stored storyline as the Sunday post prints it (names escaped through `renderName`, the rest
 * escaped), or null. Through `loadShownLine`, so hidden, opted-out, switched-off is no line.
 * Never throws.
 */
export async function loadDiscordStoryline(
  service: ServiceClient,
  input: { groupId: string; weekStart: string; gate?: AiGate | null },
): Promise<string | null> {
  try {
    const names = await readLineNames(service, input.groupId, input.weekStart);
    const slots: (string | null)[] = [];
    const shown = await loadShownLine(service, {
      groupId: input.groupId,
      subject: { kind: 'week', weekStart: input.weekStart },
      nameOf: (playerId) => {
        if (!names.has(playerId)) return null;
        slots.push(names.get(playerId) ?? null);
        return `\u0000${slots.length - 1}\u0000`;
      },
      ...(input.gate === undefined ? {} : { gate: input.gate }),
    });
    return shown === null ? null : discordRecapText(shown.text, slots);
  } catch (error) {
    console.error(
      'ai storyline: no Discord storyline',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------
 * The Sunday post's hook
 * ------------------------------------------------------------------------------------------- */

export interface StorylineHookDeps {
  readGate: (groupId: string) => Promise<AiGate | null>;
  readPlayerIds: (puuids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  generate: (input: { groupId: string; week: WeekFactsInput }) => Promise<GenerateOutcome>;
  /** The Discord-ready stored line, or null ({@link loadDiscordStoryline}). */
  discordLine: (input: { groupId: string; weekStart: string; gate: AiGate }) => Promise<string | null>;
  /** Keeps a generation that outlived the budget running past the response (`after()`). */
  schedule: Scheduler;
  budgetMs: number;
  /** Resolves after `ms`; tests pass one they control. */
  sleep?: (ms: number) => Promise<void>;
}

/** Production wiring. The service client is read when the hook runs, never at import. */
export function storylineHookDeps(): StorylineHookDeps {
  return {
    readGate: (groupId) => readAiGate(getServiceClient(), groupId),
    readPlayerIds: (puuids) => readPlayerIds(getServiceClient(), puuids),
    generate: (input) => {
      const service = getServiceClient();
      return generateWeekLine(generateDepsFor(service), input);
    },
    discordLine: (input) => loadDiscordStoryline(getServiceClient(), input),
    schedule: afterResponse,
    budgetMs: STORYLINE_POST_BUDGET_MS,
  };
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A budget timer must never keep a script's process alive on its own.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref();
  });

/**
 * The Sunday post's storyline: generate it (once per group-week) within the budget, then read the
 * stored line back for Discord. Null for every group whose AI gate is closed, before any other
 * read, so a group without Premium costs one gate read and its post is today's byte for byte.
 * Never throws.
 */
export async function runStoryline(source: WeekPostSource, deps: StorylineHookDeps): Promise<string | null> {
  try {
    const gate = await deps.readGate(source.groupId);
    if (!aiGateOpen(gate)) return null;
    const weekStart = weekStartDay(source.window, source.timeZone);
    const idOf = await deps.readPlayerIds(source.rows.map((row) => row.puuid));
    const week = weekFactsFromPost({
      weekStart,
      games: source.games,
      rows: source.rows,
      stats: source.stats,
      idOf,
    });
    if (week !== null) {
      const generation = deps.generate({ groupId: source.groupId, week });
      const sleep = deps.sleep ?? defaultSleep;
      const finished = await Promise.race([
        generation.then(() => true),
        sleep(deps.budgetMs).then(() => false),
      ]);
      if (!finished) {
        console.info(`ai: week line for ${weekStart} is still being written; the post goes without it`);
        deps.schedule(() => generation);
        return null;
      }
    }
    return await deps.discordLine({ groupId: source.groupId, weekStart, gate });
  } catch (error) {
    console.error('ai storyline: none on the post', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/** The cron route's hook for `postClosedWindow`. */
export function weeklyStorylineHook(
  deps: () => StorylineHookDeps = storylineHookDeps,
): (source: WeekPostSource) => Promise<string | null> {
  return (source) => runStoryline(source, deps());
}

/**
 * The window cron's daily second chance for a closed week's storyline (M16.12): when the Sunday
 * call failed transiently (budget, kill switch, a timeout), re-attempt it in `after()` from its
 * stored facts while the week is still on the board. **Fills the board only**: the Sunday post went
 * out once and is never re-posted or edited by this. Never throws, never waits.
 */
export function scheduleStorylineRetry(
  input: { groupId: string; window: ClosedWindow; timeZone: string; deadline: number },
  options: { schedule?: Scheduler; deps?: () => GenerateDeps } = {},
): void {
  try {
    const schedule = options.schedule ?? afterResponse;
    const deps =
      options.deps ?? (() => ({ ...generateDepsFor(getServiceClient()), deadline: input.deadline }));
    const weekStart = weekStartDay(input.window, input.timeZone);
    schedule(async () =>
      retryStoredLine(deps(), { groupId: input.groupId, subject: { kind: 'week', weekStart } }),
    );
  } catch (error) {
    console.error(
      'ai storyline: retry not scheduled',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}
