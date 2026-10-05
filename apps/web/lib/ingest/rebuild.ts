import { displayRating, foldWinProbability, printedChange, type Rating } from '@customs/core';
import type { RatingInsert, SideValue } from '@customs/db';
import { invalidateGroup } from '../cache/tags';
import { gameModeFromRaw } from '../games/queue';
import type { ServiceClient } from '../supabase';
import { applyGamePlayerRatings } from './applyRatings';
import {
  type FoldOutcome,
  type FoldRatedPlayer,
  foldGameKustom,
  foldGameOutcomes,
  gateRatedGame,
  KUSTOM_FRESH,
  type KustomFoldOutcome,
  type KustomState,
  type RatedSkipReason,
} from './fold';
import { kustomWeekStart } from './kustomWeek';
import { countsForRatings, readRatingsSince } from './ratingsEpoch';
import {
  type CompareChange,
  type CompareGame,
  compareRebuild,
  formatComparison,
  type RebuildComparison,
} from './rebuildCompare';
import {
  recomputeInferredRoles,
  releaseFillFlags,
  selectAllPlayerIds,
  selectReleasedFillFlags,
} from './roles';
import { readSeed, type StoredSeed, sameSeed, seedColumns, seedFor } from './seed';

/**
 * The rating rebuild (M5.2): fold every rated-eligible game of a group, in `started_at` order,
 * from seeds -- **one group at a time** since M13.3, because a rating is a position in one
 * group's pool. {@link rebuildRatings} folds one group; {@link rebuildAllGroups} is the loop the
 * command runs.
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
 *    the answer is complete and a crash halfway leaves the old numbers standing. Since 0043 the
 *    `game_players` half of that write is one statement (`applyGamePlayerRatings`), so it lands
 *    whole or not at all; the `ratings` upsert after it is its own call;
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
 *
 * **The Kustom rating, both tracks (M18.5).** The same loop folds `foldGameKustom`: all-time from
 * 1200 and 0 at the group's epoch (the OpenSkill universe), weekly from 1200 and 0 at every week
 * boundary over **every** game of the group, because the weekly track ignores `ratings_since`. So
 * the snapshot is the whole group now; a game before the epoch keeps its stored all-time columns
 * (history) and has its weekly columns, share rank and award refolded.
 */

/** PostgREST's `max_rows`. Every select here pages, because a group outgrows one page. */
const PAGE_SIZE = 1000;

/** Rows per batched write. Small enough for a URL, large enough that a group is a few calls. */
const WRITE_CHUNK = 500;

/** A game landing inside this window means somebody is probably still playing. */
export const RECENT_GAME_MS = 15 * 60 * 1000;

/**
 * How close two ratings have to be to count as the same number.
 *
 * PostgREST prints a `double precision` to **fifteen significant digits**, so a rating written
 * by the live fold and read back here is never bit-identical to the double that was stored: it
 * is that double rounded. The live fold then folds the next game from that rounded read, while
 * this one folds the whole group in memory from seeds — so the two chains drift apart in the
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
  /**
   * The group to fold (M13.3). Ratings are per group, so a rebuild is too: this group's games,
   * this group's `ratings` rows, this group's guard. {@link rebuildAllGroups} is the loop.
   */
  groupId: string;
  /** Skip the guard, and nothing else. */
  force?: boolean;
  /** Compute and report; write nothing. */
  dryRun?: boolean;
  /** Delete `ratings` rows for players with no rated game in the group. */
  prune?: boolean;
  /**
   * Tests only: run between the snapshot and the write, which is the window the fence exists
   * to notice. Nothing in the app passes it.
   */
  afterSnapshot?: () => Promise<void>;
  /** Tests only: rows per 0043 call (default `APPLY_CHUNK_ROWS`). */
  writeChunkRows?: number;
  now?: Date;
  /** The zone of the weekly track's Sunday 06:00 (M18.5). Default: `nightTimeZone()`, the board's. */
  timeZone?: string;
}

export type RebuildSkipReason = RatedSkipReason;

