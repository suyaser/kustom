import { appendFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { checkLine, renderLine } from '../lib/ai/check.ts';
import {
  type AiReply,
  type AiRequest,
  type AiTransport,
  anthropicTransport,
  createAiClient,
} from '../lib/ai/client.ts';
import {
  buildGameFacts,
  buildPlayerFacts,
  buildWeekFacts,
  type GameFactsInput,
  loadGameFactsInput,
  RECENT_LINES,
  renderFact,
} from '../lib/ai/facts.ts';
import {
  type GenerateOutcome,
  generateGameLine,
  generatePlayerLine,
  generateWeekLine,
} from '../lib/ai/generate.ts';
import { AI_FEATURES, type AiModel, costUsd, memoryMeter, memoryMeterState } from '../lib/ai/meter.ts';
import { memoryLineStore, readOptedOut } from '../lib/ai/store.ts';
import { readAnthropicEnv } from '../lib/env.ts';
import type { AiGate } from '../lib/premium.ts';
import {
  nameOfEvalPlayer,
  PLAYER_SCENARIOS,
  ROSTER,
  rosterId,
  SCENARIOS,
  WEEK_SCENARIOS,
} from './ai-eval-scenarios.ts';

/**
 * M16.8: the AI recap line, evaluated on games. Dev-only, run by hand; never in CI.
 *
 *   set -a; . ./.env.local; set +a
 *   pnpm --filter web ai-eval [--source scenarios|local|all] [--model haiku|sonnet] [--limit N]
 *                             [--budget <usd>] [--ledger <file>] [--json <file>] [--group <slug>]
 *                             [--only <label words>] [--fresh] [--weeks] [--players] [--repeat N] [--dry]
 *
 * For each game: the fact sheet exactly as production builds it (`loadGameFactsInput` +
 * `buildGameFacts` for `--source local`; the scenario inputs through the same `buildGameFacts`
 * otherwise), every model attempt with its raw text, the checker's verdict and cost, and the line
 * as Discord would print it. Generation runs through production's own `generateGameLine` and
 * `createAiClient` + `anthropicTransport`, so the retry-with-reason and the checker are the real
 * ones; only the line store (memory) and the meter (memory, capped at `--budget`, default $0.25)
 * are swapped.
 *
 * **No database writes.** There is no database write path: no `ai_lines` row, no `ai_calls`
 * ledger row (`--ledger` / `--json` write only the local files you name). Reads the local stack only (refuses any Supabase URL that is not 127.0.0.1 or localhost). Never prints the
 * key. `--model` swaps the game line's model for this process only, to compare the two.
 */

interface Args {
  source: 'scenarios' | 'local' | 'all';
  model: AiModel | null;
  limit: number;
  budget: number;
  ledger: string | null;
  json: string | null;
  group: string;
  only: string | null;
  fresh: boolean;
  weeks: boolean;
  players: boolean;
  repeat: number;
  dry: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    source: 'scenarios',
    model: null,
    limit: 50,
    budget: 0.25,
    ledger: null,
    json: null,
    group: 'customs',
    only: null,
    fresh: false,
    weeks: false,
    players: false,
    repeat: 1,
    dry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === '--source') {
      const value = next();
      if (value !== 'scenarios' && value !== 'local' && value !== 'all') throw new Error('bad --source');
      args.source = value;
    } else if (flag === '--model') {
      const value = next();
      args.model =
        value === 'haiku' ? 'claude-haiku-4-5-20251001' : value === 'sonnet' ? 'claude-sonnet-5-5' : null;
      if (args.model === null) throw new Error('--model is haiku or sonnet');
    } else if (flag === '--limit') args.limit = Number(next());
    else if (flag === '--budget') args.budget = Number(next());
    else if (flag === '--ledger') args.ledger = next();
    else if (flag === '--json') args.json = next();
    else if (flag === '--group') args.group = next();
    else if (flag === '--only') args.only = next();
    else if (flag === '--fresh') args.fresh = true;
    else if (flag === '--weeks') args.weeks = true;
    else if (flag === '--players') args.players = true;
    else if (flag === '--repeat') args.repeat = Math.max(1, Math.min(10, Number(next()) || 1));
    else if (flag === '--dry') args.dry = true;
    else if (flag === '--write') throw new Error('this script has no write path, by design (M16.8)');
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isFinite(args.budget) || args.budget <= 0 || args.budget > 1)
    throw new Error('--budget is a dollar amount above 0 and at most 1');
  return args;
}

