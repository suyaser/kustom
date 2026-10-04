import type { RecordedGame, RecordedGameKind } from '@customs/core';
import {
  type CompanionGameEogPayload,
  type CompanionGameEogPayloadWithWinner,
  type GameInsert,
  type GamePlayerInsert,
  type Json,
  scrubRawEogBlock,
} from '@customs/db';
import { invalidateGroup } from '../cache/invalidate';
import { MIN_RATED_DURATION_S } from '../lobbyRules';
import { championTable } from '../mode/champions';
import { readLobbyLock } from '../mode/lock';
import { recordedGame, stampColumns } from '../mode/record';
import { supabaseModeStore } from '../mode/state';
import { mergeDraftBans, rawFactsFromUnknown } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';
import { isRatedMode } from './fold';
import { selectLatestLobby } from './lobby';
import { BACKFILL_MIN_MEMBERS, countMembersByPuuid, ensureMemberships } from './memberships';
import { ensurePlayers } from './players';
import { storedStat } from './statValue';

/**
 * Game ingest from an end-of-game block, live (`source: 'eog'`) or walked out of match history
 * months later (`source: 'backfill'`, M5.1). One writer, because the row is the same row: the
 * differences are that a backfilled game is linked to no lobby and is not rated inline, and
 * both of those are decided by the caller and the two lines below.
 *
 * Deliberately not here: `rateGame` and the `ratings` update (`rating.ts`) and moving the lobby
 * to `finished` (`lobbyState.ts`, from the game route). This writes `games` and `game_players`
 * and keeps the whole block in `games.raw`, which is what every later column can be recomputed
 * from — including a rebuild (M5.2) that replays the fold from scratch.
 *
 * Idempotency is on `lcu_game_id`: two companions in the same game both post, and the second
 * post does not replace the row. A later match-history post may copy `teams[].bans` onto a
 * live eog block that never stored them — that list only, nothing else.
 */

/** The only `gameType` we ingest. Anything else is not our night (`M2.5`). */
export const CUSTOM_GAME_TYPE = 'CUSTOM_GAME';

export function isCustomGame(payload: CompanionGameEogPayload): boolean {
  return payload.gameType === CUSTOM_GAME_TYPE;
}

/**
 * A companion may only report a game it played in (`docs/01-architecture.md` "Security").
 * The token says who the caller is; this asks whether that player is on the scoreboard.
 *
 * The architecture doc phrases this as "the block's `localPlayer` must match the token's
 * player". The companion flattens the block before posting, so there is no `localPlayer`
 * field to compare; membership of `participants` is the same check against one fewer
 * claimed field. See `04-decisions.md`.
 */
export function isParticipant(payload: CompanionGameEogPayload, puuid: string): boolean {
  return payload.participants.some((participant) => participant.puuid === puuid);
}

/** The first PUUID that appears twice on the scoreboard, or null. */
export function findDuplicateParticipant(payload: CompanionGameEogPayload): string | null {
  const seen = new Set<string>();
  for (const participant of payload.participants) {
    if (seen.has(participant.puuid)) return participant.puuid;
    seen.add(participant.puuid);
  }
  return null;
}

export interface GameIngestResult {
  outcome: 'stored';
  gameId: string;
  lobbyId: string | null;
  /** The group the game belongs to: its lobby's, or the posting token's when it has none (M13.3). */
  groupId: string;
  /** False when this `lcu_game_id` was already stored — the idempotent case. */
  created: boolean;
  /**
   * True when the game was already stored **in another group** than the posting token's (M13.3).
   * Such a post is a no-op: nothing is written, no fold runs, no lobby moves. A game belongs to
   * exactly one group, and ingest dedupe stays global (decision row 2026-10-03).
   */
  foreignDuplicate: boolean;
  /** Rows in `game_players` for this game after the write. */
  participants: number;
  /**
   * The game as the mode lifecycle sees it (M15.3): its kind and its lobby's lock at Roll, for the
   * compare-and-clear the route runs after the fold (`clearAfterRecord`).
   */
  modeRecord: RecordedGame;
}

/**
 * A backfilled game that is not this group's (M13.3): fewer than {@link BACKFILL_MIN_MEMBERS}
 * of its players are members of the token's group. Nothing is written; the next daily scan
 * offers it again, by which time more of them may have joined.
 */
export interface GameSkippedNotThisGroup {
  outcome: 'skipped-not-this-group';
  /** How many of the ten were members of the token's group. */
  members: number;
}

export type GameIngestOutcome = GameIngestResult | GameSkippedNotThisGroup;

export interface GameIngestOptions {
  /** The posting token's group (`CompanionIdentity.groupId`). */
  groupId: string;
}

