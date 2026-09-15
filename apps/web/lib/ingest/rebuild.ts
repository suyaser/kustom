import type { Rating } from '@customs/core';
import type { RatingInsert, SideValue } from '@customs/db';
import { gameModeFromRaw } from '../games/queue';
import type { ServiceClient } from '../supabase';
import { type FoldRatedPlayer, foldGame, gateRatedGame, type RatedSkipReason } from './fold';
import { recomputeInferredRoles, selectAllPlayerIds } from './roles';
import { readSeed, type StoredSeed, sameSeed, seedColumns, seedFor } from './seed';

/**
 * The rating rebuild (M5.2): fold every rated-eligible game of a season, in `started_at` order,
 * from seeds.
 *
 * This is the promise underneath every number on the leaderboard — the ratings are a fold over
 * games in the order they were played, and if that ever stops being true (a batch of old
 * customs lands from backfill, a bug drops a game, the model changes) one command puts it back.
 * `games.raw` is kept for exactly this reason (`01-architecture.md`); this is what spends it.
 *
 * The fold itself is `fold.ts`, shared with `rating.ts`, so "the rebuild reproduces the
 * incremental fold" is a property of there being one implementation rather than two copies of
 * one. It reproduces it to the precision the database prints (`RATING_EPSILON`), which is the
 * only sense in which it can: see that constant.
 *
 * **No lock** (`04-decisions.md`, 2026-09-09). There is no transaction to hold: the API writes
 * through PostgREST with the service role, one statement at a time, so a script's advisory lock
 * would stop nothing. Instead there are three things:
 *
 * 1. a **guard** that refuses to start while a lobby is live or a game landed in the last
 *    fifteen minutes, so it does not overlap in the first place;
 * 2. an **in-memory fold** with one batched write at the end, so `ratings` is untouched until
 *    the answer is complete and a crash halfway leaves the old numbers standing;
 * 3. a **fence** that re-reads the game set afterwards and says "run it again" if it moved.
 *
 * A concurrent end-of-game post during a rebuild cannot corrupt anything: it reads pre-rebuild
 * ratings, writes its own game's columns, and the final pass overwrites both with the ordered
 * answer. If it arrived after the snapshot, the fence catches it and the second run includes it.
 *
 * **The rebuild is the one writer allowed to overwrite a `mu_after is null` claim** — the live
 * fold's claim serialises two companions posting the same game, and this is the one caller that
 * is entitled to say the claim was wrong.
 *
 * **Where a fold starts** (M5.7, amended 2026-09-16). Each player is seeded from
 * `ratings.seed_mu` / `seed_sigma` when their row has them, and from `provisionalSeed()` —
 * `{ mu: 20, sigma: 12 }`, the same for everybody — when it does not. Both come through
 * `seedFor`, so this command and the live fold cannot disagree about a first number. The stored
 * seed is what makes the command safe to run twice a year apart: a seed written once is never
 * recomputed, so nothing that happens afterwards shifts somebody's whole history.
 *
 * A row with no stored seed is a row written before `0012`, and this is what fills it — with the
 * seed **this run actually folded from**, so the number and the history under it agree by
 * construction. Note what that write includes: `seedColumns` also stores `seed_rank_tier` /
 * `seed_rank_division`, and for a freshly seeded row those strings are the player's rank *as it
 * reads today*. They are informational and drive no number — but a maintenance plan that nulls
 * `seed_mu` / `seed_sigma` to re-seed the group would also overwrite that record of what the
 * client said the night a history started, so re-seed by setting the two numbers directly.
 */

/** PostgREST's `max_rows`. Every select here pages, because a season outgrows one page. */
const PAGE_SIZE = 1000;

/** Rows per batched write. Small enough for a URL, large enough that a season is a few calls. */
const WRITE_CHUNK = 500;

/**
 * How many single-row updates are in flight at once.
 *
 * `game_players` has no batch update through PostgREST, so a rebuild that moves a whole season
 * is one statement per row. Locally 500 at a time is free; through a hosted gateway it is a
 * burst somebody else's night is queued behind, and the command is not in a hurry.
 */
const WRITE_CONCURRENCY = 25;

/** A game landing inside this window means somebody is probably still playing. */
export const RECENT_GAME_MS = 15 * 60 * 1000;