interface EvalGame {
  label: string;
  real: boolean;
  groupId: string;
  input: GameFactsInput;
  optedOut: ReadonlySet<string>;
  nameOf: (playerId: string) => string | null;
}

const EVAL_GROUP = 'eval-group';

async function localGames(args: Args): Promise<EvalGame[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url))
    throw new Error(`refusing a Supabase URL that is not the local stack: ${url}`);
  if (key === '') throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const service = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: group, error } = await service.from('groups').select('id').eq('slug', args.group).single();
  if (error) throw new Error(`no group ${args.group}: ${error.message}`);
  const { data: games, error: gamesError } = await service
    .from('games')
    .select('id')
    .eq('group_id', group.id)
    .order('started_at', { ascending: false })
    .limit(args.limit);
  if (gamesError) throw new Error(gamesError.message);
  const optedOut = await readOptedOut(service, group.id);
  const out: EvalGame[] = [];
  for (const { id } of games ?? []) {
    const input = await loadGameFactsInput(service, group.id, id, optedOut);
    if (input === null) continue;
    const ids = input.seats.map((seat) => seat.playerId);
    const { data: players } = await service
      .from('players')
      .select('id, display_name, game_name')
      .in('id', ids);
    const names = new Map((players ?? []).map((row) => [row.id, row.display_name ?? row.game_name ?? null]));
    out.push({
      label: `local game ${id}`,
      real: true,
      groupId: group.id,
      input,
      optedOut,
      nameOf: (playerId) => names.get(playerId) ?? null,
    });
  }
  return out;
}

function scenarioGames(): EvalGame[] {
  return SCENARIOS.map((scenario) => ({
    label: scenario.label,
    real: scenario.real,
    groupId: EVAL_GROUP,
    input: scenario.input,
    optedOut: new Set((scenario.optedOut ?? []).map(rosterId)),
    nameOf: nameOfEvalPlayer,
  }));
}

/** Records every request and reply that went through the real transport. */
function recording(inner: AiTransport) {
  const calls: { request: AiRequest; reply: AiReply | null; error: string | null }[] = [];
  const transport: AiTransport = {
    async send(request, signal) {
      try {
        const reply = await inner.send(request, signal);
        calls.push({ request, reply, error: null });
        return reply;
      } catch (error) {
        calls.push({ request, reply: null, error: error instanceof Error ? error.message : 'error' });
        throw error;
      }
    },
  };
  return { transport, calls };
}

const OPEN_GATE: AiGate = {
  premium: true,
  linesEnabled: true,
  premiumChangedAt: '2000-01-01T00:00:00.000Z',
};

/**
 * `--weeks`: the weekly storyline (M16.5) over the scenario weeks, through production's
 * `generateWeekLine` (its model, two attempts, the checker), the same memory store and meter.
 */
/**
 * `--players`: the scouting report (M16.6) over the scenario players, through production's
 * `generatePlayerLine` (its model, two attempts, the checker), the same memory store and meter.
 */
