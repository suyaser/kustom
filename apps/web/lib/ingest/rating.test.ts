import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { rateStoredGame, selectWeekStates, WEEK_PAGE_SIZE } from './rating';

/**
 * The fold and the group's ratings epoch (M14.18): the epoch is read **before** a single
 * `game_players` row is claimed, and again right before the `ratings` upsert. A failing first read
 * throws with nothing written, so a retry can still rate the game.
 *
 * A fake client that answers the reads a rateable game needs (the game, its ten rows, the epoch)
 * and records every write anybody attempts.
 */
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

interface FakeOptions {
  /** The first epoch read fails (a timeout). */
  epochFails?: boolean;
  /** `groups.ratings_since`, one answer per read, in order (the last repeats). */
  epochs?: (string | null)[];
  /** `games.rated` (M15.3). Default true. */
  rated?: boolean;
}

function fakeClient(writes: string[], options: FakeOptions = {}): ServiceClient {
  let epochReads = 0;
  const game = {
    group_id: 'group-1',
    started_at: '2026-10-01T19:00:00.000Z',
    duration_s: 1_800,
    winning_side: 100,
    lobby_id: null,
    raw: { gameMode: 'CLASSIC' },
    rated: options.rated ?? true,
  };
  const players = Array.from({ length: 10 }, (_, index) => ({
    player_id: `player-${index}`,
    side: index < 5 ? 100 : 200,
    role: ROLES[index % 5],
    kills: 3,
    deaths: 3,
    assists: 3,
    gold: 10_000,
    damage_to_champs: 15_000,
    cs: 150,
    vision_score: 20,
    damage_self_mitigated: 12_000,
    damage_to_objectives: 3_000,
    mu_after: null,
    players: {
      puuid: `puuid-${index}`,
      rank_tier: null,
      rank_division: null,
      main_role: null,
      secondary_role: null,
    },
  }));
  const answers: Record<string, { data: unknown; error: { code: string; message: string } | null }> = {
    games: { data: game, error: null },
    game_players: { data: players, error: null },
    ratings: { data: [], error: null },
  };

  const chainFor = (table: string) => {
    let answer = answers[table] ?? { data: null, error: null };
    if (table === 'groups') {
      const epochs = options.epochs ?? [null];
      const since = epochs[Math.min(epochReads, epochs.length - 1)] ?? null;
      epochReads += 1;
      answer =
        options.epochFails && epochReads === 1
          ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
          : { data: { ratings_since: since }, error: null };
    }
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'range', 'gte', 'lt', 'lte']) {
      chain[method] = () => chain;
    }
    // The weekly track's read (M18.5) is the one `game_players` select with a `not`: nobody has
    // played earlier this week in this fake.
    chain.not = () => {
      answer = { data: [], error: null };
      return chain;
    };
    for (const method of ['update', 'upsert', 'insert', 'delete']) {
      chain[method] = () => {
        writes.push(`${table}.${method}`);
        return chain;
      };
    }
    chain.single = async () => answer;
    chain.maybeSingle = async () => answer;
    // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is a thenable; so is this fake.
    chain.then = (resolve: (value: unknown) => unknown) => resolve(answer);
    return chain;
  };
  // The claim (0043): one `apply_game_player_ratings` call for the ten, recorded as
  // `game_players.claim:<rows>`; nobody else has rated the game, so every row is written.
  const rpc = async (name: string, args: { p_rows: unknown[]; p_only_unrated: boolean }) => {
    if (name !== 'apply_game_player_ratings') throw new Error(`unexpected rpc ${name}`);
    writes.push(`game_players.claim:${args.p_rows.length}${args.p_only_unrated ? '' : ':overwrite'}`);
    return { data: args.p_rows.length, error: null };
  };
  return { from: chainFor, rpc } as unknown as ServiceClient;
}

describe('rateStoredGame and a failing epoch read', () => {
  it('throws before claiming any game_players row', async () => {
    const writes: string[] = [];
    await expect(rateStoredGame(fakeClient(writes, { epochFails: true }), 'game-1')).rejects.toThrow(
      'ratings epoch lookup failed',
    );
    expect(writes).toEqual([]);
  });
});

