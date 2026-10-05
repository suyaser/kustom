import { type Assignment, type Calibration, calibration } from '@customs/core';
import { receiptSplitFromRow } from '@/components/receipt/model';
import type { ReceiptNames, StoredSplit, WinnerSide } from '@/components/receipt/types';
import { inChunks } from '../chunks';
import { readAssignments } from '../discord/assemble';
import { matchesQueue } from '../games/queue';
import { splitSidesOf } from '../games/receipt';
import type { PageGroup } from '../groups/pageGroup';
import type { PublicClient } from '../publicClient';
import { CALIBRATION_MIN_GAMES } from '../receipt/copy';

/**
 * What the landing page reads (M14.24; STRATEGY §2.3): the demo group's latest rolled game as a
 * real receipt, the demo group's calibration line, its game count, and the honest live counters
 * across every group. All public data, read with the anon key through RLS.
 *
 * Every part fails on its own: a failed read hides that part (counters, calibration, the game
 * count) or falls back (the receipt becomes the worked example). The page never shows a zero and
 * never an error for any of it.
 *
 * The reads sit behind {@link LandingSource} so the composition is unit-tested with a fake;
 * {@link supabaseLandingSource} is the one implementation.
 */

export interface DemoGameRow {
  id: string;
  lobbyId: string | null;
  startedAt: string;
  winningSide: number | null;
  /** The client's `gameMode` off `games.raw` (`CLASSIC`, `ARAM`, …), or null. */
  mode: string | null;
}

export interface ChosenSplitRow {
  lobbyId: string;
  /** The run's insert time: a run is the rows sharing it (`lib/tonight/load.ts`). */
  createdAt: string;
  blueWinProb: number;
  blue: readonly Assignment[];
  red: readonly Assignment[];
}

export interface SeatRow {
  gameId: string;
  playerId: string;
  side: number;
  /** `r_before` and `r_after` both stored: the fold rated this seat. */
  rated: boolean;
}

export interface PlayerRow {
  id: string;
  puuid: string;
  name: string | null;
}

export interface LandingSource {
  group(slug: string): Promise<PageGroup | null>;
  /** Every game of the group, newest first. */
  games(groupId: string): Promise<DemoGameRow[]>;
  chosenSplits(lobbyIds: readonly string[]): Promise<ChosenSplitRow[]>;
  seats(gameIds: readonly string[]): Promise<SeatRow[]>;
  players(playerIds: readonly string[]): Promise<PlayerRow[]>;
  /** The three (or fewer) splits of one balance run, rank order. */
  run(lobbyId: string, createdAt: string): Promise<StoredSplit[]>;
  /** Games refereed and distinct players with a rated game, across every group. */
  totals(): Promise<{ games: number; players: number }>;
}

export type HeroReceipt =
  | {
      kind: 'live';
      gameId: string;
      startedAt: string;
      winner: WinnerSide;
      splits: readonly StoredSplit[];
      names: ReceiptNames;
    }
  | { kind: 'example' };

export interface LandingData {
  /** The demo group, or null when it could not be read. */
  demo: PageGroup | null;
  /** How many games the demo group has played, or null when unknown. */
  demoGames: number | null;
  hero: HeroReceipt;
  /** Core's calibration over the demo group's qualifying games, only from 20 of them. */
  calibration: Calibration | null;
  /** Live counters, or null when the read failed or either count is zero. */
  counters: { games: number; players: number } | null;
}

/** A game the bot's split actually describes: same ten, same sides (STRATEGY §4.8). */
export interface QualifyingGame {
  game: DemoGameRow;
  winner: WinnerSide;
  split: ChosenSplitRow;
  rated: boolean;
}

/**
 * The demo group's games the receipt and the calibration line may use, newest first: Summoner's
 * Rift, a winner, a chosen split, and the ten on each side exactly the split's ten. A game whose
 * teams changed in the lobby after the roll is left out: those were not the bot's teams.
 * Pure, so every rule is a unit test.
 */
