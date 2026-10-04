import { type BalancePlayer, balance, config, type Duo, type Split } from '@customs/core';
import { type Json, rosterKey, type SplitInsert } from '@customs/db';
import { invalidateGroup } from '../cache/tags';
import { NAMELESS_PLAYER } from '../discord/embeds';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';
import { KUSTOM_FRESH, type KustomState } from './fold';
import type { LobbyBalancedEvent } from './hooks';
import { type PoolMember, planSeats, selectTen } from './selection';

/**
 * The balance step (M2.5): everyone around, the ten who play, `balance()` from
 * `@customs/core`, and the three `splits` rows.
 *
 * No balancing maths lives here and none ever will — `packages/core` is the only place that
 * decides who plays with whom. This file is the I/O and the policy around that call: which
 * ten, rated from what, and what gets written down.
 *
 * **The balancer reads what the fold reads** (M18.2, M18.5): each player's all-time Kustom
 * Rating `ratings.r` and their rated-games count, and 1200 and 0 for somebody with no row in the
 * group, exactly as the fold starts them. So for a roster unchanged since the roll and no game
 * folded in between, the split's stored `blue_win_prob` is the fold's blue `fold_p`.
 */

/** How far back the sit-out lookup reads. A player who has not sat out in this many games. */
const SIT_OUT_HISTORY_GAMES = 400;

/**
 * How many of the group's most recent games the fill lookup reads, to find twenty of *one*
 * player's inside them.
 *
 * It is a bound, not the window: the window is `config.roles.inferenceWindow` games **per
 * player** (M7.6), counted inside this slice. Truncating here can only lose a fill older than
 * this many group games, which reads as `null` — the flat penalty, the documented baseline —
 * and can never move a player's distance to a wrong number, because the count runs newest
 * first and only older rows fall off the end.
 */
const FILL_HISTORY_GAMES = 200;

export interface BalanceOutcome extends LobbyBalancedEvent {
  /** All three splits, best first, as core returned them. `splits.rank` is the index plus one. */
  splits: Split[];
}

export async function balanceLobby(
  client: ServiceClient,
  lobby: { id: string; lobbyName: string | null; lobbyPassword: string | null },
  now: Date,
  timeZone: string,
): Promise<BalanceOutcome> {
  // The lobby's own group (M13.3), read off the row rather than trusted from a caller: the
  // balancer is fed that group's ratings and remembers that group's splits, nobody else's.
  const groupId = await lobbyGroupId(client, lobby.id);
  const pool = await loadGroupPool(client, lobby.id, now, timeZone, groupId);
  const selection = selectTen(pool);

  const key = rosterKey(selection.playing.map((member) => member.puuid));
  const [lastSplit, recentTeammates] = await Promise.all([
    selectLastSplit(client, key, groupId),
    loadRecentTeammates(client, groupId, now, timeZone),
  ]);

  const result = balance({
    players: selection.playing.map(toBalancePlayer),
    // Duo locks have no source yet: no UI, no column. They land with M3.6 at the earliest,
    // and this is the one line that changes the day they exist.
    duos: [],
    lastSplit,
    // M18.13: teammate variety's input. Core ignores a pair naming someone outside the ten.
    recentTeammates,
  });

  const chosen = result.splits[0];
  const explanation = result.explanations[0];
  if (chosen === undefined || explanation === undefined) {
    throw new Error('balanceLobby: core returned no splits');
  }

  const splitId = await storeSplits(client, lobby.id, key, result.splits, result.explanations);
  // A lobby that already played keeps its games, whose chosen split just changed (app-perf).
  invalidateGroup(groupId, ['games']);

  return {
    lobbyId: lobby.id,
    groupId,
    splitId,
    rosterKey: key,
    split: chosen,
    splits: result.splits,
    explanation,
    lobbyName: lobby.lobbyName,
    lobbyPassword: lobby.lobbyPassword,
    sitters: selection.sitters,
    seatMoves: planSeats(selection),
    tiedOnGames: selection.tiedOnGames,
    playing: selection.playing,
  };
}

