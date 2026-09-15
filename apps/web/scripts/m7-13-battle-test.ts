import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  config,
  mvpAce,
  type PerformanceBucket,
  type PerformancePlayer,
  performanceScores,
  type Role,
  type Side,
} from '@customs/core';
import { z } from 'zod';
import { championName } from '../lib/champs/names.ts';

/**
 * M7.13's battle test: the retired flat M7.8 formula against the three-bucket one, over the
 * same 23 real ten-human customs M7.12 measured.
 *
 *   pnpm --filter web exec node --import tsx scripts/m7-13-battle-test.ts <rows.json> [--detail] [--quoted]
 *
 * (or `pnpm --filter web m7-13-battle-test <rows.json>`, the package script, same arguments.)
 *
 * ## The M7.14 addendum
 *
 * M7.14 added a seventh component, `damageToObjectives`, weighted `0.15` on the jungle vector
 * and `0.00` on the other two. That moves what "the new column" means — it used to be the
 * six-component three-bucket formula, it is now the seven-component one — so the default report
 * above would quietly be comparing *two* changes at once if it were read as M7.13's evidence.
 *
 *   pnpm --filter web exec node --import tsx scripts/m7-13-battle-test.ts <rows.json> --addendum [--detail] [--quoted]
 *
 * `--addendum` prints a different report over the same file: **six components against seven**,
 * both bucket-weighted, which isolates M7.14 and nothing else. The flat column does not appear
 * in it at all, deliberately — flat-against-seven would conflate M7.13 and M7.14 into one table
 * and neither number would mean anything. Without the flag the report is exactly what it was:
 * flat against whatever core exports today, so M7.13's own acceptance stays re-derivable.
 *
 * The "before" side of the addendum is `M7_13_SIX` below, the retired M7.13 per-bucket weights,
 * written as seven-entry records with `damageToObjectives` pinned to `0.00` so the one
 * normaliser in this file scores both columns unchanged. The addendum also checks M7.14's own
 * claim against the real rows rather than trusting it: every carry and every support seat must
 * score *identically* under six and under seven, because `score + 0 * share` is exact. If one
 * does not, the run says which and exits 1.
 *
 * **It reads a file and prints a table. It opens no database connection, holds no credentials,
 * and writes nothing anywhere** — deliberately, because M7.13 is a read-only inspection and
 * this machine has no hosted credentials outside the Supabase SQL editor. The data comes in the
 * same way M7.12's did: one query, pasted by the user out of the editor, into a file.
 *
 * ## The queries that feed it
 *
 * Two `select`s, run against the hosted `kustom` project. The date bound is what pins the set to
 * the same 23 games M7.12 measured (`source = 'eog'`, exactly ten `game_players` rows,
 * `raw->>'gameMode'` CLASSIC, 2026-09-08 to 2026-09-14) rather than "23 games plus whatever
 * landed since": M7.12's own published query had no bound because on the day it ran there was
 * nothing after it.
 *
 * Query 1, the pre-flight. `games_in_window` should be 23, `player_rows` 230, and both null
 * counts 0. If a null count is not 0, those games have no MVP under either formula and the run
 * will say so rather than guess.
 *
 * ```sql
 * with g as (
 *   select gm.id, gm.started_at,
 *     upper(coalesce(nullif(trim(gm.raw->>'gameMode'), ''), 'CLASSIC')) as mode,
 *     (select count(*) from game_players gp where gp.game_id = gm.id) as n
 *   from games gm
 *   where gm.source = 'eog'
 * ),
 * live10 as (select * from g where n = 10 and mode = 'CLASSIC'),
 * windowed as (
 *   select * from live10
 *   where started_at >= timestamptz '2026-09-08 00:00:00+00'
 *     and started_at <  timestamptz '2026-09-15 00:00:00+00'
 * )
 * select
 *   (select count(*) from windowed)                                             as games_in_window,
 *   (select count(*) from live10)                                               as games_all_time,
 *   (select min(started_at) from windowed)                                      as first_game,
 *   (select max(started_at) from windowed)                                      as last_game,
 *   (select count(*) from game_players gp join windowed w on w.id = gp.game_id) as player_rows,
 *   (select count(*) from game_players gp join windowed w on w.id = gp.game_id
 *      where gp.role is null)                                                   as rows_with_no_role,
 *   (select count(*) from game_players gp join windowed w on w.id = gp.game_id
 *      where gp.vision_score is null or gp.damage_self_mitigated is null
 *         or gp.damage_to_objectives is null)                                  as rows_missing_a_stat;
 * ```
 *
 * `damage_to_objectives` joined that null check with M7.14 (migration `0015`). A row written
 * before it and never reached by the backwards copy has no score under *either* column of the
 * addendum, and the run will say so rather than score the six column on rows the seven column
 * had to decline.
 *
 * Query 2, the extraction. One row, one column; save that single cell to a file.
 *
 * ```sql
 * with g as (
 *   select gm.id, gm.lcu_game_id, gm.started_at, gm.duration_s, gm.winning_side,
 *     upper(coalesce(nullif(trim(gm.raw->>'gameMode'), ''), 'CLASSIC')) as mode,
 *     (select count(*) from game_players gp where gp.game_id = gm.id) as n
 *   from games gm
 *   where gm.source = 'eog'
 * ),
 * live10 as (
 *   select * from g
 *   where n = 10 and mode = 'CLASSIC'
 *     and started_at >= timestamptz '2026-09-08 00:00:00+00'
 *     and started_at <  timestamptz '2026-09-15 00:00:00+00'
 * ),
 * r as (
 *   select l.id as game_id, l.lcu_game_id, l.started_at, l.duration_s, l.winning_side,
 *     p.puuid,
 *     coalesce(nullif(p.display_name, ''), nullif(p.game_name, ''), left(p.puuid, 8)) as name,
 *     gp.side, gp.role::text as role, gp.champion_id,
 *     gp.kills, gp.deaths, gp.assists, gp.damage_to_champs, gp.gold,
 *     gp.vision_score, gp.damage_self_mitigated, gp.cs, gp.damage_to_objectives
 *   from live10 l
 *   join game_players gp on gp.game_id = l.id
 *   join players p on p.id = gp.player_id
 * )
 * select jsonb_agg(to_jsonb(r) order by r.started_at, r.game_id, r.side, r.puuid)::text
 *   as battle_test_rows
 * from r;
 * ```
 *
 * JSON and not CSV on purpose: `vision_score`, `damage_self_mitigated` and
 * `damage_to_objectives` are all nullable, a CSV
 * turns a null into an empty cell, and reading that back as `0` would score a real tank at
 * nothing — the exact confusion migration `0014` exists to prevent. JSON keeps null null. A cell
 * the editor truncates cannot pass silently either: the paste stops parsing.
 *
 * ## What it computes
 *
 * - **New**: `performanceScores` / `mvpAce` imported from `packages/core`. The real exports, not
 *   a copy. Whatever is in core the day this runs is what the "after" column says.
 * - **Old**: the retired flat vector, which no longer exists in core. It is declared here as
 *   `M7_8_FLAT`, the same literal `packages/core/src/rating/performance.test.ts` keeps for the
 *   same reason, and it is scored through `scoreWith` — one local normaliser that is **checked
 *   against core on every game before anything is printed**: scoring with core's own bucket
 *   weights must reproduce core's own scores to 1e-9, or the run aborts. So the two columns can
 *   only differ by the weights, never by drift in a second implementation of the normalisation.
 * - **Six** (`--addendum` only): `M7_13_SIX`, the retired M7.13 per-bucket weights, through that
 *   same checked normaliser. Retired the same way and for the same reason as `M7_8_FLAT`: core
 *   revised its numbers in place, so the only honest "before" is a literal beside the "after".
 *
 * Exit codes: 0 fine, 1 bad arguments, a file that will not parse, the normalisation check
 * failing against core, or — in `--addendum` — a carry or support seat whose score moved.
 *
 * Honest limit, at the time this was written: the two queries above were read by eye against
 * `0001_init.sql`, `0014_vision_and_mitigation.sql` and `0015_damage_to_objectives.sql` and have
 * not been executed anywhere — this session had no hosted credentials and could not reach the
 * local stack either. The script itself was exercised end to end on synthetic rows in the
 * query's exact shape, including a row with no role, a row with a null stat, and a truncated
 * paste. The extraction query grew `gp.damage_to_objectives` with M7.14, so a `rows.json`
 * pasted before that date will not parse against `RowSchema` — re-run the query, do not patch
 * the file.
 */