export interface RebuildReport {
  groupId: string;
  /** The group's slug, for the printed report. */
  groupSlug: string;
  /** The group's epoch (M14.18): only games that started at or after it are folded. Null: never reset. */
  ratingsSince: string | null;
  /** Games since the epoch: the all-time track's universe, as before M18. */
  considered: number;
  rated: number;
  /**
   * Games before the epoch that passed the gate and were folded on the weekly Kustom track alone
   * (M18.5: the weekly track ignores `ratings_since`). Zero for a group that was never reset.
   */
  weeklyOnly: number;
  /**
   * The Kustom fold's size (M18.5), printed as `kustom  N game_players rows, N ratings rows, N weeks`:
   * rows folded on the weekly track (every rated game's ten), `ratings` rows carrying an all-time
   * Rating, and weeks with at least one rated game.
   */
  kustom: { gamePlayerRows: number; ratingRows: number; weeks: number };
  /**
   * The M18.10 gate (M18.5, `rebuildCompare.ts`): the Kustom fold against the stored numbers over
   * the same games -- log loss, Spearman, top 3, places moved and a short side by side. Printed on
   * a dry run. Null for a group with no rated game since the epoch.
   */
  comparison: RebuildComparison | null;
  skipped: Record<RebuildSkipReason, number>;
  /**
   * `game_players` rows whose rating columns or fold breakdown changed (or would, on a dry run).
   */
  gamePlayerRowsChanged: number;
  /**
   * Rows the database actually wrote (0043 returns it; it skips a row whose stored values already
   * match exactly). Zero on a dry run and on a second run of an unchanged database.
   */
  gamePlayerRowsWritten: number;
  /** `apply_game_player_ratings` calls made (chunks of whole games, `APPLY_CHUNK_ROWS`). */
  gamePlayerWriteCalls: number;
  /**
   * Rated `game_players` rows this run writes a fold breakdown on for the first time (M14.58,
   * `0034`: stored before the migration). Zero on every run after the first.
   */
  breakdownsFilled: number;
  /** `ratings` rows written (or that would be). */
  ratingRowsChanged: number;
  /** Players with at least one rated game in the group. */
  playersWritten: number;
  /**
   * Players whose inferred pair moved (M5.17) — counted over **every** player, not only this
   * group's. Zero on a second run of an unchanged database, which is the same idempotency the
   * rating columns have: a recompute that agrees with what is stored writes nothing, so
   * `roles_inferred_at` does not creep forward every run.
   */
  rolesChanged: number;
  /**
   * Stored `counts_for_role_inference = false` rows this run sets back to `true` (or would): the
   * M21.8 fill guard's refold of history, for games whose teams were not the chosen split's or
   * whose player played another role than the split's (`selectReleasedFillFlags`). Zero on every
   * run after the first.
   */
  fillFlagsReleased: number;
  /**
   * The biggest move this rebuild made to a `mu` that was **already stored**. A player who had
   * no `ratings` row is not a move of any size — they are counted in `firstRatings` instead,
   * because "the biggest change was 25.0" for somebody's first game is noise, not news.
   */
  largestMuChange: { puuid: string; from: number; to: number; delta: number } | null;
  /** Players who had no `ratings` row in this group before the run. */
  firstRatings: number;
  /**
   * `ratings` rows this run writes a seed on for the first time (M5.7): a row this fold is
   * creating, and — the backfill — a row written before `0012` that has none. Zero on every
   * run after the first, which is what makes it worth printing on a dry run: the seeds are
   * where a player's history starts, and this is the count of the ones about to be fixed.
   */
  seedsStored: number;
  /** `ratings` rows for players with no rated game left in the group. */
  orphanRatings: number;
  prunedRatings: number;
  /** Data bugs, named. A non-empty list is a non-zero exit. */
  problems: string[];
  dryRun: boolean;
}

export type RebuildResult =
  | { ok: true; report: RebuildReport }
  | { ok: false; code: 'guard' | 'fence'; message: string; report: RebuildReport | null };

/**
 * Did this run write a row? (M19.9: the caller bumps the group's `group_live` row `ratings` only
 * then.) A dry run and a guard refusal never do; a fence did write before it noticed the drift; an
 * unchanged database writes nothing on its second run.
 */
export function rebuildWrote(result: RebuildResult): boolean {
  const report = result.report;
  if (report === null || report.dryRun) return false;
  if (!result.ok && result.code === 'guard') return false;
  return (
    report.gamePlayerRowsChanged > 0 ||
    report.breakdownsFilled > 0 ||
    report.ratingRowsChanged > 0 ||
    report.prunedRatings > 0 ||
    report.fillFlagsReleased > 0 ||
    report.rolesChanged > 0
  );
}

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
   * not read the whole block to do it: this select covers **a whole group's history**, an end-of-game
   * block is tens of kilobytes, and a hosted rebuild would drag all that JSON across the
   * wire to look at one string. The stored column `game_mode` (0039, generated from `raw`) is read, and the shape
   * put back together here is the only shape `gameModeFromRaw` ever looks at, so the answer is
   * identical to the live fold's on every input, including a null `raw` and a `gameMode` that
   * is not a string.
   */
  raw: unknown;
  /** `games.rated` (M15.3): false is skipped as `not-rated`, exactly as the live fold skips it. */
  rated: boolean;
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
  /** `players.display_name ?? game_name`, for the dry run's side by side only. */
  name: string | null;
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
  foldP: number | null;
  baseMuAfter: number | null;
  award: string | null;
  ratedGamesBefore: number | null;
  rBefore: number | null;
  rAfter: number | null;
  k: number | null;
  shareRank: number | null;
  weekRBefore: number | null;
  weekRAfter: number | null;
  weekK: number | null;
  weekFoldP: number | null;
  weekGamesBefore: number | null;
}

/**
 * Every column the rebuild owns on one `game_players` row: OpenSkill's four, the 0034 breakdown
 * (whose `fold_p`, `award` and `rated_games_before` are the Kustom all-time track's since M18.5),
 * and the 0036 Kustom columns of both tracks.
 */
interface WriteRow {
  gameId: string;
  playerId: string;
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
  /** The fold's breakdown (M14.58, `0034`), null on a row the gate refused. */
  foldP: number | null;
  baseMuAfter: number | null;
  award: FoldAwardValue | null;
  ratedGamesBefore: number | null;
  rBefore: number | null;
  rAfter: number | null;
  k: number | null;
  shareRank: number | null;
  weekRBefore: number | null;
  weekRAfter: number | null;
  weekK: number | null;
  weekFoldP: number | null;
  weekGamesBefore: number | null;
}