/**
 * Which group a game lands in (M13.3, decision rows 2026-10-03):
 *
 * - an `lcu_game_id` already stored **anywhere** keeps its group and its row -- a second post is
 *   the usual idempotent no-op, and from another group's token it writes nothing at all;
 * - a live game takes **its lobby's group**, whoever's companion posts it: the lobby went to the
 *   group whose companion saw the party first, and the game that came out of it follows;
 * - a game with no lobby takes **the token's group**;
 * - a **backfilled** game (no lobby by definition) is stored in the token's group only when at
 *   least {@link BACKFILL_MIN_MEMBERS} of its players are already members there, and is
 *   otherwise skipped (`skipped-not-this-group`).
 *
 * Every player of a game stored here becomes a `member` of the game's group (playing is joining).
 */
export async function ingestEogGame(
  client: ServiceClient,
  payload: CompanionGameEogPayloadWithWinner,
  options: GameIngestOptions,
): Promise<GameIngestOutcome> {
  // A backfilled game belongs to no lobby (M5.1). The contract says the body carries no
  // `partyId` at all, and this is the belt to that braces: a months-old game must never be
  // linked to a lobby cycle the party id happens to still match, and `games.lobby_id` being
  // null is already a rated-eligible state (M2.5).
  const lobby =
    payload.source === 'backfill'
      ? null
      : await findLobby(client, payload.partyId ?? null, payload.startedAt);
  const lobbyId = lobby?.id ?? null;
  const groupId = lobby?.groupId ?? options.groupId;

  // The six-of-ten rule only decides where a **new** game goes; an id already stored anywhere is
  // the usual no-op below and is not counted against anybody.
  if (payload.source === 'backfill' && (await findGame(client, payload.gameId)) === null) {
    const members = await countMembersByPuuid(
      client,
      options.groupId,
      payload.participants.map((participant) => participant.puuid),
    );
    if (members < BACKFILL_MIN_MEMBERS) {
      return { outcome: 'skipped-not-this-group', members };
    }
  }

  // The mode stamp (M15.3, R2): the lobby's lock taken at Roll, not the card at record time, so a
  // mid-game switch never changes the game being played. A game with no lock takes the standing
  // mode at its default. Computed on every post; a duplicate's insert is ignored, so the stored
  // stamp is the first write's.
  const kind = recordedKind(payload);
  const lock = lobbyId === null ? null : await readLobbyLock(client, lobbyId);
  const modeColumns = stampColumns({
    kind,
    lock,
    state: (await supabaseModeStore(client).read(groupId)).state,
    seats: payload.participants.map((participant) => ({
      side: participant.side,
      championId: participant.championId,
      role: participant.role,
    })),
    table: championTable(),
  });

  const insert: GameInsert = {
    lcu_game_id: payload.gameId,
    lobby_id: lobbyId,
    started_at: payload.startedAt,
    duration_s: payload.durationS,
    winning_side: payload.winningSide,
    source: payload.source,
    // Scrubbed again here, not only in the route: this is the one place that writes
    // `games.raw`, `games` is public-read, and `scrubRawEogBlock` is idempotent (M2.10,
    // point 11). Backfill (M5.1) will write through this function too.
    raw: asJson(scrubRawEogBlock(payload.raw)),
    // The mode, the rule, `rated` and the rule check (M15.3), named explicitly. `games_stamp_mode`
    // (0024, amended by 0032) only fills a null `mode`, so it is the fallback for a writer that
    // names none; a second companion's duplicate (`ignoreDuplicates`) keeps the first write's.
    ...modeColumns,
    group_id: groupId,
  };

  const { data: inserted, error: insertError } = await client
    .from('games')
    .upsert(insert, { onConflict: 'lcu_game_id', ignoreDuplicates: true })
    .select('id, lobby_id, group_id')
    .maybeSingle();
  if (insertError) throw new Error(`ingestGame: insert failed: ${insertError.message}`);

  const game = inserted ?? (await selectGame(client, payload.gameId));
  const created = inserted !== null;

  // Stored already, and in another group than this token's: a game belongs to one group, and
  // the other group's companion posting the same block changes nothing anywhere.
  const foreignDuplicate = !created && game.group_id !== options.groupId;
  if (!foreignDuplicate) {
    await upsertGamePlayers(client, game.id, game.group_id, payload, created);
    if (!created) {
      await mergeStoredDraftBans(client, game.id, payload.raw);
    }
    // The group's cached game-derived reads (the calibration line) are stale now (app-perf).
    invalidateGroup('games', game.group_id);
  }

  return {
    outcome: 'stored',
    gameId: game.id,
    lobbyId: game.lobby_id,
    groupId: game.group_id,
    created,
    foreignDuplicate,
    participants: await countGamePlayers(client, game.id),
    modeRecord: recordedGame(kind, lock),
  };
}