/**
 * The seven components, in core's order (`damageToObjectives` last, M7.14). Changing the order
 * changes the last bits of a score.
 */
const COMPONENTS = [
  'kda',
  'damageToChamps',
  'gold',
  'visionScore',
  'damageSelfMitigated',
  'cs',
  'damageToObjectives',
] as const;

type Component = (typeof COMPONENTS)[number];
type Weights = Record<Component, number>;

/**
 * The retired M7.8 flat vector. M7.13 replaced it in place, so there is no flat scorer left in
 * `packages/core` and this must never become one: it exists in this one-off measurement, and in
 * core's own test, only so the "before" column can say what the old formula would have answered.
 *
 * `damageToObjectives: 0` is not a weight M7.8 had — M7.8 had six components and no seventh.
 * It is how a six-component vector is written in a seven-component world, and it keeps this
 * column numerically identical to what it printed before M7.14.
 */
const M7_8_FLAT: Weights = {
  kda: 0.1,
  damageToChamps: 0.2,
  gold: 0.2,
  visionScore: 0.25,
  damageSelfMitigated: 0.15,
  cs: 0.1,
  damageToObjectives: 0,
};

/**
 * The retired M7.13 per-bucket vectors: what core exported between M7.13 and M7.14, before the
 * seventh component. Retired the same way `M7_8_FLAT` is, and kept here for the same one
 * reason — `--addendum`'s "before" column. It must never become a second scorer.
 *
 * `damageToObjectives` is pinned to `0.00` in all three so the same `scoreWith` normaliser runs
 * unchanged over both columns; the six-component score of a player is the seven-component sum
 * with a zero term added, which is exact.
 *
 * The one row M7.14 moved is `jungle`: `kda` 0.25 to 0.20, `gold` 0.15 to 0.10, `cs` 0.15 to
 * 0.10, and the 0.15 those three gave up became `damageToObjectives`. `carry` and `support` are
 * character-for-character what core still has, which is exactly why the addendum can assert
 * their scores did not move and expect zero.
 */
const M7_13_SIX: Record<PerformanceBucket, Weights> = {
  carry: {
    kda: 0.15,
    damageToChamps: 0.3,
    gold: 0.2,
    visionScore: 0.05,
    damageSelfMitigated: 0.1,
    cs: 0.2,
    damageToObjectives: 0,
  },
  jungle: {
    kda: 0.25,
    damageToChamps: 0.2,
    gold: 0.15,
    visionScore: 0.15,
    damageSelfMitigated: 0.1,
    cs: 0.15,
    damageToObjectives: 0,
  },
  support: {
    kda: 0.25,
    damageToChamps: 0.05,
    gold: 0.05,
    visionScore: 0.4,
    damageSelfMitigated: 0.15,
    cs: 0.1,
    damageToObjectives: 0,
  },
};