type FoldAwardValue = FoldOutcome['award'];

export async function rebuildRatings(client: ServiceClient, options: RebuildOptions): Promise<RebuildResult> {
  const now = options.now ?? new Date();
  const groupId = options.groupId;
  const groupSlug = await resolveGroupSlug(client, groupId);

  if (!options.force) {
    // Per group (M13.3): another group's live lobby says nothing about whether this group's
    // numbers are about to move under the rebuild.
    const blocker = await guardBlocker(client, groupId, now);
    if (blocker !== null) {
      return { ok: false, code: 'guard', message: `${GUARD_MESSAGE} (${blocker})`, report: null };
    }
  }

  // ---- Snapshot -----------------------------------------------------------------------
  //
  // `started_at` then `lcu_game_id`, and the second key is not decoration: backfill will
  // happily land two games with the same `gameCreation`, and without a tie-break two runs
  // could order them differently and disagree about the numbers.
  // Every game of the group (M18.5): the all-time track folds only games since the group's latest
  // reset (M14.18), whose older games keep their stored all-time columns, but the weekly track
  // ignores the reset and folds every rated game of every week.
  const since = await readRatingsSince(client, groupId);
  const timeZone = options.timeZone;
  const games = await selectGroupGames(client, groupId);
  const rows = await selectGroupGamePlayers(client, groupId);
  const storedRatings = await selectGroupRatings(client, groupId);

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
    // Played not rated (M15.3): a class or region wars game, or the Rated switch. Counted on
    // Stats and Games, never folded; its rating columns are nulled like any skipped game's.
    'not-rated': 0,
  };
  const writes: WriteRow[] = [];
  let rated = 0;
  let considered = 0;
  let weeklyOnly = 0;

  // The Kustom fold's two running states (M18.5). All-time: from 1200 and 0 at the epoch, like
  // OpenSkill from its seeds. Weekly: emptied at every week boundary, so everyone's first game of
  // a week is 1200, n 0 (K 32, 50/50).
  const allTime = new Map<string, KustomState>();
  let week = new Map<string, KustomState>();
  let weekKey: string | null = null;
  let weeks = 0;
  let kustomRows = 0;

  const compareGames: CompareGame[] = [];
  const compareChanges: CompareChange[] = [];
  let lastRatedAt: string | null = null;
  const names = new Map<string, string>();
  for (const row of rows) if (row.name !== null) names.set(row.playerId, row.name);

  const storedRow = new Map<string, SnapshotRow>();
  for (const row of rows) storedRow.set(`${row.gameId}:${row.playerId}`, row);

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
    const gate = gateRatedGame(players, game.durationS, game.raw, game.rated);
    // Before the epoch: history on the all-time track (its stored columns are kept as they are),
    // still folded on the weekly track.
    const afterEpoch = countsForRatings(game.startedAt, since);
    if (afterEpoch) considered += 1;

    if (!gate.ok) {
      if (afterEpoch) skipped[gate.reason] += 1;
      if (gate.reason === 'duplicate-player') {
        // A data bug: the fold must not average somebody against themselves, and nobody should
        // find out about it from a quiet number in a table.
        problems.push(`game ${game.lcuGameId} has the same player twice on the scoreboard`);
      }
      // A game that no longer qualifies must not keep stale numbers from a previous fold.
      for (const player of players) {
        const previous = storedRow.get(`${game.id}:${player.playerId}`);
        writes.push(
          afterEpoch || previous === undefined ? nulled(game.id, player.playerId) : weekNulled(previous),
        );
      }
      continue;
    }

    // The weekly track's week (M18.5): games arrive in order, so a new key is a new week.
    const key = kustomWeekStart(game.startedAt, timeZone);
    if (key !== weekKey) {
      weekKey = key;
      week = new Map();
      weeks += 1;
    }
    const kustom = foldGameKustom(
      gate.blue,
      gate.red,
      { allTime: afterEpoch ? allTime : null, week },
      game.winningSide,
    );
    kustomRows += players.length;

    if (!afterEpoch) {
      for (const player of players) {
        const outcome = kustom.get(player.playerId) as KustomFoldOutcome;
        week.set(player.playerId, { r: outcome.week.rAfter, n: outcome.week.n + 1 });
        const previous = storedRow.get(`${game.id}:${player.playerId}`);
        writes.push(weekOnly(game.id, player.playerId, previous, outcome));
      }
      weeklyOnly += 1;
      continue;
    }

    const before = new Map<string, Rating>();
    for (const player of players) {
      before.set(player.playerId, current.get(player.playerId) ?? mustSeed(seeds, player.playerId));
    }

    const outcomes = foldGameOutcomes(gate.blue, gate.red, before, game.winningSide);

    // The M18.10 gate's inputs (read-only): blue's stored OpenSkill odds -- an OpenSkill-era row's
    // `fold_p`, else `foldWinProbability` of the stored befores, which is the same number (M14.59)
    // -- beside blue's Kustom expected, and each row's stored and new printed change.
    compareGames.push({
      blueWon: game.winningSide === 100,
      oldBlueP: storedBlueP(
        gate.blue.map((p) => storedRow.get(`${game.id}:${p.playerId}`)),
        gate.red.map((p) => storedRow.get(`${game.id}:${p.playerId}`)),
      ),
      newBlueP: kustom.get((gate.blue[0] as FoldRatedPlayer).playerId)?.allTime?.expected as number,
    });
    lastRatedAt = game.startedAt;

    for (const player of players) {
      const playerBefore = before.get(player.playerId) as Rating;
      const outcome = outcomes.get(player.playerId) as FoldOutcome;
      const k = kustom.get(player.playerId) as KustomFoldOutcome;
      const kAllTime = k.allTime as NonNullable<KustomFoldOutcome['allTime']>;
      const playerAfter = outcome.after;
      current.set(player.playerId, playerAfter);
      allTime.set(player.playerId, { r: kAllTime.rAfter, n: kAllTime.n + 1 });
      const old = storedRow.get(`${game.id}:${player.playerId}`);
      compareChanges.push({
        playerId: player.playerId,
        startedAt: game.startedAt,
        oldChange:
          old?.muBefore == null || old.muAfter == null
            ? null
            : displayRating(old.muAfter) - displayRating(old.muBefore),
        newChange: printedChange(kAllTime.rBefore, kAllTime.rAfter),
      });
      week.set(player.playerId, { r: k.week.rAfter, n: k.week.n + 1 });
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
        // Kustom's all-time expected for this row's side (0036 reuses the column).
        foldP: kAllTime.expected,
        baseMuAfter: outcome.baseMuAfter,
        award: k.award,
        // This player's rated games in the group before this one, since the epoch: the fold's own
        // running count, which is what `ratings.games` was when the live fold rated the game, and
        // the all-time `n` K was read from.
        ratedGamesBefore: tally.games,
        rBefore: kAllTime.rBefore,
        rAfter: kAllTime.rAfter,
        k: kAllTime.k,
        ...weekColumns(k),
      });
    }
    rated += 1;
  }

  // ---- What actually differs from what is stored --------------------------------------
  //
  // Only the rows that move are written. That is not an optimisation: `ratings.updated_at` has
  // a trigger, so rewriting an unchanged row would make two runs of an idempotent command
  // produce different tables, and check 1 of the acceptance list would be a lie.
  const stored = storedRow;

  const changedRows = writes.filter((write) => {
    const row = stored.get(`${write.gameId}:${write.playerId}`);
    if (row === undefined) return true;
    return !(
      sameNumber(row.muBefore, write.muBefore) &&
      sameNumber(row.sigmaBefore, write.sigmaBefore) &&
      sameNumber(row.muAfter, write.muAfter) &&
      sameNumber(row.sigmaAfter, write.sigmaAfter) &&
      sameNumber(row.foldP, write.foldP) &&
      sameNumber(row.baseMuAfter, write.baseMuAfter) &&
      row.award === write.award &&
      row.ratedGamesBefore === write.ratedGamesBefore &&
      sameNumber(row.rBefore, write.rBefore) &&
      sameNumber(row.rAfter, write.rAfter) &&
      sameNumber(row.k, write.k) &&
      row.shareRank === write.shareRank &&
      sameNumber(row.weekRBefore, write.weekRBefore) &&
      sameNumber(row.weekRAfter, write.weekRAfter) &&
      sameNumber(row.weekK, write.weekK) &&
      sameNumber(row.weekFoldP, write.weekFoldP) &&
      row.weekGamesBefore === write.weekGamesBefore
    );
  });
  // M14.58: rated rows this run gives a breakdown for the first time (stored before `0034`).
  const breakdownsFilled = writes.filter((write) => {
    // An all-time row only: a weekly-only row (before the epoch) is not M14.58's breakdown.
    if (write.award === null || write.muAfter === null) return false;
    const row = stored.get(`${write.gameId}:${write.playerId}`);
    return row === undefined || row.award === null;
  }).length;

  const ratingInserts: RatingInsert[] = [];
  let largestMuChange: RebuildReport['largestMuChange'] = null;
  let firstRatings = 0;
  let seedsStored = 0;
  for (const [playerId, tally] of played) {
    const rating = current.get(playerId) as Rating;
    const r = (allTime.get(playerId) ?? KUSTOM_FRESH).r;
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
      sameNumber(previous.r, r) &&
      previous.games === tally.games &&
      previous.wins === tally.wins &&
      sameSeed(previous.seed, seed);
    if (!unchanged) {
      ratingInserts.push({
        group_id: groupId,
        player_id: playerId,
        mu: rating.mu,
        sigma: rating.sigma,
        r,
        games: tally.games,
        wins: tally.wins,
        ...seedColumns(seed),
      });
    }
    if (previous === undefined) {
      firstRatings += 1;
      continue;
    }
    if (previous.mu === null) continue;
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

  const comparison =
    rated === 0
      ? null
      : compareRebuild({
          games: compareGames,
          changes: compareChanges,
          players: [...played].map(([playerId, tally]) => {
            const mu = storedRatings.get(playerId)?.mu ?? null;
            return {
              playerId,
              name: names.get(playerId) ?? (puuids.get(playerId) ?? playerId).slice(0, 12),
              games: tally.games,
              oldRating: mu === null ? null : displayRating(mu),
              newRating: Math.round((allTime.get(playerId) ?? KUSTOM_FRESH).r),
            };
          }),
          // The last two weeks: from the boundary a week before the last rated game's week.
          recentSince:
            lastRatedAt === null
              ? null
              : new Date(Date.parse(kustomWeekStart(lastRatedAt, timeZone)) - 7 * 86_400_000).toISOString(),
        });

  // M21.8: the fill guard's refold (read now so a dry run can say how many would move).
  const releasedFlags = await selectReleasedFillFlags(client, groupId);

  const report: RebuildReport = {
    groupId,
    groupSlug,
    ratingsSince: since,
    considered,
    rated,
    weeklyOnly,
    kustom: { gamePlayerRows: kustomRows, ratingRows: played.size, weeks },
    comparison,
    skipped,
    gamePlayerRowsChanged: changedRows.length,
    gamePlayerRowsWritten: 0,
    gamePlayerWriteCalls: 0,
    breakdownsFilled,
    ratingRowsChanged: ratingInserts.length,
    seedsStored,
    playersWritten: played.size,
    rolesChanged: 0,
    fillFlagsReleased: releasedFlags.length,
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
  const written = await writeGamePlayerRatings(
    client,
    groupId,
    changedRows,
    options.writeChunkRows ?? APPLY_CHUNK_ROWS,
  );
  report.gamePlayerRowsWritten = written.written;
  report.gamePlayerWriteCalls = written.calls;
  await writeRatings(client, ratingInserts);
  if (options.prune && orphans.length > 0) {
    await pruneRatings(client, groupId, orphans);
    report.prunedRatings = orphans.length;
  }
  // Every game's `mu_after` may have moved: drop the group's cached game-derived reads (app-perf;
  // a no-op in the script, whose writes show when the entries expire).
  invalidateGroup(groupId, ['games']);

  // ---- Inferred roles (M5.17) ----------------------------------------------------------
  //
  // **Every player**, not only the ones with a game in this group. Three reasons, and the
  // third is the one that made this the whole roster: a game that stopped qualifying above just
  // lost its rating columns, so its ten have one counted game fewer than they did a second ago;
  // a player's rated games are read across groups, so folding one group can move somebody who
  // has none in it; and an M1-era hand-set pair on somebody who has never played is exactly the
  // row "overwritten by the first recompute" means, and no game-driven pass would ever visit
  // it. `recomputeInferredRoles` writes only the rows that actually move, so the second run of
  // an unchanged database changes nothing here either.
  //
  // After the writes, because it reads `mu_after` to decide which games count, and that column
  // is what the two calls above have just settled.
  //
  // The fill guard's released flags first (M21.8), because the recompute reads them.
  report.fillFlagsReleased = await releaseFillFlags(client, releasedFlags);
  const roles = await recomputeInferredRoles(client, await selectAllPlayerIds(client), { now });
  report.rolesChanged = roles.changed;

  // ---- Fence ---------------------------------------------------------------------------
  const drift = await fenceDrift(client, groupId, games, byGame);
  if (drift !== null) {
    return { ok: false, code: 'fence', message: `${FENCE_MESSAGE} (${drift})`, report };
  }

  return { ok: true, report };
}

// ---------------------------------------------------------------------------
// Every group (M13.3)
// ---------------------------------------------------------------------------

export interface RebuildAllOptions extends Omit<RebuildOptions, 'groupId'> {
  /** One group by slug (`--group <slug>`); every group, oldest first, when absent. */
  groupSlug?: string | null;
}

/** One group's outcome inside {@link rebuildAllGroups}. */
export interface GroupRebuild {
  groupId: string;
  groupSlug: string;
  result: RebuildResult;
}

export type RebuildAllResult =
  | { ok: true; groups: GroupRebuild[] }
  | { ok: false; code: 'no-group'; message: string };

/**
 * `rebuild-ratings` over every group, **each folded independently** (M13.3): a group's ratings
 * are a fold over that group's games and nothing else, so the groups share no state and one
 * group's guard refusing (a live lobby, a game in the last fifteen minutes) does not stop the
 * next group's rebuild. Oldest group first, so the original group is always the first report.
 *
 * Each group's result is returned as {@link rebuildRatings} gave it; the command decides the exit
 * code from the worst of them.
 */
export async function rebuildAllGroups(
  client: ServiceClient,
  options: RebuildAllOptions = {},
): Promise<RebuildAllResult> {
  const query = client.from('groups').select('id, slug').order('created_at', { ascending: true });
  const { data, error } = await (options.groupSlug ? query.eq('slug', options.groupSlug) : query);
  if (error) throw new Error(`rebuild: groups select failed: ${error.message}`);

  const groups = data ?? [];
  if (groups.length === 0) {
    return {
      ok: false,
      code: 'no-group',
      message: options.groupSlug ? `No group with the slug ${options.groupSlug}.` : 'No groups exist.',
    };
  }

  const { groupSlug: _slug, ...rest } = options;
  const results: GroupRebuild[] = [];
  for (const group of groups) {
    results.push({
      groupId: group.id,
      groupSlug: group.slug,
      result: await rebuildRatings(client, { ...rest, groupId: group.id }),
    });
  }
  return { ok: true, groups: results };
}

function nulled(gameId: string, playerId: string): WriteRow {
  return {
    gameId,
    playerId,
    muBefore: null,
    sigmaBefore: null,
    muAfter: null,
    sigmaAfter: null,
    // A refused game keeps no breakdown either (`0034`'s check: none outlives its rating), and no
    // Kustom column on either track (M18.4: an un-rate nulls every column of both tracks).
    foldP: null,
    baseMuAfter: null,
    award: null,
    ratedGamesBefore: null,
    rBefore: null,
    rAfter: null,
    k: null,
    shareRank: null,
    weekRBefore: null,
    weekRAfter: null,
    weekK: null,
    weekFoldP: null,
    weekGamesBefore: null,
  };
}

/** A stored row's all-time columns, exactly as they are: history the rebuild does not refold. */
function keptAllTime(row: SnapshotRow): Omit<WriteRow, 'gameId' | 'playerId'> {
  return {
    muBefore: row.muBefore,
    sigmaBefore: row.sigmaBefore,
    muAfter: row.muAfter,
    sigmaAfter: row.sigmaAfter,
    foldP: row.foldP,
    baseMuAfter: row.baseMuAfter,
    award: storedAward(row.award),
    ratedGamesBefore: row.ratedGamesBefore,
    rBefore: row.rBefore,
    rAfter: row.rAfter,
    k: row.k,
    shareRank: row.shareRank,
    weekRBefore: row.weekRBefore,
    weekRAfter: row.weekRAfter,
    weekK: row.weekK,
    weekFoldP: row.weekFoldP,
    weekGamesBefore: row.weekGamesBefore,
  };
}

/**
 * A game before the epoch that no longer passes the gate: its weekly columns go, and the award
 * and share rank go with them unless an all-time rating from before the reset still stands on
 * the row (0036: neither outlives every rating on the row). The all-time history stays.
 */
function weekNulled(row: SnapshotRow): WriteRow {
  const hasAllTime = row.muAfter !== null || row.rAfter !== null;
  return {
    gameId: row.gameId,
    playerId: row.playerId,
    ...keptAllTime(row),
    award: hasAllTime ? storedAward(row.award) : null,
    shareRank: hasAllTime ? row.shareRank : null,
    weekRBefore: null,
    weekRAfter: null,
    weekK: null,
    weekFoldP: null,
    weekGamesBefore: null,
  };
}

/**
 * A game before the epoch, folded on the weekly track alone: the stored all-time columns kept,
 * the weekly five, the share rank and the award written (the same game names the same MVP and
 * ACE on any fold, so an award stored by the pre-reset fold is rewritten to itself).
 */
function weekOnly(
  gameId: string,
  playerId: string,
  previous: SnapshotRow | undefined,
  outcome: KustomFoldOutcome,
): WriteRow {
  const base =
    previous === undefined ? nulled(gameId, playerId) : { gameId, playerId, ...keptAllTime(previous) };
  return { ...base, award: outcome.award, ...weekColumns(outcome) };
}

/** The weekly five and the shared share rank, from one Kustom outcome. */
function weekColumns(outcome: KustomFoldOutcome) {
  return {
    shareRank: outcome.shareRank,
    weekRBefore: outcome.week.rBefore,
    weekRAfter: outcome.week.rAfter,
    weekK: outcome.week.k,
    weekFoldP: outcome.week.expected,
    weekGamesBefore: outcome.week.n,
  };
}

/**
 * Blue's stored OpenSkill odds for the gate: the `fold_p` of a blue row the OpenSkill fold wrote
 * (`r_after` null), else `foldWinProbability` of the ten stored befores, else null.
 */
function storedBlueP(
  blue: readonly (SnapshotRow | undefined)[],
  red: readonly (SnapshotRow | undefined)[],
): number | null {
  const first = blue[0];
  if (first !== undefined && first.rAfter === null && first.foldP !== null) return first.foldP;
  const befores = (side: readonly (SnapshotRow | undefined)[]) =>
    side.flatMap((row) =>
      row?.muBefore == null || row.sigmaBefore == null ? [] : [{ mu: row.muBefore, sigma: row.sigmaBefore }],
    );
  const b = befores(blue);
  const r = befores(red);
  return b.length === 5 && r.length === 5 ? foldWinProbability(b, r, 100) : null;
}

function storedAward(award: string | null): FoldAwardValue | null {
  return award === 'mvp' || award === 'ace' || award === 'none' ? award : null;
}

function mustSeed(seeds: Map<string, StoredSeed>, playerId: string): Rating {
  return mustSeedRecord(seeds, playerId).rating;
}

function mustSeedRecord(seeds: Map<string, StoredSeed>, playerId: string): StoredSeed {
  const seed = seeds.get(playerId);
  if (seed === undefined) throw new Error(`rebuild: no seed for player ${playerId}`);
  return seed;
}

/** `groups.slug`. Throws for a group that does not exist: folding nobody's games is a typo. */
async function resolveGroupSlug(client: ServiceClient, groupId: string): Promise<string> {
  const { data, error } = await client.from('groups').select('slug').eq('id', groupId).maybeSingle();
  if (error) throw new Error(`rebuild: group select failed: ${error.message}`);
  if (data === null) throw new Error(`rebuild: no group ${groupId}`);
  return data.slug;
}

/**
 * The reason the guard says no for **this group**, or null. One sentence either way
 * (`GUARD_MESSAGE`).
 */
async function guardBlocker(client: ServiceClient, groupId: string, now: Date): Promise<string | null> {
  const { data: lobby, error: lobbyError } = await client
    .from('lobbies')
    .select('id, status')
    .eq('group_id', groupId)
    .in('status', ['open', 'balanced', 'in_game'])
    .limit(1)
    .maybeSingle();
  if (lobbyError) throw new Error(`rebuild: lobby guard failed: ${lobbyError.message}`);
  if (lobby) return `lobby ${lobby.id} is ${lobby.status}`;

  const since = new Date(now.getTime() - RECENT_GAME_MS).toISOString();
  const { data: game, error: gameError } = await client
    .from('games')
    .select('lcu_game_id, created_at')
    .eq('group_id', groupId)
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

async function selectGroupGames(client: ServiceClient, groupId: string): Promise<SnapshotGame[]> {
  const rows = await selectPaged('games select', (from, to) => {
    return client
      .from('games')
      .select('id, lcu_game_id, started_at, duration_s, winning_side, source, rated, gameMode:game_mode')
      .eq('group_id', groupId)
      .not('winning_side', 'is', null)
      .order('started_at', { ascending: true })
      .order('lcu_game_id', { ascending: true })
      .range(from, to);
  });

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
      rated: row.rated,
    }));
}

