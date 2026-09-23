import { displayRating, isOffRole, type Role, seedFromRank } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import { readAssignments } from '../discord/assemble';
import { loadFearless } from '../fearless/load';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { type FoldAwardPlayer, gatedGameAward } from '../ingest/fold';
import { inLaneOrder } from '../laneOrder';
import { formatClock, formatNightLabel, type NightClock, nightClock } from '../night';
import type { PublicClient } from '../publicClient';
import { renderWebName } from './copy';
import type {
  LobbyView,
  MemberView,
  PlayerName,
  ResultSeatView,
  ResultView,
  SeatView,
  SplitChoice,
  TapeEntry,
  TeamsView,
  TonightSnapshot,
} from './types';

/**
 * Everything the tonight page shows, read with the **anon key** (M3.4).
 *
 * One function, two callers: the server component renders the first paint with it, and the
 * browser re-runs it on every Realtime event. That is deliberate — an update path that
 * assembled state a second way would be a second set of rules about which lobby is tonight's
 * and what a rating is, and the two would drift on the night nobody is watching.
 *
 * Every read here is public: `lobbies`, `lobby_members`, `splits`, `games`, `game_players`,
 * `ratings`, `seasons` and `fearless_state` carry a `for select to anon` policy, and names come
 * from `players_public`, which is `players` without `discord_id`. The base `players` table is not
 * readable with this key at all, and nothing on this path tries.
 */

export interface LoadTonightOptions {
  /**
   * The 06:00 boundary of the night being asked about, from `lib/night.ts` on the server. It
   * is passed in rather than computed because the browser must not re-derive what "tonight"
   * means: one definition, on the server, in the timezone the deployment is configured with.
   */
  nightStart: Date;
  /**
   * The zone the slug line is written in. **Server only**: the page passes `nightTimeZone()`,
   * and the browser passes {@link nightLabel} instead of a zone.
   */
  timeZone?: string;
  /**
   * The label the server already formatted, for the browser's re-read to carry through.
   *
   * The slug is formatted **once, on the server**, and every later snapshot repeats it
   * verbatim: the browser has no environment, so re-deriving it there would silently use the
   * default zone and could flip the weekday under the reader seconds after the first paint on
   * any deployment that overrides `CUSTOMS_NIGHT_TZ` (05-design.md, "The status strip").
   */
  nightLabel?: string;
  /**
   * The zone's offset for the night, carried through the browser's re-read like
   * {@link nightLabel}, so the tape's clocks are the server's (`lib/night.ts`, `NightClock`).
   */
  nightClock?: NightClock;
}

export async function loadTonight(
  client: PublicClient,
  options: LoadTonightOptions,
): Promise<TonightSnapshot> {
  const nightStart = options.nightStart.toISOString();
  const clock = options.nightClock ?? nightClock(options.nightStart, options.timeZone);
  const [lobbyRow, season, fearless, tapeRows] = await Promise.all([
    selectLobby(client, nightStart),
    selectSeason(client),
    loadFearless(client),
    selectTapeLobbies(client, nightStart),
  ]);
  const seasonId = season?.id ?? null;
  const tapeLobbies = pickTapeLobbies(tapeRows, nightStart, drawnLobbyId(lobbyRow));

  const [lobby, tape] = await Promise.all([
    lobbyRow === null ? Promise.resolve(null) : loadLobby(client, lobbyRow, seasonId),
    loadTape(client, tapeLobbies, clock),
  ]);

  return {
    nightStart,
    nightLabel: options.nightLabel ?? formatNightLabel(options.nightStart, options.timeZone),
    nightClock: clock,
    seasonActive: seasonId !== null,
    lobby,
    fearless,
    tape,
  };
}

interface LobbyRow {
  id: string;
  status: LobbyView['status'];
  /** `Customs 09 Sep #1`, when the client reported one. Half of M4.10's line. */
  lobbyName: string | null;
  /** The four digits the companion set, when it sent them (M4.2). Never a secret. */
  lobbyPassword: string | null;
}