/**
 * How close two ratings have to be to count as the same number.
 *
 * PostgREST prints a `double precision` to **fifteen significant digits**, so a rating written
 * by the live fold and read back here is never bit-identical to the double that was stored: it
 * is that double rounded. The live fold then folds the next game from that rounded read, while
 * this one folds the whole season in memory from seeds — so the two chains drift apart in the
 * last decimal or two and nothing can make them agree bit for bit.
 *
 * Two numbers that differ by less than this are therefore the same rating as far as anything
 * can observe: the leaderboard sorts on `ordinal` and shows `round(mu * 60)`, and 1e-9 of mu is
 * 6e-8 of a display point. Rows inside the tolerance are **not rewritten**, which is what keeps
 * two runs byte-identical — `ratings.updated_at` has a trigger, and rewriting an unchanged row
 * would make an idempotent command produce a different table every time.
 */
export const RATING_EPSILON = 1e-9;

/** Null-safe, tolerance-aware equality for one rating column. */
function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= RATING_EPSILON;
}

export const GUARD_MESSAGE = 'A lobby is live. Run this when nobody is playing, or pass --force.';
export const FENCE_MESSAGE = 'New games landed while this was running. Run it again.';

export interface RebuildOptions {
  /** The season to fold. Defaults to the active one. */
  seasonId?: string | null;
  /** Skip the guard, and nothing else. */
  force?: boolean;
  /** Compute and report; write nothing. */
  dryRun?: boolean;
  /** Delete `ratings` rows for players with no rated game in the season. */
  prune?: boolean;
  /**
   * Tests only: run between the snapshot and the write, which is the window the fence exists
   * to notice. Nothing in the app passes it.
   */
  afterSnapshot?: () => Promise<void>;
  now?: Date;
}

export type RebuildSkipReason = RatedSkipReason;

export interface RebuildReport {
  seasonId: string;
  seasonName: string;
  considered: number;
  rated: number;
  skipped: Record<RebuildSkipReason, number>;
  /** `game_players` rows whose four rating columns changed (or would, on a dry run). */
  gamePlayerRowsChanged: number;
  /** `ratings` rows written (or that would be). */
  ratingRowsChanged: number;
  /** Players with at least one rated game in the season. */
  playersWritten: number;
  /**
   * Players whose inferred pair moved (M5.17) — counted over **every** player, not only this
   * season's. Zero on a second run of an unchanged database, which is the same idempotency the
   * rating columns have: a recompute that agrees with what is stored writes nothing, so
   * `roles_inferred_at` does not creep forward every run.
   */
  rolesChanged: number;
  /**
   * The biggest move this rebuild made to a `mu` that was **already stored**. A player who had
   * no `ratings` row is not a move of any size — they are counted in `firstRatings` instead,
   * because "the biggest change was 25.0" for somebody's first game is noise, not news.
   */
  largestMuChange: { puuid: string; from: number; to: number; delta: number } | null;
  /** Players who had no `ratings` row in this season before the run. */
  firstRatings: number;
  /**
   * `ratings` rows this run writes a seed on for the first time (M5.7): a row this fold is
   * creating, and — the backfill — a row written before `0012` that has none. Zero on every
   * run after the first, which is what makes it worth printing on a dry run: the seeds are
   * where a player's history starts, and this is the count of the ones about to be fixed.
   */
  seedsStored: number;
  /** `ratings` rows for players with no rated game left in the season. */
  orphanRatings: number;
  prunedRatings: number;
  /** Data bugs, named. A non-empty list is a non-zero exit. */
  problems: string[];
  dryRun: boolean;
}

export type RebuildResult =
  | { ok: true; report: RebuildReport }
  | { ok: false; code: 'no-season' | 'guard' | 'fence'; message: string; report: RebuildReport | null };

interface SnapshotGame {
  id: string;
  lcuGameId: number;
  startedAt: string;
  durationS: number;
  winningSide: SideValue;
  source: string;
  /**
   * Enough of `games.raw` to answer the map (M7.1) — `{ gameMode }`, and not the blob.
   *
   * The rebuild has to read the mode for the same reason the live fold does: a game the live
   * fold refused to rate and the rebuild rated would move numbers nobody played for. It must
   * not read the whole block to do it: this select covers **a whole season**, an end-of-game
   * block is tens of kilobytes, and a hosted rebuild would drag the season's JSON across the
   * wire to look at one string. PostgREST projects the field (`raw->gameMode`) and the shape
   * put back together here is the only shape `gameModeFromRaw` ever looks at, so the answer is
   * identical to the live fold's on every input, including a null `raw` and a `gameMode` that
   * is not a string.
   */
  raw: unknown;
}

