import { displayKustom, isOffRole, KUSTOM_START, type Mode, type Role } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import { KICKOFF_COLUMNS, type KickoffRow, ORIGINAL_GROUP_ID, ruleModeOf } from '@customs/db/schemas';
import { receiptSplitFromRow } from '@/components/receipt/model';
import type { StoredSplit } from '@/components/receipt/types';
import { inChunks } from '../chunks';
import { readAssignments } from '../discord/assemble';
import { loadFearless } from '../fearless/load';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { type FoldAwardPlayer, gatedGameAward } from '../ingest/fold';
import { inLaneOrder } from '../laneOrder';
import { loadCheckNames } from '../mode/clientNames';
import { type LockRow, lockFromRow } from '../mode/lock';
import { missingState } from '../mode/state';
import {
  type GameStampRow,
  loadGameStamp,
  loadLastGameAt,
  loadModeFacts,
  stampCheck,
  stampFromRow,
} from '../mode/tonightRead';
import type { GameStampView } from '../mode/types';
import { formatClock, formatNightLabel, type NightClock, nightClock } from '../night';
import type { PublicClient } from '../publicClient';
import { renderWebName } from './copy';
import { kickoffView, readKickoff } from './kickoff';
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
 * `ratings` and `fearless_state` carry a `for select to anon` policy, and names come from
 * `players_public`, which is `players` without `discord_id`. The base `players` table is not
 * readable with this key at all, and nothing on this path tries. **`lobbies.lobby_password` is
 * not read here** (M14.28, `0028`: anon may not select it): the page adds it on the server, with
 * the service role, for a linked member of the group only (`lib/tonight/lobbyPassword.ts`).
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
  /**
   * Only this group's lobbies, ratings and fearless pool (M13.3). Absent is today's behaviour --
   * every lobby, and the original group's fearless pool -- which the tonight page keeps until
   * M13.9 passes its group; the champ-select overlay passes it now.
   */
  groupId?: string;
}

export async function loadTonight(
  client: PublicClient,
  options: LoadTonightOptions,
): Promise<TonightSnapshot> {
  const nightStart = options.nightStart.toISOString();
  const clock = options.nightClock ?? nightClock(options.nightStart, options.timeZone);
  const groupId = options.groupId;
  // **Three rounds, whatever the screen** (performance plan, phase 2). Round one: the night's
  // lobbies (one read for the drawn lobby and the tape), the `group_modes` row (one read for the
  // pool and the card, M15.5), the pool's cursor and when the last game landed; each falls back on
  // its own. Round two: every member, split and game (with its scoreboard) of those lobbies, and
  // the pool's games. Round three: the names and ratings of everybody they mention.
  const modeFacts = loadModeFacts(client, groupId ?? ORIGINAL_GROUP_ID);
  const fearlessRead = loadFearless(client, groupId, {
    modeState: modeFacts.then((facts) => facts.standing),
  });
  const lastGameAtRead = loadLastGameAt(client, groupId ?? ORIGINAL_GROUP_ID);
  // Started before the lobbies are awaited, and awaited below; if the lobbies read throws first,
  // these must not become unhandled rejections (side references, as the page's roster read does).
  for (const started of [modeFacts, fearlessRead, lastGameAtRead]) started.catch(() => undefined);
  const lobbies = await selectNightLobbies(client, nightStart, groupId);
  const lobbyRow = newestLobby(lobbies);
  const tapeLobbies = pickTapeLobbies(lobbies, nightStart, drawnLobbyId(lobbyRow));

  const [
    { lobby, tape },
    { mode, modeSince, ...fearless },
    { state: modeState, failed: modeReadFailed },
    lastGameAt,
  ] = await Promise.all([
    loadNight(client, lobbyRow, tapeLobbies, groupId, clock),
    fearlessRead,
    modeFacts,
    lastGameAtRead,
  ]);

  return {
    nightStart,
    nightLabel: options.nightLabel ?? formatNightLabel(options.nightStart, options.timeZone),
    nightClock: clock,
    lobby,
    fearless,
    mode,
    modeSince: modeSince ?? null,
    modeState: modeState ?? missingState(),
    modeReadFailed,
    lastGameAt,
    tape,
    // M14.66: companion tokens are not readable with the anon key; the page fills both on the
    // server (`withHostPresence`). Unknown reads as "a host is up", so no line is drawn.
    hostNames: [],
    hostSeenRecently: true,
  };
}

