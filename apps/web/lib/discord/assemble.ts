import { type Assignment, displayKustom, isOffRole, type Mode, type Role, resolveRoles } from '@customs/core';
import type { SideValue } from '@customs/db';
import {
  type LobbyKickoff,
  type RuleCheck,
  ruleCheckSchema,
  ruleModeOf,
  storedScoreParts,
} from '@customs/db/schemas';
import { SWITCH_SIDE_ENABLED } from '../commands/gate';
import { readKickoffs } from '../games/kickoffs';
import { matchesQueue } from '../games/queue';
import {
  kickoffDisagrees,
  type PlayedSplit,
  playedOddsOf,
  postedOdds,
  splitRolesFor,
} from '../games/receipt';
import { type FoldPerformance, gatedGameAward, gateGame } from '../ingest/fold';
import type { PoolMember, SeatMove } from '../ingest/selection';
import { loadCheckNames } from '../mode/clientNames';
import { displayDelta } from '../ratingDisplay';
import { groupPageUrl, kustomAvatarUrl } from '../siteUrl';
import type { ServiceClient } from '../supabase';
import { sitOutRule } from '../tonight/sitOut';
import type {
  GameOnEmbedInput,
  GameOnPlayer,
  PlayerName,
  PostIdentity,
  PromotedSplit,
  ResultAward,
  ResultEmbedInput,
  ResultPlayer,
  SeatLine,
  TeamsEmbedInput,
  TeamsPlayer,
  TeamsReceipt,
} from './embeds';
import type { TeamsModeInput } from './modeLines';

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
  /**
   * The stored split columns the receipt is drawn from (M14.10), read by `loadLobbyReceipt`.
   * Absent or `null` leaves the description core's sentence alone.
   */
  receipt?: TeamsReceipt | null | undefined;
  /**
   * The lobby's mode lock taken at Roll (M15.6), read by `loadTeamsMode`. Absent or `null` (a
   * balance with no lock, or a lock that could not be read) prints no rule line.
   */
  mode?: TeamsModeInput | null | undefined;
}

export interface EmbedContext {
  /** The group's name and links, and the avatar (M14.61, 05-design 10.2). */
  identity: PostIdentity;
  /** E1's title link (the group's page, or the game's), or `undefined` with no honest URL (M3.1). */
  url?: string | undefined;
  /** The teams post's E4 link, `/g/<slug>#how-the-bot-decided` (M14.61). */
  receiptUrl?: string | undefined;
  /** The result post's thumbnail, only on a public origin (05-design 10.11 B2). */
  badgeUrl?: string | undefined;
  /**
   * M4.3's gate, for the teams embed's side line. Left out in production, where the value is
   * {@link SWITCH_SIDE_ENABLED} read at post time: the same flag that decides whether a
   * `switch_side` row is ever queued decides which sentence the message carries, so the embed
   * cannot promise a switch the server does not make. Tests pass it to see the other line.
   */
  switchSideEnabled?: boolean | undefined;
  /** The group's mode panel, `/g/<slug>/mode`, for the teams post's rule line (M15.6). */
  modeUrl?: string | undefined;
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
        // The all-time Kustom Rating the balancer read (M18.5, M18.6).
        rating: displayKustom(member.r),
        // Core's rule, not a copy of it: the scorer, the explanation and this line agree
        // about who is off-role because all three ask the same function.
        offRole: isOffRole(member, role),
        noMain: resolveRoles(member).main === null,
      };
    });

  return {
    blue: side(source.split.blue),
    red: side(source.split.red),
    explanation: source.explanation,
    receipt: source.receipt ?? null,
    sitOut:
      source.sitters.length === 0
        ? null
        : {
            names: source.sitters.map((member) => names.get(member.puuid) ?? null),
            rule: sitOutRule(source.playing, source.sitters),
          },
    seats: source.seatMoves.map((move) => toSeatLine(move, names)),
    switchSideEnabled: context.switchSideEnabled ?? SWITCH_SIDE_ENABLED,
    lobby: { name: source.lobbyName, password: source.lobbyPassword },
    promoted: source.promoted,
    identity: context.identity,
    url: context.url,
    receiptUrl: context.receiptUrl,
    ...(source.mode === undefined || source.mode === null
      ? {}
      : { mode: source.mode, modeUrl: context.modeUrl }),
  };
}

