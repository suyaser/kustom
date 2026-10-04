import type { Rating, Role } from '@customs/core';
import { openSkillPair, type RatingInsert, type SideValue } from '@customs/db';
import { gameModeFromRaw } from '../games/queue';
import { PLAYERS_PER_GAME } from '../lobbyState';
import type { ServiceClient } from '../supabase';
import {
  type FoldOutcome,
  type FoldRatedPlayer,
  foldGameKustom,
  foldGameOutcomes,
  gateRatedGame,
  KUSTOM_FRESH,
  type KustomFoldOutcome,
  type KustomState,
  mustGet,
  type RatedSkipReason,
} from './fold';
import { kustomWeekStart } from './kustomWeek';
import { countsForRatings, readRatingsSince } from './ratingsEpoch';
import { recomputeInferredRoles, roleInferenceFlags } from './roles';
import { readSeed, type StoredSeed, seedColumns, seedFor } from './seed';

/**
 * The rating fold (M2.5): what an end-of-game block does to the leaderboard.
 *
 * `rateGame` comes from `@customs/core` and the maths is not repeated here. This file is the
 * claim, the read of the ratings that went in, and the write of the ones that came out — in
 * `started_at` order for one game. The gate and the fold itself are `fold.ts`, shared with the
 * rebuild (M5.2), which replays exactly this for every game of a group.
 */

/**
 * `before-reset` (M14.18): the game started before the group's latest `Reset ratings`
 * (`groups.ratings_since`), so it is history and never moves today's ratings.
 */
export type RatingSkipReason =
  | RatedSkipReason
  | 'already-rated'
  | 'backfill'
  | 'other-group'
  | 'before-reset';

export interface RatingFoldResult {
  rated: boolean;
  /** Why not, when `rated` is false. */
  reason: RatingSkipReason | null;
  /** How many `game_players` rows this request claimed. Ten, or zero, or a crash scar. */
  claimed: number;
}

/**
 * `FoldRatedPlayer` and the four columns only this file reads.
 *
 * The stat line and `game_players.role` come in through the interface (M7.9) and are read by
 * `foldGame` alone: the MVP / ACE bonus is applied inside the shared fold, so this file selects
 * the columns and nothing more.
 */