const ROLES: readonly string[] = ['top', 'jungle', 'mid', 'adc', 'support'];

const RowSchema = z.looseObject({
  game_id: z.string(),
  lcu_game_id: z.union([z.number(), z.string()]).transform(String),
  started_at: z.string(),
  duration_s: z.number().nullable().optional(),
  winning_side: z.union([z.literal(100), z.literal(200)]),
  puuid: z.string(),
  name: z.string().nullable(),
  side: z.union([z.literal(100), z.literal(200)]),
  // Not `z.enum`: a value outside the five has to arrive as data and be *treated* as no role,
  // which is M7.13's rule, rather than crash the reader.
  role: z.string().nullable(),
  champion_id: z.number().nullable(),
  kills: z.number().nullable(),
  deaths: z.number().nullable(),
  assists: z.number().nullable(),
  damage_to_champs: z.number().nullable(),
  gold: z.number().nullable(),
  vision_score: z.number().nullable(),
  damage_self_mitigated: z.number().nullable(),
  cs: z.number().nullable(),
  // M7.14's seventh. Required, not `.optional()`: a paste without the column is a paste from
  // the old query, and the addendum would silently score nothing rather than say so.
  damage_to_objectives: z.number().nullable(),
});

type Row = z.infer<typeof RowSchema>;

interface Seat extends PerformancePlayer {
  name: string;
  championId: number | null;
}

interface Game {
  id: string;
  lcuGameId: string;
  startedAt: string;
  winningSide: Side;
  seats: Seat[];
}

interface Args {
  file: string;
  detail: boolean;
  quoted: boolean;
  /** M7.14: print six-against-seven instead of flat-against-new. See the header comment. */
  addendum: boolean;
}

function parseArgs(argv: readonly string[]): Args | null {
  let file: string | null = null;
  let detail = false;
  let quoted = false;
  let addendum = false;
  for (const arg of argv) {
    if (arg === '--detail') detail = true;
    else if (arg === '--quoted') quoted = true;
    else if (arg === '--addendum') addendum = true;
    else if (arg.startsWith('--')) return null;
    else if (file === null) file = arg;
    else return null;
  }
  return file === null ? null : { file, detail, quoted, addendum };
}

/**
 * The paste arrives in whatever shape the editor gave it: the bare JSON array, a JSON string
 * holding that array, or the grid's one-row-one-column wrapper around either. Unwrap until an
 * array of row objects falls out, and say so plainly when one does not.
 */
function unwrap(value: unknown, depth = 0): unknown[] {
  if (depth > 6) throw new Error('could not find an array of rows in the pasted JSON');
  if (typeof value === 'string') return unwrap(JSON.parse(value), depth + 1);
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (first !== undefined && typeof first === 'object' && first !== null && 'puuid' in first) return value;
    if (value.length === 1) return unwrap(first, depth + 1);
    if (value.length === 0) return [];
    throw new Error('the pasted JSON is an array, but its entries do not look like player rows');
  }
  if (typeof value === 'object' && value !== null) {
    const values = Object.values(value);
    const only = values[0];
    if (values.length === 1 && only !== undefined) return unwrap(only, depth + 1);
    throw new Error('the pasted JSON is an object with several keys; paste the single result cell');
  }
  throw new Error('the pasted JSON is not rows');
}

function asRole(value: string | null): Role | null {
  return value !== null && ROLES.includes(value) ? (value as Role) : null;
}

function toGames(rows: readonly Row[]): Game[] {
  const byGame = new Map<string, Game>();
  for (const row of rows) {
    let game = byGame.get(row.game_id);
    if (game === undefined) {
      game = {
        id: row.game_id,
        lcuGameId: row.lcu_game_id,
        startedAt: row.started_at,
        winningSide: row.winning_side,
        seats: [],
      };
      byGame.set(row.game_id, game);
    }
    game.seats.push({
      puuid: row.puuid,
      name: row.name ?? row.puuid.slice(0, 8),
      championId: row.champion_id,
      side: row.side,
      role: asRole(row.role),
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      damageToChamps: row.damage_to_champs,
      gold: row.gold,
      visionScore: row.vision_score,
      damageSelfMitigated: row.damage_self_mitigated,
      cs: row.cs,
      damageToObjectives: row.damage_to_objectives,
    });
  }
  // `started_at` order, the same order the rating fold uses, by instant and not by string: two
  // rows rendered with different UTC offsets must still sort by when they happened.
  const at = (g: Game): number => {
    const ms = Date.parse(g.startedAt);
    return Number.isNaN(ms) ? 0 : ms;
  };
  return [...byGame.values()].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
}

/** The seven component values for one player, or null if any of the nine numbers is missing. */
function componentsOf(p: PerformancePlayer): Weights | null {
  const n = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const kills = n(p.kills);
  const deaths = n(p.deaths);
  const assists = n(p.assists);
  const damageToChamps = n(p.damageToChamps);
  const gold = n(p.gold);
  const visionScore = n(p.visionScore);
  const damageSelfMitigated = n(p.damageSelfMitigated);
  const cs = n(p.cs);
  const damageToObjectives = n(p.damageToObjectives);
  if (
    kills === null ||
    deaths === null ||
    assists === null ||
    damageToChamps === null ||
    gold === null ||
    visionScore === null ||
    damageSelfMitigated === null ||
    cs === null ||
    damageToObjectives === null
  ) {
    return null;
  }
  return {
    kda: (kills + assists) / Math.max(1, deaths),
    damageToChamps,
    gold,
    visionScore,
    damageSelfMitigated,
    cs,
    damageToObjectives,
  };
}