/** A kickoff record that gets a `Game on` post (M21.6): teams Kustom did not roll. */
export type GameOnKickoff = Extract<LobbyKickoff, { kind: 'custom' | 'unrolled' }>;

/** Everything the `Game on` embed needs that is not a name. */
export interface GameOnSource {
  kickoff: GameOnKickoff;
  /** The lobby's chosen split, for the roles of a side that is its five; `null` with none. */
  split: {
    blue: readonly { puuid: string; role: Role }[];
    red: readonly { puuid: string; role: Role }[];
  } | null;
  /** Each player's all-time `ratings.r` going in (the kickoff odds' own input); absent is 1200. */
  ratingOf: (puuid: string) => number;
  /** The lobby's lock (the rule line), or `null` when there is none or it could not be read. */
  mode: TeamsModeInput | null;
}

/**
 * The `Game on` embed input (M21.6). Pure. A kickoff side whose players are exactly one of the
 * split's two sides keeps that side's roles (the split's five, wherever they sit); any other side
 * prints names with no role, because the lane is not known until the eog. A not-rated game drops
 * the odds and keeps the rule line (M15.18), as the post's brief says.
 */
export function buildGameOnInput(
  source: GameOnSource,
  names: NameLookup,
  context: EmbedContext,
): GameOnEmbedInput {
  const splitSides = source.split === null ? [] : [source.split.blue, source.split.red];
  const side = (puuids: readonly string[]): GameOnPlayer[] => {
    const match = splitSides.find(
      (splitSide) =>
        splitSide.length === puuids.length &&
        puuids.every((puuid) => splitSide.some((a) => a.puuid === puuid)),
    );
    return puuids.map((puuid) => ({
      puuid,
      name: names.get(puuid) ?? null,
      role: match?.find((a) => a.puuid === puuid)?.role ?? null,
      rating: displayKustom(source.ratingOf(puuid)),
    }));
  };
  const rated = source.mode?.rated !== false;
  return {
    identity: context.identity,
    kind: source.kickoff.kind,
    blue: side(source.kickoff.blue),
    red: side(source.kickoff.red),
    blueWinProb: rated ? source.kickoff.blueWinProb : null,
    url: context.url,
    ...(source.mode === null ? {} : { mode: source.mode, modeUrl: context.modeUrl }),
  };
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
  /** `games.rated` (M15.3): false for a game played not rated (a rule's default, or the switch). */
  rated: boolean;
  /** Summoner's Rift (`raw.gameMode` CLASSIC or missing, M7.1): ARAM never gets a result post. */
  rift: boolean;
  /** The rule played (`games.rule*`) and its stored check (`games.rule_check`), or `null`. */
  rule: { mode: Mode; check: RuleCheck; names?: Readonly<Record<number, string>> } | null;
  players: readonly ResultSourcePlayer[];
}

export interface ResultSourcePlayer {
  puuid: string;
  name: PlayerName;
  side: SideValue;
  /** What the two columns print: the scoreboard's role, or the stored split's as a fallback. */
  role: Role | null;
  damage: number;
  rBefore: number | null;
  rAfter: number | null;
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
  if (!source.rated) return buildNotRatedInput(source, context);

  const rated = source.players.filter(
    (player): player is ResultSourcePlayer & { rBefore: number; rAfter: number } =>
      player.rBefore !== null && player.rAfter !== null,
  );
  if (rated.length !== source.players.length || rated.length === 0) return null;

  const toPlayer = (player: (typeof rated)[number]): ResultPlayer => ({
    puuid: player.puuid,
    name: player.name,
    role: player.role,
    rating: displayKustom(player.rAfter),
    // The one delta rule, from the one shared helper (M3.3).
    delta: displayDelta(player.rBefore, player.rAfter),
  });

