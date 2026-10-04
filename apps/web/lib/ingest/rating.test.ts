import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { rateStoredGame } from './rating';

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
    for (const method of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'range', 'gte', 'lt']) {
      chain[method] = () => chain;
    }
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
  return { from: chainFor } as unknown as ServiceClient;
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
    expect(writes.filter((write) => write === 'game_players.update')).toHaveLength(10);
    expect(writes).not.toContain('ratings.upsert');
  });

  it('never claims a game that started before an epoch already in place', async () => {
    const writes: string[] = [];
    const result = await rateStoredGame(
      fakeClient(writes, { epochs: ['2026-10-02T00:00:00.000Z'] }),
      'game-1',
    );
    expect(result).toEqual({ rated: false, reason: 'before-reset', claimed: 0 });
    expect(writes).toEqual([]);
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