/**
 * Core's normalisation, with the weight vector handed in. Used twice: once with the retired
 * flat vector (the thing core no longer has) and once with core's own bucket weights, purely so
 * the second run can be compared against core itself and prove this function has not drifted.
 */
function scoreWith(
  players: readonly PerformancePlayer[],
  weightFor: (p: PerformancePlayer) => Weights | null,
): Map<string, number> | null {
  const values: Weights[] = [];
  const weights: Weights[] = [];
  for (const p of players) {
    const w = weightFor(p);
    if (w === null) return null;
    const v = componentsOf(p);
    if (v === null) return null;
    values.push(v);
    weights.push(w);
  }
  const max = {} as Weights;
  for (const c of COMPONENTS) {
    let best = 0;
    for (const v of values) {
      const value = v[c];
      if (value > best) best = value;
    }
    max[c] = best;
  }
  const out = new Map<string, number>();
  players.forEach((p, i) => {
    const v = values[i] ?? ({} as Weights);
    const w = weights[i] ?? ({} as Weights);
    let score = 0;
    for (const c of COMPONENTS) {
      const best = max[c];
      if (best <= 0) continue;
      const share = (v[c] ?? 0) / best;
      score += (w[c] ?? 0) * (share < 0 ? 0 : share > 1 ? 1 : share);
    }
    out.set(p.puuid, score);
  });
  return out;
}

/** Core's rule: best score wins, a tie goes to the lower puuid. */
function bestOf(seats: readonly Seat[], scores: Map<string, number>, side: Side): string {
  let winner: { puuid: string; score: number } | null = null;
  for (const s of seats) {
    if (s.side !== side) continue;
    const score = scores.get(s.puuid) ?? 0;
    if (winner === null || score > winner.score || (score === winner.score && s.puuid < winner.puuid)) {
      winner = { puuid: s.puuid, score };
    }
  }
  if (winner === null) throw new Error(`no players on side ${side}`);
  return winner.puuid;
}

/** The bucket core puts this player's role in, or null for no role and for anything else. */
function bucketOf(p: PerformancePlayer): PerformanceBucket | null {
  const role = p.role;
  if (role === null || role === undefined || !ROLES.includes(role)) return null;
  return config.rating.performanceBucket[role];
}

function bucketWeightsFor(p: PerformancePlayer): Weights | null {
  const bucket = bucketOf(p);
  return bucket === null ? null : config.rating.performance[bucket];
}

/** The same role-to-bucket map, against the retired M7.13 weights. `--addendum`'s "before". */
function sixWeightsFor(p: PerformancePlayer): Weights | null {
  const bucket = bucketOf(p);
  return bucket === null ? null : M7_13_SIX[bucket];
}

interface Verdict {
  mvp: string;
  ace: string;
}

interface GameResult {
  game: Game;
  flat: Verdict | null;
  bucket: Verdict | null;
  /** The M7.13 six-component verdict, `--addendum`'s "before". Null whenever `bucket` is. */
  six: Verdict | null;
  flatScores: Map<string, number> | null;
  bucketScores: Map<string, number> | null;
  sixScores: Map<string, number> | null;
  declined: string | null;
}

function evaluate(game: Game): GameResult {
  const seats = game.seats;
  const losing: Side = game.winningSide === 100 ? 200 : 100;

  const blue = seats.filter((s) => s.side === 100).length;
  const red = seats.filter((s) => s.side === 200).length;
  if (blue !== 5 || red !== 5) {
    return {
      game,
      flat: null,
      bucket: null,
      six: null,
      flatScores: null,
      bucketScores: null,
      sixScores: null,
      declined: `not five a side (${blue} blue, ${red} red)`,
    };
  }

  const flatScores = scoreWith(seats, () => M7_8_FLAT);
  const sixScores = scoreWith(seats, sixWeightsFor);
  const localBucketScores = scoreWith(seats, bucketWeightsFor);
  const coreScores = performanceScores(seats);

  // The guard rail: this file's normaliser, fed core's own weights, must reproduce core's own
  // numbers. If it does not, the "before" column cannot be trusted either, so stop.
  if ((coreScores === null) !== (localBucketScores === null)) {
    throw new Error(`game ${game.id}: core and the local scorer disagree about whether it can be scored`);
  }
  if (coreScores !== null && localBucketScores !== null) {
    for (const { puuid, score } of coreScores) {
      const mine = localBucketScores.get(puuid);
      if (mine === undefined || Math.abs(mine - score) > 1e-9) {
        throw new Error(
          `game ${game.id}: local normalisation drifted from packages/core for ${puuid} (${mine} vs ${score})`,
        );
      }
    }
  }

  const coreVerdict = mvpAce(seats, game.winningSide);

  const withoutRole = seats.filter((s) => s.role === null).length;
  const withoutStats = seats.filter((s) => componentsOf(s) === null).length;
  const declined =
    coreVerdict === null || flatScores === null
      ? `${withoutRole} of ten with no role, ${withoutStats} of ten missing a stat`
      : null;

  return {
    game,
    flat:
      flatScores === null
        ? null
        : { mvp: bestOf(seats, flatScores, game.winningSide), ace: bestOf(seats, flatScores, losing) },
    bucket: coreVerdict === null ? null : { mvp: coreVerdict.mvp, ace: coreVerdict.ace },
    // The six-component verdict is read through `bestOf`, the same tie-break core uses, and it
    // exists only where core's own verdict does: the two columns of the addendum are always the
    // same set of games, because the missing-input rule is per game and identical for both.
    six:
      sixScores === null || coreVerdict === null
        ? null
        : { mvp: bestOf(seats, sixScores, game.winningSide), ace: bestOf(seats, sixScores, losing) },
    flatScores,
    bucketScores: localBucketScores,
    sixScores,
    declined,
  };
}

