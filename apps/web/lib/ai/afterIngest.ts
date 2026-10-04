import 'server-only';
import { after } from 'next/server';
import { editResultWithRecap, type RecapEditOutcome } from '../discord/aiEdit';
import type { AiGate } from '../premium';
import { getServiceClient } from '../supabase';
import { type GenerateOutcome, gameLineSourcesFor, generateDepsFor, generateGameLine } from './generate';
import { loadDiscordRecap } from './recap';

/**
 * The game recap's post-ingest hook (M16.4). The companion game route calls
 * {@link scheduleGameLine} **after** the result has been announced (the Discord post is already
 * out) and returns its answer without waiting: the work runs in `after()`, which on Vercel keeps the
 * function alive past the response. Then:
 *
 * 1. `generateGameLine` (M16.3): live (`source = 'eog'`) games of a group whose Premium and AI
 *    lines are on, recorded after Premium was switched on, inside 15 minutes; once per game (a
 *    second ingest is `cached`, no model call). Backfilled games never reach here (the route does
 *    not schedule them) and would be skipped anyway (`not_live`).
 * 2. When a line was **published by this run**, the result post is edited to carry it, if the post
 *    was made here and is less than 15 minutes old (`lib/discord/aiEdit.ts`).
 *
 * Nothing here throws into ingest: every step is wrapped, and `generateGameLine` never throws.
 * The {@link AiGate} type import is the M16.2 guard's requirement and a reminder: the gate is read
 * inside `generateGameLine` and `loadShownLine`, never assumed here.
 */

export interface GameLineInput {
  groupId: string;
  gameId: string;
}

export interface GameLineHookDeps {
  generate: (input: GameLineInput) => Promise<GenerateOutcome>;
  /** The Discord-ready text of the published line, or null (`loadDiscordRecap`). */
  discordLine: (input: GameLineInput) => Promise<string | null>;
  editResult: (input: GameLineInput & { line: string; now: Date }) => Promise<RecapEditOutcome>;
  now: () => Date;
}

export interface GameLineRun {
  generated: GenerateOutcome;
  discord: RecapEditOutcome | null;
}

export type GateNote = AiGate | null;

/** Production wiring. The service client is read when the task runs, never at import. */
export function gameLineHookDeps(): GameLineHookDeps {
  return {
    generate: (input) => {
      const service = getServiceClient();
      return generateGameLine(generateDepsFor(service), gameLineSourcesFor(service), input);
    },
    discordLine: (input) => loadDiscordRecap(getServiceClient(), input),
    editResult: (input) => editResultWithRecap(getServiceClient(), input),
    now: () => new Date(),
  };
}

/** Generate, then edit the post. Never throws. */
export async function runGameLine(input: GameLineInput, deps: GameLineHookDeps): Promise<GameLineRun | null> {
  try {
    const generated = await deps.generate(input);
    if (generated.status !== 'published') return { generated, discord: null };
    const line = await deps.discordLine(input);
    if (line === null) return { generated, discord: null };
    const discord = await deps.editResult({ ...input, line, now: deps.now() });
    return { generated, discord };
  } catch (error) {
    console.error('ai: game line hook failed', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

export type Scheduler = (task: () => Promise<unknown>) => void;

/**
 * Next's `after()`: runs the task once the response has been sent. Outside a request scope (a
 * script, a unit test calling the route handler directly) `after` throws; the task then runs
 * detached, its promise never awaited and never rejected (`runGameLine` catches everything).
 */
export const afterResponse: Scheduler = (task) => {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
};

/**
 * The route's one call: schedule the recap and return at once. Never throws, never waits. The
 * route passes only live posts of the game's own group (`source = 'eog'`, not another group's
 * duplicate); a second companion's post schedules again and is a `cached` no-op with no call.
 */
export function scheduleGameLine(
  input: GameLineInput,
  options: { schedule?: Scheduler; deps?: () => GameLineHookDeps } = {},
): void {
  try {
    const schedule = options.schedule ?? afterResponse;
    const deps = options.deps ?? gameLineHookDeps;
    schedule(() => runGameLine(input, deps()));
  } catch (error) {
    console.error(
      'ai: could not schedule the game line',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}