/**
 * A `game_players` row as the rebuild reads it: the fold's shape — the gate's three fields and
 * M7.9's stat line, so this replay names the same MVP the live fold did — plus the rank the
 * seed is read from and the four rating columns this run is about to agree or disagree with.
 */
interface SnapshotRow extends FoldRatedPlayer {
  gameId: string;
  rankTier: string | null;
  rankDivision: string | null;
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
}

interface WriteRow {
  gameId: string;
  playerId: string;
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
}

export async function rebuildRatings(
  client: ServiceClient,
  options: RebuildOptions = {},
): Promise<RebuildResult> {
  const now = options.now ?? new Date();

  const season = await resolveSeason(client, options.seasonId ?? null);
  if (season === null) {
    return {
      ok: false,
      code: 'no-season',
      message:
        options.seasonId == null
          ? 'No season is active. The one season row is created by migration 0001; restore it with pnpm db:reset locally, or pass --season <id>.'
          : `No season ${options.seasonId}.`,
      report: null,
    };
  }

  if (!options.force) {
    const blocker = await guardBlocker(client, now);
    if (blocker !== null) {
      return { ok: false, code: 'guard', message: `${GUARD_MESSAGE} (${blocker})`, report: null };
    }
  }

  // ---- Snapshot -----------------------------------------------------------------------
  //
  // `started_at` then `lcu_game_id`, and the second key is not decoration: backfill will
  // happily land two games with the same `gameCreation`, and without a tie-break two runs
  // could order them differently and disagree about the numbers.
  const games = await selectSeasonGames(client, season.id);
  const rows = await selectSeasonGamePlayers(client, season.id);
  const storedRatings = await selectSeasonRatings(client, season.id);

  const byGame = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const list = byGame.get(row.gameId);
    if (list) list.push(row);
    else byGame.set(row.gameId, [row]);
  }

  // ---- Fold, in memory, from seeds ----------------------------------------------------
  const current = new Map<string, Rating>();
  const seeds = new Map<string, StoredSeed>();
  const puuids = new Map<string, string>();
  const played = new Map<string, { games: number; wins: number }>();
  const problems: string[] = [];
  const skipped: Record<RebuildSkipReason, number> = {
    'participant-count': 0,
    'side-split': 0,
    duration: 0,
    'duplicate-player': 0,
    // ARAM and anything else that is not the Rift (M7.1). Not a problem, and not a number that
    // should worry anybody: it is how many nights on the Howling Abyss the fold walked past.
    'game-mode': 0,
  };
  const writes: WriteRow[] = [];
  let rated = 0;

  for (const row of rows) {
    puuids.set(row.playerId, row.puuid);
    if (!seeds.has(row.playerId)) {
      /**
       * The seed (M5.7): the stored one, or `provisionalSeed()` — 20 / 12, the same for
       * everybody — when their row has none (2026-09-16). Reading the stored pair first is what
       * stops anything that happened *after* somebody's first rated game rewriting their whole
       * history the next time this command runs: the fold has to start where it started.
       *
       * `rankTier` / `rankDivision` are still passed and still ride onto the stored seed, but
       * they no longer choose a number — they are the record of what the client reported.
       */
      seeds.set(
        row.playerId,
        seedFor(storedRatings.get(row.playerId)?.seed ?? null, row.rankTier, row.rankDivision),
      );
    }
  }

  for (const game of games) {
    const players = byGame.get(game.id) ?? [];
    const gate = gateRatedGame(players, game.durationS, game.raw);

    if (!gate.ok) {
      skipped[gate.reason] += 1;
      if (gate.reason === 'duplicate-player') {
        // A data bug: the fold must not average somebody against themselves, and nobody should
        // find out about it from a quiet number in a table.
        problems.push(`game ${game.lcuGameId} has the same player twice on the scoreboard`);
      }
      // A game that no longer qualifies must not keep stale numbers from a previous fold.
      for (const player of players) {
        writes.push(nulled(game.id, player.playerId));
      }
      continue;
    }

    const before = new Map<string, Rating>();
    for (const player of players) {
      before.set(player.playerId, current.get(player.playerId) ?? mustSeed(seeds, player.playerId));
    }

    const after = foldGame(gate.blue, gate.red, before, game.winningSide);

    for (const player of players) {
      const playerBefore = before.get(player.playerId) as Rating;
      const playerAfter = after.get(player.playerId) as Rating;
      current.set(player.playerId, playerAfter);
      const tally = played.get(player.playerId) ?? { games: 0, wins: 0 };
      played.set(player.playerId, {
        games: tally.games + 1,
        wins: tally.wins + (player.side === game.winningSide ? 1 : 0),
      });
      writes.push({
        gameId: game.id,
        playerId: player.playerId,
        muBefore: playerBefore.mu,
        sigmaBefore: playerBefore.sigma,
        muAfter: playerAfter.mu,
        sigmaAfter: playerAfter.sigma,
      });
    }
    rated += 1;
  }

  // ---- What actually differs from what is stored --------------------------------------
  //
  // Only the rows that move are written. That is not an optimisation: `ratings.updated_at` has
  // a trigger, so rewriting an unchanged row would make two runs of an idempotent command
  // produce different tables, and check 1 of the acceptance list would be a lie.
  const stored = new Map<string, SnapshotRow>();
  for (const row of rows) stored.set(`${row.gameId}:${row.playerId}`, row);

  const changedRows = writes.filter((write) => {
    const row = stored.get(`${write.gameId}:${write.playerId}`);
    if (row === undefined) return true;
    return !(
      sameNumber(row.muBefore, write.muBefore) &&
      sameNumber(row.sigmaBefore, write.sigmaBefore) &&
      sameNumber(row.muAfter, write.muAfter) &&
      sameNumber(row.sigmaAfter, write.sigmaAfter)
    );
  });

  const ratingInserts: RatingInsert[] = [];
  let largestMuChange: RebuildReport['largestMuChange'] = null;
  let firstRatings = 0;
  let seedsStored = 0;
  for (const [playerId, tally] of played) {
    const rating = current.get(playerId) as Rating;
    const previous = storedRatings.get(playerId);
    /**
     * The seed this run folded from, written back (M5.7). For a row that already has one it is
     * the same pair it already holds, so the write is a no-op on those four columns and
     * `sameSeed` below keeps the row out of the payload entirely. For a row written before
     * `0012` it is the backfill: the seed **this fold used**, which is the only value that
     * cannot disagree with the history stored under it.
     */
    const seed = mustSeedRecord(seeds, playerId);
    if (previous === undefined || previous.seed === null) seedsStored += 1;
    const unchanged =
      previous !== undefined &&
      sameNumber(previous.mu, rating.mu) &&
      sameNumber(previous.sigma, rating.sigma) &&
      previous.games === tally.games &&
      previous.wins === tally.wins &&
      sameSeed(previous.seed, seed);
    if (!unchanged) {
      ratingInserts.push({
        player_id: playerId,
        season_id: season.id,
        mu: rating.mu,
        sigma: rating.sigma,
        games: tally.games,
        wins: tally.wins,
        ...seedColumns(seed),
      });
    }
    if (previous === undefined) {
      firstRatings += 1;
      continue;
    }
    // Reported, not acted on: a move smaller than the tolerance is float noise, not news.
    const delta = Math.abs(rating.mu - previous.mu);
    if (delta > RATING_EPSILON && (largestMuChange === null || delta > largestMuChange.delta)) {
      largestMuChange = {
        puuid: puuids.get(playerId) ?? playerId,
        from: previous.mu,
        to: rating.mu,
        delta,
      };
    }
  }

  const orphans = [...storedRatings.keys()].filter((playerId) => !played.has(playerId));

  const report: RebuildReport = {
    seasonId: season.id,
    seasonName: season.name,
    considered: games.length,
    rated,
    skipped,
    gamePlayerRowsChanged: changedRows.length,
    ratingRowsChanged: ratingInserts.length,
    seedsStored,
    playersWritten: played.size,
    rolesChanged: 0,
    largestMuChange,
    firstRatings,
    orphanRatings: orphans.length,
    prunedRatings: 0,
    problems,
    dryRun: options.dryRun === true,
  };

  if (options.dryRun) return { ok: true, report };

  if (options.afterSnapshot) await options.afterSnapshot();

  // ---- Write once, at the end ----------------------------------------------------------
  await writeGamePlayerRatings(client, changedRows);
  await writeRatings(client, ratingInserts);
  if (options.prune && orphans.length > 0) {
    await pruneRatings(client, season.id, orphans);
    report.prunedRatings = orphans.length;
  }

  // ---- Inferred roles (M5.17) ----------------------------------------------------------
  //
  // **Every player**, not only the ones with a game in this season. Three reasons, and the
  // third is the one that made this the whole roster: a game that stopped qualifying above just
  // lost its rating columns, so its ten have one counted game fewer than they did a second ago;
  // a player's rated games are read across seasons, so folding one season can move somebody who
  // has none in it; and an M1-era hand-set pair on somebody who has never played is exactly the
  // row "overwritten by the first recompute" means, and no game-driven pass would ever visit
  // it. `recomputeInferredRoles` writes only the rows that actually move, so the second run of
  // an unchanged database changes nothing here either.
  //
  // After the writes, because it reads `mu_after` to decide which games count, and that column
  // is what the two calls above have just settled.
  const roles = await recomputeInferredRoles(client, await selectAllPlayerIds(client), { now });
  report.rolesChanged = roles.changed;

  // ---- Fence ---------------------------------------------------------------------------
  const drift = await fenceDrift(client, season.id, games, byGame);
  if (drift !== null) {
    return { ok: false, code: 'fence', message: `${FENCE_MESSAGE} (${drift})`, report };
  }

  return { ok: true, report };
}