interface LobbyRow {
  id: string;
  status: LobbyView['status'];
  /** `Customs 09 Sep #1`, when the client reported one. Half of M4.10's line. */
  lobbyName: string | null;
  /** `lobbies.updated_at`: for an `in_game` row, when the game started (see {@link LobbyView.startedAt}). */
  updatedAt: string;
  created_at: string;
  /** The lock columns (M15.5), read with the row instead of a read of their own. */
  lock: LockRow;
  /** The kickoff record's columns (M21.4, 0046), read with the row too; parsed for `in_game` only. */
  kickoff: KickoffRow;
}

/**
 * Tonight's lobbies that are not `abandoned`, oldest first: **one read** for both the lobby the
 * page draws ({@link newestLobby}) and the tape's candidates ({@link pickTapeLobbies}), with the
 * name and the lock on the same rows. The name comes back with the row the page is already reading
 * (M4.10). The password does not: it is not readable with the anon key (M14.28, `0028`), and only
 * a linked member of the group is given it, by the page, from a service-role read
 * (`lib/tonight/lobbyPassword.ts`).
 */
async function selectNightLobbies(
  client: PublicClient,
  nightStart: string,
  groupId: string | undefined,
): Promise<LobbyRow[]> {
  let query = client
    .from('lobbies')
    .select(
      `id, status, lobby_name, updated_at, created_at, lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, lock_version, ${KICKOFF_COLUMNS}`,
    )
    .gte('created_at', nightStart)
    .neq('status', 'abandoned');
  if (groupId !== undefined) query = query.eq('group_id', groupId);
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`tonight: lobby lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    lobbyName: row.lobby_name,
    updatedAt: row.updated_at,
    created_at: row.created_at,
    lock: row,
    kickoff: row,
  }));
}

/**
 * The newest of tonight's lobbies.
 *
 * One row is one game cycle (M2.14), so a night has several and the page follows the newest:
 * when the group starts the next game, the result of the last one is replaced by the member
 * list filling up. That is the decision recorded on 2026-09-09, and it is why there is no
 * "last game" block on this page.
 */
export function newestLobby<T extends { created_at: string }>(rows: readonly T[]): T | null {
  let newest: T | null = null;
  for (const row of rows) {
    if (newest === null || Date.parse(row.created_at) >= Date.parse(newest.created_at)) newest = row;
  }
  return newest;
}

/** One `in (...)` read per {@link inChunks} list, all at once, rows concatenated (`414` otherwise). */
async function readIn<T>(
  ids: readonly string[],
  read: (chunk: string[]) => {
    range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
  what: string,
): Promise<T[]> {
  const chunks = await Promise.all(
    inChunks(ids).map(async (chunk) => {
      // And paged: PostgREST cuts any response at `max_rows` (1000) without saying so, and a busy
      // night's members or splits over ninety lobbies can pass it. The queries order on a unique
      // key, so pages neither overlap nor skip; one page is the usual case.
      const rows: T[] = [];
      for (let from = 0; ; from += READ_PAGE) {
        const { data, error } = await read(chunk).range(from, from + READ_PAGE - 1);
        if (error) throw new Error(`tonight: ${what} lookup failed: ${error.message}`);
        rows.push(...(data ?? []));
        if ((data ?? []).length < READ_PAGE) break;
      }
      return rows;
    }),
  );
  return chunks.flat();
}

/** PostgREST's `max_rows`: one page of {@link readIn}. */
const READ_PAGE = 1_000;

const MEMBER_COLUMNS = 'lobby_id, player_id, role_override, is_spectator, side, created_at';
const SPLIT_COLUMNS =
  'id, lobby_id, rank, blue, red, blue_win_prob, gap, off_role_count, score_parts, explanation, is_chosen, created_at';
/**
 * The game row (the mode alone, not the end-of-game blob), its rule stamp (M15.5, M15.19: the
 * columns of `GAME_STAMP_COLUMNS`) and its scoreboard, embedded, with the award's stat line (M11.3).
 */
const NIGHT_GAME_COLUMNS =
  'id, lobby_id, winning_side, started_at, duration_s, gameMode:game_mode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated, rule_checked, rule_check, game_players(player_id, side, role, kills, deaths, assists, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, damage_to_champs, r_before, r_after)' as const;

type NightGameRow = GameStampRow & {
  id: string;
  lobby_id: string | null;
  winning_side: number | null;
  started_at: string;
  game_players: GamePlayerRow[];
};

/**
 * The drawn lobby and the tape, in two more rounds: every member, split and game (with its
 * scoreboard embedded) of tonight's lobbies in one read each, then the names and ratings of
 * everybody those mention. An `open` lobby reads no split and no game, and only a `finished` one
 * reads its game, as before.
 */
async function loadNight(
  client: PublicClient,
  lobbyRow: LobbyRow | null,
  tapeLobbies: readonly TapeLobbyRow[],
  groupId: string | undefined,
  clock: NightClock,
): Promise<{ lobby: LobbyView | null; tape: TapeEntry[] }> {
  const current = lobbyRow;
  const tapeIds = tapeLobbies.map((lobby) => lobby.id);
  const memberIds = [...new Set([...(current === null ? [] : [current.id]), ...tapeIds])];
  if (memberIds.length === 0) return { lobby: null, tape: [] };
  const splitIds = [
    ...new Set([...(current !== null && current.status !== 'open' ? [current.id] : []), ...tapeIds]),
  ];
  const gameIds = [
    ...new Set([...(current !== null && current.status === 'finished' ? [current.id] : []), ...tapeIds]),
  ];

  const [memberRows, splitRows, gameRows] = await Promise.all([
    readIn(
      memberIds,
      (chunk) =>
        client
          .from('lobby_members')
          // `side` is the column M4.11 reads: where the client has each person right now, so the
          // page can tell whether the ten are already on the sides the split gave them.
          .select(MEMBER_COLUMNS)
          .in('lobby_id', chunk)
          .order('created_at', { ascending: true })
          .order('player_id', { ascending: true })
          .order('lobby_id', { ascending: true }),
      'member',
    ),
    readIn(
      splitIds,
      (chunk) =>
        client
          .from('splits')
          .select(SPLIT_COLUMNS)
          .in('lobby_id', chunk)
          .order('created_at', { ascending: false })
          .order('rank', { ascending: true })
          .order('id', { ascending: true }),
      'split',
    ),
    readIn(
      gameIds,
      (chunk) =>
        client
          .from('games')
          .select(NIGHT_GAME_COLUMNS)
          .in('lobby_id', chunk)
          .order('started_at', { ascending: false })
          .order('id', { ascending: true }),
      'game',
    ),
  ]);

  const currentMembers = current === null ? [] : memberRows.filter((row) => row.lobby_id === current.id);
  const currentGame =
    current !== null && current.status === 'finished'
      ? (gameRows.find((game) => game.lobby_id === current.id) ?? null)
      : null;
  const playerIds = [
    ...new Set([
      ...memberRows.map((row) => row.player_id),
      ...gameRows.flatMap((game) => game.game_players.map((row) => row.player_id)),
    ]),
  ];
  const stampCheckOf = currentGame === null ? null : stampCheck(currentGame.id, currentGame);
  const [players, ratings, checkNames] = await Promise.all([
    readNightPlayers(client, playerIds),
    loadRatings(
      client,
      currentMembers.map((row) => row.player_id),
      groupId,
    ),
    currentGame === null ? Promise.resolve({}) : loadCheckNames(client, currentGame.id, stampCheckOf),
  ]);

  const lobby =
    current === null
      ? null
      : buildLobby(current, {
          members: buildMembers(currentMembers, players, ratings),
          splits: splitRows.filter((row) => row.lobby_id === current.id),
          game:
            currentGame === null
              ? null
              : {
                  row: currentGame,
                  stamp: stampFromRow(currentGame, stampCheckOf, checkNames),
                },
          players,
        });

  const tapeSet = new Set(tapeIds);
  const tapeGames = gameRows.filter((game) => game.lobby_id !== null && tapeSet.has(game.lobby_id));
  const tape =
    tapeLobbies.length === 0
      ? []
      : assembleTape(
          {
            lobbies: tapeLobbies,
            games: tapeGames,
            gamePlayers: tapeGames.flatMap((game) =>
              game.game_players.map((row) => ({ ...row, game_id: game.id })),
            ),
            splits: splitRows.filter((row) => tapeSet.has(row.lobby_id) && row.is_chosen),
            members: memberRows.filter((row) => tapeSet.has(row.lobby_id)),
            players: new Map(
              [...players].map(([id, player]) => [id, { puuid: player.puuid, name: displayName(player) }]),
            ),
          },
          clock,
        );
  return { lobby, tape };
}

/** The drawn lobby from its rows. Pure. */
function buildLobby(
  lobby: LobbyRow,
  source: {
    members: MemberView[];
    splits: readonly SplitRow[];
    game: { row: NightGameRow; stamp: GameStampView } | null;
    players: ReadonlyMap<string, PlayerRow>;
  },
): LobbyView {
  const members = source.members;
  const byPuuid = new Map(members.map((member) => [member.puuid, member]));

  // `open` has no splits to read and no game to read, and the first paint of a filling lobby
  // is the one people wait on.
  const open = lobby.status === 'open';
  const teams = open ? null : buildTeams(source.splits, members, byPuuid);
  const game = source.game;
  const result =
    !open && lobby.status === 'finished' && game !== null
      ? (assembleResult(
          game.row,
          game.row.game_players,
          chosenSplitOf(source.splits),
          game.stamp,
          scoreboardOf(source.players, game.row.game_players),
          byPuuid,
        )?.result ?? null)
      : null;
  // M15.5: the mode locked at Roll, which the card shows while the teams are set or in game.
  const lock =
    !open && (lobby.status === 'balanced' || lobby.status === 'in_game')
      ? (lockFromRow(lobby.lock)?.lock ?? null)
      : null;
  // M21.5: in game, the teams that started (the kickoff record), or none and the page is as before.
  const record = lobby.status === 'in_game' ? readKickoff(lobby.kickoff, lobby.id) : null;
  const kickoff = record === null ? null : kickoffView(record, teams, members);

  return {
    id: lobby.id,
    status: lobby.status,
    lobbyName: lobby.lobbyName,
    // Never from this anon read (M14.28): the page fills it in for a linked member only.
    lobbyPassword: null,
    // M14.9: the timer's start. The `in_progress` post moves `updated_at` when it sets `in_game`,
    // and nothing else writes the row during a game but a lobby rename (`lib/lobbyState.ts`'s
    // sweep reads the same clock). Only meaningful in `in_game`, so only carried there.
    startedAt: lobby.status === 'in_game' ? lobby.updatedAt : null,
    members,
    teams,
    result,
    lock,
    kickoff,
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
 * **The rating is `loadGroupPool`'s rule, not a second one** (M18.2, M18.6): the group's
 * `ratings.r`, and 1200 when there is no row or the row has no `r` yet. That is what the balancer
 * read and what the Discord teams embed printed (`buildTeamsInput`), and a page that disagreed with
 * the embed by one point would be a ten-minute argument in voice. The rank guess is retired.
 */
function buildMembers(
  rows: readonly {
    player_id: string;
    role_override: RoleValue | null;
    is_spectator: boolean;
    side: number | null;
    created_at: string;
  }[],
  players: ReadonlyMap<string, PlayerRow>,
  ratings: ReadonlyMap<string, { r: number; games: number }>,
): MemberView[] {
  if (rows.length === 0) return [];

  const members: MemberView[] = [];
  for (const row of rows) {
    const player = players.get(row.player_id);
    // A member whose player row we cannot read is not a row we can draw: no name, no rating,
    // no puuid to key it on. It cannot happen through the foreign key; dropping it is still
    // better than a blank line in a list people count.
    if (player === undefined) continue;
    const rating = ratings.get(row.player_id) ?? { r: KUSTOM_START, games: 0 };

    members.push({
      puuid: player.puuid,
      name: displayName(player),
      mainRole: player.main_role,
      secondaryRole: player.secondary_role,
      roleOverride: row.role_override,
      isSpectator: row.is_spectator,
      joinedAt: row.created_at,
      rating: displayKustom(rating.r),
      // Rated games in this group (`ratings.games`), for the settling chip (M14.9). No row is a
      // player the fold has never rated here: 0.
      ratedGames: rating.games,
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
async function readNightPlayers(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerRow>> {
  const rows = await readIn(
    playerIds,
    (chunk) =>
      client
        .from('players_public')
        .select('id, puuid, display_name, game_name, main_role, secondary_role, rank_tier, rank_division')
        .in('id', chunk)
        .order('id', { ascending: true }),
    'player',
  );

  const players = new Map<string, PlayerRow>();
  for (const row of rows) {
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
  groupId: string | undefined,
): Promise<Map<string, { r: number; games: number }>> {
  const rows = await readIn(
    playerIds,
    (chunk) => {
      let query = client.from('ratings').select('player_id, r, games');
      // One rating per person per group (M13.3): with a group, that group's number and no other.
      if (groupId !== undefined) query = query.eq('group_id', groupId);
      return query.in('player_id', chunk).order('player_id', { ascending: true }).order('group_id');
    },
    'rating',
  );

  // `r` null: a row the Kustom fold has not written yet; 1200, as the balancer reads it (M18.2).
  return new Map(rows.map((row) => [row.player_id, { r: row.r ?? KUSTOM_START, games: row.games }]));
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
function buildTeams(
  rows: readonly SplitRow[],
  members: readonly MemberView[],
  byPuuid: ReadonlyMap<string, MemberView>,
): TeamsView | null {
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
  const run = rows.filter((row) => row.created_at === chosen.created_at);
  const splits: SplitChoice[] = run
    // `isChosen` is "the one this page is showing", so that the reroll control offers the
    // split after it. In the no-chosen-row window above they are the same thing anyway.
    .map((row) => ({ id: row.id, rank: row.rank, isChosen: row.id === chosen.id }));
  /**
   * The same run as the fairness receipt reads it (M14.9): every stored split with its numeric
   * columns and its parsed ten, best first. The receipt's numbers come from these columns and
   * M14.4's helpers only; `explanation` rides along to be printed verbatim, never parsed.
   */
  const stored: StoredSplit[] = run
    .map((row) =>
      receiptSplitFromRow({
        rank: row.rank,
        is_chosen: row.id === chosen.id,
        blue_win_prob: row.blue_win_prob,
        gap: row.gap,
        off_role_count: row.off_role_count,
        score_parts: row.score_parts,
        blue: readAssignments(row.blue),
        red: readAssignments(row.red),
        explanation: row.explanation,
      }),
    )
    .sort((a, b) => a.rank - b.rank);

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
    stored,
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

  const [rows, splitRoles, stamp] = await Promise.all([
    loadGamePlayers(client, game.id),
    lobbyId === null ? Promise.resolve(NO_SPLIT) : loadChosenSplit(client, lobbyId),
    // M15.5: the rule and rated stamp, for the poster's rule line. Never throws.
    loadGameStamp(client, game.id),
  ]);
  if (rows.length === 0) return null;

  const scoreboard = await scoreboardPlayers(
    client,
    rows.map((row) => row.player_id),
  );
  return assembleResult(game, rows, splitRoles, stamp, scoreboard, byPuuid);
}

type GamePlayerRow = Awaited<ReturnType<typeof loadGamePlayers>>[number];

/** {@link resultOfGame} from its rows. Pure; Tonight reads the rows with the rest of the night. */
function assembleResult(
  game: { id: string; duration_s: number; winning_side: number | null },
  rows: readonly GamePlayerRow[],
  splitRoles: ChosenSplit,
  stamp: GameStampView | null,
  scoreboard: ReadonlyMap<string, { puuid: string; name: PlayerName }>,
  byPuuid: ReadonlyMap<string, MemberView>,
): { result: ResultView; explanation: string | null } | null {
  if (game.winning_side !== 100 && game.winning_side !== 200) return null;
  if (rows.length === 0) return null;

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
      rBefore: row.r_before,
      rAfter: row.r_after,
    });

    if (row.damage_to_champs > 0 && (topDamage === null || row.damage_to_champs > topDamage.damage)) {
      topDamage = { name, damage: row.damage_to_champs };
    }
  }

  const winningSide = game.winning_side as SideValue;
  const rated = seats.length > 0 && seats.every((seat) => seat.rBefore !== null && seat.rAfter !== null);

  const result: ResultView = {
    gameId: game.id,
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
    stamp,
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
  return {
    mvp: names.get(award.mvp) ?? null,
    ace: names.get(award.ace) ?? null,
    mvpPuuid: award.mvp,
    acePuuid: award.ace,
  };
}

async function loadGamePlayers(client: PublicClient, gameId: string) {
  const { data, error } = await client
    .from('game_players')
    // The stat line is the award's input (M11.3): the columns the result post reads, all of
    // them publicly readable on the rows this key already sees.
    .select(
      'player_id, side, role, kills, deaths, assists, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, damage_to_champs, r_before, r_after',
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

/** One `splits` row as the night reads it ({@link SPLIT_COLUMNS}). */
interface SplitRow {
  id: string;
  lobby_id: string;
  rank: number;
  blue: unknown;
  red: unknown;
  blue_win_prob: number;
  gap: number;
  off_role_count: number;
  /** M18.13 (0045): jsonb, parsed by `receiptSplitFromRow`. Absent on rows a test builds by hand. */
  score_parts?: unknown;
  explanation: string;
  is_chosen: boolean;
  created_at: string;
}

/** {@link loadChosenSplit} from the lobby's split rows already read. Pure. */
function chosenSplitOf(rows: readonly SplitRow[]): ChosenSplit {
  const data = rows.find((row) => row.is_chosen);
  if (data === undefined) return NO_SPLIT;
  const roles = new Map<string, RoleValue>();
  for (const side of [data.blue, data.red]) {
    for (const assignment of readAssignments(side)) roles.set(assignment.puuid, assignment.role);
  }
  return { roles, blueWinProb: data.blue_win_prob, explanation: data.explanation };
}

/** {@link scoreboardPlayers} from the night's players already read. Pure. */
function scoreboardOf(
  players: ReadonlyMap<string, PlayerRow>,
  rows: readonly { player_id: string }[],
): Map<string, { puuid: string; name: PlayerName }> {
  const out = new Map<string, { puuid: string; name: PlayerName }>();
  for (const row of rows) {
    const player = players.get(row.player_id);
    if (player !== undefined) out.set(row.player_id, { puuid: player.puuid, name: displayName(player) });
  }
  return out;
}

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

/** One `game_players` row as the tape reads it. */
export interface TapeGamePlayer {
  game_id: string;
  r_before: number | null;
  r_after: number | null;
  player_id?: string;
  side?: number | null;
  role?: RoleValue | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  gold?: number;
  cs?: number;
  vision_score?: number | null;
  damage_self_mitigated?: number | null;
  damage_to_objectives?: number | null;
  damage_to_champs?: number;
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
    /** M15.19: the rule columns (`0032`); absent in older fixtures, read as no rule. */
    rule?: string | null;
    rule_class_tag?: string | null;
    rule_region_blue?: string | null;
    rule_region_red?: string | null;
    rule_checked?: boolean;
  }[];
  /**
   * The scoreboard rows. `r_*` decide `rated`; the stat line (optional, M14.9) is the MVP's input,
   * the same columns `resultOfGame` hands `gatedGameAward`. A row without it gives no MVP.
   */
  gamePlayers: readonly TapeGamePlayer[];
  splits: readonly {
    lobby_id: string;
    blue: unknown;
    red: unknown;
    blue_win_prob: number | null;
    /** M14.9: `pick #2` on the tile after a reroll. Absent reads as no pick number. */
    rank?: number | null;
  }[];
  members: readonly { lobby_id: string; player_id: string; created_at: string }[];
  players: ReadonlyMap<string, { puuid: string; name: PlayerName }>;
}