  return {
    winningSide: source.winningSide === 100 ? 100 : 200,
    durationS: source.durationS,
    blue: rated.filter((player) => player.side === 100).map(toPlayer),
    red: rated.filter((player) => player.side === 200).map(toPlayer),
    award: resultAward(source),
    blueWinProb: source.blueWinProb,
    topDamage: topDamage(source),
    gameNumber: source.gameNumber,
    // A rated rule game (mirror match, or a rule switched to rated) carries its check line.
    ...(source.rule === null ? {} : { mode: { rated: true, rule: source.rule } }),
    identity: context.identity,
    url: context.url,
    badgeUrl: context.badgeUrl,
  };
}

/**
 * A game played **not rated** (M15.6, brief D5): unlike ARAM it gets a result post, because the
 * rule line lives there. Only a clean Rift ten — the gate the fold would have used had the game
 * been rated (ten rows, five a side, over five minutes, Rift) — so a remake, a short game and an
 * ARAM still get none. The columns print names alone, there is no MVP and ACE (nobody's delta was
 * amplified), and the description says `Not rated, so no Rating change.`
 */
function buildNotRatedInput(source: ResultSource, context: EmbedContext): ResultEmbedInput | null {
  if (!source.rift || !gateGame(source.players, source.durationS).ok) return null;
  const toPlayer = (player: ResultSourcePlayer): ResultPlayer => ({
    puuid: player.puuid,
    name: player.name,
    role: player.role,
    rating: null,
    delta: null,
  });
  return {
    winningSide: source.winningSide === 100 ? 100 : 200,
    durationS: source.durationS,
    blue: source.players.filter((player) => player.side === 100).map(toPlayer),
    red: source.players.filter((player) => player.side === 200).map(toPlayer),
    award: null,
    blueWinProb: source.blueWinProb,
    topDamage: topDamage(source),
    gameNumber: source.gameNumber,
    mode: { rated: false, rule: source.rule },
    identity: context.identity,
    url: context.url,
    badgeUrl: context.badgeUrl,
  };
}

