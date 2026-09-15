import { type Rating, type Role, seedFromRank } from '@customs/core';
import type { RatingInsert, SideValue } from '@customs/db';
import { gameModeFromRaw, mapIdFromRaw } from '../games/queue';
import { PLAYERS_PER_GAME } from '../lobbyState';
import type { ServiceClient } from '../supabase';
import { type FoldSkipReason, foldGame, gateRatedGame, mustGet } from './fold';
import { recomputeInferredRoles, roleInferenceFlags } from './roles';
import { readSeed, type StoredSeed, seedColumns } from './seed';

/**
 * The rating fold (M2.5): what an end-of-game block does to the leaderboard.
 *
 * `rateGame` comes from `@customs/core` and the maths is not repeated here. This file is the
 * claim, the read of the ratings that went in, and the write of the ones that came out — in
 * `started_at` order for one game. The gate and the fold itself are `fold.ts`, shared with the
 * rebuild (M5.2), which replays exactly this for every game of a season.
 */

export type RatingSkipReason = FoldSkipReason | 'already-rated' | 'backfill';

export interface RatingFoldResult {
  rated: boolean;
  /** Why not, when `rated` is false. */
  reason: RatingSkipReason | null;
  /** How many `game_players` rows this request claimed. Ten, or zero, or a crash scar. */
  claimed: number;
}

interface GamePlayerRow {
  playerId: string;
  puuid: string;
  side: SideValue;
  muAfter: number | null;
  rankTier: string | null;
  rankDivision: string | null;
  /** The pair at fold time, which is what the role guard is measured against (M5.17). */
  mainRole: Role | null;
  secondaryRole: Role | null;
}

/**
 * A game the route stored but deliberately did not fold (M5.1).
 *
 * `source: 'backfill'` arrives out of `started_at` order by definition, so rating it as it
 * lands would write numbers the first rebuild throws away. It is stored with four null rating
 * columns and `pnpm --filter web rebuild-ratings` (M5.2) is what turns a batch into ratings.
 */
export const BACKFILL_NOT_RATED: RatingFoldResult = { rated: false, reason: 'backfill', claimed: 0 };

/**
 * Rate one stored game, once.
 *
 * The gate first (`fold.ts`): ten `game_players` rows, five a side, `duration_s` over 300
 * seconds, and Summoner's Rift. M1.5 stores *every* `CUSTOM_GAME` block — remakes, four-minute
 * surrenders and ARAM included — so this is where a game nobody played, or a game that is not
 * the nightly 5v5, stops. 300 exactly is not rated. ARAM is stored and listed on `/games`, and
 * it does not move ratings. The row is kept either way; only `ratings` is left alone.
 */