/**
 * Every `game_players` row of the group, with the player's rank for the seed.
 *
 * Filtered on the row's own `group_id` rather than an `in` list of game ids: a group's worth of
 * uuids is a URL nobody should build.
 */
async function selectGroupGamePlayers(client: ServiceClient, groupId: string): Promise<SnapshotRow[]> {
  const rows = await selectPaged('game_players select', (from, to) => {
    return (
      client
        .from('game_players')
        .select(
          // `role` and the nine stat columns are M7.9's, and are the same list `rating.ts`
          // selects: the rebuild has to be able to name the same MVP the live fold named, or the
          // two folds disagree about a game and one of them rewrites the other's numbers.
          'game_id, player_id, side, role, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_before, sigma_before, mu_after, sigma_after, fold_p, base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank, week_r_before, week_r_after, week_k, week_fold_p, week_games_before, players!inner(puuid, rank_tier, rank_division, display_name, game_name)',
        )
        // `game_players.group_id` is always its game's (`game_players_game_group_fkey`).
        .eq('group_id', groupId)
        .order('game_id', { ascending: true })
        .order('player_id', { ascending: true })
        .range(from, to)
    );
  });

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
      name: row.players.display_name ?? row.players.game_name ?? null,
      muBefore: row.mu_before,
      sigmaBefore: row.sigma_before,
      muAfter: row.mu_after,
      sigmaAfter: row.sigma_after,
      foldP: row.fold_p,
      baseMuAfter: row.base_mu_after,
      award: row.award,
      ratedGamesBefore: row.rated_games_before,
      rBefore: row.r_before,
      rAfter: row.r_after,
      k: row.k,
      shareRank: row.share_rank,
      weekRBefore: row.week_r_before,
      weekRAfter: row.week_r_after,
      weekK: row.week_k,
      weekFoldP: row.week_fold_p,
      weekGamesBefore: row.week_games_before,
    }));
}