function nulled(gameId: string, playerId: string): WriteRow {
  return { gameId, playerId, muBefore: null, sigmaBefore: null, muAfter: null, sigmaAfter: null };
}

function mustSeed(seeds: Map<string, StoredSeed>, playerId: string): Rating {
  return mustSeedRecord(seeds, playerId).rating;
}

function mustSeedRecord(seeds: Map<string, StoredSeed>, playerId: string): StoredSeed {
  const seed = seeds.get(playerId);
  if (seed === undefined) throw new Error(`rebuild: no seed for player ${playerId}`);
  return seed;
}

interface SeasonRow {
  id: string;
  name: string;
}

async function resolveSeason(client: ServiceClient, seasonId: string | null): Promise<SeasonRow | null> {
  const query = client.from('seasons').select('id, name');
  const { data, error } =
    seasonId === null
      ? await query.eq('is_active', true).maybeSingle()
      : await query.eq('id', seasonId).maybeSingle();
  if (error) throw new Error(`rebuild: season select failed: ${error.message}`);
  return data;
}

/** The reason the guard says no, or null. One sentence either way (`GUARD_MESSAGE`). */
async function guardBlocker(client: ServiceClient, now: Date): Promise<string | null> {
  const { data: lobby, error: lobbyError } = await client
    .from('lobbies')
    .select('id, status')
    .in('status', ['open', 'balanced', 'in_game'])
    .limit(1)
    .maybeSingle();
  if (lobbyError) throw new Error(`rebuild: lobby guard failed: ${lobbyError.message}`);
  if (lobby) return `lobby ${lobby.id} is ${lobby.status}`;

  const since = new Date(now.getTime() - RECENT_GAME_MS).toISOString();
  const { data: game, error: gameError } = await client
    .from('games')
    .select('lcu_game_id, created_at')
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();
  if (gameError) throw new Error(`rebuild: game guard failed: ${gameError.message}`);
  if (game) return `game ${game.lcu_game_id} landed at ${game.created_at}`;

  return null;
}