export async function rateStoredGame(client: ServiceClient, gameId: string): Promise<RatingFoldResult> {
  const game = await selectGame(client, gameId);
  const rows = await selectGamePlayers(client, gameId);

  const gate = gateRatedGame(rows, game.durationS, game.gameMode, game.mapId);
  if (!gate.ok) {
    console.info(
      `rating: game ${gameId} not rated: ${gate.reason} (${rows.length} rows, ${game.durationS}s)`,
    );
    return { rated: false, reason: gate.reason, claimed: 0 };
  }
  const { blue: blueRows, red: redRows } = gate;

  // Ordered by puuid on both sides, so the arrays handed to core are deterministic and a
  // rebuild (M5.2) reproduces exactly these numbers.
  const stored = await selectRatings(
    client,
    rows.map((row) => row.playerId),
    game.seasonId,
  );

  const before = new Map<string, Rating>();
  for (const row of rows) {
    before.set(
      row.playerId,
      stored.get(row.playerId)?.rating ?? seedFromRank(row.rankTier, row.rankDivision),
    );
  }

  /**
   * The seed each of the ten gets written back with (M5.7).
   *
   * **This fold writes a seed only for a player it is creating a `ratings` row for** — that is
   * the first fold that ever rated them, and the number above is literally where their history
   * begins. Everyone else keeps whatever their row already holds, including null: a row written
   * before `0012` is filled by `rebuild-ratings`, which writes the seed *its own* fold used and
   * so cannot freeze a value the stored history disagrees with. Nothing here ever rewrites a
   * seed that is already there.
   */
  const seeds = new Map<string, StoredSeed | null>();
  for (const row of rows) {
    const previous = stored.get(row.playerId);
    seeds.set(
      row.playerId,
      previous === undefined
        ? {
            rating: mustGet(before, row.playerId),
            rankTier: row.rankTier,
            rankDivision: row.rankDivision,
          }
        : previous.seed,
    );
  }

  const after = foldGame(blueRows, redRows, before, game.winningSide);

  // The feedback-loop guard (M5.17), decided here because here is the only place it is
  // knowable: the recompute at the bottom of this function is about to move the very roles it
  // is measured against. `false` for the players the balancer filled; everyone else keeps the
  // column's `true`.
  const roleFlags = await roleInferenceFlags(client, game.lobbyId, rows);

  // The claim is the null rating column, not a new column: whoever writes the first row owns
  // the fold. Two companions post the same game and both requests get this far; the loser's
  // update matches nothing and it stops here, having changed nothing.
  const ordered = [...rows].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  let claimed = 0;
  for (const row of ordered) {
    const wrote = await writeRatingColumns(
      client,
      gameId,
      row.playerId,
      {
        before: mustGet(before, row.playerId),
        after: mustGet(after, row.playerId),
      },
      roleFlags.get(row.playerId) ?? true,
    );
    if (wrote) claimed += 1;
    else if (claimed === 0) {
      // The first row was already written: this game has been rated. Nothing else is touched,
      // and `ratings.updated_at` does not move.
      return { rated: false, reason: 'already-rated', claimed: 0 };
    }
  }

  if (claimed !== PLAYERS_PER_GAME) {
    // Between zero and ten is a crash scar: a request that died mid-fold. Say so loudly and
    // leave the rest to the M5.2 rebuild rather than guessing.
    console.error(
      `rating: game ${gameId} claimed ${claimed} of ${PLAYERS_PER_GAME} rows; the rest were already written`,
    );
  }

  await applyRatings(client, game.seasonId, game.winningSide, rows, after, stored, seeds);

  // The ten who played, and nobody else (M5.17). Deliberately not fatal: the game is rated and
  // the numbers are right, and a pair that failed to move is fixed by the next game these
  // people play or by the next `rebuild-ratings`. Failing here would 500 a post whose retry
  // answers `already-rated` and never reaches this line again.
  try {
    await recomputeInferredRoles(
      client,
      rows.map((row) => row.playerId),
    );
  } catch (error) {
    console.error(`rating: game ${gameId} rated, but the role recompute failed`, error);
  }

  return { rated: true, reason: null, claimed };
}

interface StoredGame {
  seasonId: string;
  durationS: number;
  winningSide: SideValue;
  /** Null for a backfilled game and for a game played from no lobby: nobody was filled. */
  lobbyId: string | null;
  /** The client's `gameMode` off `games.raw`. Missing is Rift. */
  gameMode: string | null;
  mapId: number | null;
}

async function selectGame(client: ServiceClient, gameId: string): Promise<StoredGame> {
  const { data, error } = await client
    .from('games')
    .select('season_id, duration_s, winning_side, lobby_id, raw')
    .eq('id', gameId)
    .single();
  if (error) throw new Error(`rating: game select failed: ${error.message}`);
  if (data.winning_side !== 100 && data.winning_side !== 200) {
    throw new Error(`rating: game ${gameId} has no winning side`);
  }
  return {
    seasonId: data.season_id,
    durationS: data.duration_s,
    winningSide: data.winning_side,
    lobbyId: data.lobby_id,
    gameMode: gameModeFromRaw(data.raw),
    mapId: mapIdFromRaw(data.raw),
  };
}