interface StoredRating {
  /** Null on a Kustom-only row (0036): no OpenSkill pair to compare with, so the row is rewritten. */
  mu: number | null;
  sigma: number | null;
  /** The all-time Kustom Rating (0036), null until the Kustom fold first writes the row. */
  r: number | null;
  games: number;
  wins: number;
  /** The stored seed (M5.7), or null on a row written before `0012`. */
  seed: StoredSeed | null;
}

async function selectGroupRatings(
  client: ServiceClient,
  groupId: string,
): Promise<Map<string, StoredRating>> {
  const rows = await selectPaged('ratings select', (from, to) =>
    client
      .from('ratings')
      .select('player_id, mu, sigma, r, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('group_id', groupId)
      .order('player_id', { ascending: true })
      .range(from, to),
  );

  return new Map(
    rows.map((row) => [
      row.player_id,
      { mu: row.mu, sigma: row.sigma, r: row.r, games: row.games, wins: row.wins, seed: readSeed(row) },
    ]),
  );
}

/**
 * Rows per `apply_game_player_ratings` call (0043). A call is one statement, and it runs under the
 * caller's statement timeout (PostgREST's authenticator, about 8 s on hosted; the function's own
 * `statement_timeout` setting does not extend it), so the rebuild writes in chunks well inside it.
 */
export const APPLY_CHUNK_ROWS = 2_000;

/**
 * Every rating column of every row that moved, through 0043 (`applyGamePlayerRatings`), in chunks
 * of **whole games** in `started_at` order (at most `chunkRows` rows a call, a game never split).
 * Each chunk is one statement, so one transaction, and rows the database finds unmoved are skipped
 * there too, so a no-op rebuild fires no Realtime event. A run that fails part way leaves the
 * earlier chunks written and the rest as they were; the rebuild is idempotent, so running it again
 * writes only what is left, and the run after that writes 0. Before 0043 this was one PATCH per
 * row (18,190 requests for a 2,000-game group).
 *
 * `onlyUnrated: false`: deliberately **not** guarded by "rated on no track". The rebuild is the
 * one writer entitled to overwrite the live fold's claim, because it is the one writer that knows
 * the whole order. Every column of both tracks is in every row, so 0036's "a track together or not
 * at all" holds by construction. Returns the rows the database wrote and the calls made.
 */
async function writeGamePlayerRatings(
  client: ServiceClient,
  groupId: string,
  rows: readonly WriteRow[],
  chunkRows: number,
): Promise<{ written: number; calls: number }> {
  const chunks: WriteRow[][] = [];
  let chunk: WriteRow[] = [];
  let game: WriteRow[] = [];
  const closeGame = () => {
    if (game.length === 0) return;
    if (chunk.length > 0 && chunk.length + game.length > chunkRows) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...game);
    game = [];
  };
  for (const row of rows) {
    if (game.length > 0 && game[0]?.gameId !== row.gameId) closeGame();
    game.push(row);
  }
  closeGame();
  if (chunk.length > 0) chunks.push(chunk);

  let written = 0;
  for (const part of chunks) written += await applyChunk(client, groupId, part);
  return { written, calls: chunks.length };
}

