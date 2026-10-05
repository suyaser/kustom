import type { Fixtures, FixtureRow } from './recordingClient';

/**
 * Tonight's rows for the recording fake client (`recordingClient.ts`): a group, twelve players,
 * and one night of lobbies built by {@link night}. The M22.5 tests run the real `loadTonight` over
 * them (one table: the snapshot as before M22; two tables: both views, three rounds).
 *
 * The fake applies `eq` / `neq` / `in` / `is` and ignores order and comparisons, so the rows are
 * listed oldest first and every row is of tonight.
 */

export const GROUP = '00000000-0000-0000-0000-00000000a022';
export const NIGHT_START = new Date('2026-10-06T04:00:00.000Z');
/** 20:00 UTC on the night. */
export const NOW = new Date('2026-10-06T20:00:00.000Z');
/** A fixed offset clock, so nothing here reads the machine's zone. */
export const CLOCK = { offsetMs: 0, shift: null };

export const PID = (n: number) => `00000000-0000-0000-0000-0000000d22${String(n).padStart(2, '0')}`;
export const PUUID = (n: number) => `puuid-${n}`;
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

/** Minutes before {@link NOW}, as an ISO string. */
export const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

export type RowStatus = 'open' | 'balanced' | 'in_game' | 'finished' | 'dropped' | 'abandoned';

/** One `lobbies` row of the night, with what hangs off it. */
export interface CycleSpec {
  id: string;
  party: string;
  status: RowStatus;
  /** Minutes before NOW. */
  created: number;
  updated: number;
  reporter: number | null;
  /** Player numbers on the roster (joined at `created`). */
  members: readonly number[];
  /** Blue and red player numbers of a chosen split (three ranks stored), or none. */
  split?: { blue: readonly number[]; red: readonly number[] };
  /** A game on this row: the winner and when it started (minutes before NOW). */
  game?: { id: string; winner: 100 | 200; started: number };
  /** The row's lock (Roll), standing mode only. */
  locked?: boolean;
}

const team = (players: readonly number[]) => players.map((n, i) => ({ puuid: PUUID(n), role: ROLES[i % 5] }));

/** The fixtures for a night of {@link CycleSpec}s. */
export function night(cycles: readonly CycleSpec[]): Fixtures {
  const players = Array.from({ length: 16 }, (_, n) => ({
    id: PID(n),
    puuid: PUUID(n),
    display_name: `Player ${n}`,
    game_name: `Player ${n}`,
    main_role: ROLES[n % 5],
    secondary_role: ROLES[(n + 1) % 5],
    rank_tier: null,
    rank_division: null,
  }));
  const lobbies: FixtureRow[] = cycles.map((cycle) => ({
    id: cycle.id,
    group_id: GROUP,
    lcu_party_id: cycle.party,
    status: cycle.status,
    lobby_name: `Customs ${cycle.party}`,
    created_at: ago(cycle.created),
    updated_at: ago(cycle.updated),
    reported_by_player_id: cycle.reporter === null ? null : PID(cycle.reporter),
    lock_mode: cycle.locked ? 'normal' : null,
    lock_rule: null,
    lock_class_tag: null,
    lock_region_blue: null,
    lock_region_red: null,
    lock_rated: cycle.locked ? true : null,
    locked_at: cycle.locked ? ago(cycle.updated) : null,
    kickoff_kind: null,
    kickoff_blue: null,
    kickoff_red: null,
    kickoff_swapped: null,
    kickoff_blue_win_prob: null,
    kickoff_odds_model: null,
    kickoff_at: null,
    kickoff_game_mode: null,
  }));
  const lobbyMembers: FixtureRow[] = cycles.flatMap((cycle) =>
    cycle.members.map((n, i) => ({
      lobby_id: cycle.id,
      player_id: PID(n),
      role_override: null,
      is_spectator: i >= 10,
      side: i < 5 ? 100 : i < 10 ? 200 : null,
      created_at: ago(cycle.created),
    })),
  );
  const splits: FixtureRow[] = cycles.flatMap((cycle) =>
    cycle.split === undefined
      ? []
      : [1, 2, 3].map((rank) => ({
          id: `${cycle.id}-split-${rank}`,
          lobby_id: cycle.id,
          rank,
          blue: team(rank === 1 ? (cycle.split?.blue ?? []) : (cycle.split?.red ?? [])),
          red: team(rank === 1 ? (cycle.split?.red ?? []) : (cycle.split?.blue ?? [])),
          blue_win_prob: rank === 1 ? 0.52 : 0.47,
          gap: 10 * rank,
          off_role_count: 0,
          score_parts: null,
          explanation: `Split ${rank} of ${cycle.id}.`,
          is_chosen: rank === 1,
          created_at: ago(cycle.updated),
        })),
  );
  const gamePlayersOf = (cycle: CycleSpec) =>
    cycle.game === undefined || cycle.split === undefined
      ? []
      : [...cycle.split.blue, ...cycle.split.red].map((n, i) => ({
          game_id: cycle.game?.id,
          group_id: GROUP,
          player_id: PID(n),
          side: i < 5 ? 100 : 200,
          role: ROLES[i % 5],
          champion_id: 10 + n,
          kills: 3 + (n % 4),
          deaths: 2 + (n % 3),
          assists: 5 + (n % 5),
          gold: 10_000 + n * 100,
          cs: 150 + n,
          vision_score: 20 + n,
          damage_self_mitigated: 12_000 + n * 50,
          damage_to_objectives: 4_000 + n * 30,
          damage_to_champs: 18_000 + n * 400,
          r_before: 1200 + n * 10,
          r_after: 1200 + n * 10 + (i < 5 === (cycle.game?.winner === 100) ? 12 : -12),
          fold_p: 0.5,
        }));
  const games: FixtureRow[] = cycles.flatMap((cycle) =>
    cycle.game === undefined
      ? []
      : [
          {
            id: cycle.game.id,
            group_id: GROUP,
            lobby_id: cycle.id,
            winning_side: cycle.game.winner,
            started_at: ago(cycle.game.started),
            duration_s: 1_800,
            gameMode: 'CLASSIC',
            game_mode: 'CLASSIC',
            rule: null,
            rule_class_tag: null,
            rule_region_blue: null,
            rule_region_red: null,
            rated: true,
            rule_checked: false,
            rule_check: null,
            game_players: gamePlayersOf(cycle),
          },
        ],
  );
  return {
    players_public: players,
    ratings: players.map((player, n) => ({
      group_id: GROUP,
      player_id: player.id,
      r: 1200 + n * 10,
      games: n,
    })),
    lobbies,
    lobby_members: lobbyMembers,
    splits,
    games,
    game_players: cycles.flatMap(gamePlayersOf),
    group_modes: [
      {
        group_id: GROUP,
        mode: 'normal',
        updated_at: ago(600),
        pending_rule: null,
        pending_class_tag: null,
        pending_region_blue: null,
        pending_region_red: null,
        rated_override: null,
        version: 1,
      },
    ],
    fearless_state: [{ group_id: GROUP, reset_at: ago(6000) }],
  };
}

const TEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const BLUE = [0, 1, 2, 3, 4] as const;
const RED = [5, 6, 7, 8, 9] as const;

/** Two finished games earlier on party A, the start of every one-table scene. */
export const EARLIER: readonly CycleSpec[] = [
  {
    id: 'lobby-a1',
    party: 'party-a',
    status: 'finished',
    created: 180,
    updated: 140,
    reporter: 0,
    members: TEN,
    split: { blue: BLUE, red: RED },
    game: { id: 'game-a1', winner: 100, started: 175 },
  },
  {
    id: 'lobby-a2',
    party: 'party-a',
    status: 'finished',
    created: 135,
    updated: 95,
    reporter: 1,
    members: [...TEN, 10],
    split: { blue: RED, red: BLUE },
    game: { id: 'game-a2', winner: 200, started: 130 },
  },
];

/** Party A's current cycle in each state a one-table night can be in. */
export function currentCycle(
  kind: 'filling' | 'teams' | 'in-game' | 'result' | 'result-old' | 'dropped' | 'abandoned',
): CycleSpec {
  const base = { id: 'lobby-a3', party: 'party-a', reporter: 0, created: 30 } as const;
  const twelve = [...TEN, 10, 11];
  switch (kind) {
    case 'filling':
      return { ...base, status: 'open', updated: 25, members: twelve };
    case 'teams':
      return {
        ...base,
        status: 'balanced',
        updated: 10,
        members: twelve,
        split: { blue: BLUE, red: RED },
        locked: true,
      };
    case 'in-game':
      return {
        ...base,
        status: 'in_game',
        updated: 5,
        members: twelve,
        split: { blue: BLUE, red: RED },
        locked: true,
      };
    case 'result':
      return {
        ...base,
        status: 'finished',
        updated: 4,
        members: twelve,
        split: { blue: BLUE, red: RED },
        game: { id: 'game-a3', winner: 200, started: 28 },
      };
    case 'result-old':
      // Finished 60 minutes ago with no next cycle: no live table, and the poster stays up as before.
      return {
        ...base,
        created: 100,
        status: 'finished',
        updated: 60,
        members: twelve,
        split: { blue: BLUE, red: RED },
        game: { id: 'game-a3', winner: 200, started: 95 },
      };
    case 'dropped':
      return { ...base, status: 'dropped', updated: 1, members: twelve, split: { blue: BLUE, red: RED } };
    case 'abandoned':
      return { ...base, status: 'abandoned', updated: 20, members: twelve };
  }
}
