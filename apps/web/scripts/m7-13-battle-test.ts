import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  config,
  mvpAce,
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
 *      where gp.vision_score is null or gp.damage_self_mitigated is null)       as rows_missing_a_stat;
 * ```
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
 *     gp.vision_score, gp.damage_self_mitigated, gp.cs
 *   from live10 l
 *   join game_players gp on gp.game_id = l.id
 *   join players p on p.id = gp.player_id
 * )
 * select jsonb_agg(to_jsonb(r) order by r.started_at, r.game_id, r.side, r.puuid)::text
 *   as battle_test_rows
 * from r;
 * ```
 *
 * JSON and not CSV on purpose: `vision_score` and `damage_self_mitigated` are nullable, a CSV
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
 *
 * Exit codes: 0 fine, 1 bad arguments, a file that will not parse, or the normalisation check
 * failing against core.
 *
 * Honest limit, at the time this was written: the two queries above were read by eye against
 * `0001_init.sql` and `0014_vision_and_mitigation.sql` and have not been executed anywhere —
 * this session had no hosted credentials and could not reach the local stack either. The
 * script itself was exercised end to end on synthetic rows in the query's exact shape, including
 * a row with no role, a row with a null stat, and a truncated paste.
 */

/** The six components, in core's order. Changing the order changes the last bits of a score. */
const COMPONENTS = ['kda', 'damageToChamps', 'gold', 'visionScore', 'damageSelfMitigated', 'cs'] as const;

type Component = (typeof COMPONENTS)[number];
type Weights = Record<Component, number>;

/**
 * The retired M7.8 flat vector. M7.13 replaced it in place, so there is no flat scorer left in
 * `packages/core` and this must never become one: it exists in this one-off measurement, and in
 * core's own test, only so the "before" column can say what the old formula would have answered.
 */
const M7_8_FLAT: Weights = {
  kda: 0.1,
  damageToChamps: 0.2,
  gold: 0.2,
  visionScore: 0.25,
  damageSelfMitigated: 0.15,
  cs: 0.1,
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
}

function parseArgs(argv: readonly string[]): Args | null {
  let file: string | null = null;
  let detail = false;
  let quoted = false;
  for (const arg of argv) {
    if (arg === '--detail') detail = true;
    else if (arg === '--quoted') quoted = true;
    else if (arg.startsWith('--')) return null;
    else if (file === null) file = arg;
    else return null;
  }
  return file === null ? null : { file, detail, quoted };
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

/** The six component values for one player, or null if any of the eight numbers is missing. */
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
  if (
    kills === null ||
    deaths === null ||
    assists === null ||
    damageToChamps === null ||
    gold === null ||
    visionScore === null ||
    damageSelfMitigated === null ||
    cs === null
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

function bucketWeightsFor(p: PerformancePlayer): Weights | null {
  const role = p.role;
  if (role === null || role === undefined || !ROLES.includes(role)) return null;
  return config.rating.performance[config.rating.performanceBucket[role]];
}

interface Verdict {
  mvp: string;
  ace: string;
}

interface GameResult {
  game: Game;
  flat: Verdict | null;
  bucket: Verdict | null;
  flatScores: Map<string, number> | null;
  bucketScores: Map<string, number> | null;
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
      flatScores: null,
      bucketScores: null,
      declined: `not five a side (${blue} blue, ${red} red)`,
    };
  }

  const flatScores = scoreWith(seats, () => M7_8_FLAT);
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
    flatScores,
    bucketScores: localBucketScores,
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      'usage: pnpm --filter web exec node --import tsx scripts/m7-13-battle-test.ts <rows.json> [--detail] [--quoted]',
    );
    process.exitCode = 1;
    return;
  }

  let rows: Row[];
  try {
    const raw = unwrap(readFileSync(args.file, 'utf8').trim());
    rows = raw.map((r, i) => {
      const parsed = RowSchema.safeParse(r);
      if (!parsed.success)
        throw new Error(`row ${i}: ${parsed.error.issues.map((e) => e.message).join('; ')}`);
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

  say(`# M7.13 battle test — flat M7.8 against the three buckets`);
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
      say(
        table(
          [
            'side',
            'role',
            'player',
            'champion',
            'k/d/a',
            'dmg',
            'gold',
            'vis',
            'mit',
            'cs',
            'flat',
            'buckets',
            'pick',
          ],
          [...r.game.seats]
            .sort((a, b) => a.side - b.side || ROLES.indexOf(a.role ?? '') - ROLES.indexOf(b.role ?? ''))
            .map((s) => {
              const marks: string[] = [];
              if (s.puuid === r.flat?.mvp) marks.push('MVP(flat)');
              if (s.puuid === r.bucket?.mvp) marks.push('MVP(new)');
              if (s.puuid === r.flat?.ace) marks.push('ACE(flat)');
              if (s.puuid === r.bucket?.ace) marks.push('ACE(new)');
              return [
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
                (r.flatScores?.get(s.puuid) ?? 0).toFixed(3),
                (r.bucketScores?.get(s.puuid) ?? 0).toFixed(3),
                marks.join(' '),
              ];
            }),
        ),
      );
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

  console.log(args.quoted ? out.map((l) => `    > ${l}`.trimEnd()).join('\n') : out.join('\n'));
}

main();