async function selectGamePlayers(client: ServiceClient, gameId: string): Promise<GamePlayerRow[]> {
  const { data, error } = await client
    .from('game_players')
    .select(
      'player_id, side, mu_after, players!inner(puuid, rank_tier, rank_division, main_role, secondary_role)',
    )
    .eq('game_id', gameId);
  if (error) throw new Error(`rating: game_players select failed: ${error.message}`);

  return (data ?? [])
    .filter((row) => row.side === 100 || row.side === 200)
    .map((row) => ({
      playerId: row.player_id,
      puuid: row.players.puuid,
      side: row.side as SideValue,
      muAfter: row.mu_after,
      rankTier: row.players.rank_tier,
      rankDivision: row.players.rank_division,
      mainRole: row.players.main_role,
      secondaryRole: row.players.secondary_role,
    }));
}

interface StoredRating {
  rating: Rating;
  games: number;
  wins: number;
  /** The stored seed (M5.7), or null on a row written before `0012` filled these columns. */
  seed: StoredSeed | null;
}

async function selectRatings(
  client: ServiceClient,
  playerIds: readonly string[],
  seasonId: string,
): Promise<Map<string, StoredRating>> {
  const { data, error } = await client
    .from('ratings')
    .select('player_id, mu, sigma, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
    .eq('season_id', seasonId)
    .in('player_id', playerIds);
  if (error) throw new Error(`rating: ratings select failed: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.player_id,
      {
        rating: { mu: row.mu, sigma: row.sigma },
        games: row.games,
        wins: row.wins,
        seed: readSeed(row),
      },
    ]),
  );
}

/**
 * One row's four rating columns and the role guard, guarded by `mu_after is null`. `false` means
 * somebody else has already written it.
 *
 * `counts_for_role_inference` rides along with the claim rather than in a pass of its own, so
 * the row that lost the race writes neither and the winner writes both (M5.17).
 */
async function writeRatingColumns(
  client: ServiceClient,
  gameId: string,
  playerId: string,
  ratings: { before: Rating; after: Rating },
  countsForRoleInference: boolean,
): Promise<boolean> {
  const { data, error } = await client
    .from('game_players')
    .update({
      mu_before: ratings.before.mu,
      sigma_before: ratings.before.sigma,
      mu_after: ratings.after.mu,
      sigma_after: ratings.after.sigma,
      counts_for_role_inference: countsForRoleInference,
    })
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .is('mu_after', null)
    .select('player_id');
  if (error) throw new Error(`rating: claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The `ratings` upsert: the new `{ mu, sigma }`, one more game, and one more win for the five
 * on the winning side. Read-then-write is safe here — the claim above serialises the same
 * game, and one group cannot play two games at once.
 *
 * The four seed columns are in every payload, because a PostgREST bulk upsert needs identical
 * keys on every object (PGRST102) — and for nine of the ten they carry the value that is
 * already stored, so the write is a no-op on them. That is what "nothing ever rewrites a seed"
 * looks like through an `on conflict do update`.
 */
async function applyRatings(
  client: ServiceClient,
  seasonId: string,
  winningSide: SideValue,
  rows: readonly GamePlayerRow[],
  after: Map<string, Rating>,
  stored: Map<string, StoredRating>,
  seeds: ReadonlyMap<string, StoredSeed | null>,
): Promise<void> {
  const inserts: RatingInsert[] = rows.map((row) => {
    const previous = stored.get(row.playerId);
    const rating = mustGet(after, row.playerId);
    return {
      player_id: row.playerId,
      season_id: seasonId,
      mu: rating.mu,
      sigma: rating.sigma,
      games: (previous?.games ?? 0) + 1,
      wins: (previous?.wins ?? 0) + (row.side === winningSide ? 1 : 0),
      ...seedColumns(seeds.get(row.playerId) ?? null),
    };
  });

  const { error } = await client.from('ratings').upsert(inserts, { onConflict: 'player_id,season_id' });
  if (error) throw new Error(`rating: ratings upsert failed: ${error.message}`);
}