/**
 * How the mode lifecycle sees the game (core's `RecordedGameKind`): ARAM (anything that is not the
 * Rift, `isRatedMode`'s rule), a remake (the rating gate's short game: 300 seconds or less), or a
 * Rift game. Remakes and ARAM never rate, never get checked, and leave the rule pending (R1).
 */
export function recordedKind(
  payload: Pick<CompanionGameEogPayloadWithWinner, 'raw' | 'durationS'>,
): RecordedGameKind {
  if (!isRatedMode(payload.raw)) return 'aram';
  if (payload.durationS <= MIN_RATED_DURATION_S) return 'remake';
  return 'rift';
}

/** The stored row for this `lcu_game_id`, or null. */
async function findGame(client: ServiceClient, lcuGameId: number): Promise<{ id: string } | null> {
  const { data, error } = await client.from('games').select('id').eq('lcu_game_id', lcuGameId).maybeSingle();
  if (error) throw new Error(`ingestGame: existing game lookup failed: ${error.message}`);
  return data;
}

/**
 * A second post of the same `lcu_game_id` used to change no column. Live eog
 * rows have no `teams[].bans`; a later match-history post carries them. Copy
 * only that list onto the stored block so `/fun` Most banned can see last night.
 */
async function mergeStoredDraftBans(
  client: ServiceClient,
  gameId: string,
  incomingRaw: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await client.from('games').select('raw').eq('id', gameId).maybeSingle();
  if (error) throw new Error(`ingestGame: raw select failed: ${error.message}`);
  const merged = mergeDraftBans(data?.raw, incomingRaw);
  if (merged === null) return;
  const { error: updateError } = await client
    .from('games')
    .update({ raw: asJson(scrubRawEogBlock(merged)) })
    .eq('id', gameId);
  if (updateError) throw new Error(`ingestGame: raw ban merge failed: ${updateError.message}`);
}

async function selectGame(
  client: ServiceClient,
  lcuGameId: number,
): Promise<{ id: string; lobby_id: string | null; group_id: string }> {
  const { data, error } = await client
    .from('games')
    .select('id, lobby_id, group_id')
    .eq('lcu_game_id', lcuGameId)
    .maybeSingle();
  if (error) throw new Error(`ingestGame: select failed: ${error.message}`);
  if (!data) throw new Error(`ingestGame: game ${lcuGameId} vanished after a conflicting insert`);
  return data;
}

/**
 * The lobby this game was played from (M2.14): the party's live row, or the newest row it
 * has once that cycle closed. An end-of-game block can arrive minutes late — after the group
 * has already opened the night's next lobby with the same party id — and it still belongs to
 * the cycle it was played in.
 *
 * An `abandoned` row is **not** a lobby a game was played from: the two-hour sweep gave up on
 * it, so linking a real game to it would say the group played a lobby that dissolved. Such a
 * game is stored with `lobby_id: null` and still rated — ratings never depended on a lobby
 * existing, which is also what makes backfill (M5.1) possible.
 */
export async function findLobbyId(
  client: ServiceClient,
  partyId: string | null,
  startedAt?: string | null,
): Promise<string | null> {
  return (await findLobby(client, partyId, startedAt))?.id ?? null;
}

/** {@link findLobbyId}, with the lobby's group: the group the game will be stored in (M13.3). */
export async function findLobby(
  client: ServiceClient,
  partyId: string | null,
  startedAt?: string | null,
): Promise<{ id: string; groupId: string } | null> {
  if (partyId === null) return null;

  // An unknown party id is not an error: the companion may have missed the lobby events.
  const lobby = await selectLatestLobby(client, partyId, startedAt);
  if (lobby === null) return null;

  if (lobby.status === 'abandoned') {
    console.warn(
      `ingestGame: party ${partyId} resolves only to abandoned lobby ${lobby.id}; storing the game with no lobby`,
    );
    return null;
  }

  return { id: lobby.id, groupId: lobby.groupId };
}