/** The single highest damage of the game, ties broken by puuid; `null` when nobody dealt any. */
function topDamage(source: ResultSource): { name: PlayerName; damage: number } | null {
  const top = [...source.players].sort(
    (a, b) => b.damage - a.damage || (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
  )[0];
  return top === undefined || top.damage <= 0 ? null : { name: top.name, damage: top.damage };
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
 *   all carry `r_before` and `r_after` — the caller checked — which is what rules out a
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
    .select(
      'id, group_id, lobby_id, started_at, duration_s, winning_side, rated, rule, rule_class_tag, rule_region_blue, rule_region_red, rule_checked, rule_check, gameMode:game_mode',
    )
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
      'side, role, kills, deaths, assists, damage_to_champs, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, r_before, r_after, players!inner(puuid, display_name, game_name)',
    )
    .eq('game_id', gameId);
  if (playerError) throw new Error(`discord: game_players lookup failed: ${playerError.message}`);

  const [chosen, kickoffs] = await Promise.all([
    loadChosenSplit(client, game.lobby_id),
    readKickoffs(client, game.lobby_id === null ? [] : [game.lobby_id], 'discord'),
  ]);
  const rule = storedRule(gameId, game);
  // M15.10: a checked champion newer than the pin is named as the client named it.
  const names = rule === null ? {} : await loadCheckNames(client, gameId, rule.check);

  const sided = (rows ?? []).filter((row) => row.side === 100 || row.side === 200);
  const seats = sided.map((row) => ({
    puuid: row.players.puuid,
    side: (row.side === 100 ? 100 : 200) as SideValue,
    rBefore: row.r_before,
  }));
  // M21.7: the split's role is a fallback only for a player whose team is one of the split's two
  // (whichever side it sat on); someone on a changed team was never given a lane on it.
  const splitRoles = splitRolesFor(chosen, seats);
  const kickoff = game.lobby_id === null ? null : (kickoffs.get(game.lobby_id) ?? null);
  if (kickoffDisagrees(kickoff, seats)) {
    console.warn(
      `discord: game ${gameId}'s kickoff record (lobby ${game.lobby_id}) is not its end-of-game teams; ignored`,
    );
  }
  const rift = matchesQueue(typeof game.gameMode === 'string' ? game.gameMode : null, 'sr');
  const odds = postedOdds(
    playedOddsOf({
      aram: matchesQueue(typeof game.gameMode === 'string' ? game.gameMode : null, 'aram'),
      rated: game.rated,
      seats,
      chosen,
      kickoff,
    }),
    chosen,
  );

  const players: ResultSourcePlayer[] = sided.map((row) => ({
    puuid: row.players.puuid,
    name: row.players.display_name ?? row.players.game_name ?? null,
    side: (row.side === 100 ? 100 : 200) as SideValue,
    // What the scoreboard says first; the split's role is the fallback, so the two embeds
    // line up even when the client reported no position. The award below does **not** take
    // that fallback — see {@link ResultSourcePlayer.stats}.
    role: row.role ?? splitRoles.get(row.players.puuid) ?? null,
    damage: row.damage_to_champs,
    rBefore: row.r_before,
    rAfter: row.r_after,
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
    gameNumber: await countGamesThrough(client, game.group_id, game.started_at),
    blueWinProb: odds,
    endedAt: new Date(Date.parse(game.started_at) + game.duration_s * 1_000).toISOString(),
    rated: game.rated,
    rift,
    rule: rule === null || Object.keys(names).length === 0 ? rule : { ...rule, names },
    players,
  };
}

/**
 * The game's rule and its stored verdict (`0032`), or `null` for a standing-mode game, a game
 * whose check never ran, or a stored verdict this build cannot read (logged and dropped: the
 * post goes out without the check line rather than not at all).
 */
export function storedRule(
  gameId: string,
  row: {
    rule: string | null;
    rule_class_tag: string | null;
    rule_region_blue: string | null;
    rule_region_red: string | null;
    rule_checked: boolean;
    rule_check: unknown;
  },
): { mode: Mode; check: RuleCheck } | null {
  if (!row.rule_checked) return null;
  const mode = ruleModeOf({
    rule: row.rule,
    classTag: row.rule_class_tag,
    regionBlue: row.rule_region_blue,
    regionRed: row.rule_region_red,
  });
  if (mode === null) return null;
  const check = ruleCheckSchema.safeParse(row.rule_check);
  if (!check.success) {
    console.error(`discord: game ${gameId} has a rule_check this build cannot read; posting without it`);
    return null;
  }
  return { mode, check: check.data };
}

/** The chosen split of the lobby this game was played from (its teams, roles, odds and rank), or `null`. */
async function loadChosenSplit(
  client: ServiceClient,
  lobbyId: string | null,
): Promise<PlayedSplitRoles | null> {
  if (lobbyId === null) return null;

  const { data, error } = await client
    .from('splits')
    .select('blue, red, blue_win_prob, rank')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`discord: split lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    blue: readAssignments(data.blue),
    red: readAssignments(data.red),
    blueWinProb: data.blue_win_prob,
    rank: data.rank,
  };
}

type PlayedSplitRoles = PlayedSplit & {
  blue: { puuid: string; role: Role }[];
  red: { puuid: string; role: Role }[];
};

/**
 * Which game this is, counted from the group's first: `Kustom · game 47` (M5.12, product
 * 2026-09-10). Counted rather than stored, so it stays right after a backfill inserts an older
 * game (M5.1).
 *
 * Every game of **this game's group** up to and including this one (M14.10: a second
 * group's first game is its game 1, not the original group's count plus one).
 */
async function countGamesThrough(
  client: ServiceClient,
  groupId: string,
  startedAt: string,
): Promise<number | null> {
  const { count, error } = await client
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .lte('started_at', startedAt);
  if (error) {
    console.error(`discord: counting the group's games failed: ${error.message}`);
    return null;
  }
  return count ?? null;
}

/** One stored `splits` row, as `loadLobbyReceipt` reads it. */
export interface StoredSplitRow {
  id: string;
  rank: number;
  blue: unknown;
  red: unknown;
  gap: number;
  off_role_count: number;
  blue_win_prob: number;
  /** M18.13 (0045): jsonb, zod-checked in `toReceipt`. Absent or null on a row from before 0045. */
  score_parts?: unknown;
}

/**
 * The teams embed's receipt from a lobby's stored splits (M14.10): the posted one, the one ranked
 * directly below it, and how many there are. Pure. `null` when the posted split is not among the
 * rows or its sides do not read as five a side: a receipt about a split we cannot read is worse
 * than core's sentence alone.
 */
export function toReceipt(rows: readonly StoredSplitRow[], postedSplitId: string): TeamsReceipt | null {
  const read = (row: StoredSplitRow) => ({
    rank: row.rank,
    blue: readAssignments(row.blue),
    red: readAssignments(row.red),
    gap: row.gap,
    offRoleCount: row.off_role_count,
    blueWinProb: row.blue_win_prob,
    scoreParts: storedScoreParts(row.score_parts),
  });
  const posted = rows.find((row) => row.id === postedSplitId);
  if (posted === undefined) return null;
  const chosen = read(posted);
  if (chosen.blue.length !== 5 || chosen.red.length !== 5) return null;
  if (!(chosen.blueWinProb >= 0 && chosen.blueWinProb <= 1)) return null;
  const below = rows.find((row) => row.rank === posted.rank + 1);
  const next = below === undefined ? null : read(below);
  return { chosen, next, splitCount: rows.length };
}

/**
 * Every split a lobby stored, by rank: the numeric columns the receipt reads and nothing else
 * (never `explanation`, STRATEGY §4.2 rule 5). `null` when the read fails: the post goes out with
 * core's sentence alone rather than not at all.
 */
export async function loadLobbyReceipt(
  client: ServiceClient,
  lobbyId: string,
  postedSplitId: string,
): Promise<TeamsReceipt | null> {
  const { data, error } = await client
    .from('splits')
    .select('id, rank, blue, red, gap, off_role_count, blue_win_prob, score_parts')
    .eq('lobby_id', lobbyId)
    .order('rank', { ascending: true });
  if (error) {
    console.error(`discord: reading the lobby's splits for the receipt failed: ${error.message}`);
    return null;
  }
  return toReceipt(data ?? [], postedSplitId);
}

/**
 * A group's `/g/<slug>` segment, for every link its posts carry (M13.11, M14.10). `null` when the
 * group is gone or the read fails, and the post goes out with no link rather than a link to
 * another group's page.
 */
export async function loadGroupSlug(client: ServiceClient, groupId: string): Promise<string | null> {
  try {
    const { data, error } = await client.from('groups').select('slug').eq('id', groupId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.slug ?? null;
  } catch (error) {
    console.error('discord: group slug lookup failed', error);
    return null;
  }
}

/** A group as its posts name it (M14.61): the `/g/<slug>` segment and the display name. */
export interface PostGroup {
  slug: string;
  name: string;
}

/**
 * The group's slug and name, for every post's links and author line (M14.61). `null` when the
 * group is gone or the read fails: the post goes out with no author and no link, never another
 * group's.
 */
export async function loadPostGroup(client: ServiceClient, groupId: string): Promise<PostGroup | null> {
  try {
    const { data, error } = await client.from('groups').select('slug, name').eq('id', groupId).maybeSingle();
    if (error) throw new Error(error.message);
    return data === null ? null : { slug: data.slug, name: data.name };
  } catch (error) {
    console.error('discord: group lookup failed', error);
    return null;
  }
}

/**
 * A post's {@link PostIdentity} from its group and the request origin (05-design 10.2): the
 * author names the group and links `/g/<slug>`, and the avatar is sent only on a public origin.
 * Pure.
 */
export function postIdentity(group: PostGroup | null, origin: string | null | undefined): PostIdentity {
  return {
    groupName: group?.name ?? null,
    groupUrl: group === null ? undefined : groupPageUrl(origin, group.slug),
    avatarUrl: kustomAvatarUrl(origin),
  };
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