async function runPlayers(
  args: Args,
  client: ReturnType<typeof createAiClient>,
  calls: ReturnType<typeof recording>['calls'],
): Promise<void> {
  console.log(`ai-eval  players  model ${AI_FEATURES.player.model}  budget $${args.budget.toFixed(2)}`);
  let total = 0;
  const tally = { subjects: 0, published: 0, attempts: 0, refused: 0 };
  const runs = Array.from({ length: args.repeat }, () => PLAYER_SCENARIOS).flat();
  for (const scenario of runs) {
    const list = buildPlayerFacts(scenario.player, new Set());
    console.log(`\n=== PLAYER SCENARIO: ${scenario.label}`);
    if (list === null) {
      console.log('no facts (settling or opted out)');
      continue;
    }
    for (const fact of list.facts) console.log(`  ${renderFact(fact)}`);
    const first = calls.length;
    const outcome = await generatePlayerLine(
      {
        client,
        store: memoryLineStore(),
        readGate: async () => OPEN_GATE,
        readOptedOut: async () => new Set(),
        now: () => new Date(),
        log: () => {},
      },
      { groupId: EVAL_GROUP, player: scenario.player },
    );
    let cost = 0;
    calls.slice(first).forEach((call, index) => {
      if (call.reply === null) {
        console.log(`attempt ${index + 1}  ERROR ${call.error}`);
        return;
      }
      const c = costUsd(call.request.model, call.reply);
      cost += c;
      const verdict = checkLine(call.reply.text, list, { stopReason: call.reply.stopReason });
      tally.attempts += 1;
      if (!verdict.ok) tally.refused += 1;
      console.log(
        `attempt ${index + 1}  ${call.reply.inputTokens} in / ${call.reply.outputTokens} out  $${c.toFixed(5)}  ${
          verdict.ok ? 'PASS' : `REJECT ${verdict.code}: ${verdict.reason}`
        }`,
      );
      console.log(`  raw: ${call.reply.text}`);
    });
    tally.subjects += 1;
    total += cost;
    if (outcome.status === 'published') {
      tally.published += 1;
      const shown = renderLine({
        gate: OPEN_GATE,
        line: { status: 'published', text: outcome.text, tokenMap: list.tokenMap },
        optedOut: new Set(),
        nameOf: nameOfEvalPlayer,
      });
      console.log(`page     AI scouting report: ${shown}`);
    }
    console.log(`outcome  ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
    console.log(`cost     $${cost.toFixed(5)}   running $${total.toFixed(5)}`);
    if (args.ledger !== null)
      appendFileSync(
        args.ledger,
        `${new Date().toISOString()}\t${AI_FEATURES.player.model}\t${cost.toFixed(6)}\t${scenario.label}\n`,
      );
  }
  console.log(
    `\nsummary  players ${tally.subjects}: published ${tally.published}; attempts ${tally.attempts}, refused ${tally.refused}`,
  );
  console.log(`total $${total.toFixed(5)}`);
}

async function runWeeks(
  args: Args,
  client: ReturnType<typeof createAiClient>,
  calls: ReturnType<typeof recording>['calls'],
): Promise<void> {
  console.log(`ai-eval  weeks  model ${AI_FEATURES.week.model}  budget $${args.budget.toFixed(2)}`);
  let total = 0;
  const results: unknown[] = [];
  const tally = { subjects: 0, published: 0, firstPass: 0, attempts: 0, refusedAttempts: 0 };
  const reasons = new Map<string, number>();
  const runs = Array.from({ length: args.repeat }, () => WEEK_SCENARIOS).flat();
  for (const scenario of runs) {
    const optedOut = new Set((scenario.optedOut ?? []).map(rosterId));
    const list = buildWeekFacts(scenario.week, optedOut);
    console.log(`\n=== WEEK SCENARIO: ${scenario.label}`);
    if (list === null) continue;
    console.log(
      `tokens   ${Object.entries(list.tokenMap)
        .map(([token, id]) => `${token}=${nameOfEvalPlayer(id) ?? '?'}`)
        .join(' ')}`,
    );
    for (const fact of list.facts) console.log(`  ${renderFact(fact)}`);
    const first = calls.length;
    const outcome = await generateWeekLine(
      {
        client,
        store: memoryLineStore(),
        readGate: async () => OPEN_GATE,
        readOptedOut: async () => optedOut,
        now: () => new Date(),
        log: () => {},
      },
      { groupId: EVAL_GROUP, week: scenario.week },
    );
    let cost = 0;
    calls.slice(first).forEach((call, index) => {
      if (call.reply === null) {
        console.log(`attempt ${index + 1}  ERROR ${call.error}`);
        return;
      }
      const c = costUsd(call.request.model, call.reply);
      cost += c;
      const verdict = checkLine(call.reply.text, list, { stopReason: call.reply.stopReason });
      tally.attempts += 1;
      if (!verdict.ok) {
        tally.refusedAttempts += 1;
        const key = `${verdict.code}: ${verdict.reason}`;
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      } else if (index === 0) tally.firstPass += 1;
      console.log(
        `attempt ${index + 1}  ${call.reply.inputTokens} in / ${call.reply.outputTokens} out  $${c.toFixed(5)}  ${
          verdict.ok ? 'PASS' : `REJECT ${verdict.code}: ${verdict.reason}`
        }`,
      );
      console.log(`  raw: ${call.reply.text}`);
    });
    tally.subjects += 1;
    if (outcome.status === 'published') tally.published += 1;
    total += cost;
    const shown =
      outcome.status === 'published'
        ? renderLine({
            gate: OPEN_GATE,
            line: { status: 'published', text: outcome.text, tokenMap: list.tokenMap },
            optedOut,
            nameOf: nameOfEvalPlayer,
          })
        : null;
    console.log(`outcome  ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
    if (shown !== null) console.log(`discord  AI recap: ${shown}`);
    console.log(`cost     $${cost.toFixed(5)}   running $${total.toFixed(5)}`);
    results.push({
      label: scenario.label,
      facts: list.facts.map(renderFact),
      outcome: outcome.status,
      shown,
      cost,
    });
    if (args.ledger !== null)
      appendFileSync(
        args.ledger,
        `${new Date().toISOString()}\t${AI_FEATURES.week.model}\t${cost.toFixed(6)}\t${scenario.label}\n`,
      );
  }
  console.log(
    `\nsummary  weeks ${tally.subjects}: published ${tally.published}, refused for good ${
      tally.subjects - tally.published
    }, first-attempt pass ${tally.firstPass}; attempts ${tally.attempts}, refused attempts ${tally.refusedAttempts}`,
  );
  for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n}x ${reason}`);
  console.log(`total $${total.toFixed(5)}`);
  if (args.json !== null) writeFileSync(args.json, `${JSON.stringify(results, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = readAnthropicEnv(process.env);
  if (env === null) throw new Error('ANTHROPIC_API_KEY is not set (set -a; . ./.env.local; set +a)');
  if (args.model !== null) AI_FEATURES.game.model = args.model;
  const model = AI_FEATURES.game.model;

  let games: EvalGame[] = [];
  if (args.source !== 'local') games.push(...scenarioGames());
  if (args.source !== 'scenarios') games.push(...(await localGames(args)));
  if (args.only !== null) {
    const wanted = args.only.toLowerCase();
    games = games.filter((game) => game.label.toLowerCase().includes(wanted));
  }
  games = games.slice(0, args.limit);

  const state = memoryMeterState({
    [EVAL_GROUP]: { capUsd: args.budget },
    ...Object.fromEntries(games.map((game) => [game.groupId, { capUsd: args.budget }])),
  });
  state.globalCapUsd = args.budget;
  const { transport, calls } = recording(anthropicTransport(env.ANTHROPIC_API_KEY));
  const client = createAiClient({
    transport,
    meter: memoryMeter(state),
    readGate: async () => OPEN_GATE,
    log: () => {},
  });

  if (args.players) {
    await runPlayers(args, client, calls);
    return;
  }
  if (args.weeks) {
    await runWeeks(args, client, calls);
    return;
  }

  console.log(`ai-eval  model ${model}  games ${games.length}  budget $${args.budget.toFixed(2)}`);
  console.log(`roster   ${ROSTER.join(', ')}`);
  let total = 0;
  let published = 0;
  const night: string[] = [];
  const results: unknown[] = [];
  for (const game of games) {
    const list = buildGameFacts(game.input, game.optedOut);
    console.log(`\n=== ${game.real ? 'REAL' : 'SCENARIO'}: ${game.label}`);
    if (list === null) {
      console.log('no facts (everyone opted out)');
      continue;
    }
    const legend = Object.entries(list.tokenMap)
      .map(([token, id]) => `${token}=${game.nameOf(id) ?? '?'}`)
      .join(' ');
    console.log(`tokens   ${legend}`);
    for (const fact of list.facts) console.log(`  ${renderFact(fact)}`);
    if (args.dry) continue;

    const first = calls.length;
    const store = memoryLineStore();
    const outcome: GenerateOutcome = await generateGameLine(
      {
        client,
        store,
        readGate: async () => OPEN_GATE,
        readOptedOut: async () => game.optedOut,
        // The lines already written this run, newest first: a night in the group's Discord.
        readRecentLines: async () => (args.fresh ? [] : night.slice(0, RECENT_LINES)),
        now: () => new Date(),
        log: () => {},
      },
      {
        readGameMeta: async () => ({
          id: game.input.gameId,
          groupId: game.groupId,
          source: 'eog',
          createdAt: new Date().toISOString(),
        }),
        loadGameFactsInput: async () => game.input,
      },
      { groupId: game.groupId, gameId: game.input.gameId },
    );
    const attempts = calls.slice(first);
    let gameCost = 0;
    attempts.forEach((call, index) => {
      if (call.reply === null) {
        console.log(`attempt ${index + 1}  ERROR ${call.error}`);
        return;
      }
      const cost = costUsd(call.request.model, call.reply);
      gameCost += cost;
      const verdict = checkLine(call.reply.text, list, { stopReason: call.reply.stopReason });
      console.log(
        `attempt ${index + 1}  ${call.reply.inputTokens} in / ${call.reply.outputTokens} out  $${cost.toFixed(5)}  ${
          verdict.ok ? 'PASS' : `REJECT ${verdict.code}: ${verdict.reason}`
        }`,
      );
      console.log(`  raw: ${call.reply.text}`);
    });
    total += gameCost;
    let shown: string | null = null;
    if (outcome.status === 'published') {
      published += 1;
      night.unshift(outcome.text);
      shown = renderLine({
        gate: OPEN_GATE,
        line: { status: 'published', text: outcome.text, tokenMap: list.tokenMap },
        optedOut: game.optedOut,
        nameOf: game.nameOf,
      });
    }
    console.log(`outcome  ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
    if (shown !== null) console.log(`discord  AI recap: ${shown}`);
    console.log(`cost     $${gameCost.toFixed(5)}   running $${total.toFixed(5)}`);
    results.push({
      label: game.label,
      real: game.real,
      model,
      facts: list.facts.map(renderFact),
      tokens: legend,
      attempts: attempts.map((call) => ({
        text: call.reply?.text ?? null,
        verdict:
          call.reply === null
            ? call.error
            : checkLine(call.reply.text, list, { stopReason: call.reply.stopReason }),
      })),
      outcome: outcome.status,
      shown,
      costUsd: gameCost,
    });
    if (args.ledger !== null)
      appendFileSync(
        args.ledger,
        `${new Date().toISOString()}\t${model}\t${gameCost.toFixed(6)}\t${game.label}\n`,
      );
  }
  console.log(
    `\nsummary  ${published}/${games.length} published  total $${total.toFixed(5)}  per game $${(
      total / Math.max(1, games.length)
    ).toFixed(5)}`,
  );
  if (args.json !== null) writeFileSync(args.json, `${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(`ai-eval: ${error instanceof Error ? error.message : 'failed'}`);
  process.exitCode = 1;
});