export function qualifyingGames(
  games: readonly DemoGameRow[],
  splits: readonly ChosenSplitRow[],
  seats: readonly SeatRow[],
  players: readonly PlayerRow[],
): QualifyingGame[] {
  const splitByLobby = new Map(splits.map((split) => [split.lobbyId, split]));
  const puuidById = new Map(players.map((player) => [player.id, player.puuid]));
  const seatsByGame = new Map<string, SeatRow[]>();
  for (const seat of seats) {
    const list = seatsByGame.get(seat.gameId) ?? [];
    list.push(seat);
    seatsByGame.set(seat.gameId, list);
  }

  const out: QualifyingGame[] = [];
  for (const game of games) {
    if (game.lobbyId === null || !matchesQueue(game.mode, 'sr')) continue;
    if (game.winningSide !== 100 && game.winningSide !== 200) continue;
    const split = splitByLobby.get(game.lobbyId);
    if (split === undefined) continue;
    const rows = seatsByGame.get(game.id) ?? [];
    if (rows.length !== 10) continue;
    const seats = rows.flatMap((row) => {
      const puuid = puuidById.get(row.playerId);
      return puuid === undefined || (row.side !== 100 && row.side !== 200)
        ? []
        : [{ puuid, side: row.side as 100 | 200 }];
    });
    // The receipt rule's check (M21.7): the split's ten on its own sides. Swapped sides are the
    // bot's teams too, but the demo draws the run as stored, so it keeps to `same`.
    if (seats.length !== 10 || splitSidesOf(split, seats) !== 'same') continue;
    out.push({ game, winner: game.winningSide, split, rated: rows.every((row) => row.rated) });
  }
  return out;
}

/** Core's calibration over the rated qualifying games, or null under {@link CALIBRATION_MIN_GAMES}. */
export function demoCalibration(games: readonly QualifyingGame[]): Calibration | null {
  const result = calibration(
    games
      .filter((entry) => entry.rated)
      .map((entry) => ({ blueWinProb: entry.split.blueWinProb, blueWon: entry.winner === 100 })),
  );
  return result.n >= CALIBRATION_MIN_GAMES ? result : null;
}

export async function loadLanding(source: LandingSource, demoSlug: string): Promise<LandingData> {
  const [demoPart, counters] = await Promise.all([loadDemo(source, demoSlug), loadCounters(source)]);
  return { ...demoPart, counters };
}

async function loadCounters(source: LandingSource): Promise<LandingData['counters']> {
  try {
    const totals = await source.totals();
    if (!(totals.games > 0) || !(totals.players > 0)) return null;
    return totals;
  } catch (error) {
    console.error('landing: the counters could not be read', error);
    return null;
  }
}

async function loadDemo(source: LandingSource, demoSlug: string): Promise<Omit<LandingData, 'counters'>> {
  const empty = { demo: null, demoGames: null, hero: { kind: 'example' } as const, calibration: null };
  let demo: PageGroup | null;
  let games: DemoGameRow[];
  try {
    demo = await source.group(demoSlug);
    if (demo === null) return empty;
    games = await source.games(demo.id);
  } catch (error) {
    console.error('landing: the demo group could not be read', error);
    return empty;
  }

  const base = { demo, demoGames: games.length, hero: { kind: 'example' } as const, calibration: null };
  try {
    const lobbyIds = games.flatMap((game) => (game.lobbyId === null ? [] : [game.lobbyId]));
    const splits = await source.chosenSplits(lobbyIds);
    const withSplit = new Set(splits.map((split) => split.lobbyId));
    const candidates = games.filter((game) => game.lobbyId !== null && withSplit.has(game.lobbyId));
    if (candidates.length === 0) return base;

    const seats = await source.seats(candidates.map((game) => game.id));
    const players = await source.players(seats.map((seat) => seat.playerId));
    const qualifying = qualifyingGames(candidates, splits, seats, players);
    const latest = qualifying[0];
    if (latest === undefined || latest.game.lobbyId === null) return base;

    const run = await source.run(latest.game.lobbyId, latest.split.createdAt);
    const names: Record<string, string> = {};
    for (const player of players) if (player.name !== null) names[player.puuid] = player.name;

    return {
      demo,
      demoGames: games.length,
      calibration: demoCalibration(qualifying),
      hero:
        run.length === 0
          ? { kind: 'example' }
          : {
              kind: 'live',
              gameId: latest.game.id,
              startedAt: latest.game.startedAt,
              winner: latest.winner,
              splits: run,
              names,
            },
    };
  } catch (error) {
    console.error('landing: the demo receipt could not be read', error);
    return base;
  }
}

