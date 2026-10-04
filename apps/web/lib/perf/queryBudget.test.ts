import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Fixtures, type Recording, recordingClient } from '../testing/recordingClient';

/**
 * Query budgets for the page loaders (app-perf, 2026-10-04): each loader, run against the
 * recording fake client over a small group, may make at most `queries` requests in at most `waves`
 * round trips one after another, and never select `games.raw` whole. A change that adds a
 * sequential read, an N+1 loop or a duplicate read fails here, in CI, with no local stack.
 *
 * The budgets are today's numbers (the fixture's group is small, so chunked reads are one chunk);
 * lower one when a loader gets cheaper, never raise one without a decision row.
 *
 * The same-name roster labels (`lib/names/roster.ts`) and the closed-week awards (`lib/stats`) are
 * other loaders with their own owners; they are stubbed here to zero requests so these budgets
 * measure only the code under them.
 */

vi.mock('../names/roster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../names/roster')>();
  return { ...actual, loadRosterLabels: async () => actual.NO_LABELS };
});

const GROUP = '00000000-0000-0000-0000-00000000a001';
const LOBBY = (n: number) => `00000000-0000-0000-0000-0000000b000${n}`;
const GAME = (n: number) => `00000000-0000-0000-0000-0000000c000${n}`;
const PID = (n: number) => `00000000-0000-0000-0000-0000000d00${String(n).padStart(2, '0')}`;
const PUUID = (n: number) => `puuid-${n}`;
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const NOW = new Date('2026-10-07T12:00:00.000Z');

function fixtures(): Fixtures {
  const players = Array.from({ length: 10 }, (_, n) => ({
    id: PID(n),
    puuid: PUUID(n),
    display_name: `Player ${n}`,
    game_name: `Player ${n}`,
    tag_line: 'EUW',
    rank_tier: null,
    rank_division: null,
    main_role: ROLES[n % 5],
  }));
  const games = Array.from({ length: 6 }, (_, n) => ({
    id: GAME(n),
    group_id: GROUP,
    lcu_game_id: 9000 + n,
    started_at: new Date(NOW.getTime() - (n + 1) * 3_600_000).toISOString(),
    duration_s: 1_800,
    winning_side: n % 2 === 0 ? 100 : 200,
    lobby_id: n < 4 ? LOBBY(n) : null,
    rated: true,
    rule: null,
    rule_class_tag: null,
    rule_region_blue: null,
    rule_region_red: null,
    rule_checked: false,
    rule_no_draw: false,
    source: 'live',
    mode: 'CLASSIC',
    gameMode: 'CLASSIC',
    game_mode: 'CLASSIC',
    // 0041: every game has its current facts row, so no read falls back to raw.
    game_facts: [{ facts_version: 1, facts: { byPuuid: {}, bans: [] } }],
    created_at: NOW.toISOString(),
  }));
  const seat = (game: (typeof games)[number], n: number) => ({
    game_id: game.id,
    group_id: GROUP,
    player_id: PID(n),
    players_public: { puuid: PUUID(n) },
    side: n < 5 ? 100 : 200,
    role: ROLES[n % 5],
    champion_id: 1 + n,
    kills: 5,
    deaths: 3,
    assists: 7,
    gold: 11_000,
    damage_to_champs: 20_000,
    cs: 180,
    vision_score: 30,
    damage_self_mitigated: 15_000,
    damage_to_objectives: 5_000,
    mu_before: 25,
    sigma_before: 4,
    mu_after: 25.4,
    sigma_after: 3.9,
    fold_p: 0.5,
    base_mu_after: 25.3,
    award: null,
    rated_games_before: 3,
    games: {
      started_at: game.started_at,
      group_id: GROUP,
      lcu_game_id: game.lcu_game_id,
      duration_s: game.duration_s,
      winning_side: game.winning_side,
      lobby_id: game.lobby_id,
    },
  });
  const team = (from: number) =>
    Array.from({ length: 5 }, (_, i) => ({ puuid: PUUID(from + i), role: ROLES[i] }));
  return {
    groups_public: [{ id: GROUP, slug: 'perf', name: 'Perf', ratings_since: null }],
    players_public: players,
    group_members_public: players.map((player) => ({ group_id: GROUP, player_id: player.id })),
    ratings: players.map((player) => ({
      group_id: GROUP,
      player_id: player.id,
      mu: 25,
      sigma: 4,
      games: 12,
      wins: 6,
      seed_mu: null,
      seed_sigma: null,
      seed_rank_tier: null,
      seed_rank_division: null,
    })),
    games,
    game_players: games.flatMap((game) => Array.from({ length: 10 }, (_, n) => seat(game, n))),
    splits: games.flatMap((game) =>
      game.lobby_id === null
        ? []
        : [
            {
              lobby_id: game.lobby_id,
              roster_key: 'k',
              rank: 1,
              is_chosen: true,
              blue_win_prob: 0.55,
              gap: 20,
              off_role_count: 0,
              blue: team(0),
              red: team(5),
              explanation: 'x',
            },
          ],
    ),
    group_memberships: players.map((player, n) => ({
      group_id: GROUP,
      role: n === 0 ? 'owner' : 'member',
      ai_opt_out: false,
      players: { ...player, discord_id: null },
    })),
    group_modes: [
      {
        group_id: GROUP,
        mode: 'fearless',
        updated_at: NOW.toISOString(),
        pending_rule: null,
        pending_class_tag: null,
        rated_override: null,
        version: 1,
      },
    ],
    fearless_state: [{ group_id: GROUP, reset_at: '2026-01-01T00:00:00.000Z' }],
  };
}