/**
 * The tape's rows from its rows. Pure, so the acceptance fixtures are unit tests.
 *
 * - **Result** is the lobby's newest game with a winner — `loadResult`'s pick — and `rated` is
 *   its rule, every scoreboard row carrying both all-time Ratings (`r_before`, `r_after`).
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

  const rowsByGame = new Map<string, TapeGamePlayer[]>();
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
              rated: rows.length > 0 && rows.every((row) => row.r_before !== null && row.r_after !== null),
              mvp: tapeMvp(rows, game, source.players),
              rule: tapeRule(game),
            },
      blueWinProb: split?.blue_win_prob ?? null,
      rank: split?.rank ?? null,
      sitters: split === undefined ? [] : tapeSitters(lobby.id, split, source),
    };
  });
}

/**
 * The rule a tape game was played under (M15.19), named only when the game was checked against it
 * (`rule_checked`: a Rift game past the remake line), so a remake or ARAM under a rule is not
 * called a tanks game. Null for a standing-mode game or unreadable columns.
 */
function tapeRule(game: TapeSource['games'][number]): Mode | null {
  if (game.rule_checked !== true) return null;
  return ruleModeOf({
    rule: game.rule ?? null,
    classTag: game.rule_class_tag ?? null,
    regionBlue: game.rule_region_blue ?? null,
    regionRed: game.rule_region_red ?? null,
  });
}