/**
 * The newest `lobbies` row of tonight that is not `abandoned`.
 *
 * One row is one game cycle (M2.14), so a night has several and the page follows the newest:
 * when the group starts the next game, the result of the last one is replaced by the member
 * list filling up. That is the decision recorded on 2026-09-09, and it is why there is no
 * "last game" block on this page.
 */
async function selectLobby(client: PublicClient, nightStart: string): Promise<LobbyRow | null> {
  const { data, error } = await client
    .from('lobbies')
    // The name and the password come back with the row the page is already reading (M4.10):
    // one query, three facts. Both are publicly readable — RLS is row-level, and this row is
    // the one the anon policy already returns — and neither is a secret: the password goes in
    // the Discord embed and is read out in voice.
    .select('id, status, lobby_name, lobby_password')
    .gte('created_at', nightStart)
    .neq('status', 'abandoned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tonight: lobby lookup failed: ${error.message}`);
  if (data === null) return null;
  return {
    id: data.id,
    status: data.status,
    lobbyName: data.lobby_name,
    lobbyPassword: data.lobby_password,
  };
}

/**
 * The active season, or `null`: the page then prints `NO_ACTIVE_SEASON_TONIGHT_MESSAGE` and
 * the slug line is the date alone.
 *
 * The name comes back alongside the id because the strip's slug says which season this is —
 * one query, two facts, and no second read of the same row.
 */
async function selectSeason(client: PublicClient): Promise<{ id: string; name: string } | null> {
  const { data, error } = await client
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tonight: season lookup failed: ${error.message}`);
  return data ?? null;
}

async function loadLobby(client: PublicClient, lobby: LobbyRow, seasonId: string | null): Promise<LobbyView> {
  const members = await loadMembers(client, lobby.id, seasonId);
  const byPuuid = new Map(members.map((member) => [member.puuid, member]));

  // `open` has no splits to read and no game to read, and the first paint of a filling lobby
  // is the one people wait on.
  const [teams, result] =
    lobby.status === 'open'
      ? [null, null]
      : await Promise.all([
          loadTeams(client, lobby.id, members, byPuuid),
          lobby.status === 'finished' ? loadResult(client, lobby.id, byPuuid) : Promise.resolve(null),
        ]);

  return {
    id: lobby.id,
    status: lobby.status,
    lobbyName: lobby.lobbyName,
    lobbyPassword: lobby.lobbyPassword,
    members,
    teams,
    result,
  };
}

interface PlayerRow {
  id: string;
  puuid: string;
  display_name: string | null;
  game_name: string | null;
  main_role: RoleValue | null;
  secondary_role: RoleValue | null;
  rank_tier: string | null;
  rank_division: string | null;
}

/**
 * Everyone around, in join order, with the number they will see beside their name.
 *
 * **The rating is `loadPool`'s rule, not a second one**: the `ratings` row for the active
 * season, and `seedFromRank` in memory when there is none. That is what the balancer used and
 * what the Discord embed printed, and a page that disagreed with the embed by one point would
 * be a ten-minute argument in voice.
 *
 * **This is the one surface that still prints a rank estimate, and it is deliberate**
 * (2026-09-16). Nothing stored is seeded from a League rank any more, and `/leaderboard` and
 * `/p/[puuid]` now show `provisionalSeed()`'s 1200 for a player with no folded row. This page is
 * not those pages: it renders tonight's lobby and tonight's split, seat by seat, and every seat
 * number here is also in the Discord teams embed, which `buildTeamsInput` builds from the
 * balancer's own pool. Changing this line would not make a never-rated player's number more
 * honest — it would make the page and the message about the same ten people disagree, which is
 * the bug this file's rule exists to prevent. The seam is one evening wide and closes the moment
 * their first game is folded.
 */
async function loadMembers(
  client: PublicClient,
  lobbyId: string,
  seasonId: string | null,
): Promise<MemberView[]> {
  const { data, error } = await client
    .from('lobby_members')
    // `side` is the column M4.11 reads: where the client has each person right now, so the
    // page can tell whether the ten are already on the sides the split gave them.
    .select('player_id, role_override, is_spectator, side, created_at')
    .eq('lobby_id', lobbyId)
    .order('created_at', { ascending: true })
    .order('player_id', { ascending: true });
  if (error) throw new Error(`tonight: member lookup failed: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const playerIds = rows.map((row) => row.player_id);
  const [players, ratings] = await Promise.all([
    loadPlayers(client, playerIds),
    loadRatings(client, playerIds, seasonId),
  ]);

  const members: MemberView[] = [];
  for (const row of rows) {
    const player = players.get(row.player_id);
    // A member whose player row we cannot read is not a row we can draw: no name, no rating,
    // no puuid to key it on. It cannot happen through the foreign key; dropping it is still
    // better than a blank line in a list people count.
    if (player === undefined) continue;
    const rating = ratings.get(row.player_id) ?? seedFromRank(player.rank_tier, player.rank_division);

    members.push({
      puuid: player.puuid,
      name: displayName(player),
      mainRole: player.main_role,
      secondaryRole: player.secondary_role,
      roleOverride: row.role_override,
      isSpectator: row.is_spectator,
      joinedAt: row.created_at,
      rating: displayRating(rating.mu),
      side: toSide(row.side),
    });
  }

  // **Join order, and a name inside one join.** Everyone in the same companion post is
  // inserted by one statement and shares `created_at` to the microsecond, so the query's tie
  // break was `player_id` — a random uuid, which reads as a shuffle on the first screen of a
  // seven-person post. Sort within equal timestamps on the name the reader actually sees.
  // Between posts nothing changes: an earlier `created_at` always sorts first, so a later
  // join is still appended at the bottom.
  return members.sort(
    (a, b) =>
      Date.parse(a.joinedAt) - Date.parse(b.joinedAt) ||
      renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
      (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
  );
}

/** `players_public`: `players` minus `discord_id`, and the only players relation anon can read. */
async function loadPlayers(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerRow>> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name, main_role, secondary_role, rank_tier, rank_division')
    .in('id', [...playerIds]);
  if (error) throw new Error(`tonight: player lookup failed: ${error.message}`);

  const players = new Map<string, PlayerRow>();
  for (const row of data ?? []) {
    // The view's columns are all nullable to the generated types; the id is the primary key
    // of the table underneath it and is never null in a row that exists.
    if (row.id === null || row.puuid === null) continue;
    players.set(row.id, {
      id: row.id,
      puuid: row.puuid,
      display_name: row.display_name,
      game_name: row.game_name,
      main_role: row.main_role,
      secondary_role: row.secondary_role,
      rank_tier: row.rank_tier,
      rank_division: row.rank_division,
    });
  }
  return players;
}

async function loadRatings(
  client: PublicClient,
  playerIds: readonly string[],
  seasonId: string | null,
): Promise<Map<string, { mu: number; sigma: number }>> {
  if (seasonId === null) return new Map();

  const { data, error } = await client
    .from('ratings')
    .select('player_id, mu, sigma')
    .eq('season_id', seasonId)
    .in('player_id', [...playerIds]);
  if (error) throw new Error(`tonight: rating lookup failed: ${error.message}`);

  return new Map((data ?? []).map((row) => [row.player_id, { mu: row.mu, sigma: row.sigma }]));
}

/** M3.10's fallback is applied at render; the loader carries the honest `null`. */
function displayName(player: PlayerRow): PlayerName {
  return player.display_name ?? player.game_name ?? null;
}

/**
 * `lobby_members.side` is a plain `smallint` to the generated types, and the page's `SideValue`
 * is `100 | 200`. Anything else — a null for a spectator, and a number that is neither, which
 * the check constraint forbids but this key cannot promise — is carried as `null`: **not
 * knowing where somebody is sitting is not the same as knowing they are in the right seat**, and
 * `null` is the value the side line keeps itself on screen for (M4.11).
 */
function toSide(side: number | null): SideValue | null {
  return side === 100 ? 100 : side === 200 ? 200 : null;
}

/**
 * The promoted split (`splits.is_chosen`) and the rest of the lobby's list.
 *
 * The explanation is the stored string of **that** split and is carried verbatim: after a
 * reroll it is split 2's sentence, off-role clause and all, which is the whole of M3.7. The
 * off-role marker beside a name comes from core's `isOffRole` on the same role the split
 * stored, so the sentence and the cards can never disagree about who is off their role.
 */
async function loadTeams(
  client: PublicClient,
  lobbyId: string,
  members: readonly MemberView[],
  byPuuid: ReadonlyMap<string, MemberView>,
): Promise<TeamsView | null> {
  const { data, error } = await client
    .from('splits')
    .select('id, rank, blue, red, blue_win_prob, explanation, is_chosen, created_at')
    .eq('lobby_id', lobbyId)
    .order('created_at', { ascending: false })
    .order('rank', { ascending: true });
  if (error) throw new Error(`tonight: split lookup failed: ${error.message}`);

  const rows = data ?? [];
  // **The window where no split is chosen.** Both `balanceLobby` and `promoteSplit` clear
  // `is_chosen` in one statement and set it in the next — PostgREST has no transaction — so a
  // read that lands between them sees a lobby with splits and none chosen. Falling through to
  // `null` there would flash the member list under a reader who is looking at the teams. The
  // rows come back newest run first, rank ascending, so `rows[0]` is the best split of the
  // most recent balance: the same teams the next statement is about to re-flag.
  const chosen = rows.find((row) => row.is_chosen) ?? rows[0];
  if (chosen === undefined) return null;

  // One balance run's three splits, and only those: `storeSplits` inserts them in a single
  // statement, so a run is exactly the rows that share the chosen one's `created_at`. A
  // rebalance appends a new set of three rather than replacing the old, and ranks start at 1
  // again — without this the reroll control could offer split 2 of a run the group has already
  // moved past.
  const splits: SplitChoice[] = rows
    .filter((row) => row.created_at === chosen.created_at)
    // `isChosen` is "the one this page is showing", so that the reroll control offers the
    // split after it. In the no-chosen-row window above they are the same thing anyway.
    .map((row) => ({ id: row.id, rank: row.rank, isChosen: row.id === chosen.id }));

  /**
   * **Lane order is enforced here, not trusted.** `splits.blue` is jsonb in whatever order the
   * balancer wrote it, and the page's promise is that "my row" is in the same place in the
   * teams card, the result card and both embeds (`lib/laneOrder.ts`). The embeds already sort;
   * this is the page saying the same thing rather than reading a stored array's order and
   * hoping (the designer, 2026-09-10).
   */
  const seats = (side: unknown): SeatView[] =>
    inLaneOrder(readAssignments(side)).map((assignment) => toSeat(assignment, byPuuid));
  const blue = seats(chosen.blue);
  const red = seats(chosen.red);
  const playing = new Set([...blue, ...red].map((seat) => seat.puuid));

  return {
    splitId: chosen.id,
    explanation: chosen.explanation,
    blue,
    red,
    sitters: members.filter((member) => !playing.has(member.puuid)),
    blueWinProb: chosen.blue_win_prob,
    splits: splits.sort((a, b) => a.rank - b.rank),
  };
}

function toSeat(
  assignment: { puuid: string; role: Role },
  byPuuid: ReadonlyMap<string, MemberView>,
): SeatView {
  const member = byPuuid.get(assignment.puuid);
  return {
    puuid: assignment.puuid,
    name: member?.name ?? null,
    role: assignment.role,
    rating: member?.rating ?? 0,
    // Where the client has them, beside the side this split gave them. A seat with no member
    // row keeps `null`, which reads as "not known to be in the right place" (M4.11).
    liveSide: member?.side ?? null,
    offRole:
      member === undefined
        ? false
        : isOffRole(
            {
              mainRole: member.mainRole,
              secondaryRole: member.secondaryRole,
              roleOverride: member.roleOverride,
            },
            assignment.role,
          ),
  };
}

/**
 * The lobby's game, as the result card needs it.
 *
 * The two mu values travel; the delta is computed where it is rendered. A game the fold did
 * not rate keeps every row and sets `rated` false, which is the "no deltas under the header
 * `Final`" case — never a banner apologising for a remake.
 */
async function loadResult(
  client: PublicClient,
  lobbyId: string,
  byPuuid: ReadonlyMap<string, MemberView>,
): Promise<ResultView | null> {
  const { data: game, error } = await client
    .from('games')
    .select('id, duration_s, winning_side, started_at')
    .eq('lobby_id', lobbyId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tonight: game lookup failed: ${error.message}`);
  if (!game) return null;
  return (await resultOfGame(client, game, lobbyId, byPuuid))?.result ?? null;
}

/**
 * One stored game as the poster draws it, plus the chosen split's stored explanation: the
 * tonight page's result block and `/g/[gameId]` (M11.4) both come through here, so a game's
 * odds, MVP and deltas are one computation on both. `null` for a game with no winner or no
 * scoreboard rows.
 */
export async function resultOfGame(
  client: PublicClient,
  game: { id: string; duration_s: number; winning_side: number | null },
  lobbyId: string | null,
  byPuuid: ReadonlyMap<string, MemberView> = new Map(),
): Promise<{ result: ResultView; explanation: string | null } | null> {
  if (game.winning_side !== 100 && game.winning_side !== 200) return null;

  const [rows, splitRoles] = await Promise.all([
    loadGamePlayers(client, game.id),
    lobbyId === null ? Promise.resolve(NO_SPLIT) : loadChosenSplit(client, lobbyId),
  ]);
  if (rows.length === 0) return null;

  const scoreboard = await scoreboardPlayers(
    client,
    rows.map((row) => row.player_id),
  );

  const seats: ResultSeatView[] = [];
  const ten: FoldAwardPlayer[] = [];
  let topDamage: { name: PlayerName; damage: number } | null = null;
  for (const row of rows) {
    const player = scoreboard.get(row.player_id);
    if (player === undefined) continue;
    const puuid = player.puuid;
    // The award's stat line is the scoreboard's alone, `role` included, with no fallback to the
    // split: the same rule `resultAward` in `lib/discord/assemble.ts` keeps, so a game the fold
    // gave no MVP to because a position was missing does not grow one on this page.
    if (row.side === 100 || row.side === 200) {
      ten.push({
        puuid,
        side: row.side,
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
      });
    }
    // **The scoreboard's own name, not the lobby's.** `game_players` and `lobby_members` are
    // not the same ten: `findLobbyId`'s clock and late-report fallbacks can attach a game to a
    // lobby whose roster was frozen at `in_game`, so a player on the scoreboard need not have
    // a member row. Reading the name off the member map printed `Someone` for them — and
    // `Top damage: Someone` — while the result embed, which reads `players`, named them, and
    // the 60-second name re-read could never fix it because the name was there all along.
    const name = player.name ?? byPuuid.get(puuid)?.name ?? null;

    seats.push({
      puuid,
      name,
      // What the scoreboard said, then the split's role: the same fallback the result embed
      // uses, so the page and the message put a player on the same line.
      role: row.role ?? splitRoles.roles.get(puuid) ?? null,
      side: row.side === 100 ? 100 : 200,
      muBefore: row.mu_before,
      muAfter: row.mu_after,
    });

    if (row.damage_to_champs > 0 && (topDamage === null || row.damage_to_champs > topDamage.damage)) {
      topDamage = { name, damage: row.damage_to_champs };
    }
  }

  const winningSide = game.winning_side as SideValue;
  const rated = seats.length > 0 && seats.every((seat) => seat.muBefore !== null && seat.muAfter !== null);

  const result: ResultView = {
    winningSide,
    durationS: game.duration_s,
    blueWinProb: splitRoles.blueWinProb,
    topDamage,
    award: rated && ten.length === rows.length ? resultAward(ten, seats, game.duration_s, winningSide) : null,
    // Lane order, the same five positions as the teams block: `game_players` comes back in
    // whatever order Postgres feels like, and "my row" has to be where it was twenty minutes
    // ago. The result embed sorts with this same function (05-design.md, "Result card").
    blue: inLaneOrder(seats.filter((seat) => seat.side === 100)),
    red: inLaneOrder(seats.filter((seat) => seat.side === 200)),
    rated,
  };
  return { result, explanation: splitRoles.explanation };
}

/**
 * The MVP and the ACE by name, or `null` (M11.3). `gatedGameAward` is the one function in the
 * app that names an MVP; this maps its two puuids onto the names the cards are printing, the
 * same mapping `resultAward` in `lib/discord/assemble.ts` does for the post.
 *
 * Reached only for a rated game whose every scoreboard row mapped to a puuid: anything that is
 * still not a clean ten is `gateGame`'s to refuse, and it refuses with `null`, not a throw.
 */
function resultAward(
  ten: readonly FoldAwardPlayer[],
  seats: readonly ResultSeatView[],
  durationS: number,
  winningSide: SideValue,
): ResultView['award'] {
  const award = gatedGameAward(ten, durationS, winningSide);
  if (award === null) return null;
  const names = new Map(seats.map((seat) => [seat.puuid, seat.name]));
  return { mvp: names.get(award.mvp) ?? null, ace: names.get(award.ace) ?? null };
}

async function loadGamePlayers(client: PublicClient, gameId: string) {
  const { data, error } = await client
    .from('game_players')
    // The stat line is the award's input (M11.3): the columns the result post reads, all of
    // them publicly readable on the rows this key already sees.
    .select(
      'player_id, side, role, kills, deaths, assists, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, damage_to_champs, mu_before, mu_after',
    )
    .eq('game_id', gameId);
  if (error) throw new Error(`tonight: game player lookup failed: ${error.message}`);
  return data ?? [];
}

/**
 * The puuid **and the newest name** for everyone on the scoreboard, from `players_public`.
 *
 * One query either way, so there is no reason to read a name from the lobby when the row that
 * has it is already being fetched. The member map stays as the second answer: it holds the
 * same string for anyone who is in both lists.
 */
async function scoreboardPlayers(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, { puuid: string; name: PlayerName }>> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name')
    .in('id', [...playerIds]);
  if (error) throw new Error(`tonight: scoreboard player lookup failed: ${error.message}`);

  const players = new Map<string, { puuid: string; name: PlayerName }>();
  for (const row of data ?? []) {
    if (row.id === null || row.puuid === null) continue;
    players.set(row.id, { puuid: row.puuid, name: row.display_name ?? row.game_name ?? null });
  }
  return players;
}

interface ChosenSplit {
  roles: Map<string, RoleValue>;
  blueWinProb: number | null;
  explanation: string | null;
}

const NO_SPLIT: ChosenSplit = { roles: new Map(), blueWinProb: null, explanation: null };

/** The chosen split's roles, odds and stored explanation: the fallback role, the prediction line's number. */
async function loadChosenSplit(client: PublicClient, lobbyId: string): Promise<ChosenSplit> {
  const { data, error } = await client
    .from('splits')
    .select('blue, red, blue_win_prob, explanation')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`tonight: chosen split lookup failed: ${error.message}`);
  if (!data) return NO_SPLIT;

  const roles = new Map<string, RoleValue>();
  for (const side of [data.blue, data.red]) {
    for (const assignment of readAssignments(side)) roles.set(assignment.puuid, assignment.role);
  }
  return { roles, blueWinProb: data.blue_win_prob, explanation: data.explanation };
}

/* ---------------------------------------------------------------------------
 * The night tape (M11.2): tonight's earlier games, oldest first.
 *
 * Query-only and read with the same anon key: `lobbies`, `lobby_members`, `splits`, `games`,
 * `game_players` and `players_public` are all already on this page's path. One read of the
 * night's candidate lobbies runs beside `selectLobby`; the rest is four batched reads over
 * those ids, beside `loadLobby`, so the tape adds one round trip to the page and not one per row.
 * ------------------------------------------------------------------------- */

export interface TapeLobbyRow {
  id: string;
  status: LobbyView['status'];
  created_at: string;
}

const TAPE_STATUSES = ['finished', 'dropped'] as const;

async function selectTapeLobbies(client: PublicClient, nightStart: string): Promise<TapeLobbyRow[]> {
  const { data, error } = await client
    .from('lobbies')
    .select('id, status, created_at')
    .gte('created_at', nightStart)
    .in('status', [...TAPE_STATUSES])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`tonight: tape lobby lookup failed: ${error.message}`);
  return data ?? [];
}

/**
 * The lobby the primary block is drawing, or `null` when it draws none.
 *
 * `tonightState` draws every status the loader returns except `dropped`, which falls to its
 * default branch and is the idle page — so a newest dropped lobby is not on screen anywhere and
 * belongs on the tape (`load.test.ts` pins this against `tonightState` itself, status by status).
 */
export function drawnLobbyId(lobby: { id: string; status: LobbyView['status'] } | null): string | null {
  if (lobby === null || lobby.status === 'dropped' || lobby.status === 'abandoned') return null;
  return lobby.id;
}

/** Tonight's `finished` and `dropped` lobbies, oldest first, minus the one on screen. */
export function pickTapeLobbies(
  rows: readonly TapeLobbyRow[],
  nightStart: string,
  drawnId: string | null,
): TapeLobbyRow[] {
  const from = Date.parse(nightStart);
  return rows
    .filter(
      (row) =>
        row.id !== drawnId &&
        (TAPE_STATUSES as readonly string[]).includes(row.status) &&
        Date.parse(row.created_at) >= from,
    )
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** Everything {@link assembleTape} reads, as the queries return it. */
export interface TapeSource {
  lobbies: readonly TapeLobbyRow[];
  games: readonly {
    id: string;
    lobby_id: string | null;
    duration_s: number;
    winning_side: number | null;
    started_at: string;
    gameMode: unknown;
  }[];
  gamePlayers: readonly { game_id: string; mu_before: number | null; mu_after: number | null }[];
  splits: readonly { lobby_id: string; blue: unknown; red: unknown; blue_win_prob: number | null }[];
  members: readonly { lobby_id: string; player_id: string; created_at: string }[];
  players: ReadonlyMap<string, { puuid: string; name: PlayerName }>;
}

async function loadTape(
  client: PublicClient,
  lobbies: readonly TapeLobbyRow[],
  clock: NightClock,
): Promise<TapeEntry[]> {
  if (lobbies.length === 0) return [];
  const ids = lobbies.map((lobby) => lobby.id);

  const [games, splits, members] = await Promise.all([
    client
      .from('games')
      // The mode alone, not the end-of-game blob (`selectSeasonGames` in `lib/ingest/rebuild.ts`).
      .select('id, lobby_id, duration_s, winning_side, started_at, raw->gameMode')
      .in('lobby_id', ids),
    client
      .from('splits')
      .select('lobby_id, blue, red, blue_win_prob')
      .in('lobby_id', ids)
      .eq('is_chosen', true),
    client
      .from('lobby_members')
      .select('lobby_id, player_id, created_at')
      .in('lobby_id', ids)
      .order('created_at', { ascending: true }),
  ]);
  if (games.error) throw new Error(`tonight: tape game lookup failed: ${games.error.message}`);
  if (splits.error) throw new Error(`tonight: tape split lookup failed: ${splits.error.message}`);
  if (members.error) throw new Error(`tonight: tape member lookup failed: ${members.error.message}`);

  const gameIds = (games.data ?? []).map((game) => game.id);
  const playerIds = [...new Set((members.data ?? []).map((member) => member.player_id))];
  const [gamePlayers, players] = await Promise.all([
    gameIds.length === 0
      ? Promise.resolve([])
      : client
          .from('game_players')
          .select('game_id, mu_before, mu_after')
          .in('game_id', gameIds)
          .then(({ data, error }) => {
            if (error) throw new Error(`tonight: tape game player lookup failed: ${error.message}`);
            return data ?? [];
          }),
    playerIds.length === 0 ? Promise.resolve(new Map()) : scoreboardPlayers(client, playerIds),
  ]);

  return assembleTape(
    {
      lobbies,
      games: games.data ?? [],
      gamePlayers,
      splits: splits.data ?? [],
      members: members.data ?? [],
      players,
    },
    clock,
  );
}

/**
 * The tape's rows from its rows. Pure, so the acceptance fixtures are unit tests.
 *
 * - **Result** is the lobby's newest game with a winner — `loadResult`'s pick — and `rated` is
 *   its rule, every scoreboard row carrying both mu values.
 * - **Odds** are the chosen split's stored `blue_win_prob`, the number the poster read.
 * - **Sitters** are `loadTeams`' rule: the lobby's members who are not one of the chosen
 *   split's ten, in join order (and by name inside one post, as `loadMembers` sorts). With no
 *   chosen split nobody is known to have sat, and there is no line.
 */
export function assembleTape(source: TapeSource, clock: NightClock): TapeEntry[] {
  const gamesByLobby = new Map<string, TapeSource['games'][number]>();
  for (const game of source.games) {
    if (game.lobby_id === null || (game.winning_side !== 100 && game.winning_side !== 200)) continue;
    const held = gamesByLobby.get(game.lobby_id);
    if (held === undefined || Date.parse(game.started_at) > Date.parse(held.started_at)) {
      gamesByLobby.set(game.lobby_id, game);
    }
  }

  const rowsByGame = new Map<string, { mu_before: number | null; mu_after: number | null }[]>();
  for (const row of source.gamePlayers) {
    const rows = rowsByGame.get(row.game_id) ?? [];
    rows.push(row);
    rowsByGame.set(row.game_id, rows);
  }

  const splitByLobby = new Map(source.splits.map((split) => [split.lobby_id, split]));

  return source.lobbies.map((lobby) => {
    const game = gamesByLobby.get(lobby.id);
    const split = splitByLobby.get(lobby.id);
    const rows = game === undefined ? [] : (rowsByGame.get(game.id) ?? []);

    return {
      lobbyId: lobby.id,
      createdAt: lobby.created_at,
      clock: formatClock(new Date(lobby.created_at), clock),
      status: lobby.status === 'dropped' ? 'dropped' : 'finished',
      result:
        game === undefined
          ? null
          : {
              gameId: game.id,
              winningSide: game.winning_side as SideValue,
              durationS: game.duration_s,
              aram: matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'aram'),
              rated: rows.length > 0 && rows.every((row) => row.mu_before !== null && row.mu_after !== null),
            },
      blueWinProb: split?.blue_win_prob ?? null,
      sitters: split === undefined ? [] : tapeSitters(lobby.id, split, source),
    };
  });
}

function tapeSitters(lobbyId: string, split: TapeSource['splits'][number], source: TapeSource): PlayerName[] {
  const playing = new Set(
    [...readAssignments(split.blue), ...readAssignments(split.red)].map((seat) => seat.puuid),
  );
  const sat: { puuid: string; name: PlayerName; joinedAt: string }[] = [];
  for (const member of source.members) {
    if (member.lobby_id !== lobbyId) continue;
    const player = source.players.get(member.player_id);
    if (player === undefined || playing.has(player.puuid)) continue;
    sat.push({ puuid: player.puuid, name: player.name, joinedAt: member.created_at });
  }
  return sat
    .sort(
      (a, b) =>
        Date.parse(a.joinedAt) - Date.parse(b.joinedAt) ||
        renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
        (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
    )
    .map((member) => member.name);
}