/**
 * Every page of a select, because PostgREST caps a response at `max_rows` (1000) and silently
 * returns the first page — which for a fold would be a wrong answer rather than an error.
 */
async function selectPaged<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`rebuild: ${label} failed: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}

async function selectSeasonGames(client: ServiceClient, seasonId: string): Promise<SnapshotGame[]> {
  const rows = await selectPaged('games select', (from, to) =>
    client
      .from('games')
      .select('id, lcu_game_id, started_at, duration_s, winning_side, source, raw->gameMode')
      .eq('season_id', seasonId)
      .not('winning_side', 'is', null)
      .order('started_at', { ascending: true })
      .order('lcu_game_id', { ascending: true })
      .range(from, to),
  );

  return rows
    .filter((row) => row.winning_side === 100 || row.winning_side === 200)
    .map((row) => ({
      id: row.id,
      lcuGameId: row.lcu_game_id,
      startedAt: row.started_at,
      durationS: row.duration_s,
      winningSide: row.winning_side as SideValue,
      source: row.source,
      // The projection, put back into the shape the shared reader takes. A game whose `raw` is
      // null, or whose block named no mode, arrives here as `{ gameMode: null }` — which is
      // Rift, exactly as it is for the live fold.
      raw: { gameMode: row.gameMode },
    }));
}

/**
 * Every `game_players` row of the season, with the player's rank for the seed.
 *
 * Filtered through the embedded `games` rather than an `in` list of game ids: a season's worth
 * of uuids is a URL nobody should build, and `games!inner` is one join either way.
 */
async function selectSeasonGamePlayers(client: ServiceClient, seasonId: string): Promise<SnapshotRow[]> {
  const rows = await selectPaged('game_players select', (from, to) =>
    client
      .from('game_players')
      .select(
        // `role` and the nine stat columns are M7.9's, and are the same list `rating.ts`
        // selects: the rebuild has to be able to name the same MVP the live fold named, or the
        // two folds disagree about a game and one of them rewrites the other's numbers.
        'game_id, player_id, side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_before, sigma_before, mu_after, sigma_after, games!inner(season_id), players!inner(puuid, rank_tier, rank_division)',
      )
      .eq('games.season_id', seasonId)
      .order('game_id', { ascending: true })
      .order('player_id', { ascending: true })
      .range(from, to),
  );

  return rows
    .filter((row) => row.side === 100 || row.side === 200)
    .map((row) => ({
      gameId: row.game_id,
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
      rankTier: row.players.rank_tier,
      rankDivision: row.players.rank_division,
      muBefore: row.mu_before,
      sigmaBefore: row.sigma_before,
      muAfter: row.mu_after,
      sigmaAfter: row.sigma_after,
    }));
}

interface StoredRating {
  mu: number;
  sigma: number;
  games: number;
  wins: number;
  /** The stored seed (M5.7), or null on a row written before `0012`. */
  seed: StoredSeed | null;
}

async function selectSeasonRatings(
  client: ServiceClient,
  seasonId: string,
): Promise<Map<string, StoredRating>> {
  const rows = await selectPaged('ratings select', (from, to) =>
    client
      .from('ratings')
      .select('player_id, mu, sigma, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('season_id', seasonId)
      .order('player_id', { ascending: true })
      .range(from, to),
  );

  return new Map(
    rows.map((row) => [
      row.player_id,
      { mu: row.mu, sigma: row.sigma, games: row.games, wins: row.wins, seed: readSeed(row) },
    ]),
  );
}

/**
 * The four rating columns, row by row.
 *
 * There is no `update ... from (values ...)` through PostgREST, so this is one statement per
 * row that actually moved — which after the first rebuild is none of them. It is deliberately
 * **not** guarded by `mu_after is null`: the rebuild is the one writer entitled to overwrite the
 * live fold's claim, because it is the one writer that knows the whole order.
 */
async function writeGamePlayerRatings(client: ServiceClient, rows: readonly WriteRow[]): Promise<void> {
  for (let index = 0; index < rows.length; index += WRITE_CONCURRENCY) {
    const chunk = rows.slice(index, index + WRITE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        const { error } = await client
          .from('game_players')
          .update({
            mu_before: row.muBefore,
            sigma_before: row.sigmaBefore,
            mu_after: row.muAfter,
            sigma_after: row.sigmaAfter,
          })
          .eq('game_id', row.gameId)
          .eq('player_id', row.playerId);
        if (error) throw new Error(`rebuild: game_players update failed: ${error.message}`);
      }),
    );
  }
}

async function writeRatings(client: ServiceClient, inserts: readonly RatingInsert[]): Promise<void> {
  for (let index = 0; index < inserts.length; index += WRITE_CHUNK) {
    const { error } = await client
      .from('ratings')
      .upsert(inserts.slice(index, index + WRITE_CHUNK), { onConflict: 'player_id,season_id' });
    if (error) throw new Error(`rebuild: ratings upsert failed: ${error.message}`);
  }
}

async function pruneRatings(
  client: ServiceClient,
  seasonId: string,
  playerIds: readonly string[],
): Promise<void> {
  for (let index = 0; index < playerIds.length; index += WRITE_CHUNK) {
    const { error } = await client
      .from('ratings')
      .delete()
      .eq('season_id', seasonId)
      .in('player_id', playerIds.slice(index, index + WRITE_CHUNK));
    if (error) throw new Error(`rebuild: ratings prune failed: ${error.message}`);
  }
}

/**
 * Did the world move under us? The id set, any game's winning side, any game's participant
 * count, and — since M7.1 — any game's **mode**, because the mode is now part of what the fold
 * reads. A repost of a stored game merges `teams[].bans` onto its `raw` (`game.ts`), so that
 * column is not frozen the way the others are; the rest of `raw` and the lobby still cannot
 * change the fold.
 */
async function fenceDrift(
  client: ServiceClient,
  seasonId: string,
  games: readonly SnapshotGame[],
  byGame: ReadonlyMap<string, readonly SnapshotRow[]>,
): Promise<string | null> {
  const after = await selectSeasonGames(client, seasonId);
  if (after.length !== games.length) {
    return `${games.length} games at the start, ${after.length} now`;
  }

  const before = new Map(games.map((game) => [game.id, game]));
  for (const game of after) {
    const snapshot = before.get(game.id);
    if (snapshot === undefined) return `game ${game.lcuGameId} is new`;
    if (snapshot.winningSide !== game.winningSide) return `game ${game.lcuGameId} changed sides`;
    if (gameModeFromRaw(snapshot.raw) !== gameModeFromRaw(game.raw)) {
      return `game ${game.lcuGameId} changed mode`;
    }
  }

  const counts = await selectPaged('fence count', (from, to) =>
    client
      .from('game_players')
      .select('game_id, games!inner(season_id)')
      .eq('games.season_id', seasonId)
      .order('game_id', { ascending: true })
      .range(from, to),
  );
  const tally = new Map<string, number>();
  for (const row of counts) tally.set(row.game_id, (tally.get(row.game_id) ?? 0) + 1);
  for (const game of games) {
    if ((tally.get(game.id) ?? 0) !== (byGame.get(game.id)?.length ?? 0)) {
      return `game ${game.lcuGameId} changed participant count`;
    }
  }

  return null;
}

/** The summary the command prints. One place, so a test can read what a human reads. */
export function formatRebuildReport(report: RebuildReport): string {
  const lines = [
    `season        ${report.seasonName} (${report.seasonId})`,
    `considered    ${report.considered} game${report.considered === 1 ? '' : 's'}`,
    `rated         ${report.rated}`,
    `skipped       ${formatSkipped(report.skipped)}`,
    `${report.dryRun ? 'would change  ' : 'wrote         '}${report.gamePlayerRowsChanged} game_players row${
      report.gamePlayerRowsChanged === 1 ? '' : 's'
    }, ${report.ratingRowsChanged} ratings row${report.ratingRowsChanged === 1 ? '' : 's'}`,
    `players       ${report.playersWritten} with a rated game`,
    `seeds         ${report.seedsStored} ${report.dryRun ? 'to store' : 'stored'} for the first time`,
    `roles         ${report.rolesChanged} inferred pair${report.rolesChanged === 1 ? '' : 's'} moved`,
    `biggest move  ${formatMuChange(report.largestMuChange, report.firstRatings)}`,
  ];
  if (report.orphanRatings > 0) {
    lines.push(
      `orphans       ${report.orphanRatings} ratings row${report.orphanRatings === 1 ? '' : 's'} with no rated game${
        report.prunedRatings > 0 ? ` (${report.prunedRatings} deleted)` : ' (pass --prune to delete)'
      }`,
    );
  }
  for (const problem of report.problems) lines.push(`PROBLEM       ${problem}`);
  if (report.dryRun) lines.push('dry run: nothing was written');
  return lines.join('\n');
}

function formatSkipped(skipped: Record<RebuildSkipReason, number>): string {
  const parts = Object.entries(skipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${reason}`);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

function formatMuChange(change: RebuildReport['largestMuChange'], firstRatings: number): string {
  const first =
    firstRatings === 0 ? '' : ` (first ratings for ${firstRatings} player${firstRatings === 1 ? '' : 's'})`;
  if (change === null) return `none${first}`;
  return `${change.puuid} ${change.from.toFixed(3)} -> ${change.to.toFixed(3)} (${change.delta.toFixed(3)})${first}`;
}
