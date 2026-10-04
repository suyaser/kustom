import 'server-only';
import { SETTLING_GAMES } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { championName } from '../champs/names';
import type { ClosedWindow } from '../night';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import { getServiceClient, type ServiceClient } from '../supabase';
import { afterResponse, type Scheduler } from './afterIngest';
import { AI_TIMEOUT_MS } from './client';
import {
  DUO_MIN_GAMES,
  FIRST_CHAMPION_MIN_GAMES,
  type PlayerExtras,
  type PlayerFactsInput,
  ROLE_SHIFT_MIN_GAMES,
} from './facts';
import { type GenerateOutcome, generateDepsFor, generatePlayerLine } from './generate';
import { dbLineStore, readOptedOut, subjectKey } from './store';
import { weekStartDay } from './storyline';

/**
 * The player scouting report (M16.6; brief m16.1 1.2, 1.3, 4.1). Two or three lines on a regular's
 * page, written on the Sunday job from the group's own rated games, stored once per player-week
 * (`ai_lines`, kind `player`, subject `<players.id>:<week's Sunday>`) and never on a page view.
 *
 * - **Who**: players with {@link SETTLING_GAMES}+ rated games in the group (the settling chip's
 *   count, `ratings.games`) who played a rated game in the closed week, and have not opted out.
 *   Anyone else keeps last week's report, or has none.
 * - **When**: the window cron (`GET /api/cron/window`) schedules {@link runScouting} per group in
 *   `after()`, gate first. The cron is idempotent and runs again; a report already stored is a
 *   `cached` no-op, so work that missed this call's deadline is picked up by the next one.
 * - **Within the function's limit**: at most {@link SCOUTING_CONCURRENCY} players at a time
 *   **across every group of the run** (one limiter per process, shared by all the groups the cron
 *   scheduled), no player started within {@link SCOUTING_START_MARGIN_MS} of the deadline the route
 *   hands in, and the deadline passed down to generation, which starts no model call (first try,
 *   transient retry or second attempt) that could still be running past it.
 * - **The page** (`loadPlayerScouting`, `scoutingRead.ts`, which imports no generator) reads the player's newest report: published shows,
 *   hidden shows nothing (Hide is for everyone), the gate and opt-outs are read at render.
 *
 * Everything here fails closed and silently (brief 4.6): any error is no report.
 */

/** Players written at once, across every group of one cron run (the process-wide limiter). */
export const SCOUTING_CONCURRENCY = 4;

/**
 * No new player is started this close to the deadline: the reads plus one model call (at most
 * `AI_TIMEOUT_MS`). Later calls for that player are bounded by the deadline inside generation.
 */
export const SCOUTING_START_MARGIN_MS = AI_TIMEOUT_MS + 2_000;

/** A player's champion and role pool is read at most this many pages (5,000 games). */
const POOL_PAGE = 1000;
const POOL_MAX_PAGES = 5;
/** Games per teammate read: ten seats each, under PostgREST's 1,000-row page. */
const TEAMMATE_CHUNK = 90;

/** The group-wide reads (ratings, the week's seats) page through at most this many rows, then throw. */
const READ_PAGE = 1000;
export const READ_MAX_PAGES = 20;

/** A counting semaphore: `run` waits for one of `max` slots. */
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next(); // the slot passes straight to the next waiter
  };
  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

/** One per process: every group the window cron schedules in this invocation shares it. */
const SCOUTING_LIMITER = createLimiter(SCOUTING_CONCURRENCY);

/* ---------------------------------------------------------------------------------------------
 * Facts input (pure)
 * ------------------------------------------------------------------------------------------- */

/** One rated game of the player in the group, as the pool needs it. */
export interface PoolRow {
  championId: number | null;
  role: RoleValue | null;
  won: boolean;
  /** M16.19 (optional: the extras need them): when, the champion's name, their numbers, teammates. */
  startedAt?: string;
  /** The champion's name, when the caller has it (else `championName(championId)`). */
  champion?: string | null;
  kills?: number;
  assists?: number;
  /** `players.id` of the other four on their side. */
  teammates?: readonly string[];
}

const nameOfRow = (row: PoolRow): string | null =>
  row.champion !== undefined
    ? row.champion
    : row.championId === null
      ? null
      : championName(row.championId, null);