/**
 * `on conflict do nothing` on `(game_id, player_id)`, so a repeat post writes nothing and a
 * post that follows a half-finished one fills in the rows that are missing.
 *
 * The `mu_*`/`sigma_*` columns are left null on purpose: rating happens a step later (M2.5)
 * and a rebuild (M5.2) rewrites them.
 *
 * **Names, and the one rule backfill breaks** (M5.1 review). An end-of-game block is a report
 * of who these people are *now*, so it refreshes `game_name`, `tag_line` and the automatic
 * `display_name`. A match detail is a report of who they were **when the game was played**, and
 * the walker reads history newest-first, so letting it refresh would settle everybody's name on
 * the oldest game in the batch and do it again the next time a friend backfills the same
 * nights. So a backfill post is `fillOnly`: it can give a name to a PUUID the database has
 * never met — the commonest good outcome of backfill — and it can never change one it has.
 * When the game was already stored, it does not even claim a name: nothing about a re-post of
 * a game we have is news about anybody.
 */
async function upsertGamePlayers(
  client: ServiceClient,
  gameId: string,
  groupId: string,
  payload: CompanionGameEogPayloadWithWinner,
  created: boolean,
): Promise<void> {
  const backfill = payload.source === 'backfill';
  const withNames = !backfill || created;

  // The end-of-game block is the only place the client gives us a Riot ID for someone we have
  // only ever seen in a lobby (lobby members carry no `gameName`/`tagLine` at all, M2.10 point
  // 2), so the names go in with the players.
  const playerIds = await ensurePlayers(
    client,
    payload.participants.map((participant) => ({
      puuid: participant.puuid,
      summonerId: withNames ? participant.summonerId : null,
      gameName: withNames ? participant.gameName : null,
      tagLine: withNames ? participant.tagLine : null,
    })),
    { fillOnly: backfill },
  );

  // Vision score, damage mitigated and damage to objectives come off the posted block, not off
  // the mapped participant (M7.7 and M7.14, `04-decisions.md` 2026-09-15): every companion the
  // group has ever run already carries all three numbers in `raw` on both shapes, so no
  // release is owed for any of them.
  // `rawFactsFromUnknown` is the one reader of that column — the same one `/fun` uses and the
  // same one the backwards copy pass uses — so a live block and a backfilled detail land on
  // the identical pair of integers. A mapped value is honoured only when the blob is silent,
  // which is what a future companion release would fill.
  const rawStats = rawFactsFromUnknown(payload.raw).byPuuid;

  const rows: GamePlayerInsert[] = [];
  for (const participant of payload.participants) {
    const playerId = playerIds.get(participant.puuid);
    if (playerId === undefined) continue;
    const facts = rawStats[participant.puuid];
    rows.push({
      game_id: gameId,
      // Always the game's own group: `game_players_game_group_fkey` refuses anything else.
      group_id: groupId,
      player_id: playerId,
      side: participant.side,
      role: participant.role,
      champion_id: participant.championId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      gold: participant.gold,
      damage_to_champs: participant.damageToChamps,
      cs: participant.cs,
      // Null, never 0: "this game never stored it" is a different fact from a game with no
      // wards, and M7.8 skips the game rather than scoring a real tank at nothing.
      //
      // `storedStat` is the gate, and it is not belt and braces for the column's check
      // constraint — it is the only thing standing between a nonsense number in the blob and a
      // game that is stored, unratable and permanently stuck. The `games` row is written
      // first, so a `game_players` insert that Postgres refuses (a negative, or a value past
      // int4, which the check cannot even see) 500s on every retry for ever. A number we
      // cannot store honestly becomes null, exactly like a key that was never there.
      vision_score: storedStat(facts?.visionScore ?? participant.visionScore),
      damage_self_mitigated: storedStat(facts?.damageSelfMitigated ?? participant.damageSelfMitigated),
      // The third of the same kind (M7.14), and the same gate. A backfilled detail only ever
      // carries the camelCase spelling of this one, which the reader already handles.
      damage_to_objectives: storedStat(facts?.damageToObjectives ?? participant.damageToObjectives),
    });
  }
  if (rows.length === 0) return;

  const { error } = await client
    .from('game_players')
    .upsert(rows, { onConflict: 'game_id,player_id', ignoreDuplicates: true });
  if (error) throw new Error(`ingestGame: game_players insert failed: ${error.message}`);

  // Playing is joining (M13.3): everyone on this scoreboard is a member of the game's group.
  await ensureMemberships(
    client,
    groupId,
    rows.map((row) => row.player_id),
  );
}

async function countGamePlayers(client: ServiceClient, gameId: string): Promise<number> {
  const { count, error } = await client
    .from('game_players')
    .select('player_id', { count: 'exact', head: true })
    .eq('game_id', gameId);
  if (error) throw new Error(`ingestGame: game_players count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The raw block is already known to be a JSON object (zod parsed it out of the request body),
 * so its values are JSON by construction; `Record<string, unknown>` just cannot say so.
 */
function asJson(raw: Record<string, unknown>): Json {
  return raw as Json;
}