/** Exported for the test that pins M1.4's worked example to this mapping, and nothing else. */
export function toBalancePlayer(member: PoolMember): BalancePlayer {
  return {
    puuid: member.puuid,
    name: member.name,
    r: member.r,
    n: member.n,
    mainRole: member.mainRole,
    secondaryRole: member.secondaryRole,
    roleOverride: member.roleOverride,
    // M7.6: fill protection's one input. `null` — never filled, no history, or the read failed
    // — is the flat `offRolePenalty`, which is M1.4's behaviour unchanged.
    gamesSinceLastFill: member.gamesSinceLastFill ?? null,
  };
}

/** The group a lobby belongs to (M13.3). Throws for a lobby that does not exist. */
export async function lobbyGroupId(client: ServiceClient, lobbyId: string): Promise<string> {
  const { data, error } = await client.from('lobbies').select('group_id').eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`balanceLobby: lobby group lookup failed: ${error.message}`);
  if (!data) throw new Error(`balanceLobby: no lobby ${lobbyId}`);
  return data.group_id;
}

/**
 * Everyone around, with their rating in the lobby's group and their place in the rotation.
 *
 * **No `ratings` row means 1200 and 0, and write nothing** (M18.2: the rank guess is retired;
 * rank stays on the roster as information). Rows are written by the rating fold and by nothing
 * else. A row the Kustom fold has not written yet (`r` null, an OpenSkill-era row before the
 * switch's rebuild) is 1200 with its count, which is what the live fold would fold it from.
 */
