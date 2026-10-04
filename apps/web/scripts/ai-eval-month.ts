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
  renderFact,
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
// Experiments (2026-10-04), eval only: a temperature, thinking on, and a second "edit for punch" pass.
const temperatureFlag = flag('--temperature', '');
const thinking = args.includes('--thinking');
const editPass = args.includes('--edit-pass');
type MutableModel = { temperature: number | null; thinkingOff: unknown };
const modelEntry = AI_MODELS[AI_FEATURES.game.model] as unknown as MutableModel;
if (temperatureFlag !== '') modelEntry.temperature = Number(temperatureFlag);
if (thinking) {
  // DeepSeek ignores budget_tokens; the reasoning is billed as output, so max_tokens grows with it.
  modelEntry.thinkingOff = { type: 'enabled', budget_tokens: 2048 };
  for (const kind of ['game', 'week', 'player'] as const) AI_FEATURES[kind].maxTokens += 4000;
}
console.log(
  `ai-eval-month  provider ${env.provider}  model ${AI_FEATURES.game.model}  temperature ${modelEntry.temperature}` +
    `${thinking ? '  thinking on' : ''}${editPass ? '  edit pass' : ''}`,
);
const GROUP = 'eval-month';
const GATE: AiGate = { premium: true, linesEnabled: true, premiumChangedAt: '2000-01-01T00:00:00.000Z' };
const state = memoryMeterState({ [GROUP]: { capUsd: budget } });
state.globalCapUsd = budget;
const calls: { request: AiRequest; reply: AiReply | null; ms: number }[] = [];
const base = aiTransportFor(env);
/** The fact list of the subject being written, for the edit pass's own check. */
let currentList: FactList | null = null;
const EDIT_ASK =
  'Rewrite it for punch: same story, sharper words, and why it matters. Keep every player token, number with its unit word and champion exactly as written; add no new number, claim or name; follow every rule above. Reply with the line only.';
/** The edit pass: a passing draft gets one more call; the edit is kept only if it passes too. */
const inner: AiTransport = editPass
  ? {
      async send(request, signal) {
        const draft = await base.send(request, signal);
        if (currentList === null || !checkLine(draft.text, currentList, { stopReason: draft.stopReason }).ok)
          return draft;
        const edited = await base.send(
          { ...request, user: `${request.user}\n\nYour draft: ${draft.text}\n${EDIT_ASK}` },
          signal,
        );
        const keep = checkLine(edited.text, currentList, { stopReason: edited.stopReason }).ok;
        return {
          ...(keep ? edited : draft),
          inputTokens: draft.inputTokens + edited.inputTokens,
          cachedInputTokens: (draft.cachedInputTokens ?? 0) + (edited.cachedInputTokens ?? 0),
          outputTokens: draft.outputTokens + edited.outputTokens,
        };
      },
    }
  : base;
const transport: AiTransport = {
  async send(request, signal) {
    const started = Date.now();
    try {
      const reply = await inner.send(request, signal);
      calls.push({ request, reply, ms: Date.now() - started });
      return reply;
    } catch (error) {
      calls.push({ request, reply: null, ms: Date.now() - started });
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
  ms: number[];
  lines: string[];
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
  currentList = list;
  const outcome = await run();
  const tally: Tally = tallies.get(kind) ?? {
    subjects: 0,
    published: 0,
    firstPass: 0,
    attempts: 0,
    refused: 0,
    cost: 0,
    reasons: new Map(),
    ms: [],
    lines: [],
  };
  tallies.set(kind, tally);
  tally.subjects += 1;
  if (outcome.status === 'published') {
    tally.published += 1;
    if (outcome.text !== undefined) tally.lines.push(outcome.text);
  }
  const attempts = calls.slice(first).map((call, index) => {
    tally.ms.push(call.ms);
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
  // The facts with names, so a blind reader can check every claim (2026-10-04).
  const facts = list.facts.map((fact) =>
    renderFact(fact).replace(/\bP([1-9]\d?)\b/g, (token) => {
      const playerId = list.tokenMap[token as keyof typeof list.tokenMap];
      return playerId === undefined ? token : (nameOf(playerId) ?? token);
    }),
  );
  records.push({ kind, label, status: outcome.status, attempts, shown, facts });
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
  // The group's earlier Sundays, newest first, as production reads them (2026-10-04).
  const sundays: string[] = [];
  for (let rep = 0; rep < weekReps; rep += 1) {
    for (let w = 0; w < 4; w += 1) {
      const week = weekInput(games, w);
      const list = buildWeekFacts(week, optedOut);
      if (list === null) continue;
      await one('week', `week ${w + 1} rep ${rep + 1}`, list, async () => {
        const outcome = await generateWeekLine(deps(sundays), { groupId: GROUP, week });
        if (outcome.status === 'published') sundays.unshift(outcome.text);
        return outcome;
      });
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
  const sorted = [...t.ms].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const mean = sorted.reduce((sum, n) => sum + n, 0) / Math.max(1, sorted.length);
  console.log(
    `  latency mean ${Math.round(mean)} ms, p95 ${p95} ms; cost per published line $${(t.cost / Math.max(1, t.published)).toFixed(5)}`,
  );
  // Stock phrases the A/B read capped (2026-10-04): counted over published lines.
  const stock = [
    'duo to watch',
    'pair to split up',
    'ran away',
    'in the loss',
    'in a losing game',
    'for the first time in the group',
    'personal best',
    'the teammate',
    'what a',
    'keep it close',
    'still',
  ];
  const counts = stock
    .map((phrase) => [phrase, t.lines.filter((line) => line.toLowerCase().includes(phrase)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([phrase, n]) => `${phrase} ${n}/${t.lines.length}`);
  if (counts.length > 0) console.log(`  stock: ${counts.join(', ')}`);
}
console.log(`total $${total.toFixed(4)}`);
if (jsonOut !== '') writeFileSync(jsonOut, `${JSON.stringify(records, null, 1)}\n`);
