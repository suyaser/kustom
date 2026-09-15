import { type Assignment, displayRating, isOffRole, type Role } from '@customs/core';
import type { SideValue } from '@customs/db';
import { SWITCH_SIDE_ENABLED } from '../commands/gate';
import { type FoldPerformance, gatedGameAward } from '../ingest/fold';
import type { PoolMember, SeatMove } from '../ingest/selection';
import { displayDelta } from '../ratingDisplay';
import type { ServiceClient } from '../supabase';
import type {
  PlayerName,
  PromotedSplit,
  ResultAward,
  ResultEmbedInput,
  ResultPlayer,
  SeatLine,
  SitOutReason,
  TeamsEmbedInput,
  TeamsPlayer,
} from './embeds';

/**
 * Rows and events in, embed inputs out (M3.1, M3.3).
 *
 * The two `build*` functions are pure and are where every rule about what the embeds show
 * lives; the `load*` functions are the queries that feed them. Names are read here rather
 * than taken from the event, because a name can arrive between the balance and the post
 * (M2.4's rank sweep, or the first end-of-game block) and the embed should print the newest
 * one we have. Nothing is written back: `Someone` is a rendering fallback (M3.10), not a row.
 */

/** Everything the teams embed needs that is not a name. `LobbyBalancedEvent` satisfies it. */
export interface TeamsSource {
  /** The chosen split's two sides. A `Split` from core satisfies it, and so does a stored row. */
  split: { blue: readonly Assignment[]; red: readonly Assignment[] };
  explanation: string;
  lobbyName: string | null;
  lobbyPassword: string | null;
  playing: readonly PoolMember[];
  sitters: readonly PoolMember[];
  seatMoves: readonly SeatMove[];
  tiedOnGames: boolean;
  /**
   * Which stored split this is, when the post is a promotion of one (M3.2). A fresh balance
   * leaves it absent and gets the plain title; `LobbyBalancedEvent` therefore still satisfies
   * this interface unchanged.
   */
  promoted?: PromotedSplit | undefined;
}

export interface EmbedContext {
  /** The tonight page, or `undefined` when there is no honest URL to post (M3.1). */
  url?: string | undefined;
  timestamp: string;
  /**
   * M4.3's gate, for the teams embed's side line. Left out in production, where the value is
   * {@link SWITCH_SIDE_ENABLED} read at post time: the same flag that decides whether a
   * `switch_side` row is ever queued decides which sentence the message carries, so the embed
   * cannot promise a switch the server does not make. Tests pass it to see the other line.
   */
  switchSideEnabled?: boolean | undefined;
}

export type NameLookup = ReadonlyMap<string, PlayerName>;

/**
 * The teams embed input. Pure: the same source and the same names give the same object.
 *
 * The one thing it reads that is not an argument is {@link SWITCH_SIDE_ENABLED}, a compile-time
 * table of booleans and not an environment variable, and any test that cares passes
 * `context.switchSideEnabled` instead. It is read here rather than in `post.ts` so that both
 * posts — the balance and the reroll — get the same answer from one place.
 *
 * Throws when the chosen split names a player who is not in `playing` — that cannot happen
 * (both come out of one balance) and a lobby hook that throws is one log line, which is a
 * better answer than an embed with a made-up rating in it.
 */
export function buildTeamsInput(
  source: TeamsSource,
  names: NameLookup,
  context: EmbedContext,
): TeamsEmbedInput {
  const byPuuid = new Map(source.playing.map((member) => [member.puuid, member]));

  const side = (assignments: readonly { puuid: string; role: Role }[]): TeamsPlayer[] =>
    assignments.map(({ puuid, role }) => {
      const member = byPuuid.get(puuid);
      if (member === undefined) {
        throw new Error(`teams embed: the chosen split names ${puuid}, who is not among the ten`);
      }
      return {
        puuid,
        name: names.get(puuid) ?? null,
        role,
        rating: displayRating(member.mu),
        // Core's rule, not a copy of it: the scorer, the explanation and this line agree
        // about who is off-role because all three ask the same function.
        offRole: isOffRole(member, role),
      };
    });

  return {
    blue: side(source.split.blue),
    red: side(source.split.red),
    explanation: source.explanation,
    sitOut:
      source.sitters.length === 0
        ? null
        : {
            names: source.sitters.map((member) => names.get(member.puuid) ?? null),
            reason: sitOutReason(source),
          },
    seats: source.seatMoves.map((move) => toSeatLine(move, names)),
    switchSideEnabled: context.switchSideEnabled ?? SWITCH_SIDE_ENABLED,
    lobby: { name: source.lobbyName, password: source.lobbyPassword },
    promoted: source.promoted,
    url: context.url,
    timestamp: context.timestamp,
  };
}