/**
 * The tile's MVP (M14.9): `gatedGameAward` over the game's scoreboard, the one function that names
 * an MVP (the poster and the result post call it on the same columns). Only for a rated game whose
 * every row carries its stat line and a known puuid; anything else is no MVP, never a guess.
 */
function tapeMvp(
  rows: readonly TapeGamePlayer[],
  game: { duration_s: number; winning_side: number | null },
  players: TapeSource['players'],
): PlayerName {
  if (game.winning_side !== 100 && game.winning_side !== 200) return null;
  if (rows.length === 0 || rows.some((row) => row.r_before === null || row.r_after === null)) return null;
  const ten: FoldAwardPlayer[] = [];
  const names = new Map<string, PlayerName>();
  for (const row of rows) {
    const player = row.player_id === undefined ? undefined : players.get(row.player_id);
    if (
      player === undefined ||
      (row.side !== 100 && row.side !== 200) ||
      row.kills === undefined ||
      row.deaths === undefined ||
      row.assists === undefined ||
      row.gold === undefined ||
      row.cs === undefined ||
      row.damage_to_champs === undefined
    ) {
      return null;
    }
    names.set(player.puuid, player.name);
    ten.push({
      puuid: player.puuid,
      side: row.side,
      role: row.role ?? null,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      damageToChamps: row.damage_to_champs,
      gold: row.gold,
      cs: row.cs,
      visionScore: row.vision_score ?? null,
      damageSelfMitigated: row.damage_self_mitigated ?? null,
      damageToObjectives: row.damage_to_objectives ?? null,
    });
  }
  const award = gatedGameAward(ten, game.duration_s, game.winning_side);
  return award === null ? null : (names.get(award.mvp) ?? null);
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