/**
 * The facts a report leads with that the page does not (M16.19), from the player's rated pool
 * (pure): their best duo partner, the week's best game, a champion new to their pool that week,
 * and a role shift. Each is absent when the rows cannot back it; a partner who opted out is never
 * a duo. Rows without `startedAt` count as before the week.
 */
export function scoutingExtrasOf(input: {
  pool: readonly PoolRow[];
  window: Pick<ClosedWindow, 'start' | 'end'>;
  optedOut: ReadonlySet<string>;
}): PlayerExtras {
  const start = input.window.start.getTime();
  const end = input.window.end.getTime();
  const inWeek = (row: PoolRow) => {
    if (row.startedAt === undefined) return false;
    const at = Date.parse(row.startedAt);
    return at >= start && at < end;
  };
  const week = input.pool.filter(inWeek);
  const before = input.pool.filter(
    (row) => !inWeek(row) && (row.startedAt === undefined || Date.parse(row.startedAt) < start),
  );
  const extras: PlayerExtras = {};

  // The duo: most wins together, then the better share; a tie on both is nobody.
  const together = new Map<string, { games: number; wins: number }>();
  for (const row of input.pool) {
    for (const mate of row.teammates ?? []) {
      if (input.optedOut.has(mate)) continue;
      const entry = together.get(mate) ?? { games: 0, wins: 0 };
      entry.games += 1;
      if (row.won) entry.wins += 1;
      together.set(mate, entry);
    }
  }
  const duos = [...together]
    .filter(([, entry]) => entry.games >= DUO_MIN_GAMES)
    .sort(([, a], [, b]) => b.wins - a.wins || b.wins / b.games - a.wins / a.games);
  const [top, next] = duos;
  if (
    top !== undefined &&
    (next === undefined || next[1].wins !== top[1].wins || next[1].games !== top[1].games)
  ) {
    extras.duo = { partnerId: top[0], games: top[1].games, wins: top[1].wins };
  }

  // The week's best game: most kills plus assists, the first one on a tie.
  let best: PoolRow | null = null;
  for (const row of week) {
    if (row.kills === undefined || row.assists === undefined) continue;
    if (best === null || row.kills + row.assists > (best.kills ?? 0) + (best.assists ?? 0)) best = row;
  }
  if (best !== null && (best.kills ?? 0) + (best.assists ?? 0) > 0) {
    extras.bestGame = {
      champion: nameOfRow(best),
      kills: best.kills ?? 0,
      assists: best.assists ?? 0,
      won: best.won,
    };
  }

  // A champion new to their pool: first played this week, after enough earlier games to mean it.
  if (before.length >= FIRST_CHAMPION_MIN_GAMES) {
    const seen = new Set(before.map(nameOfRow));
    const fresh = new Map<string, number>();
    for (const row of week) {
      const name = nameOfRow(row);
      if (name !== null && !seen.has(name)) fresh.set(name, (fresh.get(name) ?? 0) + 1);
    }
    const [first] = [...fresh].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (first !== undefined) extras.newChampion = { name: first[0], games: first[1] };
  }

  // A role shift: the week's one main role is not their usual one.
  const soleTop = (rows: readonly PoolRow[]): { role: RoleValue; games: number } | null => {
    const counts = new Map<RoleValue, number>();
    for (const row of rows) if (row.role !== null) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    const [a, b] = sorted;
    return a === undefined || (b !== undefined && b[1] === a[1]) ? null : { role: a[0], games: a[1] };
  };
  const weekRole = soleTop(week);
  const usual = soleTop(before);
  if (
    weekRole !== null &&
    usual !== null &&
    weekRole.role !== usual.role &&
    weekRole.games >= ROLE_SHIFT_MIN_GAMES
  ) {
    extras.roleShift = { weekRole: weekRole.role, weekGames: weekRole.games, usualRole: usual.role };
  }
  return extras;
}

/**
 * The fact builder's input for one player (pure). Champions are named as the site names them;
 * `buildPlayerFacts` keeps only roster champions and figures from 5+ games.
 */