export async function loadGroupPool(
  client: ServiceClient,
  lobbyId: string,
  now: Date,
  timeZone: string,
  /**
   * The lobby's group (M13.3): whose `ratings` are read. A person with no row in this group is
   * 1200 and 0, like somebody new, whatever they are rated in another group.
   */
  groupId: string,
): Promise<PoolMember[]> {
  const [{ data, error }, host] = await Promise.all([
    client
      .from('lobby_members')
      .select(
        'player_id, side, is_spectator, role_override, players!inner(puuid, display_name, game_name, main_role, secondary_role)',
      )
      .eq('lobby_id', lobbyId),
    lobbyHost(client, lobbyId),
  ]);
  if (error) throw new Error(`balanceLobby: member select failed: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const playerIds = rows.map((row) => row.player_id);
  const ratings = await selectRatings(client, playerIds, groupId);
  // Two independent reads, in parallel, and note that only one of them has an early return:
  // `loadRotation` skips its work at ten or fewer because nobody sits, but fill protection is
  // exactly what matters at ten, where somebody has to take the empty seat (M7.6).
  const [rotation, fills] = await Promise.all([
    loadRotation(client, playerIds, now, timeZone, groupId),
    loadFills(client, playerIds),
  ]);

  return rows.map((row) => {
    const player = row.players;
    const rating = ratings.get(row.player_id) ?? KUSTOM_FRESH;

    return {
      playerId: row.player_id,
      puuid: player.puuid,
      // M3.10's one word, and it is the same word here as on every screen (M3.15): core
      // writes this name into `splits.explanation`, which the embed and the tonight page
      // print verbatim and may never recompose. A stored sentence saying `Unknown` beside a
      // rendered line saying `Someone` is one message contradicting itself about one player.
      name: player.display_name ?? player.game_name ?? NAMELESS_PLAYER,
      side: row.side === 100 || row.side === 200 ? row.side : null,
      isSpectator: row.is_spectator,
      mainRole: player.main_role,
      secondaryRole: player.secondary_role,
      roleOverride: row.role_override,
      r: rating.r,
      n: rating.n,
      gamesTonight: rotation.gamesTonight.get(row.player_id) ?? 0,
      lastSitOutAt: rotation.lastSitOutAt.get(row.player_id) ?? null,
      gamesSinceLastFill: fills.get(row.player_id) ?? null,
      isHost: host !== null && row.player_id === host,
    };
  });
}

/**
 * The player whose companion hosts the lobby (M14.43): `lobbies.reported_by_player_id`, the first
 * companion to report the party -- the token decides who that is, never a payload. `null` when the
 * row has none. `selectTen` never seats this player out.
 */
async function lobbyHost(client: ServiceClient, lobbyId: string): Promise<string | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('reported_by_player_id')
    .eq('id', lobbyId)
    .maybeSingle();
  if (error) throw new Error(`balanceLobby: lobby host lookup failed: ${error.message}`);
  return data?.reported_by_player_id ?? null;
}

async function selectRatings(
  client: ServiceClient,
  playerIds: readonly string[],
  groupId: string,
): Promise<Map<string, KustomState>> {
  const { data, error } = await client
    .from('ratings')
    .select('player_id, r, games')
    .eq('group_id', groupId)
    .in('player_id', playerIds);
  if (error) throw new Error(`balanceLobby: ratings select failed: ${error.message}`);

  // The fold's own starting rule (`rating.ts`): `r`, or 1200 on a row it has not written yet.
  const ratings = new Map<string, KustomState>();
  for (const row of data ?? []) {
    ratings.set(row.player_id, { r: row.r ?? KUSTOM_FRESH.r, n: row.games });
  }
  return ratings;
}

interface Rotation {
  gamesTonight: Map<string, number>;
  lastSitOutAt: Map<string, number>;
}

/**
 * The two numbers the rotation is ordered on, for the people who are around, **in the lobby's group
 * only** (M14.43, scene-walk gap 10; was every group's games). One group's games never move another
 * group's rotation: a busy group no longer pushes a quiet group's sit-outs out of the window, and a
 * game played in another group tonight does not count towards this group's "games tonight".
 *
 * - **Games tonight**: `game_players` joined to `games` since 06:00 local (`night.ts`).
 * - **A sit-out** needs no table and gets no column: it is a `lobby_members` row of a lobby
 *   that reached `in_game` or `finished` with no `game_players` row for that lobby's game.
 *   The most recent such game's `started_at` is the player's last sit-out.
 *
 * Only asked when more than ten are around, because with exactly ten nobody sits and the
 * order does not matter. Bounded by the last few hundred games, so a player who has not sat
 * out in a year reads the same as one who never has — which is what the comparator wants
 * anyway.
 */
async function loadRotation(
  client: ServiceClient,
  playerIds: readonly string[],
  now: Date,
  timeZone: string,
  groupId: string,
): Promise<Rotation> {
  const empty: Rotation = { gamesTonight: new Map(), lastSitOutAt: new Map() };
  if (playerIds.length <= 10) return empty;

  const since = nightStart(now, timeZone).toISOString();

  const [tonight, recent] = await Promise.all([
    client
      .from('game_players')
      .select('player_id, games!inner(started_at)')
      .eq('group_id', groupId)
      .in('player_id', playerIds)
      .gte('games.started_at', since),
    client
      .from('games')
      .select('id, lobby_id, started_at')
      .eq('group_id', groupId)
      .not('lobby_id', 'is', null)
      .order('started_at', { ascending: false })
      .limit(SIT_OUT_HISTORY_GAMES),
  ]);

  if (tonight.error) throw new Error(`balanceLobby: games tonight failed: ${tonight.error.message}`);
  if (recent.error) throw new Error(`balanceLobby: recent games failed: ${recent.error.message}`);

  const gamesTonight = new Map<string, number>();
  for (const row of tonight.data ?? []) {
    gamesTonight.set(row.player_id, (gamesTonight.get(row.player_id) ?? 0) + 1);
  }

  const games = recent.data ?? [];
  const lobbyIds = [...new Set(games.map((game) => game.lobby_id).filter((id): id is string => id !== null))];
  if (lobbyIds.length === 0) return { gamesTonight, lastSitOutAt: new Map() };

  // Chunked (M14.43): 400 uuids in one `in.(...)` filter is a URL PostgREST refuses ("URI too long"),
  // which a group with a few hundred lobby games reaches.
  const [members, played] = await Promise.all([
    readInChunks(lobbyIds, (chunk) =>
      client
        .from('lobby_members')
        .select('lobby_id, player_id')
        .in('lobby_id', chunk)
        .in('player_id', playerIds),
    ),
    readInChunks(
      games.map((game) => game.id),
      (chunk) =>
        client
          .from('game_players')
          .select('game_id, player_id')
          .in('game_id', chunk)
          .in('player_id', playerIds),
    ),
  ]);

  if (members.error) throw new Error(`balanceLobby: sit-out members failed: ${members.error}`);
  if (played.error) throw new Error(`balanceLobby: sit-out participants failed: ${played.error}`);

  const inLobby = new Map<string, Set<string>>();
  for (const row of members.data ?? []) {
    const set = inLobby.get(row.lobby_id) ?? new Set<string>();
    set.add(row.player_id);
    inLobby.set(row.lobby_id, set);
  }
  const inGame = new Map<string, Set<string>>();
  for (const row of played.data ?? []) {
    const set = inGame.get(row.game_id) ?? new Set<string>();
    set.add(row.player_id);
    inGame.set(row.game_id, set);
  }

  const lastSitOutAt = new Map<string, number>();
  for (const game of games) {
    const startedAt = Date.parse(game.started_at);
    if (Number.isNaN(startedAt) || game.lobby_id === null) continue;
    const around = inLobby.get(game.lobby_id);
    if (!around) continue;
    const players = inGame.get(game.id) ?? new Set<string>();
    for (const playerId of around) {
      if (players.has(playerId)) continue;
      const previous = lastSitOutAt.get(playerId);
      if (previous === undefined || startedAt > previous) lastSitOutAt.set(playerId, startedAt);
    }
  }

  return { gamesTonight, lastSitOutAt };
}

/** How many ids go into one `in.(...)` filter: 100 uuids is about 3.7 KB of URL. */
const ID_CHUNK = 100;

/** One select per chunk of `ids`, rows concatenated; the first error stops it. */
async function readInChunks<T>(
  ids: readonly string[],
  select: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const data: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const { data: rows, error } = await select(ids.slice(start, start + ID_CHUNK));
    if (error) return { data, error: error.message };
    data.push(...(rows ?? []));
  }
  return { data, error: null };
}

/** One player's row in one game, as the fill lookup reads it. */
export interface FillGame {
  playerId: string;
  /** `game_players.counts_for_role_inference` (M5.17): `false` is "the balancer filled them". */
  countsForRoleInference: boolean;
}

/**
 * How many games ago each player was last filled, from their games **newest first**.
 *
 * `0` is "their last game was a fill". A player with no fill in the window is absent from the
 * map, which the caller reads as `null`: never filled, as far as we can see, so the flat
 * penalty. Pure, so the walk can be tested without a stack; the query is `loadFills`.
 *
 * Only the first `window` rows of each player are looked at — `config.roles.inferenceWindow`,
 * the same number role inference uses, over the same rated universe, so the two numbers rest on
 * the same kind of history. **Not literally the same twenty rows**: `inferRoles` drops filled
 * and null-role games before it slices its twenty, while this walk has to keep the filled ones
 * — they are the thing it is counting.
 */
export function fillDistances(
  rows: readonly FillGame[],
  window: number = config.roles.inferenceWindow,
): Map<string, number> {
  const distance = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const row of rows) {
    if (distance.has(row.playerId)) continue;
    const behind = seen.get(row.playerId) ?? 0;
    if (behind >= window) continue;
    if (!row.countsForRoleInference) distance.set(row.playerId, behind);
    seen.set(row.playerId, behind + 1);
  }

  return distance;
}

/**
 * Fill protection's input (M7.6): `gamesSinceLastFill` per player, and no column anywhere —
 * `game_players.counts_for_role_inference` already records exactly this, written at fold time
 * for precisely the players the balancer put on a role that was neither their main nor
 * tonight's tap (`roles.ts` says why that is the only moment it is knowable).
 *
 * **Rated games only** (`r_after is not null`, the all-time Kustom fold's mark), which is both the fold's universe and role
 * inference's. A remake or an ARAM (M7.1) never rated, so it never carried a flag, and it is
 * neither a fill nor a step away from one: it is not in the window at all. A backfilled game
 * and a game from a lobby whose split we could not read are `true` by the column's default —
 * we did not choose those seats, so nobody was filled.
 *
 * **One read, for every lobby size.** Ordered newest first at the `games` level, because
 * `game_players` carries no timestamp, and bounded by `FILL_HISTORY_GAMES`.
 *
 * **A failure is not an error.** The lobby still balances, with `null` for everybody: a
 * balancer that refuses to split because it cannot remember last night is worse than a flat
 * penalty.
 */
async function loadFills(client: ServiceClient, playerIds: readonly string[]): Promise<Map<string, number>> {
  if (playerIds.length === 0) return new Map();

  const { data, error } = await client
    .from('games')
    .select('id, started_at, game_players!inner(player_id, r_after, counts_for_role_inference)')
    .in('game_players.player_id', playerIds)
    .not('game_players.r_after', 'is', null)
    .order('started_at', { ascending: false })
    // A second key, so two games stamped the same instant are read in one fixed order.
    .order('id', { ascending: false })
    .limit(FILL_HISTORY_GAMES);

  if (error) {
    console.warn(`balanceLobby: fill history read failed, no protection this split: ${error.message}`);
    return new Map();
  }

  const wanted = new Set(playerIds);
  const rows: FillGame[] = [];
  for (const game of data ?? []) {
    for (const row of game.game_players) {
      if (!wanted.has(row.player_id)) continue;
      rows.push({ playerId: row.player_id, countsForRoleInference: row.counts_for_role_inference });
    }
  }

  return fillDistances(rows);
}

/** One game's ten, as the variety lookup reads them: puuid and side. */
export interface TeammateGame {
  players: readonly { puuid: string; side: number }[];
}

/**
 * Every pair of teammates in `games` (M18.13), each pair once, sorted inside and across, so the
 * same games always give the same list. A pair that shared a side in two of the games still
 * counts once (`config.balance.varietyWindowGames`). Pure; the query is `loadRecentTeammates`.
 */
export function teammatePairs(games: readonly TeammateGame[]): Duo[] {
  const seen = new Set<string>();
  const pairs: Duo[] = [];
  for (const game of games) {
    const bySide = new Map<number, string[]>();
    for (const player of game.players) {
      const side = bySide.get(player.side) ?? [];
      side.push(player.puuid);
      bySide.set(player.side, side);
    }
    for (const side of bySide.values()) {
      const puuids = [...new Set(side)].sort();
      for (let i = 0; i < puuids.length; i += 1) {
        for (let j = i + 1; j < puuids.length; j += 1) {
          const a = puuids[i] as string;
          const b = puuids[j] as string;
          const id = `${a}\u0000${b}`;
          if (seen.has(id)) continue;
          seen.add(id);
          pairs.push([a, b]);
        }
      }
    }
  }
  return pairs.sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
}

/**
 * Teammate variety's input (M18.13): the teammates of **the night's previous game in this group**
 * (`config.balance.varietyWindowGames` games, newest first, started since 06:00 local and not
 * after `now`). The first roll of a night has none, so no variety term. Any game counts, rated
 * or not, with or without a lobby: the complaint is "the same teammates again", whatever the
 * last game was. Puuids only.
 *
 * **A failure is not an error**, like fill protection: the lobby balances with no variety term.
 */
export async function loadRecentTeammates(
  client: ServiceClient,
  groupId: string,
  now: Date,
  timeZone: string,
): Promise<Duo[]> {
  const window = config.balance.varietyWindowGames;
  if (window <= 0) return [];

  const { data, error } = await client
    .from('games')
    .select('id, started_at, game_players(side, players!inner(puuid))')
    .eq('group_id', groupId)
    .gte('started_at', nightStart(now, timeZone).toISOString())
    .lte('started_at', now.toISOString())
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(window);

  if (error) {
    console.warn(`balanceLobby: recent teammates read failed, no variety this split: ${error.message}`);
    return [];
  }

  return teammatePairs(
    (data ?? []).map((game) => ({
      players: game.game_players.map((row) => ({ puuid: row.players.puuid, side: row.side })),
    })),
  );
}

/**
 * M2.7's lookup: the newest chosen split for exactly these ten, whatever night it was, and
 * the five puuids of its blue side. `null` when these ten have never been split before.
 *
 * `roster_key` is why this is one indexed lookup rather than a jsonb set comparison, and why
 * changing one player makes it `null` without any extra rule.
 *
 * **Among this group's lobbies only** (M13.3): the same ten in another group are another
 * group's history, and its split must not decide this group's repeat penalty.
 */
export async function selectLastSplit(
  client: ServiceClient,
  key: string,
  groupId: string,
): Promise<readonly string[] | null> {
  const { data, error } = await client
    .from('splits')
    .select('blue, lobbies!inner(group_id)')
    .eq('roster_key', key)
    .eq('lobbies.group_id', groupId)
    .eq('is_chosen', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`balanceLobby: lastSplit lookup failed: ${error.message}`);
  if (!data) return null;

  const blue = data.blue;
  if (!Array.isArray(blue)) return null;

  const puuids = blue
    .map((entry) =>
      typeof entry === 'object' && entry !== null && 'puuid' in entry
        ? String((entry as { puuid: unknown }).puuid)
        : '',
    )
    .filter((puuid) => puuid.length > 0);

  // Core refuses a `lastSplit` that is not five of tonight's ten, and a stored split we
  // cannot read five names out of is not worth failing a balance over.
  return puuids.length === 5 ? puuids : null;
}

/**
 * The three splits, in one insert, with `is_chosen` on rank 1 only.
 *
 * A rebalance must clear `is_chosen` on this lobby's earlier splits first:
 * `splits_one_chosen_per_lobby_idx` allows exactly one chosen row per lobby and would reject
 * the insert otherwise. The old rows stay — they are history, and `roster_key` keeps them
 * findable — only the flag moves. PostgREST has no transaction, so this is two statements;
 * between them the lobby has no chosen split, and the next post would notice and rebalance.
 */
async function storeSplits(
  client: ServiceClient,
  lobbyId: string,
  key: string,
  splits: readonly Split[],
  explanations: readonly string[],
): Promise<string> {
  const { error: clearError } = await client
    .from('splits')
    .update({ is_chosen: false })
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true);
  if (clearError) throw new Error(`balanceLobby: clearing is_chosen failed: ${clearError.message}`);

  const rows: SplitInsert[] = splits.map((split, index) => ({
    lobby_id: lobbyId,
    rank: index + 1,
    blue: split.blue as unknown as Json,
    red: split.red as unknown as Json,
    gap: split.gap,
    blue_win_prob: split.blueWinProb,
    // M18.4/M18.5: these odds are Kustom's `winProbability`; the calibration line counts only these.
    odds_model: 'kustom',
    score: split.score,
    off_role_count: split.offRoleCount,
    is_chosen: index === 0,
    // Verbatim from core. The embed and the tonight page render this string; they never
    // recompose it from the numbers beside it.
    explanation: explanations[index] ?? '',
    roster_key: key,
    // M18.13 (0045): every term of `score`, so the receipt can name why a split ranked lower.
    score_parts: (split.scoreParts ?? null) as unknown as Json,
  }));

  const { data, error } = await client.from('splits').insert(rows).select('id, rank');
  if (error) throw new Error(`balanceLobby: split insert failed: ${error.message}`);

  const chosen = (data ?? []).find((row) => row.rank === 1);
  if (!chosen) throw new Error('balanceLobby: the chosen split did not come back from the insert');
  return chosen.id;
}