/** Runs `load` against a fresh recording client; the loader's answer is returned for sanity. */
async function measure<T>(load: (client: never) => Promise<T>): Promise<{ result: T; recording: Recording }> {
  const { client, recording } = recordingClient(fixtures());
  const result = await load(client);
  return { result, recording };
}

function expectWithin(recording: Recording, budget: { queries: number; waves: number }) {
  const seen = { queries: recording.count(), waves: recording.waves() };
  if (process.env.BUDGET_DEBUG)
    process.stdout.write(
      `BUDGET ${JSON.stringify(seen)} ${recording.requests.map((r) => `${r.wave}:${r.table}`).join(' ')}\n`,
    );
  expect(seen, JSON.stringify(recording.requests.map((r) => `${r.wave} ${r.table}`))).toEqual({
    queries: Math.min(seen.queries, budget.queries),
    waves: Math.min(seen.waves, budget.waves),
  });
  expect(recording.rawSelects()).toEqual([]);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('query budgets', () => {
  it('the board, This week: one round of independent reads, then the window', async () => {
    const { loadBoard } = await import('../board/load');
    const { result, recording } = await measure((client) =>
      loadBoard(client, { window: 'this-week', groupId: GROUP, now: NOW, timeZone: 'Europe/London' }),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expectWithin(recording, { queries: 7, waves: 4 });
  });

  it('the board, All time', async () => {
    const { loadBoard } = await import('../board/load');
    const { result, recording } = await measure((client) =>
      loadBoard(client, { window: 'all-time', groupId: GROUP, now: NOW, timeZone: 'Europe/London' }),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expectWithin(recording, { queries: 6, waves: 3 });
  });

  it('a player page: no group-wide game list, the rank from the same ratings read', async () => {
    const { loadPlayerBoard } = await import('../board/load');
    const { result, recording } = await measure((client) =>
      loadPlayerBoard(client, PUUID(3), {
        window: 'all-time',
        groupId: GROUP,
        now: NOW,
        timeZone: 'Europe/London',
      }),
    );
    expect(result?.recent.length).toBeGreaterThan(0);
    expectWithin(recording, { queries: 10, waves: 4 });
    expect(recording.count('ratings')).toBe(1);
  });

  it('the Games list, page 1: the page and its count are one request', async () => {
    const { loadGamesList } = await import('../games/list');
    const { result, recording } = await measure((client) =>
      loadGamesList(client, {
        groupId: GROUP,
        filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
        viewerPuuid: Promise.resolve(PUUID(1)),
        timeZone: 'Europe/London',
        now: NOW,
        calibration: async () => ({ n: 0, favoredWon: 0, expectedPct: null, actualPct: null }),
      }),
    );
    expect(result.items.length).toBeGreaterThan(0);
    expectWithin(recording, { queries: 5, waves: 2 });
  });

  it('the Games list filtered to a player', async () => {
    const { loadGamesList } = await import('../games/list');
    const { result, recording } = await measure((client) =>
      loadGamesList(client, {
        groupId: GROUP,
        filters: { window: 'all-time', mode: 'sr', player: PUUID(2), page: 1 },
        viewerPuuid: null,
        timeZone: 'Europe/London',
        now: NOW,
        calibration: async () => ({ n: 0, favoredWon: 0, expectedPct: null, actualPct: null }),
      }),
    );
    expect(result.focusName).not.toBeNull();
    expectWithin(recording, { queries: 6, waves: 3 });
  });

  it('the calibration line (uncached): four rounds, chunks in parallel', async () => {
    const { readGroupCalibration } = await import('../games/read');
    const { recording } = await measure((client) => readGroupCalibration(client, GROUP));
    expectWithin(recording, { queries: 4, waves: 4 });
  });

  it('a game page: the game, its scoreboard and the calibration in one round', async () => {
    const { loadGameDetail } = await import('../games/detail');
    const { recordingClient: make } = await import('../testing/recordingClient');
    // The one page allowed `raw` whole (one row); its own fixture carries a blob.
    const data = fixtures();
    data.games = (data.games ?? []).map((game) => ({ ...game, raw: { gameMode: 'CLASSIC', teams: [] } }));
    const { client, recording } = make(data);
    const result = await loadGameDetail(client, {
      gameId: GAME(1),
      groupId: GROUP,
      viewerPuuid: null,
      timeZone: 'Europe/London',
      calibration: async () => ({ n: 0, favoredWon: 0, expectedPct: null, actualPct: null }),
    });
    expect(result?.gameId).toBe(GAME(1));
    expect({ queries: recording.count(), waves: recording.waves() }).toEqual({ queries: 4, waves: 2 });
  });

  it("a game's breakdown: two rounds", async () => {
    const { loadGameBreakdowns } = await import('../breakdown/load');
    const { result, recording } = await measure((client) => loadGameBreakdowns(client, [GAME(1)]));
    expect(result.size).toBe(1);
    expectWithin(recording, { queries: 4, waves: 2 });
  });

  it('the fearless pool: the mode row once, never the raw blob', async () => {
    const { loadFearless } = await import('../fearless/load');
    const { recording } = await measure((client) => loadFearless(client, GROUP));
    expectWithin(recording, { queries: 3, waves: 2 });
  });

  it('the player page stats: only their games (0042 index), three rounds', async () => {
    const { loadPlayerStats } = await import('../stats/load');
    const { result, recording } = await measure((client) =>
      loadPlayerStats(client, PUUID(3), {
        window: 'all-time',
        groupId: GROUP,
        now: NOW,
        timeZone: 'Europe/London',
      }),
    );
    expect(result.games).toBe(6);
    expectWithin(recording, { queries: 5, waves: 3 });
  });

  it("You vs them: only the viewer's games, three rounds", async () => {
    const { loadYouVersus } = await import('../versus/you');
    const { result, recording } = await measure((client) =>
      loadYouVersus(client, { groupId: GROUP, viewerPuuid: PUUID(3), timeZone: 'Europe/London' }),
    );
    expect(result.length).toBe(9);
    expectWithin(recording, { queries: 5, waves: 3 });
  });

  it('Stats Records: the facts come with the games (0041), never a raw path', async () => {
    const { loadRecordsSegment } = await import('../stats/load');
    const { result, recording } = await measure((client) =>
      loadRecordsSegment(client, { window: 'all-time', groupId: GROUP, now: NOW, timeZone: 'Europe/London' }),
    );
    expect(result.stats.games).toBe(6);
    expectWithin(recording, { queries: 4, waves: 3 });
    expect(recording.requests.filter((r) => (r.select ?? '').includes('raw'))).toEqual([]);
  });

  it('the admin Members list: memberships, labels and games in one round', async () => {
    const { loadGroupMembers } = await import('../admin/groupMembers');
    const { result, recording } = await measure((client) => loadGroupMembers(client, GROUP));
    expect(result.length).toBe(10);
    expectWithin(recording, { queries: 2, waves: 1 });
  });
});