export function scoutingInputOf(input: {
  playerId: string;
  weekStart: string;
  rating: { games: number; wins: number };
  week: { games: number; wins: number };
  pool: readonly PoolRow[];
  /** M16.19: the extras, when the window is known (production and the eval pass it). */
  extras?: { window: Pick<ClosedWindow, 'start' | 'end'>; optedOut: ReadonlySet<string> };
}): PlayerFactsInput {
  const champions = new Map<string, { games: number; wins: number }>();
  const roles = new Map<RoleValue, { games: number; wins: number }>();
  for (const row of input.pool) {
    const name = nameOfRow(row);
    if (name !== null) {
      const entry = champions.get(name) ?? { games: 0, wins: 0 };
      entry.games += 1;
      if (row.won) entry.wins += 1;
      champions.set(name, entry);
    }
    if (row.role !== null) {
      const entry = roles.get(row.role) ?? { games: 0, wins: 0 };
      entry.games += 1;
      if (row.won) entry.wins += 1;
      roles.set(row.role, entry);
    }
  }
  return {
    playerId: input.playerId,
    weekStart: input.weekStart,
    ratedGames: input.rating.games,
    wins: input.rating.wins,
    weekGames: input.week.games,
    weekWins: input.week.wins,
    champions: [...champions].map(([name, entry]) => ({ name, ...entry })),
    roles: [...roles].map(([role, entry]) => ({ role, ...entry })),
    ...(input.extras === undefined
      ? {}
      : {
          extras: scoutingExtrasOf({
            pool: input.pool,
            window: input.extras.window,
            optedOut: input.extras.optedOut,
          }),
        }),
  };
}

/**
 * Who gets a report this week (pure): settled (`ratings.games` at least {@link SETTLING_GAMES}),
 * played a rated game in the week, not opted out. In the board's order of most games, then id, so a
 * deadline cuts the same players every call.
 */
export function scoutingCandidates(input: {
  ratings: ReadonlyMap<string, { games: number; wins: number }>;
  week: ReadonlyMap<string, { games: number; wins: number }>;
  optedOut: ReadonlySet<string>;
}): string[] {
  return [...input.week]
    .filter(([playerId, week]) => {
      const rating = input.ratings.get(playerId);
      return (
        week.games > 0 &&
        rating !== undefined &&
        rating.games >= SETTLING_GAMES &&
        !input.optedOut.has(playerId)
      );
    })
    .sort(([a, wa], [b, wb]) => wb.games - wa.games || (a < b ? -1 : a > b ? 1 : 0))
    .map(([playerId]) => playerId);
}

/* ---------------------------------------------------------------------------------------------
 * The Sunday run
 * ------------------------------------------------------------------------------------------- */

export interface ScoutingDeps {
  readGate: (groupId: string) => Promise<AiGate | null>;
  readOptedOut: (groupId: string) => Promise<ReadonlySet<string>>;
  /** `ratings.games` / `wins` per settled player in the group, opted-out players never read. */
  readRatings: (
    groupId: string,
    optedOut: ReadonlySet<string>,
  ) => Promise<ReadonlyMap<string, { games: number; wins: number }>>;
  /** Rated games and wins per player inside the closed week, opted-out players never read. */
  readWeek: (
    groupId: string,
    window: ClosedWindow,
    optedOut: ReadonlySet<string>,
  ) => Promise<ReadonlyMap<string, { games: number; wins: number }>>;
  /** The player's rated games in the group since the ratings epoch, or null when unreadable. */
  readPool: (groupId: string, playerId: string) => Promise<PoolRow[] | null>;
  /** A row for this player-week exists already (any status): skip the reads. */
  hasLine: (groupId: string, playerId: string, weekStart: string) => Promise<boolean>;
  /** `deadline`: epoch ms; generation starts no model call that could run past it. */
  generate: (input: {
    groupId: string;
    player: PlayerFactsInput;
    deadline: number;
  }) => Promise<GenerateOutcome>;
  now: () => number;
  /** The shared limiter; tests pass their own. */
  limiter?: Limiter;
}

export interface ScoutingRun {
  candidates: number;
  attempted: number;
  /** Not started: the deadline came first. The next cron call picks them up. */
  deferred: number;
  outcomes: Record<string, number>;
}

/**
 * Writes this week's reports for one group. Gate first: a group without Premium costs one read.
 * Never throws (a failure is a logged null).
 */