/**
 * Which of the three clauses is true of this pool (M2.15, M3.12).
 *
 * Not tied on games: somebody has played more than the rest and that is why they sit. Tied,
 * and somebody around has sat out before: the second key of `compareForSitOut` decided it, so
 * "longest since they last sat out" is the reason. Tied with **nobody** carrying a sit-out —
 * the first balance of a night, and of the group — and the comparator has fallen through to
 * PUUID order; there is no history to point at, so the clause says exactly that instead of
 * claiming one (product, 2026-09-09).
 *
 * The pool is the ten plus the sitters: everyone around, which is what the comparator ordered.
 */
export function sitOutReason(source: Pick<TeamsSource, 'playing' | 'sitters' | 'tiedOnGames'>): SitOutReason {
  if (!source.tiedOnGames) return 'most-games';
  const around = [...source.playing, ...source.sitters];
  return around.every((member) => member.lastSitOutAt === null) ? 'first-sit-out' : 'longest-since';
}

function toSeatLine(move: SeatMove, names: NameLookup): SeatLine {
  const mover = names.get(move.mover.puuid) ?? null;
  if (move.sitter === null) return { kind: 'open-slot', mover };
  return { kind: 'swap', sitter: names.get(move.sitter.puuid) ?? null, mover };
}

/** Everything the result embed needs. One row per participant, both sides together. */
export interface ResultSource {
  winningSide: SideValue;
  durationS: number;
  /** Which game this is, counted from the group's first. `null` when the count failed. */
  gameNumber: number | null;
  blueWinProb: number | null;
  /** ISO 8601: when the game ended (`started_at + duration_s`). */
  endedAt: string;
  players: readonly ResultSourcePlayer[];
}

export interface ResultSourcePlayer {
  puuid: string;
  name: PlayerName;
  side: SideValue;
  /** What the two columns print: the scoreboard's role, or the stored split's as a fallback. */
  role: Role | null;
  damage: number;
  muBefore: number | null;
  muAfter: number | null;
  /**
   * The stat line the performance score is computed from, straight off `game_players` (M7.10).
   *
   * **Its `role` is the scoreboard column alone**, with no fallback to the split — unlike the
   * `role` above it, which is what the columns print. The fold read that column and nothing
   * else, so a game it gave no MVP to because a position was missing must not grow one here:
   * the name on this line has to be the player whose delta was actually amplified.
   */
  stats: FoldPerformance;
}

/**
 * The result embed input, or `null` when this game has no ratings to show.
 *
 * `null` is the honest answer for a block the fold refused — a remake, a four-minute
 * surrender, a scoreboard that is not five a side — and for a re-post of a game somebody else
 * already rated. The route only announces a game it changed something for, so the second
 * companion in the same game produces no second message.
 */
