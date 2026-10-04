import { describe, expect, it, vi } from 'vitest';
import { AI_GAME, AI_GAME_ID, AI_GROUP_ID, AI_PLAYER, AI_WEEK, playerId } from '@/lib/testing/aiFixtures';
import type { AiGate } from '../premium';
import { renderLine } from './check';
import { type AiReply, AiTransportError, createAiClient, fakeReply, mockTransport } from './client';
import { type GameMeta, PROMPT_VERSION, renderFact } from './facts';
import {
  GAME_LINE_WINDOW_MS,
  type GameLineSources,
  type GenerateDeps,
  gameLineEligibility,
  generateGameLine,
  generatePlayerLine,
  generateWeekLine,
  PENDING_STALE_MS,
  retakeable,
  retryStoredLine,
  WEEKLY_RETRY_WINDOW_MS,
} from './generate';
import { AI_FEATURES, memoryMeter, memoryMeterState } from './meter';
import { memoryLineStore } from './store';
import { scheduleStorylineRetry } from './storyline';

function memoryRow() {
  return {
    id: '10000000-0000-4000-8000-000000000099',
    group_id: AI_GROUP_ID,
    kind: 'game',
    subject: AI_GAME_ID,
    status: 'pending',
    text: null,
    token_map: {},
    fact_hash: 'c'.repeat(64),
    model: 'claude-haiku-4-5-20251001',
    prompt_version: 'm16.5-1',
    attempts: 0,
    reject_reason: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    created_at: '',
    updated_at: '',
    published_at: null,
  };
}

/** M16.3: the generation flow end to end, with a mocked model, an in-memory store and meter. */

const NOW = new Date('2026-10-20T20:05:00Z');
const PREMIUM_SINCE = '2026-10-04T12:00:00Z';
const GOOD = '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.';
const BAD = '{P2} put up 10 kills on Lee Sin.';