function applyChunk(client: ServiceClient, groupId: string, rows: readonly WriteRow[]): Promise<number> {
  return applyGamePlayerRatings(
    client,
    groupId,
    rows.map((row) => ({
      game_id: row.gameId,
      player_id: row.playerId,
      mu_before: row.muBefore,
      sigma_before: row.sigmaBefore,
      mu_after: row.muAfter,
      sigma_after: row.sigmaAfter,
      fold_p: row.foldP,
      base_mu_after: row.baseMuAfter,
      award: row.award,
      rated_games_before: row.ratedGamesBefore,
      r_before: row.rBefore,
      r_after: row.rAfter,
      k: row.k,
      share_rank: row.shareRank,
      week_r_before: row.weekRBefore,
      week_r_after: row.weekRAfter,
      week_k: row.weekK,
      week_fold_p: row.weekFoldP,
      week_games_before: row.weekGamesBefore,
    })),
    { onlyUnrated: false },
  );
}

async function writeRatings(client: ServiceClient, inserts: readonly RatingInsert[]): Promise<void> {
  for (let index = 0; index < inserts.length; index += WRITE_CHUNK) {
    const { error } = await client
      .from('ratings')
      .upsert(inserts.slice(index, index + WRITE_CHUNK), { onConflict: 'group_id,player_id' });
    if (error) throw new Error(`rebuild: ratings upsert failed: ${error.message}`);
  }
}