// --- printing -------------------------------------------------------------------------------

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
}

function seatOf(game: Game, puuid: string): Seat | null {
  return game.seats.find((s) => s.puuid === puuid) ?? null;
}

function label(game: Game, puuid: string | undefined): string {
  if (puuid === undefined) return '—';
  const seat = seatOf(game, puuid);
  if (seat === null) return puuid.slice(0, 8);
  return `${seat.name} (${seat.role ?? 'no role'}, ${championName(seat.championId)})`;
}

function night(startedAt: string): string {
  return startedAt.slice(0, 16).replace('T', ' ');
}

function roleCounts(
  results: readonly GameResult[],
  pick: (r: GameResult) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    const puuid = pick(r);
    if (puuid === null) continue;
    const role = seatOf(r.game, puuid)?.role ?? 'no role';
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every seat's share of the game-wide maximum of one component, or null when the game cannot be
 * scored at all. The same normalisation the scores use, pulled out so the addendum can print the
 * objective-damage share that produced a jungler's move rather than only the move.
 */
function sharesOf(game: Game, component: Component): Map<string, number> | null {
  const values: Weights[] = [];
  for (const s of game.seats) {
    const v = componentsOf(s);
    if (v === null) return null;
    values.push(v);
  }
  let max = 0;
  for (const v of values) if (v[component] > max) max = v[component];
  const out = new Map<string, number>();
  game.seats.forEach((s, i) => {
    const v = values[i]?.[component] ?? 0;
    out.set(s.puuid, max <= 0 ? 0 : v / max);
  });
  return out;
}

const f3 = (n: number): string => n.toFixed(3);
const f4 = (n: number): string => n.toFixed(4);
const signed4 = (n: number): string => (n > 0 ? `+${n.toFixed(4)}` : n.toFixed(4));

/**
 * One game's ten seats with every raw number and both score columns. `'flat'` is the table
 * `--detail` has always printed, unchanged; `'addendum'` is the same rows with the objective
 * damage that only matters to M7.14, and six against seven instead of flat against new.
 */
function fullGameTable(r: GameResult, mode: 'flat' | 'addendum'): string {
  const seats = [...r.game.seats].sort(
    (a, b) => a.side - b.side || ROLES.indexOf(a.role ?? '') - ROLES.indexOf(b.role ?? ''),
  );
  const common = ['side', 'role', 'player', 'champion', 'k/d/a', 'dmg', 'gold', 'vis', 'mit', 'cs'];
  const headers =
    mode === 'flat'
      ? [...common, 'flat', 'buckets', 'pick']
      : [...common, 'obj', 'six', 'seven', 'Δ', 'pick'];
  return table(
    headers,
    seats.map((s) => {
      const marks: string[] = [];
      if (mode === 'flat') {
        if (s.puuid === r.flat?.mvp) marks.push('MVP(flat)');
        if (s.puuid === r.bucket?.mvp) marks.push('MVP(new)');
        if (s.puuid === r.flat?.ace) marks.push('ACE(flat)');
        if (s.puuid === r.bucket?.ace) marks.push('ACE(new)');
      } else {
        if (s.puuid === r.six?.mvp) marks.push('MVP(six)');
        if (s.puuid === r.bucket?.mvp) marks.push('MVP(seven)');
        if (s.puuid === r.six?.ace) marks.push('ACE(six)');
        if (s.puuid === r.bucket?.ace) marks.push('ACE(seven)');
      }
      const cells = [
        s.side === 100 ? 'blue' : 'red',
        s.role ?? 'no role',
        s.name,
        championName(s.championId),
        `${s.kills ?? '?'}/${s.deaths ?? '?'}/${s.assists ?? '?'}`,
        String(s.damageToChamps ?? '?'),
        String(s.gold ?? '?'),
        String(s.visionScore ?? '?'),
        String(s.damageSelfMitigated ?? '?'),
        String(s.cs ?? '?'),
      ];
      if (mode === 'flat') {
        return [
          ...cells,
          f3(r.flatScores?.get(s.puuid) ?? 0),
          f3(r.bucketScores?.get(s.puuid) ?? 0),
          marks.join(' '),
        ];
      }
      const six = r.sixScores?.get(s.puuid) ?? 0;
      const seven = r.bucketScores?.get(s.puuid) ?? 0;
      return [
        ...cells,
        String(s.damageToObjectives ?? '?'),
        f4(six),
        f4(seven),
        signed4(seven - six),
        marks.join(' '),
      ];
    }),
  );
}

/**
 * The M7.14 addendum: six components against seven, both bucket-weighted, so the only thing
 * that differs between the two columns is the seventh component and the three jungle weights it
 * came out of. Returns false when a carry or a support seat moved, which would mean M7.14's
 * central claim is false on real data and nothing else in here should be quoted.
 */
function printAddendum(say: (s?: string) => void, results: readonly GameResult[], detail: boolean): boolean {
  const scored = results.filter((r) => r.six !== null && r.bucket !== null);
  const mvpMoved = scored.filter((r) => r.six?.mvp !== r.bucket?.mvp);
  const aceMoved = scored.filter((r) => r.six?.ace !== r.bucket?.ace);

  say();
  say('## Every jungler, six against seven');
  say();
  say('Both junglers of every scored game, whether or not the pick moved, with the objective damage');
  say('that did it: the raw number, and the share of the game-wide best that the normaliser actually');
  say('multiplies. `pick` is what that seat was called under each formula.');
  say();

  const jungleRows: string[][] = [];
  let jungleSeats = 0;
  let up = 0;
  let down = 0;
  let same = 0;
  let biggestRise = 0;
  let biggestFall = 0;
  // Numbered over every game, not over the scored ones, so `#` means the same row here as it
  // does in the default report and in the declined list above.
  results.forEach((r, i) => {
    if (r.six === null || r.bucket === null) return;
    const shares = sharesOf(r.game, 'damageToObjectives');
    for (const s of r.game.seats) {
      if (s.role !== 'jungle') continue;
      jungleSeats += 1;
      const six = r.sixScores?.get(s.puuid) ?? 0;
      const seven = r.bucketScores?.get(s.puuid) ?? 0;
      const delta = seven - six;
      if (delta > 0) up += 1;
      else if (delta < 0) down += 1;
      else same += 1;
      if (delta > biggestRise) biggestRise = delta;
      if (delta < biggestFall) biggestFall = delta;
      const was = (v: Verdict | null): string =>
        v === null ? '—' : v.mvp === s.puuid ? 'MVP' : v.ace === s.puuid ? 'ACE' : '—';
      const before = was(r.six);
      const after = was(r.bucket);
      jungleRows.push([
        String(i + 1),
        night(r.game.startedAt),
        `${s.name} (${championName(s.championId)})`,
        s.side === r.game.winningSide ? 'won' : 'lost',
        String(s.damageToObjectives ?? '?'),
        shares === null ? '?' : f3(shares.get(s.puuid) ?? 0),
        f4(six),
        f4(seven),
        signed4(delta),
        before,
        after,
        before === after ? '' : 'moved',
      ]);
    }
  });
  say(
    table(
      [
        '#',
        'night',
        'jungler',
        'side',
        'obj dmg',
        'obj share',
        'six',
        'seven',
        'Δ',
        'pick six',
        'pick seven',
        'moved',
      ],
      jungleRows,
    ),
  );

  // The claim, checked against the rows rather than asserted: a zero weight on the seventh
  // component means `score + 0 * share`, which is exact, so these must be equal to the bit.
  let checkedSeats = 0;
  let worstDrift = 0;
  const drifted: string[] = [];
  for (const r of scored) {
    for (const s of r.game.seats) {
      if (s.role === 'jungle' || s.role === null) continue;
      checkedSeats += 1;
      const six = r.sixScores?.get(s.puuid) ?? 0;
      const seven = r.bucketScores?.get(s.puuid) ?? 0;
      const delta = Math.abs(seven - six);
      if (delta > worstDrift) worstDrift = delta;
      if (delta !== 0) {
        drifted.push(`${night(r.game.startedAt)} \`${r.game.id}\`: ${s.name} (${s.role}) ${six} → ${seven}`);
      }
    }
  }

  const movedAny = mvpMoved.length > 0 || aceMoved.length > 0;
  if (movedAny) {
    say();
    say('## Every pick that moved, with both scores');
    say();
    const movedRows: string[][] = [];
    for (const r of scored) {
      for (const title of ['MVP', 'ACE'] as const) {
        const before = title === 'MVP' ? r.six?.mvp : r.six?.ace;
        const after = title === 'MVP' ? r.bucket?.mvp : r.bucket?.ace;
        if (before === undefined || after === undefined || before === after) continue;
        const fmt = (p: string): string =>
          `${f4(r.sixScores?.get(p) ?? 0)} / ${f4(r.bucketScores?.get(p) ?? 0)}`;
        movedRows.push([
          night(r.game.startedAt),
          title,
          label(r.game, before),
          fmt(before),
          label(r.game, after),
          fmt(after),
        ]);
      }
    }
    say(table(['night', 'pick', 'six picked', 'six / seven', 'seven picked', 'six / seven'], movedRows));
  }

  const mvpSix = roleCounts(scored, (r) => r.six?.mvp ?? null);
  const mvpSeven = roleCounts(scored, (r) => r.bucket?.mvp ?? null);
  const aceSix = roleCounts(scored, (r) => r.six?.ace ?? null);
  const aceSeven = roleCounts(scored, (r) => r.bucket?.ace ?? null);
  say();
  say('### Picks by role, six against seven');
  say();
  say(
    table(
      ['role', 'MVP six', 'MVP seven', 'ACE six', 'ACE seven', 'both six', 'both seven'],
      [...ROLES, 'no role'].map((role) => [
        role,
        String(mvpSix.get(role) ?? 0),
        String(mvpSeven.get(role) ?? 0),
        String(aceSix.get(role) ?? 0),
        String(aceSeven.get(role) ?? 0),
        String((mvpSix.get(role) ?? 0) + (aceSix.get(role) ?? 0)),
        String((mvpSeven.get(role) ?? 0) + (aceSeven.get(role) ?? 0)),
      ]),
    ),
  );

  say();
  say('## Totals');
  say();
  say(`- Games scored under both formulas: **${scored.length}** of ${results.length}.`);
  say(`- **MVPs that moved: ${mvpMoved.length} of ${scored.length}.**`);
  say(`- **ACEs that moved: ${aceMoved.length} of ${scored.length}.**`);
  say(
    `- Games where neither pick moved: ${
      scored.filter((r) => r.six?.mvp === r.bucket?.mvp && r.six?.ace === r.bucket?.ace).length
    }.`,
  );
  say(
    `- Jungle seats: ${jungleSeats}. Score rose on ${up}, fell on ${down}, identical on ${same}. Largest rise ${signed4(
      biggestRise,
    )}, largest fall ${signed4(biggestFall)}.`,
  );
  if (drifted.length === 0) {
    say(
      `- **Carry and support seats: ${checkedSeats} checked, every one bit-for-bit identical under six and seven** (largest |Δ| = 0). M7.14's claim holds on the real rows, not only in the config comment.`,
    );
  } else {
    say(
      `- **Carry and support seats: ${drifted.length} of ${checkedSeats} moved, largest |Δ| = ${worstDrift}.** M7.14 says this cannot happen; do not quote anything above until it is explained.`,
    );
    for (const d of drifted) say(`  - ${d}`);
  }
  const noRole = scored.reduce((n, r) => n + r.game.seats.filter((s) => s.role === null).length, 0);
  if (noRole > 0) say(`- Seats with no role inside a scored game: ${noRole}. (Core declines those games.)`);

  if (detail) {
    say();
    say('## Every game in full');
    for (const r of results) {
      say();
      say(
        `### ${night(r.game.startedAt)} — \`${r.game.lcuGameId}\` — ${r.game.winningSide === 100 ? 'blue' : 'red'} won`,
      );
      say();
      say(fullGameTable(r, 'addendum'));
    }
  }

  say();
  say('## Judgement');
  say();
  say('Written by hand, not by this script. The question the addendum asks is narrower than');
  say('M7.13\'s: not "are the picks better" but "did giving a jungler 0.15 for objectives move the');
  say('right junglers, and only junglers". Read the moved rows against the objective share column:');
  say('a jungler who gained the pick should be one who actually took the objectives.');

  return drifted.length === 0;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      'usage: pnpm --filter web exec node --import tsx scripts/m7-13-battle-test.ts <rows.json> [--addendum] [--detail] [--quoted]',
    );
    process.exitCode = 1;
    return;
  }

  let rows: Row[];
  try {
    const raw = unwrap(readFileSync(args.file, 'utf8').trim());
    rows = raw.map((r, i) => {
      const parsed = RowSchema.safeParse(r);
      if (!parsed.success) {
        // Name the column, not just the type: the overwhelmingly likely cause of a failure here
        // is a `rows.json` pasted before M7.14 added `damage_to_objectives` to the query, and
        // "expected number, received undefined" on its own does not say which column is missing.
        const issues = parsed.error.issues.map((e) =>
          e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message,
        );
        const stale = parsed.error.issues.some((e) => e.path[0] === 'damage_to_objectives');
        throw new Error(
          `row ${i}: ${issues.join('; ')}${
            stale
              ? ' — this paste predates M7.14. Re-run query 2 from the header comment, which now selects gp.damage_to_objectives.'
              : ''
          }`,
        );
      }
      return parsed.data;
    });
  } catch (error) {
    console.error(`m7-13-battle-test: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const games = toGames(rows);
  const out: string[] = [];
  const say = (s = ''): void => {
    // Split here rather than at the end: a table arrives as one multi-line string and `--quoted`
    // has to prefix every one of its lines, not just the first.
    for (const line of s.split('\n')) out.push(line);
  };

  say(
    args.addendum
      ? '# M7.14 addendum — six components against seven'
      : '# M7.13 battle test — flat M7.8 against the three buckets',
  );
  say();
  say(
    `${rows.length} player rows, ${games.length} games, ${night(games[0]?.startedAt ?? '')} to ${night(
      games[games.length - 1]?.startedAt ?? '',
    )}. Nothing was written.`,
  );
  if (games.length !== 23) {
    say();
    say(
      `**Warning: ${games.length} games, not the 23 M7.12 measured.** Check the date bound in the query before quoting any of this.`,
    );
  }
  const wrongSize = games.filter((g) => g.seats.length !== 10);
  if (wrongSize.length > 0) {
    say();
    say(
      `**Warning: ${wrongSize.length} game(s) do not have ten rows.** ${wrongSize.map((g) => g.id).join(', ')}`,
    );
  }

  let results: GameResult[];
  try {
    results = games.map(evaluate);
  } catch (error) {
    console.error(`m7-13-battle-test: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const emit = (): void => {
    console.log(args.quoted ? out.map((l) => `    > ${l}`.trimEnd()).join('\n') : out.join('\n'));
  };

  // `--addendum` is a different report over the same rows, not an extra section on this one: the
  // flat column has no business in a table that is meant to isolate M7.14. Everything above this
  // line — the counts, the two warnings — is common to both and already said.
  if (args.addendum) {
    const cannot = results.filter((r) => r.declined !== null);
    if (cannot.length > 0) {
      say();
      say(
        `Games neither formula can score, excluded from every total below: ${cannot.length}. A game missing \`damage_to_objectives\` for even one of the ten is one of these, under six as much as under seven — the missing-input rule is per game and does not care what the weight on the missing component is.`,
      );
      for (const r of cannot) say(`- ${night(r.game.startedAt)} \`${r.game.id}\`: ${r.declined}`);
    }
    if (!printAddendum(say, results, args.detail)) process.exitCode = 1;
    emit();
    return;
  }

  const scored = results.filter((r) => r.flat !== null && r.bucket !== null);
  const mvpMoved = scored.filter((r) => r.flat?.mvp !== r.bucket?.mvp);
  const aceMoved = scored.filter((r) => r.flat?.ace !== r.bucket?.ace);

  say();
  say('## Game by game');
  say();
  say(
    table(
      [
        '#',
        'night',
        'won',
        'MVP — flat M7.8',
        'MVP — three buckets',
        'ACE — flat M7.8',
        'ACE — three buckets',
        'moved',
      ],
      results.map((r, i) => {
        const movedMvp = r.flat !== null && r.bucket !== null && r.flat.mvp !== r.bucket.mvp;
        const movedAce = r.flat !== null && r.bucket !== null && r.flat.ace !== r.bucket.ace;
        const moved =
          r.declined !== null
            ? 'no MVP'
            : movedMvp && movedAce
              ? 'both'
              : movedMvp
                ? 'MVP'
                : movedAce
                  ? 'ACE'
                  : '';
        return [
          String(i + 1),
          night(r.game.startedAt),
          r.game.winningSide === 100 ? 'blue' : 'red',
          label(r.game, r.flat?.mvp),
          label(r.game, r.bucket?.mvp),
          label(r.game, r.flat?.ace),
          label(r.game, r.bucket?.ace),
          moved,
        ];
      }),
    ),
  );

  const declined = results.filter((r) => r.declined !== null);
  if (declined.length > 0) {
    say();
    say(
      `Games one of the two formulas declines, excluded from every total below: ${declined.length}. The flat formula would have named somebody on ${
        declined.filter((r) => r.flat !== null).length
      } of them (it never read the role).`,
    );
    for (const r of declined) say(`- ${night(r.game.startedAt)} \`${r.game.id}\`: ${r.declined}`);
  }

  say();
  say('## Totals');
  say();
  say(`- Games scored by both formulas: **${scored.length}** of ${results.length}.`);
  say(`- **MVPs that moved: ${mvpMoved.length} of ${scored.length}.**`);
  say(`- **ACEs that moved: ${aceMoved.length} of ${scored.length}.**`);
  say(
    `- Games where neither pick moved: ${
      scored.filter((r) => r.flat?.mvp === r.bucket?.mvp && r.flat?.ace === r.bucket?.ace).length
    }.`,
  );

  const mvpFlat = roleCounts(scored, (r) => r.flat?.mvp ?? null);
  const mvpBucket = roleCounts(scored, (r) => r.bucket?.mvp ?? null);
  const aceFlat = roleCounts(scored, (r) => r.flat?.ace ?? null);
  const aceBucket = roleCounts(scored, (r) => r.bucket?.ace ?? null);
  say();
  say('### Picks by role, before and after');
  say();
  say(
    table(
      ['role', 'MVP flat', 'MVP buckets', 'ACE flat', 'ACE buckets', 'both flat', 'both buckets'],
      [...ROLES, 'no role'].map((role) => {
        const f = (mvpFlat.get(role) ?? 0) + (aceFlat.get(role) ?? 0);
        const b = (mvpBucket.get(role) ?? 0) + (aceBucket.get(role) ?? 0);
        return [
          role,
          String(mvpFlat.get(role) ?? 0),
          String(mvpBucket.get(role) ?? 0),
          String(aceFlat.get(role) ?? 0),
          String(aceBucket.get(role) ?? 0),
          String(f),
          String(b),
        ];
      }),
    ),
  );

  if (mvpMoved.length > 0 || aceMoved.length > 0) {
    say();
    say('## Every pick that moved, with both scores');
    say();
    say('The score each formula gave the player it dropped and the player it picked, so the size of the');
    say('disagreement is visible and not just its direction.');
    const movedRows: string[][] = [];
    for (const r of results) {
      if (r.flat === null || r.bucket === null || r.flatScores === null || r.bucketScores === null) continue;
      for (const title of ['MVP', 'ACE'] as const) {
        const before = title === 'MVP' ? r.flat.mvp : r.flat.ace;
        const after = title === 'MVP' ? r.bucket.mvp : r.bucket.ace;
        if (before === after) continue;
        const fmt = (p: string): string =>
          `${(r.flatScores?.get(p) ?? 0).toFixed(3)} / ${(r.bucketScores?.get(p) ?? 0).toFixed(3)}`;
        movedRows.push([
          night(r.game.startedAt),
          title,
          label(r.game, before),
          fmt(before),
          label(r.game, after),
          fmt(after),
        ]);
      }
    }
    say();
    say(
      table(['night', 'pick', 'flat picked', 'flat / bucket', 'buckets picked', 'flat / bucket'], movedRows),
    );
  }

  if (args.detail) {
    say();
    say('## Every game in full');
    for (const r of results) {
      say();
      say(
        `### ${night(r.game.startedAt)} — \`${r.game.lcuGameId}\` — ${r.game.winningSide === 100 ? 'blue' : 'red'} won`,
      );
      say();
      say(fullGameTable(r, 'flat'));
    }
  }

  say();
  say('## Judgement');
  say();
  say('Written by hand, not by this script. Read the moved rows above against what the night looked like:');
  say(
    'did the new pick play the game the room would have called? If the new picks look worse, M7.13 stops and',
  );
  say('reports — the weights are not tuned until the table looks nicer.');

  emit();
}

main();