function harness(
  options: {
    answers?: (string | Error)[];
    gate?: AiGate | null;
    optedOut?: string[];
    meta?: Partial<GameMeta> | null;
    noClient?: boolean;
  } = {},
) {
  const answers = options.answers ?? [GOOD];
  const transport = mockTransport((_request, call): AiReply => {
    const answer = answers[Math.min(call, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return fakeReply(answer as string, { inputTokens: 1_800, outputTokens: 40 });
  });
  const gate: AiGate | null =
    options.gate === undefined
      ? { premium: true, linesEnabled: true, premiumChangedAt: PREMIUM_SINCE }
      : options.gate;
  const meterState = memoryMeterState({ [AI_GROUP_ID]: {} });
  const store = memoryLineStore(() => NOW);
  const logs: string[] = [];
  const deps: GenerateDeps = {
    client: options.noClient
      ? null
      : createAiClient({
          transport,
          meter: memoryMeter(meterState),
          readGate: async () => gate,
          now: () => NOW,
          log: () => {},
        }),
    store,
    readGate: async () => gate,
    readOptedOut: async () => new Set(options.optedOut ?? []),
    now: () => NOW,
    sleep: async () => {},
    log: (line) => logs.push(line),
  };
  const loads = { meta: 0, facts: 0 };
  const sources: GameLineSources = {
    readGameMeta: async () => {
      loads.meta += 1;
      if (options.meta === null) return null;
      return {
        id: AI_GAME_ID,
        groupId: AI_GROUP_ID,
        source: 'eog',
        createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
        ...options.meta,
      };
    },
    loadGameFactsInput: async () => {
      loads.facts += 1;
      return AI_GAME;
    },
  };
  const run = () => generateGameLine(deps, sources, { groupId: AI_GROUP_ID, gameId: AI_GAME_ID });
  return { deps, sources, transport, store, meterState, logs, loads, run, gate };
}

describe('generateGameLine', () => {
  it('M16.15: a line leading with the same angle as the group’s previous line is refused, once', async () => {
    const DEATHLESS = '{P2} went 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.';
    const h = harness({ answers: [DEATHLESS, GOOD] });
    // AI_GAME is an upset: make it calm so nothing is exceptional.
    h.sources.loadGameFactsInput = async () => ({ ...AI_GAME, upset: false });
    h.deps.readRecentLines = async () => ['{P5} finished with 0 deaths on Thresh and the win.'];
    const outcome = await h.run();
    expect(h.transport.requests).toHaveLength(2);
    expect(h.transport.requests[1]?.user).toMatch(
      /repeat: it leads with the same kind of story \(deathless\)/,
    );
    // GOOD also reads "0 deaths" in its first sentence: the second is refused too, and no line is stored.
    expect(outcome).toMatchObject({ status: 'rejected' });

    const fresh = harness({ answers: [DEATHLESS] });
    fresh.sources.loadGameFactsInput = async () => ({ ...AI_GAME, upset: false });
    fresh.deps.readRecentLines = async () => ['{P5} makes it 6 wins in a row on Thresh.'];
    expect(await fresh.run()).toMatchObject({ status: 'published' });
  });

  it('M16.14: a reply cut off at max_tokens is refused and the second attempt is told why', async () => {
    const h = harness({ answers: [GOOD, GOOD] });
    const answer = h.transport.send.bind(h.transport);
    let call = 0;
    h.transport.send = async (request, signal) => {
      const reply = await answer(request, signal);
      call += 1;
      return call === 1 ? { ...reply, stopReason: 'max_tokens' } : reply;
    };
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.transport.requests).toHaveLength(2);
    expect(h.transport.requests[1]?.user).toContain('cut off at max_tokens');
  });

  describe('M16.6 code review: a deadline starts no call that could run past it', () => {
    const TIMEOUT = 20_000;

    it('too close to the deadline: no call, left failed (transient) for a later run', async () => {
      const h = harness();
      h.deps.deadline = NOW.getTime() + TIMEOUT - 1;
      expect(await h.run()).toMatchObject({ status: 'failed', reason: 'transient:deadline' });
      expect(h.transport.requests).toHaveLength(0);
    });

    it('a refused first attempt gets no second one once the deadline is near', async () => {
      const h = harness({ answers: [BAD, GOOD] });
      let clock = NOW.getTime();
      h.deps.now = () => new Date(clock);
      h.deps.deadline = NOW.getTime() + TIMEOUT + 5_000;
      const answer = h.transport.send.bind(h.transport);
      h.transport.send = async (request, signal) => {
        const reply = await answer(request, signal);
        clock += 10_000; // the first call took ten seconds
        return reply;
      };
      expect(await h.run()).toMatchObject({ status: 'failed', reason: 'transient:deadline' });
      expect(h.transport.requests).toHaveLength(1);
      // ...and a later run, inside the retry window, takes it over.
      expect(h.store.rows[0]).toMatchObject({
        status: 'failed',
        attempts: 1,
        reject_reason: 'transient:deadline',
      });
    });

    it('a transient error is not retried when the retry could overrun', async () => {
      const h = harness({ answers: [new AiTransportError('server', 529), GOOD] });
      h.deps.deadline = NOW.getTime() + TIMEOUT + 1_000; // under the 1.5 s pause + a call
      expect(await h.run()).toMatchObject({ status: 'failed' });
      expect(h.transport.requests).toHaveLength(1);
    });

    it('with room to spare, nothing changes', async () => {
      const h = harness({ answers: [BAD, GOOD] });
      h.deps.deadline = NOW.getTime() + 10 * TIMEOUT;
      expect(await h.run()).toMatchObject({ status: 'published' });
      expect(h.transport.requests).toHaveLength(2);
    });
  });

  it('M16.9: reads opt-outs first and hands them to the loader, so no opted-out history is read', async () => {
    const h = harness({ optedOut: [AI_GAME.seats[3]?.playerId ?? ''] });
    const seen: ReadonlySet<string>[] = [];
    h.sources.loadGameFactsInput = async (_groupId, _gameId, optedOut) => {
      seen.push(optedOut);
      return AI_GAME;
    };
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect([...(seen[0] ?? [])]).toEqual([AI_GAME.seats[3]?.playerId]);
  });

  it("M16.8: tells the model the group's recent lines, tokens and numbers masked; a failed read is none", async () => {
    const h = harness();
    h.deps.readRecentLines = async (_groupId, kind) =>
      kind === 'game' ? ['{P4} makes it 5 wins in a row.'] : [];
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.transport.requests[0]?.user).toContain('- someone makes it N wins in a row.');

    const broken = harness();
    broken.deps.readRecentLines = async () => {
      throw new Error('db down');
    };
    expect(await broken.run()).toMatchObject({ status: 'published' });
    expect(broken.transport.requests[0]?.user).not.toContain('Recent lines');
  });

  it('publishes a checked line, stored with tokens, the facts, the hash and the cost', async () => {
    const h = harness();
    const outcome = await h.run();
    expect(outcome).toMatchObject({ status: 'published', text: GOOD });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
    const row = h.store.rows[0];
    expect(row).toMatchObject({
      kind: 'game',
      subject: AI_GAME_ID,
      status: 'published',
      text: GOOD,
      attempts: 1,
      model: AI_FEATURES.game.model,
      prompt_version: PROMPT_VERSION,
      input_tokens: 1_800,
      output_tokens: 40,
    });
    expect(row?.fact_hash).toMatch(/^[0-9a-f]{64}$/);
    // 1,800 in and 40 out on the game line's model (Sonnet 5.5, $2/$10, since M16.8).
    expect(row?.cost_usd).toBeCloseTo(0.004, 6);
    expect(h.meterState.ledger).toHaveLength(1);
  });

  it('is idempotent: a second ingest, a re-render, a rebuild make no call and no row', async () => {
    const h = harness();
    await h.run();
    expect(await h.run()).toMatchObject({ status: 'cached' });
    expect(await h.run()).toMatchObject({ status: 'cached' });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
  });

  it('two racing ingests (two companions) make one call', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.run(), h.run()]);
    expect([a.status, b.status].sort()).toEqual(['cached', 'published']);
    expect(h.transport.requests).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
  });

  it('retries once with the checker`s reason, then publishes', async () => {
    const h = harness({ answers: [BAD, GOOD] });
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.transport.requests).toHaveLength(2);
    expect(h.transport.requests[1]?.user).toMatch(
      /refused by the checker \(number: "10 kills" is not in the facts\)/,
    );
    expect(h.store.rows[0]).toMatchObject({ attempts: 2, input_tokens: 3_600 });
  });

  it('stores two refusals as rejected, shown nowhere, finished for good', async () => {
    const h = harness({ answers: [BAD, BAD, GOOD] });
    const outcome = await h.run();
    expect(outcome).toMatchObject({ status: 'rejected' });
    const row = h.store.rows[0];
    expect(row).toMatchObject({ status: 'rejected', text: BAD, attempts: 2 });
    expect(row?.reject_reason).toMatch(/^number:/);
    expect(
      renderLine({
        gate: h.gate,
        line: { status: row?.status ?? 'rejected', text: row?.text ?? null, tokenMap: row?.token_map ?? {} },
        optedOut: new Set(),
        nameOf: () => 'Nadia',
      }),
    ).toBeNull();
    expect(await h.run()).toMatchObject({ status: 'cached' });
    expect(h.transport.requests).toHaveLength(2);
  });

  it('retries a transient error once at once without using an attempt', async () => {
    const h = harness({ answers: [new AiTransportError('server', 529), GOOD] });
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.store.rows[0]?.attempts).toBe(1);
  });

  it('a second transient failure leaves the row failed; a later run inside the window takes it over', async () => {
    const h = harness({
      answers: [new AiTransportError('server', 503), new AiTransportError('server', 503), GOOD],
    });
    expect(await h.run()).toMatchObject({ status: 'failed', reason: 'transient:server' });
    expect(h.store.rows[0]?.status).toBe('failed');
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.store.rows).toHaveLength(1);
  });

  it('a pending row left by a dead generation is taken over once stale, never while fresh', async () => {
    const h = harness();
    const claim = await h.store.claim({
      groupId: AI_GROUP_ID,
      subject: { kind: 'game', gameId: AI_GAME_ID },
      facts: [],
      tokenMap: {},
      factHash: 'b'.repeat(64),
      model: 'claude-haiku-4-5-20251001',
      promptVersion: 'm16.5-1',
    });
    if (!claim.claimed) throw new Error('expected a claim');
    const row = h.store.rows[0] as (typeof h.store.rows)[number];
    // Fresh: another generation may still be running.
    row.updated_at = new Date(NOW.getTime() - 60_000).toISOString();
    expect(await h.run()).toMatchObject({ status: 'cached' });
    expect(h.transport.requests).toHaveLength(0);
    // Stale: its generation died after the claim.
    row.created_at = new Date(NOW.getTime() - PENDING_STALE_MS - 1).toISOString();
    row.updated_at = row.created_at;
    expect(await h.run()).toMatchObject({ status: 'published' });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
  });

  it('retakeable: stale pending inside the window only; never published, rejected or hidden', () => {
    const base = {
      ...(memoryRow() as object),
      created_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      updated_at: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
    } as Parameters<typeof retakeable>[0];
    expect(retakeable({ ...base, status: 'pending' }, NOW, GAME_LINE_WINDOW_MS)).toBe(true);
    expect(retakeable({ ...base, status: 'pending' }, NOW, 4 * 60_000)).toBe(false);
    expect(
      retakeable(
        { ...base, status: 'pending', updated_at: new Date(NOW.getTime() - 1_000).toISOString() },
        NOW,
        GAME_LINE_WINDOW_MS,
      ),
    ).toBe(false);
    for (const status of ['published', 'rejected', 'hidden'] as const) {
      expect(retakeable({ ...base, status }, NOW, GAME_LINE_WINDOW_MS)).toBe(false);
    }
  });

  it('a non-transient failure is final', async () => {
    const h = harness({ answers: [new AiTransportError('client', 400), GOOD] });
    expect(await h.run()).toMatchObject({ status: 'failed', reason: 'error:client' });
    expect(await h.run()).toMatchObject({ status: 'cached' });
    expect(h.transport.requests).toHaveLength(1);
  });

  it('at the cap or behind the kill switch: no call, nothing shown, ingest unaffected', async () => {
    const capped = harness();
    capped.meterState.groups.set(AI_GROUP_ID, { premium: true, linesEnabled: true, capUsd: 0 });
    expect(await capped.run()).toMatchObject({ status: 'failed', reason: 'refused:group_cap' });
    expect(capped.transport.requests).toHaveLength(0);

    const killed = harness();
    killed.meterState.callsEnabled = false;
    expect(await killed.run()).toMatchObject({ status: 'failed', reason: 'refused:kill_switch' });
    expect(killed.transport.requests).toHaveLength(0);

    const global = harness();
    global.meterState.globalCapUsd = 0;
    expect(await global.run()).toMatchObject({ status: 'failed', reason: 'refused:global_cap' });
    expect(global.transport.requests).toHaveLength(0);
  });

  it('with no key: skipped before anything is read', async () => {
    const h = harness({ noClient: true });
    expect(await h.run()).toEqual({ status: 'skipped', reason: 'no_key' });
    expect(h.loads).toEqual({ meta: 0, facts: 0 });
    expect(h.store.rows).toHaveLength(0);
  });

  it('with the group switch off, Premium off or an unreadable gate: no call, no row', async () => {
    for (const gate of [
      { premium: true, linesEnabled: false, premiumChangedAt: PREMIUM_SINCE },
      { premium: false, linesEnabled: true, premiumChangedAt: PREMIUM_SINCE },
      null,
    ]) {
      const h = harness({ gate });
      expect(await h.run()).toEqual({ status: 'skipped', reason: 'gate_closed' });
      expect(h.transport.requests).toHaveLength(0);
      expect(h.store.rows).toHaveLength(0);
    }
  });

  it('only live games recorded after Premium was switched on, and only while fresh', async () => {
    expect(await harness({ meta: { source: 'backfill' } }).run()).toEqual({
      status: 'skipped',
      reason: 'not_live',
    });
    expect(await harness({ meta: { createdAt: '2026-10-04T11:59:59Z' } }).run()).toEqual({
      status: 'skipped',
      reason: 'before_premium',
    });
    expect(
      await harness({
        meta: { createdAt: new Date(NOW.getTime() - GAME_LINE_WINDOW_MS - 1).toISOString() },
      }).run(),
    ).toEqual({ status: 'skipped', reason: 'stale' });
    expect(await harness({ meta: null }).run()).toEqual({ status: 'skipped', reason: 'no_game' });
  });

  it('leaves opted-out players out of the request, and skips when nobody is left', async () => {
    const h = harness({ optedOut: [playerId(1)] });
    await h.run();
    const request = h.transport.requests[0];
    expect(request?.user).not.toContain('Lee Sin');
    expect(Object.values(h.store.rows[0]?.token_map ?? {})).not.toContain(playerId(1));

    const everyone = harness({ optedOut: AI_GAME.seats.map((seat) => seat.playerId) });
    expect(await everyone.run()).toEqual({ status: 'skipped', reason: 'no_facts' });
    expect(everyone.transport.requests).toHaveLength(0);
  });

  it('never throws: a broken store is a logged failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    h.deps.store.read = async () => {
      throw new Error('db down');
    };
    expect(await h.run()).toEqual({ status: 'failed', lineId: null, reason: 'exception' });
  });
});

