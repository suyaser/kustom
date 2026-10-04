import { appendFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { checkLine, renderLine } from '../lib/ai/check.ts';
import {
  type AiReply,
  type AiRequest,
  type AiTransport,
  aiTransportFor,
  createAiClient,
} from '../lib/ai/client.ts';
import {
  buildGameFacts,
  buildPlayerFacts,
  buildWeekFacts,
  type FactList,
  RECENT_LINES,
} from '../lib/ai/facts.ts';
import { generateGameLine, generatePlayerLine, generateWeekLine } from '../lib/ai/generate.ts';
import {
  AI_FEATURES,
  AI_MODELS,
  type AiModel,
  costUsd,
  memoryMeter,
  memoryMeterState,
} from '../lib/ai/meter.ts';
import { type PoolRow, scoutingExtrasOf } from '../lib/ai/scouting.ts';
import { memoryLineStore } from '../lib/ai/store.ts';
import { readAiEnv } from '../lib/env.ts';
import type { AiGate } from '../lib/premium.ts';
import { buildMonth, id, nameOf, OPTED_OUT, playerInputs, weekInput } from './ai-eval-month-data.ts';

/**
 * M16.13+: the M16.7 reviewer's deterministic month (150 games, 4 weeks, 20 players;
 * `ai-eval-month-data.ts`) through production's generators, the real client and checker, a memory
 * store and a memory meter capped at `--budget`. Dev-only, run by hand; no database at all.
 *
 *   [AI_PROVIDER=deepseek|anthropic] pnpm --filter web ai-eval-month --kinds week,player[,game]
 *                                   [--week-reps N] [--game-every N] [--model flash|pro|sonnet]
 *                                   [--budget <usd>] [--json <file>] [--ledger <file>]
 *
 * The provider is production's (`readAiEnv`); `--model` swaps every feature's model for this
 * process only and must belong to that provider.
 *
 * Prints, per kind: subjects, published, refused for good, first-attempt pass, every refusal's
 * code and reason, and the cost. `--game-every N` takes one game in N (a subsample).
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? (args[at + 1] as string) : fallback;
};
const kinds = flag('--kinds', 'week,player').split(',');
const weekReps = Number(flag('--week-reps', '8'));
const gameEvery = Number(flag('--game-every', '1'));
const budget = Number(flag('--budget', '0.25'));
const jsonOut = flag('--json', '');
const ledger = flag('--ledger', '');

const env = readAiEnv(process.env);
if (env === null) throw new Error('no AI key: set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY (and AI_PROVIDER)');
const MODEL_FLAGS: Record<string, AiModel> = {
  sonnet: 'claude-sonnet-5-5',
  flash: 'deepseek-flash',
  pro: 'deepseek-v4-pro',
};
const modelFlag = flag('--model', '');
if (modelFlag !== '') {
  const model = MODEL_FLAGS[modelFlag];
  if (model === undefined) throw new Error('--model is sonnet, flash or pro');
  if (AI_MODELS[model].provider !== env.provider)
    throw new Error(`--model ${modelFlag} is not a ${env.provider} model (set AI_PROVIDER)`);
  AI_FEATURES.game.model = model;
  AI_FEATURES.week.model = model;
  AI_FEATURES.player.model = model;
}
console.log(`ai-eval-month  provider ${env.provider}  model ${AI_FEATURES.game.model}`);
const GROUP = 'eval-month';
const GATE: AiGate = { premium: true, linesEnabled: true, premiumChangedAt: '2000-01-01T00:00:00.000Z' };
const state = memoryMeterState({ [GROUP]: { capUsd: budget } });
state.globalCapUsd = budget;
const calls: { request: AiRequest; reply: AiReply | null }[] = [];
const inner = aiTransportFor(env);
const transport: AiTransport = {
  async send(request, signal) {
    try {
      const reply = await inner.send(request, signal);
      calls.push({ request, reply });
      return reply;
    } catch (error) {
      calls.push({ request, reply: null });
      throw error;
    }
  },
};
const client = createAiClient({
  transport,
  meter: memoryMeter(state),
  readGate: async () => GATE,
  log: () => {},
});
const optedOut = new Set(OPTED_OUT.map(id));

interface Tally {
  subjects: number;
  published: number;
  firstPass: number;
  attempts: number;
  refused: number;
  cost: number;
  reasons: Map<string, number>;
}
const tallies = new Map<string, Tally>();
const records: unknown[] = [];

async function one(
  kind: string,
  label: string,
  list: FactList,
  run: () => Promise<{ status: string; text?: string }>,
) {
  const first = calls.length;
  const outcome = await run();
  const tally = tallies.get(kind) ?? {
    subjects: 0,
    published: 0,
    firstPass: 0,
    attempts: 0,
    refused: 0,
    cost: 0,
    reasons: new Map(),
  };
  tallies.set(kind, tally);
  tally.subjects += 1;
  if (outcome.status === 'published') tally.published += 1;
  const attempts = calls.slice(first).map((call, index) => {
    if (call.reply === null) return { error: true };
    const cost = costUsd(call.request.model, call.reply);
    tally.cost += cost;
    tally.attempts += 1;
    const verdict = checkLine(call.reply.text, list, { stopReason: call.reply.stopReason });
    if (verdict.ok && index === 0) tally.firstPass += 1;
    if (!verdict.ok) {
      tally.refused += 1;
      const key = `${verdict.code}: ${verdict.reason.replace(/"[^"]*"/g, '"…"')}`;
      tally.reasons.set(key, (tally.reasons.get(key) ?? 0) + 1);
    }
    return {
      text: call.reply.text,
      ok: verdict.ok,
      why: verdict.ok ? null : `${verdict.code}: ${verdict.reason}`,
      cost,
    };
  });
  const shown =
    outcome.status === 'published' && outcome.text !== undefined
      ? renderLine({
          gate: GATE,
          line: { status: 'published', text: outcome.text, tokenMap: list.tokenMap },
          optedOut,
          nameOf,
        })
      : null;
  records.push({ kind, label, status: outcome.status, attempts, shown });
  console.log(`${kind}\t${label}\t${outcome.status}\t${attempts.length} attempt(s)\t${shown ?? ''}`);
  if (ledger !== '')
    appendFileSync(
      ledger,
      `${new Date().toISOString()}\tmonth-${kind}\t${attempts.reduce((s, a) => s + ('cost' in a ? (a.cost ?? 0) : 0), 0).toFixed(6)}\t${label}\n`,
    );
}

const deps = (night: string[] = []) => ({
  client,
  store: memoryLineStore(),
  readGate: async () => GATE,
  readOptedOut: async () => optedOut,
  readRecentLines: async () => night.slice(0, RECENT_LINES),
  now: () => new Date(),
  log: () => {},
});

const games = buildMonth();
if (kinds.includes('week')) {
  for (let rep = 0; rep < weekReps; rep += 1) {
    for (let w = 0; w < 4; w += 1) {
      const week = weekInput(games, w);
      const list = buildWeekFacts(week, optedOut);
      if (list === null) continue;
      await one('week', `week ${w + 1} rep ${rep + 1}`, list, () =>
        generateWeekLine(deps(), { groupId: GROUP, week }),
      );
    }
  }
}
// M16.19: the scouting extras from the month's own rows (week 4 is the report's week).
const REPORT_WEEK = { start: new Date('2026-10-04T00:00:00Z'), end: new Date('2026-10-11T00:00:00Z') };
function monthPool(playerId: string): PoolRow[] {
  return games
    .filter((game) => !game.input.aram)
    .flatMap((game) => {
      const meta = game.seatsMeta.find((seat) => seat.pid === playerId);
      const seat = game.input.seats.find((s) => s.playerId === playerId);
      if (meta === undefined || seat === undefined) return [];
      return [
        {
          championId: null,
          champion: meta.champion,
          role: meta.role,
          won: meta.won,
          startedAt: game.startedAt,
          kills: seat.kills,
          assists: seat.assists,
          teammates: game.seatsMeta
            .filter((m) => m.side === meta.side && m.pid !== playerId)
            .map((m) => m.pid),
        },
      ];
    });
}
const withExtras = !args.includes('--no-extras');

if (kinds.includes('player')) {
  const reports: string[] = [];
  for (const base of playerInputs(games)) {
    const player = withExtras
      ? {
          ...base,
          extras: scoutingExtrasOf({ pool: monthPool(base.playerId), window: REPORT_WEEK, optedOut }),
        }
      : base;
    const list = buildPlayerFacts(player, optedOut);
    if (list === null) continue;
    await one('player', `player ${nameOf(player.playerId)}`, list, async () => {
      // The same Sunday's earlier reports, newest first, as production reads them.
      const outcome = await generatePlayerLine(deps(reports), { groupId: GROUP, player });
      if (outcome.status === 'published') reports.unshift(outcome.text);
      return outcome;
    });
  }
}
if (kinds.includes('game')) {
  const night: string[] = [];
  for (const game of games.filter((g) => g.index % gameEvery === 0)) {
    const list = buildGameFacts(game.input, optedOut);
    if (list === null) continue;
    await one('game', `game ${game.index}`, list, async () => {
      const outcome = await generateGameLine(
        deps(night),
        {
          readGameMeta: async () => ({
            id: game.input.gameId,
            groupId: GROUP,
            source: 'eog',
            createdAt: new Date().toISOString(),
          }),
          loadGameFactsInput: async () => game.input,
        },
        { groupId: GROUP, gameId: game.input.gameId },
      );
      if (outcome.status === 'published') night.unshift(outcome.text);
      return outcome;
    });
  }
}

let total = 0;
for (const [kind, t] of tallies) {
  total += t.cost;
  const pct = (n: number, d: number) => `${d === 0 ? 0 : Math.round((n / d) * 100)}%`;
  console.log(
    `\nsummary ${kind}: ${t.subjects} subjects, published ${t.published}, refused for good ${t.subjects - t.published}, ` +
      `first-attempt refusals ${t.subjects - t.firstPass}/${t.subjects} (${pct(t.subjects - t.firstPass, t.subjects)}), ` +
      `attempts ${t.attempts}, refused ${t.refused}, $${t.cost.toFixed(4)}`,
  );
  for (const [reason, n] of [...t.reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${reason}`);
}
console.log(`total $${total.toFixed(4)}`);
if (jsonOut !== '') writeFileSync(jsonOut, `${JSON.stringify(records, null, 1)}\n`);