export async function runScouting(
  deps: ScoutingDeps,
  input: { groupId: string; window: ClosedWindow; weekStart: string; deadline: number },
): Promise<ScoutingRun | null> {
  try {
    if (!aiGateOpen(await deps.readGate(input.groupId))) return null;
    // Opt-outs first: an opted-out player's rows are never read (D6).
    const optedOut = await deps.readOptedOut(input.groupId);
    const [ratings, week] = await Promise.all([
      deps.readRatings(input.groupId, optedOut),
      deps.readWeek(input.groupId, input.window, optedOut),
    ]);
    const limiter = deps.limiter ?? SCOUTING_LIMITER;
    const queue = scoutingCandidates({ ratings, week, optedOut });
    const run: ScoutingRun = { candidates: queue.length, attempted: 0, deferred: 0, outcomes: {} };
    const count = (status: string) => {
      run.outcomes[status] = (run.outcomes[status] ?? 0) + 1;
    };

    const one = async (playerId: string): Promise<void> => {
      // Checked after the wait for a slot: the wait itself may have used up the time.
      if (deps.now() > input.deadline - SCOUTING_START_MARGIN_MS) {
        run.deferred += 1;
        return;
      }
      run.attempted += 1;
      try {
        if (await deps.hasLine(input.groupId, playerId, input.weekStart)) {
          count('cached');
          return;
        }
        const pool = await deps.readPool(input.groupId, playerId);
        if (pool === null) {
          count('no_pool');
          return;
        }
        const player = scoutingInputOf({
          playerId,
          weekStart: input.weekStart,
          rating: ratings.get(playerId) ?? { games: 0, wins: 0 },
          week: week.get(playerId) ?? { games: 0, wins: 0 },
          pool,
          extras: { window: input.window, optedOut },
        });
        count((await deps.generate({ groupId: input.groupId, player, deadline: input.deadline })).status);
      } catch (error) {
        count('error');
        console.error('ai scouting: one report failed', error instanceof Error ? error.message : 'unknown');
      }
    };
    const worker = async () => {
      for (;;) {
        const playerId = queue.shift();
        if (playerId === undefined) return;
        await limiter.run(() => one(playerId));
      }
    };
    await Promise.all(Array.from({ length: SCOUTING_CONCURRENCY }, worker));
    console.info(
      `ai: scouting ${input.weekStart}: ${run.candidates} candidates, ${run.attempted} attempted, ${run.deferred} deferred ${JSON.stringify(run.outcomes)}`,
    );
    return run;
  } catch (error) {
    console.error('ai scouting: none this call', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------
 * Database reads (production wiring)
 * ------------------------------------------------------------------------------------------- */

async function readRatingsSinceOrNull(service: ServiceClient, groupId: string): Promise<string | null> {
  const { data, error } = await service
    .from('groups')
    .select('ratings_since')
    .eq('id', groupId)
    .maybeSingle();
  if (error) return null;
  return (data as { ratings_since?: string | null } | null)?.ratings_since ?? null;
}

/**
 * Every row of a paged read, or a throw once there are more than {@link READ_MAX_PAGES} pages (the
 * run fails closed: no report rather than a report from part of the week).
 */
export async function readAllPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; ; index += 1) {
    if (index >= READ_MAX_PAGES)
      throw new Error(`ai scouting: ${label} has more than ${READ_MAX_PAGES * READ_PAGE} rows`);
    const { data, error } = await page(index * READ_PAGE, index * READ_PAGE + READ_PAGE - 1);
    if (error) throw new Error(`ai scouting: ${label} read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < READ_PAGE) return rows;
  }
}

/** The query without the given players (ids are uuids, safe inside PostgREST's list syntax). */
function withoutPlayers<Q extends { not: (column: string, operator: string, value: string) => Q }>(
  query: Q,
  optedOut: ReadonlySet<string>,
): Q {
  return optedOut.size === 0 ? query : query.not('player_id', 'in', `(${[...optedOut].join(',')})`);
}

export function scoutingDepsFor(service: ServiceClient): ScoutingDeps {
  const generateDeps = generateDepsFor(service);
  return {
    readGate: (groupId) => readAiGate(service, groupId),
    readOptedOut: (groupId) => readOptedOut(service, groupId),
    async readRatings(groupId, optedOut) {
      const data = await readAllPages('ratings', (from, to) =>
        withoutPlayers(
          service
            .from('ratings')
            .select('player_id, games, wins')
            .eq('group_id', groupId)
            .gte('games', SETTLING_GAMES),
          optedOut,
        )
          .order('player_id', { ascending: true })
          .range(from, to),
      );
      return new Map(data.map((row) => [row.player_id, { games: row.games, wins: row.wins }]));
    },
    async readWeek(groupId, window, optedOut) {
      const data = await readAllPages('the week', (from, to) =>
        withoutPlayers(
          service
            .from('game_players')
            .select('player_id, side, games!inner(group_id, started_at, winning_side, rated)')
            .eq('games.group_id', groupId)
            .eq('games.rated', true)
            .gte('games.started_at', window.start.toISOString())
            .lt('games.started_at', window.end.toISOString()),
          optedOut,
        )
          .order('game_id', { ascending: true })
          .order('player_id', { ascending: true })
          .range(from, to),
      );
      const week = new Map<string, { games: number; wins: number }>();
      for (const row of data) {
        const game = row.games as unknown as { winning_side: number } | null;
        if (game === null) continue;
        const entry = week.get(row.player_id) ?? { games: 0, wins: 0 };
        entry.games += 1;
        if (game.winning_side === row.side) entry.wins += 1;
        week.set(row.player_id, entry);
      }
      return week;
    },
    async readPool(groupId, playerId) {
      try {
        const since = await readRatingsSinceOrNull(service, groupId);
        const rows: (PoolRow & { gameId: string; side: number })[] = [];
        for (let page = 0; ; page += 1) {
          if (page >= POOL_MAX_PAGES) return null;
          let query = service
            .from('game_players')
            .select(
              'game_id, side, role, champion_id, kills, assists, games!inner(group_id, started_at, winning_side, rated)',
            )
            .eq('player_id', playerId)
            .eq('games.group_id', groupId)
            .eq('games.rated', true);
          if (since !== null) query = query.gte('games.started_at', since);
          const { data, error } = await query
            .order('game_id', { ascending: true })
            .range(page * POOL_PAGE, page * POOL_PAGE + POOL_PAGE - 1);
          if (error) throw new Error(error.message);
          for (const row of data ?? []) {
            const game = row.games as unknown as { winning_side: number; started_at: string } | null;
            if (game === null) continue;
            rows.push({
              gameId: row.game_id,
              side: row.side,
              championId: row.champion_id,
              role: row.role,
              won: game.winning_side === row.side,
              startedAt: game.started_at,
              kills: row.kills,
              assists: row.assists,
            });
          }
          if ((data ?? []).length < POOL_PAGE) break;
        }
        // M16.19: their teammates in each of those games, for the duo partner.
        const mates = new Map<string, string[]>();
        const ids = rows.map((row) => row.gameId);
        for (let at = 0; at < ids.length; at += TEAMMATE_CHUNK) {
          const { data, error } = await service
            .from('game_players')
            .select('game_id, player_id, side')
            .in('game_id', ids.slice(at, at + TEAMMATE_CHUNK))
            .neq('player_id', playerId);
          if (error) throw new Error(error.message);
          const sideOf = new Map(rows.map((row) => [row.gameId, row.side]));
          for (const seat of data ?? []) {
            if (seat.side !== sideOf.get(seat.game_id)) continue;
            const list = mates.get(seat.game_id) ?? [];
            list.push(seat.player_id);
            mates.set(seat.game_id, list);
          }
        }
        return rows.map(({ gameId, side: _side, ...row }) => ({
          ...row,
          teammates: mates.get(gameId) ?? [],
        }));
      } catch (error) {
        console.error('ai scouting: no pool', error instanceof Error ? error.message : 'unknown error');
        return null;
      }
    },
    async hasLine(groupId, playerId, weekStart) {
      const row = await dbLineStore(service).read(
        groupId,
        'player',
        subjectKey({ kind: 'player', playerId, weekStart }),
      );
      return row !== null && row.status !== 'failed' && row.status !== 'pending';
    },
    generate: ({ deadline, ...input }) => generatePlayerLine({ ...generateDeps, deadline }, input),
    now: () => Date.now(),
  };
}

/**
 * The window cron's call, once per group per run: schedule this week's reports in `after()` and
 * return at once. Never throws, never waits.
 */
export function scheduleScouting(
  input: { groupId: string; window: ClosedWindow; timeZone: string; deadline: number },
  options: { schedule?: Scheduler; deps?: () => ScoutingDeps } = {},
): void {
  try {
    const schedule = options.schedule ?? afterResponse;
    const deps = options.deps ?? (() => scoutingDepsFor(getServiceClient()));
    const weekStart = weekStartDay(input.window, input.timeZone);
    schedule(async () =>
      runScouting(deps(), {
        groupId: input.groupId,
        window: input.window,
        weekStart,
        deadline: input.deadline,
      }),
    );
  } catch (error) {
    console.error('ai scouting: not scheduled', error instanceof Error ? error.message : 'unknown error');
  }
}