describe('gameLineEligibility', () => {
  const gate = { premium: true, linesEnabled: true, premiumChangedAt: PREMIUM_SINCE };
  it('a gate that never recorded a switch-on time writes no game line', () => {
    expect(
      gameLineEligibility(
        { id: AI_GAME_ID, groupId: AI_GROUP_ID, source: 'eog', createdAt: NOW.toISOString() },
        { ...gate, premiumChangedAt: null },
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'before_premium' });
  });
});

describe('the weekly storyline and the scouting report share the flow', () => {
  it('writes a week line once', async () => {
    const h = harness({
      answers: [
        "{P1} finished first on the week's board with 9 wins from 12 games. {P2} took 2nd place with 7 wins.",
      ],
    });
    expect(await generateWeekLine(h.deps, { groupId: AI_GROUP_ID, week: AI_WEEK })).toMatchObject({
      status: 'published',
    });
    expect(await generateWeekLine(h.deps, { groupId: AI_GROUP_ID, week: AI_WEEK })).toMatchObject({
      status: 'cached',
    });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.transport.requests[0]?.model).toBe('claude-sonnet-5-5');
    expect(h.store.rows[0]).toMatchObject({ kind: 'week', subject: '2026-09-27' });
  });

  it('writes a player report keyed by player and week; none for a settling or opted-out player', async () => {
    const h = harness({
      answers: ['{P1} has played 14 games on Lee Sin with 10 wins. Jungle is home with 30 games.'],
    });
    expect(await generatePlayerLine(h.deps, { groupId: AI_GROUP_ID, player: AI_PLAYER })).toMatchObject({
      status: 'published',
    });
    expect(h.store.rows[0]).toMatchObject({ kind: 'player', subject: `${AI_PLAYER.playerId}:2026-09-27` });
    expect(
      await generatePlayerLine(h.deps, {
        groupId: AI_GROUP_ID,
        player: { ...AI_PLAYER, ratedGames: 9, weekStart: '2026-10-04' },
      }),
    ).toEqual({ status: 'skipped', reason: 'no_facts' });
    const out = harness({ optedOut: [AI_PLAYER.playerId] });
    expect(await generatePlayerLine(out.deps, { groupId: AI_GROUP_ID, player: AI_PLAYER })).toEqual({
      status: 'skipped',
      reason: 'no_facts',
    });
    expect(out.transport.requests).toHaveLength(0);
  });
});