export function buildResultInput(source: ResultSource, context: EmbedContext): ResultEmbedInput | null {
  const rated = source.players.filter(
    (player): player is ResultSourcePlayer & { muBefore: number; muAfter: number } =>
      player.muBefore !== null && player.muAfter !== null,
  );
  if (rated.length !== source.players.length || rated.length === 0) return null;

  const toPlayer = (player: (typeof rated)[number]): ResultPlayer => ({
    puuid: player.puuid,
    name: player.name,
    role: player.role,
    rating: displayRating(player.muAfter),
    // The one delta rule, from the one shared helper (M3.3).
    delta: displayDelta(player.muBefore, player.muAfter),
  });

  const top = [...source.players].sort(
    (a, b) => b.damage - a.damage || (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
  )[0];

  return {
    winningSide: source.winningSide === 100 ? 100 : 200,
    durationS: source.durationS,
    blue: rated.filter((player) => player.side === 100).map(toPlayer),
    red: rated.filter((player) => player.side === 200).map(toPlayer),
    award: resultAward(source),
    blueWinProb: source.blueWinProb,
    topDamage: top === undefined || top.damage <= 0 ? null : { name: top.name, damage: top.damage },
    gameNumber: source.gameNumber,
    url: context.url,
    timestamp: context.timestamp,
  };
}

/**
 * The MVP and the ACE of this game, as two names, or `null` when it has none (M7.10).
 *
 * **The answer is `gatedGameAward`'s and nothing here re-derives it**: this function maps the
 * two puuids it comes back with onto the names the columns above are already printing. That is
 * the whole of acceptance 3 — the embed and `/p/[puuid]` call one function on the same columns
 * of the same game, so the two surfaces cannot disagree about who carried it.
 *
 * Two reasons the answer is `null`, and both of them print nothing rather than a word:
 *
 * - **The game is not a clean rated ten.** `gatedGameAward` runs `gateGame` first, because
 *   core's `mvpAce` *throws* on anything that is not five a side with ten distinct puuids and a
 *   500 here would cost the whole result post. This is reached only for a game whose ten rows
 *   all carry `mu_before` and `mu_after` — the caller checked — which is what rules out a
 *   remake, a short surrender and an ARAM (M7.1: four null rating columns, for ever).
 * - **The game cannot be scored.** Any of the nine numbers missing for any of the ten, or any
 *   of the ten roles: core returns `null` and the post loses the line and keeps everything else.
 */
function resultAward(source: ResultSource): ResultAward | null {
  const award = gatedGameAward(
    source.players.map((player) => ({ puuid: player.puuid, side: player.side, ...player.stats })),
    source.durationS,
    source.winningSide,
  );
  if (award === null) return null;

  const names = new Map(source.players.map((player) => [player.puuid, player.name]));
  return { mvp: names.get(award.mvp) ?? null, ace: names.get(award.ace) ?? null };
}

/**
 * The newest display name we have for each puuid, `null` for the ones we have none for.
 *
 * Reads `players` with the service client. `players_public` is the same rows minus
 * `discord_id` and exists for the anon key; from inside the API the base table is the
 * shorter path and neither name column is a secret.
 */
export async function loadNames(client: ServiceClient, puuids: readonly string[]): Promise<NameLookup> {
  const unique = [...new Set(puuids)];
  const names = new Map<string, PlayerName>();
  if (unique.length === 0) return names;

  const { data, error } = await client
    .from('players')
    .select('puuid, display_name, game_name')
    .in('puuid', unique);
  if (error) throw new Error(`discord: name lookup failed: ${error.message}`);

  for (const row of data ?? []) {
    names.set(row.puuid, row.display_name ?? row.game_name ?? null);
  }
  return names;
}

/** Everyone the teams embed prints: the ten, plus the sitters and the movers. */
export function teamsPuuids(source: TeamsSource): string[] {
  return [
    ...source.playing.map((member) => member.puuid),
    ...source.sitters.map((member) => member.puuid),
    ...source.seatMoves.flatMap((move) => (move.sitter === null ? [] : [move.sitter.puuid])),
    ...source.seatMoves.map((move) => move.mover.puuid),
  ];
}

/**
 * One finished game, as the result embed needs it: the scoreboard with its rating columns,
 * this game's place in the group's history, the roles, and the chosen split's win probability.
 *
 * `null` when the game is gone or has no winning side — neither is a post.
 */
export async function loadResultSource(client: ServiceClient, gameId: string): Promise<ResultSource | null> {
  const { data: game, error } = await client
    .from('games')
    // No `seasons!inner(name)`: a season's name is printed on no surface any more (M5.12).
    .select('id, lobby_id, started_at, duration_s, winning_side')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw new Error(`discord: game lookup failed: ${error.message}`);
  if (!game || (game.winning_side !== 100 && game.winning_side !== 200)) return null;

  // **The same read, nine columns wider** (M7.10, acceptance 4). The MVP and the ACE are named
  // from the performance score, and the performance score is these columns; asking for them
  // here costs the round trip this query was already making, where a second query would have
  // cost the post a second round trip on the one path that runs while ten people are looking at
  // Discord.
  const { data: rows, error: playerError } = await client
    .from('game_players')
    .select(
      'side, role, kills, deaths, assists, damage_to_champs, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, mu_before, mu_after, players!inner(puuid, display_name, game_name)',
    )
    .eq('game_id', gameId);
  if (playerError) throw new Error(`discord: game_players lookup failed: ${playerError.message}`);

  const splitRoles = await loadSplitRoles(client, game.lobby_id);

  const players: ResultSourcePlayer[] = (rows ?? [])
    .filter((row) => row.side === 100 || row.side === 200)
    .map((row) => ({
      puuid: row.players.puuid,
      name: row.players.display_name ?? row.players.game_name ?? null,
      side: (row.side === 100 ? 100 : 200) as SideValue,
      // What the scoreboard says first; the split's role is the fallback, so the two embeds
      // line up even when the client reported no position. The award below does **not** take
      // that fallback — see {@link ResultSourcePlayer.stats}.
      role: row.role ?? splitRoles.roles.get(row.players.puuid) ?? null,
      damage: row.damage_to_champs,
      muBefore: row.mu_before,
      muAfter: row.mu_after,
      stats: {
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
      },
    }));

  return {
    winningSide: game.winning_side,
    durationS: game.duration_s,
    gameNumber: await countGamesThrough(client, game.started_at),
    blueWinProb: splitRoles.blueWinProb,
    endedAt: new Date(Date.parse(game.started_at) + game.duration_s * 1_000).toISOString(),
    players,
  };
}

/** The chosen split of the lobby this game was played from: who played where, and the odds. */
async function loadSplitRoles(
  client: ServiceClient,
  lobbyId: string | null,
): Promise<{ roles: Map<string, Role>; blueWinProb: number | null }> {
  const empty = { roles: new Map<string, Role>(), blueWinProb: null };
  if (lobbyId === null) return empty;

  const { data, error } = await client
    .from('splits')
    .select('blue, red, blue_win_prob')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`discord: split lookup failed: ${error.message}`);
  if (!data) return empty;

  const roles = new Map<string, Role>();
  for (const side of [data.blue, data.red]) {
    for (const assignment of readAssignments(side)) roles.set(assignment.puuid, assignment.role);
  }
  return { roles, blueWinProb: data.blue_win_prob };
}