/* ------------------------------------------------------------------------------------------ */

/** PostgREST answers at most this many rows per request (Supabase's default `max-rows`). */
const PAGE = 1000;

export function supabaseLandingSource(client: PublicClient): LandingSource {
  return {
    async group(slug) {
      const { data, error } = await client
        .from('groups_public')
        .select('id, slug, name')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new Error(`landing: group lookup failed: ${error.message}`);
      if (data === null || data.id === null || data.slug === null || data.name === null) return null;
      return { id: data.id, slug: data.slug, name: data.name };
    },

    async games(groupId) {
      const rows: DemoGameRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
          .from('games')
          .select('id, lobby_id, started_at, winning_side, mode:game_mode')
          .eq('group_id', groupId)
          .order('started_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`landing: games lookup failed: ${error.message}`);
        for (const row of data ?? []) {
          rows.push({
            id: row.id,
            lobbyId: row.lobby_id,
            startedAt: row.started_at,
            winningSide: row.winning_side,
            mode: typeof row.mode === 'string' ? row.mode : null,
          });
        }
        if ((data ?? []).length < PAGE) return rows;
      }
    },

    async chosenSplits(lobbyIds) {
      const rows: ChosenSplitRow[] = [];
      for (const chunk of inChunks(lobbyIds)) {
        const { data, error } = await client
          .from('splits')
          .select('lobby_id, created_at, blue_win_prob, blue, red')
          .eq('is_chosen', true)
          .in('lobby_id', chunk);
        if (error) throw new Error(`landing: split lookup failed: ${error.message}`);
        for (const row of data ?? []) {
          rows.push({
            lobbyId: row.lobby_id,
            createdAt: row.created_at,
            blueWinProb: row.blue_win_prob,
            blue: readAssignments(row.blue),
            red: readAssignments(row.red),
          });
        }
      }
      return rows;
    },

    async seats(gameIds) {
      const rows: SeatRow[] = [];
      for (const chunk of inChunks(gameIds)) {
        const { data, error } = await client
          .from('game_players')
          .select('game_id, player_id, side, r_before, r_after')
          .in('game_id', chunk);
        if (error) throw new Error(`landing: scoreboard lookup failed: ${error.message}`);
        for (const row of data ?? []) {
          rows.push({
            gameId: row.game_id,
            playerId: row.player_id,
            side: row.side,
            rated: row.r_before !== null && row.r_after !== null,
          });
        }
      }
      return rows;
    },

    async players(playerIds) {
      const rows: PlayerRow[] = [];
      for (const chunk of inChunks(playerIds)) {
        const { data, error } = await client
          .from('players_public')
          .select('id, puuid, display_name, game_name')
          .in('id', chunk);
        if (error) throw new Error(`landing: player lookup failed: ${error.message}`);
        for (const row of data ?? []) {
          if (row.id === null || row.puuid === null) continue;
          rows.push({ id: row.id, puuid: row.puuid, name: row.display_name ?? row.game_name ?? null });
        }
      }
      return rows;
    },

    async run(lobbyId, createdAt) {
      const { data, error } = await client
        .from('splits')
        .select('rank, is_chosen, blue_win_prob, gap, off_role_count, score_parts, blue, red, explanation')
        .eq('lobby_id', lobbyId)
        .eq('created_at', createdAt)
        .order('rank', { ascending: true });
      if (error) throw new Error(`landing: split run lookup failed: ${error.message}`);
      return (data ?? []).map((row) =>
        receiptSplitFromRow({ ...row, blue: readAssignments(row.blue), red: readAssignments(row.red) }),
      );
    },

    async totals() {
      const games = await client.from('games').select('id', { count: 'exact', head: true });
      if (games.error) throw new Error(`landing: game count failed: ${games.error.message}`);
      const players = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
          .from('ratings')
          .select('player_id')
          .gt('games', 0)
          .order('player_id', { ascending: true })
          .order('group_id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`landing: rated player lookup failed: ${error.message}`);
        for (const row of data ?? []) players.add(row.player_id);
        if ((data ?? []).length < PAGE) break;
      }
      return { games: games.count ?? 0, players: players.size };
    },
  };
}