describe('M16.12 retry paths', () => {
  const WEEK_LINE =
    "{P1} finished first on the week's board with 9 wins from 12 games. {P2} took 2nd place with 7 wins.";

  /** A harness whose group starts at a $0 cap: every call is refused by the meter. */
  function capped(answers: string[] = [WEEK_LINE]) {
    const h = harness({ answers });
    const group = h.meterState.groups.get(AI_GROUP_ID);
    if (group === undefined) throw new Error('no group');
    group.capUsd = 0;
    return { ...h, lift: () => (group.capUsd = 2) };
  }

  it('a budget refusal is transient for a week line and uses no attempt', async () => {
    const h = capped();
    expect(await generateWeekLine(h.deps, { groupId: AI_GROUP_ID, week: AI_WEEK })).toMatchObject({
      status: 'failed',
      reason: 'transient:refused:group_cap',
    });
    expect(h.transport.requests).toHaveLength(0);
    expect(h.store.rows[0]).toMatchObject({ status: 'failed', attempts: 0 });
  });

  it('the kill switch is transient for a scouting report too', async () => {
    const h = harness({ answers: [GOOD] });
    h.meterState.callsEnabled = false;
    expect(await generatePlayerLine(h.deps, { groupId: AI_GROUP_ID, player: AI_PLAYER })).toMatchObject({
      status: 'failed',
      reason: 'transient:refused:kill_switch',
    });
  });

  it('a game line keeps its one immediate retry only: a budget refusal is final', async () => {
    const h = capped([GOOD]);
    expect(await h.run()).toMatchObject({ status: 'failed', reason: 'refused:group_cap' });
    expect(retakeable(h.store.rows[0] as never, NOW, GAME_LINE_WINDOW_MS)).toBe(false);
  });

  it('the daily retry writes the stored week line once the budget fits, from the stored facts', async () => {
    const h = capped();
    await generateWeekLine(h.deps, { groupId: AI_GROUP_ID, week: AI_WEEK });
    const subject = { kind: 'week' as const, weekStart: AI_WEEK.weekStart };
    // Still capped: no call, still failed.
    expect(await retryStoredLine(h.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'failed',
    });
    expect(h.transport.requests).toHaveLength(0);
    h.lift();
    expect(await retryStoredLine(h.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'published',
      text: WEEK_LINE,
    });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.transport.requests[0]?.user).toContain(renderFact(h.store.rows[0]?.facts[1] as never));
    // Published: a further retry is a no-op.
    expect(await retryStoredLine(h.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'cached',
    });
    expect(h.transport.requests).toHaveLength(1);
  });

  it('no retry outside the window, with the gate closed, with no row, or once someone named opted out', async () => {
    const subject = { kind: 'week' as const, weekStart: AI_WEEK.weekStart };

    const late = capped();
    await generateWeekLine(late.deps, { groupId: AI_GROUP_ID, week: AI_WEEK });
    late.lift();
    late.deps.now = () => new Date(NOW.getTime() + WEEKLY_RETRY_WINDOW_MS + 60_000);
    expect(await retryStoredLine(late.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'cached',
    });

    const closed = capped();
    await generateWeekLine(closed.deps, { groupId: AI_GROUP_ID, week: AI_WEEK });
    closed.lift();
    closed.deps.readGate = async () => ({
      premium: false,
      linesEnabled: true,
      premiumChangedAt: PREMIUM_SINCE,
    });
    expect(await retryStoredLine(closed.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'skipped',
      reason: 'gate_closed',
    });

    const none = harness();
    expect(await retryStoredLine(none.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'skipped',
    });

    const out = capped();
    await generateWeekLine(out.deps, { groupId: AI_GROUP_ID, week: AI_WEEK });
    out.lift();
    out.deps.readOptedOut = async () => new Set([playerId(1)]);
    expect(await retryStoredLine(out.deps, { groupId: AI_GROUP_ID, subject })).toMatchObject({
      status: 'skipped',
      reason: 'no_facts',
    });
    for (const h of [late, closed, none, out]) expect(h.transport.requests).toHaveLength(0);
  });

  it('the window cron schedules the retry in after(), for the closed week', async () => {
    const tasks: (() => Promise<unknown>)[] = [];
    const h = capped();
    await generateWeekLine(h.deps, { groupId: AI_GROUP_ID, week: AI_WEEK });
    h.lift();
    const window = {
      kind: 'last-week' as const,
      start: new Date('2026-09-27T03:00:00Z'),
      end: new Date('2026-10-04T03:00:00Z'),
      key: 'k',
    };
    scheduleStorylineRetry(
      { groupId: AI_GROUP_ID, window, timeZone: 'Africa/Cairo', deadline: NOW.getTime() + 10 * 60_000 },
      { schedule: (task) => tasks.push(task), deps: () => h.deps },
    );
    expect(tasks).toHaveLength(1);
    expect(h.transport.requests).toHaveLength(0);
    expect(await tasks[0]?.()).toMatchObject({ status: 'published' });
  });
});