/**
 * Which game this is, counted from the group's first: `Kustom · game 47` (M5.12, product
 * 2026-09-10). Counted rather than stored, so it stays right after a backfill inserts an older
 * game (M5.1).
 *
 * **No season filter.** There is one `seasons` row and nothing can make a second (M5.14), so
 * the filter only ever narrowed the count on a deployment that pressed the removed button —
 * where it would have restarted the group's game numbering at 1 for no reason a friend could
 * see. Every game up to and including this one, and that is the whole rule.
 */
async function countGamesThrough(client: ServiceClient, startedAt: string): Promise<number | null> {
  const { count, error } = await client
    .from('games')
    .select('id', { count: 'exact', head: true })
    .lte('started_at', startedAt);
  if (error) {
    console.error(`discord: counting the group's games failed: ${error.message}`);
    return null;
  }
  return count ?? null;
}

const ROLE_VALUES: readonly string[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** `splits.blue` is jsonb. Read what we recognise and drop the rest; never throw on a row. */
export function readAssignments(value: unknown): { puuid: string; role: Role }[] {
  if (!Array.isArray(value)) return [];
  const assignments: { puuid: string; role: Role }[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { puuid, role } = entry as { puuid?: unknown; role?: unknown };
    if (typeof puuid !== 'string' || puuid.length === 0) continue;
    if (typeof role !== 'string' || !ROLE_VALUES.includes(role)) continue;
    assignments.push({ puuid, role: role as Role });
  }
  return assignments;
}