describe('rateStoredGame and a reset that lands mid-fold (M14.18)', () => {
  it('claims the rows but writes no ratings when the epoch moves past the game before the write', async () => {
    const writes: string[] = [];
    const result = await rateStoredGame(
      fakeClient(writes, { epochs: [null, '2026-10-02T00:00:00.000Z'] }),
      'game-1',
    );
    expect(result).toEqual({ rated: false, reason: 'before-reset', claimed: 10 });
    expect(writes.filter((write) => write.startsWith('game_players.'))).toEqual(['game_players.claim:10']);
    expect(writes).not.toContain('ratings.upsert');
  });

  it('folds a game that started before an epoch already in place on the weekly track only (M18.5)', async () => {
    const writes: string[] = [];
    const result = await rateStoredGame(
      fakeClient(writes, { epochs: ['2026-10-02T00:00:00.000Z'] }),
      'game-1',
    );
    // The weekly track ignores the reset: ten weekly rows claimed, no rating written.
    expect(result).toEqual({ rated: false, reason: 'before-reset', claimed: 10 });
    expect(writes.filter((write) => write.startsWith('game_players.'))).toEqual(['game_players.claim:10']);
    expect(writes).not.toContain('ratings.upsert');
  });

  it('writes the ratings when the epoch did not move', async () => {
    const writes: string[] = [];
    const result = await rateStoredGame(fakeClient(writes, { epochs: [null] }), 'game-1');
    expect(result.rated).toBe(true);
    expect(writes).toContain('ratings.upsert');
  });
});

describe('rateStoredGame and a game played not rated (M15.3)', () => {
  it('claims nothing, writes no rating and no role, and says not-rated', async () => {
    const writes: string[] = [];
    const result = await rateStoredGame(fakeClient(writes, { rated: false }), 'game-1');
    expect(result).toEqual({ rated: false, reason: 'not-rated', claimed: 0 });
    expect(writes).toEqual([]);
  });
});

describe('selectWeekStates pages the weekly read in a fixed order (M18.5)', () => {
  const game = { id: 'game-now', groupId: 'group-1', startedAt: '2026-09-09T20:00:00.000Z', lcuGameId: 50 };

  /** A fake that serves `pages` in turn and records the order and range calls. */
  function pagedClient(pages: unknown[][], calls: string[]): ServiceClient {
    let served = 0;
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'gte', 'lte']) chain[method] = () => chain;
    chain.order = (column: string) => {
      calls.push(`order:${column}`);
      return chain;
    };
    chain.range = (from: number, to: number) => {
      calls.push(`range:${from}-${to}`);
      return chain;
    };
    // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is a thenable; so is this fake.
    chain.then = (resolve: (value: unknown) => unknown) => {
      const data = pages[served] ?? [];
      served += 1;
      return resolve({ data, error: null });
    };
    return { from: () => chain } as unknown as ServiceClient;
  }

  const row = (playerId: string, lcu: number, hour: number, r: number, n: number) => ({
    player_id: playerId,
    game_id: `game-${lcu}`,
    week_r_after: r,
    week_games_before: n,
    games: { started_at: `2026-09-08T${String(hour).padStart(2, '0')}:00:00.000Z`, lcu_game_id: lcu },
  });

  it('reads past a full first page, so the latest row on page two is the one used', async () => {
    const calls: string[] = [];
    // A full first page of p1's early game (and filler), then the page with p1's latest game.
    const first = Array.from({ length: WEEK_PAGE_SIZE }, (_, index) =>
      index === 0 ? row('p1', 10, 18, 1216, 0) : row(`filler-${index}`, 10, 18, 1200, 0),
    );
    const second = [row('p1', 11, 19, 1230.5, 1), row('p2', 11, 19, 1185, 0)];
    const states = await selectWeekStates(pagedClient([first, second], calls), game, ['p1', 'p2', 'p3']);
    expect(states.get('p1')).toEqual({ r: 1230.5, n: 2 });
    expect(states.get('p2')).toEqual({ r: 1185, n: 1 });
    // Nobody played p3 this week: absent, which the fold reads as 1200 and 0.
    expect(states.has('p3')).toBe(false);
    expect(calls).toEqual([
      'order:game_id',
      'order:player_id',
      `range:0-${WEEK_PAGE_SIZE - 1}`,
      'order:game_id',
      'order:player_id',
      `range:${WEEK_PAGE_SIZE}-${2 * WEEK_PAGE_SIZE - 1}`,
    ]);
  });

  it('picks the latest by started_at then lcu_game_id whatever the page order, and skips later games', async () => {
    const calls: string[] = [];
    const later = {
      ...row('p1', 99, 23, 1300, 3),
      games: { started_at: '2026-09-09T21:00:00.000Z', lcu_game_id: 99 },
    };
    const states = await selectWeekStates(
      pagedClient(
        [[row('p1', 12, 19, 1240, 2), row('p1', 11, 19, 1230, 1), row('p1', 10, 18, 1216, 0), later]],
        calls,
      ),
      game,
      ['p1'],
    );
    expect(states.get('p1')).toEqual({ r: 1240, n: 3 });
    // One short page: one read.
    expect(calls).toHaveLength(3);
  });
});