interface GamePlayerRow extends FoldRatedPlayer {
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
 * A post of a game that is already stored in **another group** (M13.3). That post is a no-op;
 * the fold belongs to the game's own group and ran (or will run) when its companions posted it.
 */
export const FOREIGN_DUPLICATE_NOT_RATED: RatingFoldResult = {
  rated: false,
  reason: 'other-group',
  claimed: 0,
};

/** `reason` on the answer to a backfilled game that was not stored for this group (M13.3). */
export const NOT_THIS_GROUP_REASON = 'not-this-group';

/**
 * Rate one stored game, once.
 *
 * The gate first (`fold.ts`): ten `game_players` rows, five a side, `duration_s` over 300
 * seconds, and — M7.1 — Summoner's Rift. M1.5 stores *every* `CUSTOM_GAME` block — remakes,
 * four-minute surrenders and Howling Abyss nights included — so this is where a game the
 * balancer's number must not learn from stops. 300 exactly is not rated. The row is kept either
 * way, with its scoreboard and its `raw`; only the four rating columns and `ratings` are left
 * alone, and the caller still answers the companion 2xx (a non-2xx would make it retry a game
 * that will never rate) and still finishes the lobby.
 */
export async function rateStoredGame(client: ServiceClient, gameId: string): Promise<RatingFoldResult> {
  const game = await selectGame(client, gameId);
  const rows = await selectGamePlayers(client, gameId);

  const gate = gateRatedGame(rows, game.durationS, game.raw, game.rated);
  if (!gate.ok) {
    console.info(
      `rating: game ${gameId} not rated: ${gate.reason} (${rows.length} rows, ${game.durationS}s, mode ${
        gameModeFromRaw(game.raw) ?? 'CLASSIC (missing)'
      })`,
    );
    return { rated: false, reason: gate.reason, claimed: 0 };
  }
  const { blue: blueRows, red: redRows } = gate;

  // The weekly Kustom track (M18.5): every player's standing in this game's week, from their last
  // weekly row before this game in the same week, else 1200 and 0. Read for every rated game,
  // because the weekly track ignores the group's ratings reset.
  const week = await selectWeekStates(client, game, rows);

  // The group's epoch (M14.18): a game that started before the latest reset is history on the
  // all-time track. It still folds on the weekly track (M18: a reset does not touch the week).
  if (!countsForRatings(game.startedAt, await readRatingsSince(client, game.groupId))) {
    const weekly = foldGameKustom(blueRows, redRows, { allTime: null, week }, game.winningSide);
    let claimed = 0;
    for (const row of [...rows].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
      if (await writeWeekOnlyColumns(client, gameId, row.playerId, mustKustom(weekly, row.playerId))) {
        claimed += 1;
      }
    }
    console.info(
      `rating: game ${gameId} not rated: it started before the group's ratings reset (weekly track: ${claimed} rows)`,
    );
    return { rated: false, reason: 'before-reset', claimed };
  }

  // Ordered by puuid on both sides, so the arrays handed to core are deterministic and a
  // rebuild (M5.2) reproduces exactly these numbers.
  //
  // **The game's group's ratings and nobody else's** (M13.3): a person has one rating per group,
  // and somebody with no row in this group starts at the seed here, whatever they are worth in
  // another one -- whose number this fold never reads and never writes.
  const stored = await selectRatings(
    client,
    rows.map((row) => row.playerId),
    game.groupId,
  );

  // The stored rating, or — for somebody who has never been rated **in this group** — their first seed, from
  // `seed.ts`'s one rule and not a second copy of it. That rule is `provisionalSeed()` from 2026-09-16: a
  // League rank no longer starts anybody's history, here or in the rebuild.
  const before = new Map<string, Rating>();
  for (const row of rows) {
    before.set(
      row.playerId,
      stored.get(row.playerId)?.rating ?? seedFor(null, row.rankTier, row.rankDivision).rating,
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
   *
   * `seedFor` is called with the same three arguments as the `before` map above, so the number
   * folded and the number stored as the seed are one call twice and cannot drift apart.
   */
  const seeds = new Map<string, StoredSeed | null>();
  for (const row of rows) {
    const previous = stored.get(row.playerId);
    seeds.set(
      row.playerId,
      previous === undefined ? seedFor(null, row.rankTier, row.rankDivision) : previous.seed,
    );
  }

  const outcomes = foldGameOutcomes(blueRows, redRows, before, game.winningSide);
  const after = new Map<string, Rating>(
    [...outcomes].map(([playerId, outcome]) => [playerId, outcome.after]),
  );

  // The Kustom fold (M18.5), both tracks: all-time from `ratings.r` and the rated-games count
  // (1200 and 0 for somebody with no row in this group), weekly from the read above.
  const allTime = new Map<string, KustomState>();
  for (const row of rows) {
    const previous = stored.get(row.playerId);
    allTime.set(
      row.playerId,
      previous === undefined ? KUSTOM_FRESH : { r: previous.r ?? KUSTOM_FRESH.r, n: previous.games },
    );
  }
  const kustom = foldGameKustom(blueRows, redRows, { allTime, week }, game.winningSide);

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
        outcome: mustOutcome(outcomes, row.playerId),
        kustom: mustKustom(kustom, row.playerId),
        // The count the settling chip reads, as it stood when this game was folded (0034).
        ratedGamesBefore: stored.get(row.playerId)?.games ?? 0,
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

  // The epoch again, right before the `ratings` write (M14.18 review): a reset that landed while
  // this request was folding has already emptied the group's ratings, and writing this game's
  // numbers on top would carry a pre-reset game into the new ratings. The claimed columns stay, as
  // every pre-reset game's do; the rebuild never touches games before the epoch.
  if (!countsForRatings(game.startedAt, await readRatingsSince(client, game.groupId))) {
    console.info(
      `rating: game ${gameId} claimed, but the group's ratings were reset meanwhile; ratings not written`,
    );
    return { rated: false, reason: 'before-reset', claimed };
  }

  await applyRatings(client, game.groupId, game.winningSide, rows, after, kustom, stored, seeds);

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
  id: string;
  startedAt: string;
  /** The rebuild's tie-break after `started_at`, so "earlier in the week" means one thing in both folds. */
  lcuGameId: number;
  /** The group whose `ratings` this game moves (M13.3). */
  groupId: string;
  durationS: number;
  winningSide: SideValue;
  /** Null for a backfilled game and for a game played from no lobby: nobody was filled. */
  lobbyId: string | null;
  /**
   * The stored end-of-game block, for its `gameMode` and nothing else (M7.1). Read as `unknown`
   * on purpose: `isRatedMode` is the only thing that interprets it, and a null `raw` — a row
   * written before the blob was kept — is Rift, exactly as it was before this column was read.
   */
  raw: unknown;
  /** `games.rated` (M15.3): false keeps the game out of the fold, and so out of every board. */
  rated: boolean;
}

async function selectGame(client: ServiceClient, gameId: string): Promise<StoredGame> {
  const { data, error } = await client
    .from('games')
    .select('id, lcu_game_id, group_id, started_at, duration_s, winning_side, lobby_id, raw, rated')
    .eq('id', gameId)
    .single();
  if (error) throw new Error(`rating: game select failed: ${error.message}`);
  if (data.winning_side !== 100 && data.winning_side !== 200) {
    throw new Error(`rating: game ${gameId} has no winning side`);
  }
  return {
    id: data.id,
    lcuGameId: data.lcu_game_id,
    groupId: data.group_id,
    startedAt: data.started_at,
    durationS: data.duration_s,
    winningSide: data.winning_side,
    lobbyId: data.lobby_id,
    raw: data.raw,
    rated: data.rated,
  };
}

async function selectGamePlayers(client: ServiceClient, gameId: string): Promise<GamePlayerRow[]> {
  const { data, error } = await client
    .from('game_players')
    .select(
      // The nine stat columns and `role` are M7.9's: the performance score that names this
      // game's MVP and ACE reads them, and the rebuild's select carries exactly the same list.
      'player_id, side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_after, players!inner(puuid, rank_tier, rank_division, main_role, secondary_role)',
    )
    .eq('game_id', gameId);
  if (error) throw new Error(`rating: game_players select failed: ${error.message}`);

  return (data ?? [])
    .filter((row) => row.side === 100 || row.side === 200)
    .map((row) => ({
      playerId: row.player_id,
      puuid: row.players.puuid,
      side: row.side as SideValue,
      role: row.role,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      damageToChamps: row.damage_to_champs,
      gold: row.gold,
      cs: row.cs,
      visionScore: row.vision_score,
      damageSelfMitigated: row.damage_self_mitigated,
      damageToObjectives: row.damage_to_objectives,
      muAfter: row.mu_after,
      rankTier: row.players.rank_tier,
      rankDivision: row.players.rank_division,
      mainRole: row.players.main_role,
      secondaryRole: row.players.secondary_role,
    }));
}

interface StoredRating {
  /** Null on a Kustom-only row (0036): no OpenSkill pair, so the fold starts it from its seed. */
  rating: Rating | null;
  /**
   * The all-time Kustom Rating (0036). Null on a row the Kustom fold has not written yet (an
   * OpenSkill-era row before the switch's rebuild): folded from 1200 with the row's count.
   */
  r: number | null;
  games: number;
  wins: number;
  /** The stored seed (M5.7), or null on a row written before `0012` filled these columns. */
  seed: StoredSeed | null;
}

async function selectRatings(
  client: ServiceClient,
  playerIds: readonly string[],
  groupId: string,
): Promise<Map<string, StoredRating>> {
  const { data, error } = await client
    .from('ratings')
    .select('player_id, mu, sigma, r, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
    .eq('group_id', groupId)
    .in('player_id', playerIds);
  if (error) throw new Error(`rating: ratings select failed: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.player_id,
      {
        rating: openSkillPair(row),
        r: row.r,
        games: row.games,
        wins: row.wins,
        seed: readSeed(row),
      },
    ]),
  );
}

function mustOutcome(outcomes: ReadonlyMap<string, FoldOutcome>, playerId: string): FoldOutcome {
  const outcome = outcomes.get(playerId);
  if (outcome === undefined) throw new Error(`rating: the fold returned nothing for player ${playerId}`);
  return outcome;
}

function mustKustom(outcomes: ReadonlyMap<string, KustomFoldOutcome>, playerId: string): KustomFoldOutcome {
  const outcome = outcomes.get(playerId);
  if (outcome === undefined) throw new Error(`rating: the Kustom fold returned nothing for player ${playerId}`);
  return outcome;
}

/**
 * The ten's standing on the weekly Kustom track just before `game` (M18.5): each player's last
 * weekly row in the same week (`kustomWeekStart`) whose game is earlier in the rebuild's order
 * (`started_at`, then `lcu_game_id`), as `{ r: week_r_after, n: week_games_before + 1 }`.
 * Somebody with no such row is absent, which the fold reads as 1200 and 0. One read of at most a
 * week of this group's rows for ten players.
 */
async function selectWeekStates(
  client: ServiceClient,
  game: StoredGame,
  rows: readonly GamePlayerRow[],
): Promise<Map<string, KustomState>> {
  const { data, error } = await client
    .from('game_players')
    .select('player_id, game_id, week_r_after, week_games_before, games!inner(started_at, lcu_game_id)')
    .eq('group_id', game.groupId)
    .in(
      'player_id',
      rows.map((row) => row.playerId),
    )
    .not('week_r_after', 'is', null)
    .gte('games.started_at', kustomWeekStart(game.startedAt))
    .lte('games.started_at', game.startedAt);
  if (error) throw new Error(`rating: weekly track select failed: ${error.message}`);

  const at = Date.parse(game.startedAt);
  const latest = new Map<string, { t: number; lcu: number; state: KustomState }>();
  for (const row of data ?? []) {
    if (row.game_id === game.id || row.week_r_after === null || row.week_games_before === null) continue;
    const t = Date.parse(row.games.started_at);
    const lcu = row.games.lcu_game_id;
    // Strictly earlier in the fold's order: a tie on the instant goes to the lower game id.
    if (t > at || (t === at && lcu >= game.lcuGameId)) continue;
    const previous = latest.get(row.player_id);
    if (previous !== undefined && (previous.t > t || (previous.t === t && previous.lcu > lcu))) continue;
    latest.set(row.player_id, { t, lcu, state: { r: row.week_r_after, n: row.week_games_before + 1 } });
  }
  return new Map([...latest].map(([playerId, entry]) => [playerId, entry.state]));
}

/**
 * The 0036 columns of one row from its Kustom outcome: both tracks when the game is on the
 * all-time track, the weekly five alone otherwise. `share_rank` and `award` are the game's and
 * ride on both.
 */
function kustomColumns(outcome: KustomFoldOutcome) {
  return {
    share_rank: outcome.shareRank,
    award: outcome.award,
    week_r_before: outcome.week.rBefore,
    week_r_after: outcome.week.rAfter,
    week_k: outcome.week.k,
    week_fold_p: outcome.week.expected,
    week_games_before: outcome.week.n,
  };
}

/**
 * One row's four rating columns, the fold's breakdown (M14.58, `0034`: the side's odds, the base
 * `mu_after`, the award and the rated-games count), both Kustom tracks (M18.5, `0036`) and the role
 * guard, guarded by `mu_after is null` and `week_r_after is null`. `false` means somebody else has
 * already written it.
 *
 * **The Kustom columns are the rating** from M18 on: `fold_p` is the all-time Kustom expected for
 * the row's side and `award` the share ranks' MVP / ACE (the same two `mvpAce` names: one score,
 * one tie-break). The OpenSkill columns (`mu_*`, `sigma_*`, `base_mu_after`) are still written,
 * from the same game, so the readers M18.6 has not moved yet keep working and the rollback build
 * finds them filled; nothing new reads them.
 *
 * `counts_for_role_inference` rides along with the claim rather than in a pass of its own, so
 * the row that lost the race writes neither and the winner writes both (M5.17).
 */
async function writeRatingColumns(
  client: ServiceClient,
  gameId: string,
  playerId: string,
  ratings: { before: Rating; outcome: FoldOutcome; kustom: KustomFoldOutcome; ratedGamesBefore: number },
  countsForRoleInference: boolean,
): Promise<boolean> {
  const allTime = ratings.kustom.allTime;
  if (allTime === null) throw new Error(`rating: game ${gameId} folded without its all-time track`);
  const { data, error } = await client
    .from('game_players')
    .update({
      mu_before: ratings.before.mu,
      sigma_before: ratings.before.sigma,
      mu_after: ratings.outcome.after.mu,
      sigma_after: ratings.outcome.after.sigma,
      base_mu_after: ratings.outcome.baseMuAfter,
      fold_p: allTime.expected,
      rated_games_before: ratings.ratedGamesBefore,
      r_before: allTime.rBefore,
      r_after: allTime.rAfter,
      k: allTime.k,
      ...kustomColumns(ratings.kustom),
      counts_for_role_inference: countsForRoleInference,
    })
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .is('mu_after', null)
    .is('week_r_after', null)
    .select('player_id');
  if (error) throw new Error(`rating: claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * A game before the group's ratings reset, on the weekly track alone (M18.5; a legal 0036 row:
 * the weekly five, `share_rank` and `award`, no all-time column). Claimed the same way.
 */
async function writeWeekOnlyColumns(
  client: ServiceClient,
  gameId: string,
  playerId: string,
  kustom: KustomFoldOutcome,
): Promise<boolean> {
  const { data, error } = await client
    .from('game_players')
    .update(kustomColumns(kustom))
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .is('mu_after', null)
    .is('r_after', null)
    .is('week_r_after', null)
    .select('player_id');
  if (error) throw new Error(`rating: weekly claim failed: ${error.message}`);
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
  groupId: string,
  winningSide: SideValue,
  rows: readonly GamePlayerRow[],
  after: Map<string, Rating>,
  kustom: ReadonlyMap<string, KustomFoldOutcome>,
  stored: Map<string, StoredRating>,
  seeds: ReadonlyMap<string, StoredSeed | null>,
): Promise<void> {
  const inserts: RatingInsert[] = rows.map((row) => {
    const previous = stored.get(row.playerId);
    const rating = mustGet(after, row.playerId);
    const allTime = mustKustom(kustom, row.playerId).allTime;
    if (allTime === null) throw new Error('rating: a ratings write needs the all-time track');
    return {
      group_id: groupId,
      player_id: row.playerId,
      mu: rating.mu,
      sigma: rating.sigma,
      r: allTime.rAfter,
      games: (previous?.games ?? 0) + 1,
      wins: (previous?.wins ?? 0) + (row.side === winningSide ? 1 : 0),
      ...seedColumns(seeds.get(row.playerId) ?? null),
    };
  });

  // One rating per person per group (`ratings_pkey (group_id, player_id)`, 0026).
  const { error } = await client.from('ratings').upsert(inserts, { onConflict: 'group_id,player_id' });
  if (error) throw new Error(`rating: ratings upsert failed: ${error.message}`);
}