async function pruneRatings(
  client: ServiceClient,
  groupId: string,
  playerIds: readonly string[],
): Promise<void> {
  for (let index = 0; index < playerIds.length; index += WRITE_CHUNK) {
    const { error } = await client
      .from('ratings')
      .delete()
      .eq('group_id', groupId)
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
  groupId: string,
  games: readonly SnapshotGame[],
  byGame: ReadonlyMap<string, readonly SnapshotRow[]>,
): Promise<string | null> {
  const after = await selectGroupGames(client, groupId);
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
    if (snapshot.rated !== game.rated) return `game ${game.lcuGameId} changed rated`;
  }

  const counts = await selectPaged('fence count', (from, to) =>
    client
      .from('game_players')
      .select('game_id')
      .eq('group_id', groupId)
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
    `group         ${report.groupSlug} (${report.groupId})`,
    ...(report.ratingsSince === null
      ? []
      : [`since         ${report.ratingsSince} (the latest ratings reset)`]),
    `considered    ${report.considered} game${report.considered === 1 ? '' : 's'}`,
    `rated         ${report.rated}${
      report.weeklyOnly > 0 ? ` (and ${report.weeklyOnly} before the reset, on the weekly track only)` : ''
    }`,
    `skipped       ${formatSkipped(report.skipped)}`,
    `${report.dryRun ? 'would change  ' : 'wrote         '}${report.gamePlayerRowsChanged} game_players row${
      report.gamePlayerRowsChanged === 1 ? '' : 's'
    }, ${report.ratingRowsChanged} ratings row${report.ratingRowsChanged === 1 ? '' : 's'}${
      report.dryRun
        ? ''
        : ` (0043: ${report.gamePlayerRowsWritten} game_players rows moved in ${report.gamePlayerWriteCalls} call${
            report.gamePlayerWriteCalls === 1 ? '' : 's'
          })`
    }`,
    `players       ${report.playersWritten} with a rated game`,
    `seeds         ${report.seedsStored} ${report.dryRun ? 'to store' : 'stored'} for the first time`,
    `breakdowns    ${report.breakdownsFilled} game_players row${report.breakdownsFilled === 1 ? '' : 's'} ${
      report.dryRun ? 'to fill' : 'filled'
    } for the first time (0034)`,
    `kustom        ${report.kustom.gamePlayerRows} game_players row${
      report.kustom.gamePlayerRows === 1 ? '' : 's'
    }, ${report.kustom.ratingRows} ratings row${report.kustom.ratingRows === 1 ? '' : 's'}, ${report.kustom.weeks} week${
      report.kustom.weeks === 1 ? '' : 's'
    }`,
    `fill guard    ${report.fillFlagsReleased} filled flag${report.fillFlagsReleased === 1 ? '' : 's'} ${
      report.dryRun ? 'to release' : 'released'
    } (M21.8: teams or role not the split's)`,
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
  if (report.dryRun && report.comparison !== null) lines.push(...formatComparison(report.comparison));
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
