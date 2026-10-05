import {
  type CompanionLobbyPayload,
  type LobbyInsert,
  type LobbyMemberInsert,
  type LobbyStatusValue,
  type LobbyUpdate,
  rosterKey,
} from '@customs/db';
import { supersedeLobbyCommands } from '../commands/queue';
import type { CompanionIdentity } from '../companionAuth';
import type { LiveChanges } from '../live/bump';
import { ACTIVE_LOBBY_STATUSES, assertLegalTransition, isActiveLobbyStatus } from '../lobbyState';
import type { ServiceClient } from '../supabase';
import { ensureMemberships } from './memberships';
import { ensurePlayers } from './players';
import { carryRoleOverrides } from './roleCarry';

/**
 * Lobby ingest: the companion posts the whole member list every time it changes and this
 * makes the database match it.
 *
 * A lobby row is **one game cycle, not one party** (M2.14). The client keeps the same
 * `partyId` all night, so a post resolves to the party's *live* row — `open`, `balanced` or
 * `in_game` — and starts a new row when the latest one is `dropped`, `finished` or
 * `abandoned`.
 * Migration `0003` is the other half: the partial unique index that allows exactly one live
 * row per party and any number of closed ones.
 *
 * **Ingest never balances** (2026-10-03, `04-decisions.md`). Until then ten people around and
 * ten still seconds balanced the lobby from here; people join, leave and spectate in the
 * middle of that, so it fired on the wrong roster. `open` -> `balanced` is now an admin's
 * press (`lib/admin/roll.ts`) and nothing else. What ingest still does to the status:
 *
 * 1. the roster's **identity** is {@link lobbyRosterKey} over the puuids of everyone around,
 *    spectators included — sides, the spectator flag, names and the lobby name are not part
 *    of it, so a friend swapping from blue to red is not a roster change;
 * 2. when that identity changes, the `lobbies` row is written (`restartClock`): `balanced`
 *    goes back to `open`, because the teams on the board were made for people who are no
 *    longer the people here, and `updated_at` moves either way — which is what lets a roll
 *    that checked the old roster lose its compare-and-set instead of balancing the new one.
 *    Neither `lobby_members` nor `players` touches the row.
 * 3. **a post that changed nothing writes nothing** (M19.8, superseding the 2026-09-08 "written on
 *    every accepted lobby post" row): each `lobby_members` row is compared with the stored one and
 *    only a new row, a gone row, or a moved side or spectator flag is written; a Riot ID is
 *    written only when it moved (`ensurePlayers`). The answer says whether anything was written
 *    (`wrote`), which is what decides the route's `group_live` bump (M19.9).
 *
 * `recheckInMs` is still in the answer, for the companions already installed, and is always
 * `null`: it only ever existed to measure the ten seconds.
 */

export interface LobbyIngestResult {
  lobbyId: string;
  /** The lobby's group: the party's owner, which is not always the token's (M13.3). */
  groupId: string;
  /**
   * True when this post wrote any row: the lobby (a new cycle, a name, a password, the reporter,
   * the status), a `lobby_members` row, a role carry, or a player's Riot ID. False for a repeated
   * post and for another group's party. The route bumps `group_live` on it (M19.9).
   */
  wrote: boolean;
  status: LobbyStatusValue;
  /** False when the party's live row was already known — the idempotent case. */
  created: boolean;
  memberCount: number;
  /** True when the roster was frozen and this post changed no `lobby_members` row (M2.9). */
  rosterFrozen: boolean;
  /** PUUIDs among the posted members whose rank is missing or over a week old (M2.4). */
  ranksNeeded: string[];
  /**
   * Always `null` since 2026-10-03: there is no stability window left to knock for. Kept on
   * the wire because every installed companion parses it (M2.5).
   */
  recheckInMs: null;
}

/**
 * "Once, then weekly" (M2.4), as a single number on the server. A player is worth asking the
 * client about when we have never had a rank for them or when the one we have is older than
 * this. The companion holds no staleness rule of its own: it asks about exactly the PUUIDs
 * this returns, and a puuid drops off the list the moment its rank POST lands.
 */
export const RANK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Postgres `unique_violation`. Two companions opening the same cycle in the same millisecond. */
const UNIQUE_VIOLATION = '23505';

/**
 * The statuses a lobby row can still be posted to (M2.14), re-exported from `lib/lobbyState.ts`
 * where they now live: the tonight page's role control asks the same question in the browser,
 * and it may not import this module to do it (M3.6). Every caller here is unchanged.
 *
 * `dropped` leaving the set is the point of M5.11: it is how a stuck `in_game` row stops
 * swallowing the rest of the night's posts.
 */
export { ACTIVE_LOBBY_STATUSES, isActiveLobbyStatus };

/**
 * Statuses in which `lobby_members` is history rather than live state (M2.9). From `in_game`
 * on, who was in the lobby is what M2.7 matches tonight's ten against and what M5.5 lists,
 * so a late or partial post must not be able to rewrite it.
 *
 * `dropped` is here (M5.11) and `abandoned` is not, and that is the whole difference between
 * the two: a game that started and lost its result keeps the record of who played it, while a
 * lobby that dissolves without ever starting keeps the normal replace semantics (M2.9 brief,
 * "Edge cases"). Neither is in {@link ACTIVE_LOBBY_STATUSES}, so a post for that party starts
 * the night's next cycle rather than landing here at all.
 */
const ROSTER_FROZEN_STATUSES: readonly LobbyStatusValue[] = ['in_game', 'dropped', 'finished'];

/** True when later posts may no longer add, remove or change a `lobby_members` row. */
export function isRosterFrozen(status: LobbyStatusValue): boolean {
  return ROSTER_FROZEN_STATUSES.includes(status);
}

/**
 * Is this PUUID in the list? Whole-PUUID equality, spectators included: a friend who watches
 * a round is in the lobby and their companion is a legitimate reporter.
 *
 * Takes anything with a `puuid`, so the same predicate serves the posted member list here and
 * the `lobby_members` rows the game route reads (M2.8, `isLobbyMemberOfGame` below).
 */
export function isLobbyMember(members: readonly { puuid: string }[], puuid: string): boolean {
  return members.some((member) => member.puuid === puuid);
}

/**
 * May this companion report this party? (M1.8)
 *
 * The token says who the caller is; the body says who is in the lobby. A companion may only
 * report a lobby it is in, because `replaceMembers` below deletes everyone the post leaves
 * out — without this, one stale companion silently rewrites another lobby's roster.
 *
 * Two ways to pass:
 * - the caller's PUUID is in the posted `members` (any `isSpectator` value);
 * - the caller already owns the lobby row (`reported_by_player_id`). That covers the
 *   "everyone left" report — an empty list cannot contain the caller — and a client that
 *   stops listing the caller once they are only spectating (M0.3).
 *
 * An outsider posting an empty or foreign list matches neither and gets a 403.
 */
export async function mayReportLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  identity: CompanionIdentity,
): Promise<boolean> {
  if (isLobbyMember(payload.members, identity.puuid)) return true;

  // The *live* row only (M2.14): owning a party's finished lobby does not entitle anyone to
  // open the next cycle with a roster they are not in.
  const existing = await selectActiveLobby(client, payload.partyId);
  return existing !== null && existing.reportedByPlayerId === identity.playerId;
}

/**
 * Was this player in the lobby the posted game was played from (M2.8)?
 *
 * The spectator's path into the game route: a friend who sits out a round and runs the
 * companion while watching is not on the scoreboard, but they are a `lobby_members` row of
 * that lobby, `is_spectator` and all. On 16.17 a spectator stays in the client's `members[]`
 * with `isSpectator: true` (M2.13), so this check has something to match.
 *
 * "The lobby the game was played from" is {@link selectGameLobby}'s answer (M21.11): a party's
 * stale row whose sided members did not play this game is not that lobby, so being a member of
 * it proves nothing about this game.
 *
 * A token whose player is in neither list still gets a 403.
 */
export async function isLobbyMemberOfGame(
  client: ServiceClient,
  partyId: string | null,
  playerId: string,
  startedAt: string | null | undefined,
  participants: readonly string[],
): Promise<boolean> {
  const match = await selectGameLobby(client, partyId, startedAt, participants);
  if (match.kind !== 'matched') return false;

  const { count, error } = await client
    .from('lobby_members')
    .select('player_id', { count: 'exact', head: true })
    .eq('lobby_id', match.lobby.id)
    .eq('player_id', playerId);
  if (error) throw new Error(`ingestGame: lobby membership check failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/** A `lobby_members` row as {@link lobbyFitsGame} reads it. */
export interface GameLobbyMember {
  puuid: string;
  side: number | null;
  isSpectator: boolean;
}

/**
 * Was this game played from a lobby with this roster? (M21.11)
 *
 * Yes when **every sided member played** (side 100 or 200 and not a spectator: the people the
 * client had on a team when the roster froze) **and at least one member played** (a row with no
 * member rows at all fits: nothing in it says otherwise, and a game always attached to one). Sides are not
 * compared: the eog's sides are final and ratings fold on them, and a split played on swapped
 * sides is still that lobby's game. A player who is not sided in the lobby (a spectator who took
 * a seat, a member with no side, someone the last lobby post missed) does not make it a
 * stranger's game.
 *
 * What it refuses is the 2026-10-02 case: a party's row whose game was never recorded (a remake,
 * a companion that died mid-game) stays `in_game` with its roster frozen, the next rotation's
 * lobby posts land on that frozen row and change nothing, and the next game's eog resolved to it
 * -- five sided members who never played, five spectators who did. The M21.1 audit's other 120
 * lobby games (ten sided and smaller, spectators who played included) all fit.
 */
export function lobbyFitsGame(members: readonly GameLobbyMember[], participants: readonly string[]): boolean {
  const played = new Set(participants);
  const sided = members.filter((member) => !member.isSpectator && (member.side === 100 || member.side === 200));
  if (!sided.every((member) => played.has(member.puuid))) return false;
  return members.length === 0 || members.some((member) => played.has(member.puuid));
}

/**
 * Which lobby an end-of-game block was played from (M21.11):
 *
 * - `matched`: the party's row by the game's start ({@link selectLatestLobby}) and its roster
 *   fits the game ({@link lobbyFitsGame});
 * - `stale`: that row exists but its roster does not fit -- it is another game's lobby, and the
 *   game is stored with no lobby (ratings never needed one);
 * - `none`: no party id, or a party nobody posted.
 *
 * Abandoned rows are the caller's to refuse (`findLobby`).
 */
export type GameLobbyMatch =
  | { kind: 'none' }
  | { kind: 'matched'; lobby: ExistingLobby }
  | { kind: 'stale'; lobby: ExistingLobby };

export async function selectGameLobby(
  client: ServiceClient,
  partyId: string | null,
  startedAt: string | null | undefined,
  participants: readonly string[],
): Promise<GameLobbyMatch> {
  if (partyId === null) return { kind: 'none' };
  const lobby = await selectLatestLobby(client, partyId, startedAt);
  if (lobby === null) return { kind: 'none' };

  const { data, error } = await client
    .from('lobby_members')
    .select('side, is_spectator, players!inner(puuid)')
    .eq('lobby_id', lobby.id);
  if (error) throw new Error(`ingestGame: lobby roster select failed: ${error.message}`);
  const members = (data ?? []).map((row) => ({
    puuid: row.players.puuid,
    side: row.side,
    isSpectator: row.is_spectator,
  }));
  return lobbyFitsGame(members, participants) ? { kind: 'matched', lobby } : { kind: 'stale', lobby };
}

export interface LobbyIngestOptions {
  /**
   * The posting token's group (M13.3, `CompanionIdentity.groupId`). A new lobby is created in
   * it; an existing party keeps the group it already has.
   */
  groupId: string;
  /** Injected in tests: the rank staleness check (M2.4) and the role carry (M3.6) read it. */
  now?: Date;
  /**
   * The request's live signal (M19.9): the lobby's group is touched `lobby` as each write lands,
   * so the route's `withLiveSignal` bumps it even when a later step throws.
   */
  live?: LiveChanges;
}

/**
 * **A party belongs to the group whose companion posted it first** (M13.3, decision row
 * 2026-10-03). When this party's live row -- or, with no live row, its newest row -- is another
 * group's, a post from this token is a no-op that answers exactly like today's duplicate post:
 * `created: false`, the stored status and member count, and nothing written. No roster, no
 * rename, no reporter claim, no membership, no `players` row. A second companion posting the
 * same party for another group must never move the lobby.
 *
 * "Its newest row" is what keeps the night's **next** cycle in the same group: the party id is
 * the client's and survives the whole night (M2.14), so without it the first post after a
 * finished game would hand the party to whichever group's companion happened to post first.
 */
export async function ingestLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
  options: LobbyIngestOptions,
): Promise<LobbyIngestResult> {
  const now = options.now ?? new Date();

  const owner = await selectPartyOwner(client, payload.partyId);
  if (owner !== null && owner.groupId !== options.groupId) {
    return foreignPartyAnswer(client, owner.lobby, payload, now);
  }

  let upserted: LobbyRowResult;
  try {
    upserted = await upsertLobby(client, payload, reportedByPlayerId, options.groupId);
  } catch (error) {
    if (error instanceof ForeignPartyRace) return foreignPartyAnswer(client, error.lobby, payload, now);
    // The insert or the rename may have landed with its answer lost: the retry finds the row as
    // posted, writes nothing and would never bump (the M19.9 rule `noteWrite` follows; a party
    // that got this far is this group's). A bump for a write that never happened is harmless.
    options.live?.touch(options.groupId, 'lobby');
    throw error;
  }
  const { lobby, created } = upserted;
  // The request's live signal (M19.9), noted as each write lands rather than from the answer, so a
  // post that throws part way (a member upsert, the membership insert) still bumps what it wrote.
  const touch = () => options.live?.touch(lobby.groupId, 'lobby');
  if (upserted.wrote) touch();

  // Frozen (M2.9): the lobby is in a game or done, so the roster is a record of what
  // happened. Report what is stored and write nothing to `lobby_members`.
  if (isRosterFrozen(lobby.status)) {
    return {
      lobbyId: lobby.id,
      groupId: lobby.groupId,
      // A frozen roster still takes a rename or a new password on the `lobbies` row.
      wrote: upserted.wrote,
      status: lobby.status,
      created,
      memberCount: await countMembers(client, lobby.id),
      rosterFrozen: true,
      // Still answered while frozen: whoever is on the posted list and has no fresh rank is
      // worth asking about, and the game that froze the roster does not change that.
      ranksNeeded: await selectRanksNeeded(client, payload, now),
      recheckInMs: null,
    };
  }

  const posted = rosterIdentity(payload.members.map((member) => member.puuid));
  const stored = created ? null : rosterIdentity(await selectMemberPuuids(client, lobby.id));
  const rosterChanged = posted !== stored;

  // The members are compared whether or not the identity moved: a friend swapping side or
  // stepping into the spectator slot has to land in `lobby_members` (the seat plan reads it) and
  // a Riot ID that changed has to land in `players` (M1.7). Only what moved is written (M19.8).
  // Neither touches `lobbies`, so neither restarts the clock — only the write below does that.
  const diff = await replaceMembers(client, lobby.id, payload, lobby.groupId, touch);
  const memberCount = diff.count;

  // A role for tonight lasts the night and lives on the player (M3.6): every row this post
  // **created** gets `players.role_tonight` copied onto it while that preference is still
  // tonight's. Rows that were already here are not touched, so a re-post can never re-apply a
  // value over a tap that has just landed.
  if (diff.inserted.length > 0) {
    await carryRoleOverrides(client, { lobbyId: lobby.id, inserted: diff.inserted, now });
  }

  let status = lobby.status;
  if (rosterChanged && !created) {
    // Writing the lobby row is what moves `updated_at` (`lobbies_set_updated_at`), and from
    // `balanced` it is the "someone left, roll again" transition. A freshly inserted row is
    // already `open` with `updated_at = now`, so it is left alone.
    status = (await restartClock(client, lobby)).status;
  }

  return {
    lobbyId: lobby.id,
    groupId: lobby.groupId,
    // A roster change always writes a member row, so `diff.wrote` covers the clock restart and
    // the role carry (both only run when members were written or inserted).
    wrote: upserted.wrote || diff.wrote,
    status,
    created,
    memberCount,
    rosterFrozen: false,
    ranksNeeded: await selectRanksNeeded(client, payload, now),
    recheckInMs: null,
  };
}

/**
 * The answer to a post about another group's party: today's duplicate-post answer, with nothing
 * written (see {@link ingestLobby}).
 */
async function foreignPartyAnswer(
  client: ServiceClient,
  lobby: ExistingLobby,
  payload: CompanionLobbyPayload,
  now: Date,
): Promise<LobbyIngestResult> {
  return {
    lobbyId: lobby.id,
    groupId: lobby.groupId,
    wrote: false,
    status: lobby.status,
    created: false,
    memberCount: await countMembers(client, lobby.id),
    // Literally true: this post changed no `lobby_members` row, and it never will.
    rosterFrozen: true,
    // A read, and still worth answering: a rank is a fact about a person, not a group.
    ranksNeeded: await selectRanksNeeded(client, payload, now),
    recheckInMs: null,
  };
}

/**
 * The roster's identity: `rosterKey()` over everyone around, sorted, so member order is never
 * mistaken for a change. Sides, the `isSpectator` flag, names, `role_override`, the lobby
 * name and the password are deliberately not in it — the balancer assigns sides itself and
 * the rotation treats a spectator as one of the people who are here.
 *
 * Exported as {@link lobbyRosterKey}: it is also the `rosterKey` a roll must send
 * (`lib/admin/roll.ts`), computed by the presser's page over the members it was showing.
 */
function rosterIdentity(puuids: readonly string[]): string {
  const unique = [...new Set(puuids)];
  return unique.length === 0 ? '' : rosterKey(unique);
}

/**
 * The key a roll is pressed against: `rosterKey()` from `@customs/db` over the puuid of every
 * `lobby_members` row, spectators included, duplicates dropped. `''` for an empty lobby.
 * The page computes the same string from the members it rendered.
 */
export const lobbyRosterKey = rosterIdentity;

/** The puuids currently stored for this lobby, in no particular order. */
export async function selectMemberPuuids(client: ServiceClient, lobbyId: string): Promise<string[]> {
  const { data, error } = await client
    .from('lobby_members')
    .select('players!inner(puuid)')
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`ingestLobby: stored roster select failed: ${error.message}`);
  return (data ?? []).map((row) => row.players.puuid);
}

/**
 * The roster changed, so the lobby is `open` — from `balanced` that is the "someone left"
 * transition: the earlier splits stay where they are as history and the next teams need
 * another roll. From `open` the write changes no status and only moves `updated_at`, which is
 * what makes a roll pressed against the old roster lose its compare-and-set.
 */
async function restartClock(client: ServiceClient, lobby: ExistingLobby): Promise<ExistingLobby> {
  // Through the table like every other move, even though this one writes the row back.
  assertLegalTransition(lobby.status, 'open');

  const { data, error } = await client
    .from('lobbies')
    .update({ status: 'open' })
    .eq('id', lobby.id)
    .in('status', ['open', 'balanced'])
    .select(LOBBY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: clock restart failed: ${error.message}`);

  // Leaving `balanced` takes the split's pending `switch_side` commands with it (M4.1). This is
  // the one exit from `balanced` that does not go through `moveLobby`, so it says so itself.
  if (data !== null && lobby.status === 'balanced') {
    try {
      await supersedeLobbyCommands(client, lobby.id, 'the roster changed');
    } catch (commandError) {
      console.error(`ingestLobby: superseding commands for lobby ${lobby.id} failed`, commandError);
    }
  }

  // No row back means another request moved the lobby out from under us (to `in_game`, say).
  // Its status wins; this post has already replaced the members and there is nothing to undo.
  return data ? toExistingLobby(data) : lobby;
}

/**
 * The puuids among the members just posted whose `players` row has no `rank_updated_at`, one
 * older than `RANK_STALE_MS`, or no row at all (M2.4). One select over at most twenty rows.
 *
 * Spectators are included: they play the next round, and the same POST is how a name arrives
 * for someone the lobby response could not name (M2.10, point 2).
 *
 * The order is the posted member order, so two companions in the same lobby get the same
 * list in the same order and the companion's own de-duplicator sees a stable sequence.
 */
async function selectRanksNeeded(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  now: Date,
): Promise<string[]> {
  const puuids = [...new Set(payload.members.map((member) => member.puuid))];
  if (puuids.length === 0) return [];

  const { data, error } = await client.from('players').select('puuid, rank_updated_at').in('puuid', puuids);
  if (error) throw new Error(`ingestLobby: rank staleness select failed: ${error.message}`);

  const freshAfter = now.getTime() - RANK_STALE_MS;
  const fresh = new Set<string>();
  for (const row of data ?? []) {
    const updatedAt = row.rank_updated_at === null ? null : Date.parse(row.rank_updated_at);
    // An unparseable timestamp is treated as stale rather than throwing: asking once more is
    // cheap, and a rank we cannot date is a rank we cannot trust to be recent.
    if (updatedAt !== null && !Number.isNaN(updatedAt) && updatedAt >= freshAfter) fresh.add(row.puuid);
  }

  // A puuid with no row at all is not in `fresh`, so it is asked about — that is the
  // first-night case, and the rank POST creates the row.
  return puuids.filter((puuid) => !fresh.has(puuid));
}

interface LobbyRowResult {
  lobby: ExistingLobby;
  /** True when this post started a cycle: an unseen party, or the night's next game (M2.14). */
  created: boolean;
  /** True when this post wrote the `lobbies` row: a new cycle, or a patch below. */
  wrote: boolean;
}

/**
 * Find the party's live row, or start a new cycle, then refresh the fields the client can
 * tell us about. Reposting an unchanged lobby writes nothing, so `updated_at` still means
 * "something changed" — which is the whole of M2.5's stability clock.
 */
async function upsertLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
  groupId: string,
): Promise<LobbyRowResult> {
  const existing = await selectActiveLobby(client, payload.partyId);

  if (existing === null) {
    const insert: LobbyInsert = {
      lcu_party_id: payload.partyId,
      reported_by_player_id: reportedByPlayerId,
      lobby_name: payload.lobbyName,
      lobby_password: payload.lobbyPassword,
      // The token's group (M13.3). Passed explicitly even while `0018`'s temporary default would
      // have filled in the same id: M13.4's `0020` drops that default.
      group_id: groupId,
    };
    // A plain insert, not an upsert: `lcu_party_id` is no longer unique by itself (M2.14) and
    // `lobbies_active_party_idx` is partial, so there is no constraint for `on conflict` to
    // infer. The unique violation below is the race, and it is handled by re-reading.
    const { data, error } = await client.from('lobbies').insert(insert).select(LOBBY_COLUMNS).single();
    if (!error && data) return { lobby: toExistingLobby(data), created: true, wrote: true };
    if (error && error.code !== UNIQUE_VIOLATION) {
      throw new Error(`ingestLobby: insert failed: ${error.message}`);
    }

    // Another companion opened the same cycle between our select and our insert. If it was
    // another group's, that group owns the party now and this post must not write into it --
    // the caller re-checks ownership on the returned row.
    const raced = await selectActiveLobby(client, payload.partyId);
    if (raced === null) throw new Error('ingestLobby: lobby vanished after a conflicting insert');
    if (raced.groupId !== groupId) throw new ForeignPartyRace(raced);
    return { lobby: raced, created: false, wrote: false };
  }

  const patch: LobbyUpdate = {};
  // The first companion to report a party owns it; a second companion in the same lobby is a
  // no-op rather than a tug of war over `reported_by_player_id`.
  if (existing.reportedByPlayerId === null) patch.reported_by_player_id = reportedByPlayerId;
  if (payload.lobbyName !== null && payload.lobbyName !== existing.lobbyName) {
    patch.lobby_name = payload.lobbyName;
  }
  if (payload.lobbyPassword !== null && payload.lobbyPassword !== existing.lobbyPassword) {
    patch.lobby_password = payload.lobbyPassword;
  }

  if (Object.keys(patch).length > 0) {
    // This fires `lobbies_set_updated_at`. Read the row back so the caller sees what the
    // database just wrote; a roll racing a rename loses its compare-and-set and retries.
    const { data, error } = await client
      .from('lobbies')
      .update(patch)
      .eq('id', existing.id)
      .select(LOBBY_COLUMNS)
      .single();
    if (error) throw new Error(`ingestLobby: update failed: ${error.message}`);
    return { lobby: toExistingLobby(data), created: false, wrote: true };
  }

  return { lobby: existing, created: false, wrote: false };
}

/** A `lobbies` row, as everything downstream of the party-id lookup wants to read it. */
export interface ExistingLobby {
  id: string;
  status: LobbyStatusValue;
  reportedByPlayerId: string | null;
  lobbyName: string | null;
  lobbyPassword: string | null;
  /** Moved by every write to the row, by the `updated_at` trigger. The roll's CAS guard. */
  updatedAt: string;
  createdAt: string;
  /** The group that owns this lobby: whichever group's companion posted the party first (M13.3). */
  groupId: string;
}

const LOBBY_COLUMNS =
  'id, status, reported_by_player_id, lobby_name, lobby_password, updated_at, created_at, group_id';

function toExistingLobby(row: {
  id: string;
  status: LobbyStatusValue;
  reported_by_player_id: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  updated_at: string;
  created_at: string;
  group_id: string;
}): ExistingLobby {
  return {
    id: row.id,
    status: row.status,
    reportedByPlayerId: row.reported_by_player_id,
    lobbyName: row.lobby_name,
    lobbyPassword: row.lobby_password,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    groupId: row.group_id,
  };
}

/**
 * Thrown by {@link upsertLobby} when the insert lost a race to another group's companion: the
 * party is that group's now. {@link ingestLobby} turns it back into the cross-group no-op.
 */
class ForeignPartyRace extends Error {
  constructor(readonly lobby: ExistingLobby) {
    super(`ingestLobby: party was opened by group ${lobby.groupId} first`);
  }
}

/**
 * Which group owns this party, and through which row: the live row when there is one, else the
 * party's newest row of any status. `null` for a party nobody has posted.
 */
async function selectPartyOwner(
  client: ServiceClient,
  partyId: string,
): Promise<{ groupId: string; lobby: ExistingLobby } | null> {
  const live = await selectActiveLobby(client, partyId);
  if (live !== null) return { groupId: live.groupId, lobby: live };

  const { data, error } = await client
    .from('lobbies')
    .select(LOBBY_COLUMNS)
    .eq('lcu_party_id', partyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: party owner lookup failed: ${error.message}`);
  if (data === null) return null;
  const newest = toExistingLobby(data);
  return { groupId: newest.groupId, lobby: newest };
}

/**
 * The party's **live** row: `open`, `balanced` or `in_game`, newest first (M2.14). `null`
 * means this party has no open cycle — either it has never been seen, or its last cycle is
 * `dropped`/`finished`/`abandoned` and the next post starts a new row.
 *
 * The `dropped` case is M5.11's whole fix: the two-hour sweep takes a lobby whose game never
 * landed out of the live set, and this lookup then answers `null` for the party the way it
 * would after a finished game.
 *
 * There can be at most one such row (`lobbies_active_party_idx`); the ordering is belt and
 * braces for a database that somehow holds two.
 */
export async function selectActiveLobby(
  client: ServiceClient,
  partyId: string,
): Promise<ExistingLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(LOBBY_COLUMNS)
    .eq('lcu_party_id', partyId)
    .in('status', ACTIVE_LOBBY_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: select failed: ${error.message}`);
  return data ? toExistingLobby(data) : null;
}

/**
 * The party's live row, or — when its cycle has closed — the newest row it has (M2.14).
 *
 * This is what a **game** post resolves through: an end-of-game block that arrives after the
 * lobby was already marked `finished`, or after the group opened the night's next cycle,
 * still belongs to the row it was played from. A lobby post must never use this: it would
 * write into a frozen row instead of starting the next cycle.
 */
export async function selectLatestLobby(
  client: ServiceClient,
  partyId: string,
  /**
   * When the game started, for an end-of-game block. The cycle a game belongs to is the
   * newest row that already existed when it kicked off, which is what keeps a late eog on
   * the lobby it was played from even after the group has opened the night's next one.
   * Omitted (the `in_progress` ping) means "the live row".
   */
  startedAt?: string | null,
): Promise<ExistingLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(LOBBY_COLUMNS)
    .eq('lcu_party_id', partyId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`ingestGame: lobby lookup failed: ${error.message}`);

  const rows = (data ?? []).map(toExistingLobby);
  const started = startedAt == null ? Number.NaN : Date.parse(startedAt);
  const byStart = Number.isNaN(started)
    ? undefined
    : rows.find((row) => Date.parse(row.createdAt) <= started);

  // Ordered newest first, so the first match is the newest row that predates the game. The
  // fallbacks cover a companion whose clock is off and a game whose lobby was only reported
  // after it had started: the live row, and then whatever the party's newest row is.
  return byStart ?? rows.find((row) => isActiveLobbyStatus(row.status)) ?? rows[0] ?? null;
}

/** What one post did to `lobby_members`, as the role carry needs to read it (M3.6). */
export interface MemberDiff {
  /** How many rows the lobby has after the post. The caller's `memberCount`. */
  count: number;
  /**
   * Players whose row this post **created**: they had none a moment ago. The role carry writes
   * to exactly these, so a tap that has just landed on an existing row is never overwritten.
   */
  inserted: string[];
  /**
   * True when any `lobby_members` row was inserted, changed or deleted, or a player's Riot ID
   * was refreshed (M19.8). False for a post that matches what is stored.
   */
  wrote: boolean;
}

/**
 * The reported list replaces whatever we had: members who left are deleted, members who
 * stayed keep their `role` and `role_override` (M3.6 owns those columns).
 *
 * **Only what moved is written** (M19.8): the stored rows are read first, and the delete runs
 * only when somebody left, the upsert only for a row that is new or whose side or spectator flag
 * moved. The same post twice writes nothing the second time, so it sends no Realtime event and no
 * `group_live` bump.
 *
 * It also reports the diff, because a role for tonight outlives a row: `roleCarry.ts` puts an
 * override back onto a row this post created, from the party's previous cycle inside the night
 * or from a row this same post is deleting.
 */
async function replaceMembers(
  client: ServiceClient,
  lobbyId: string,
  payload: CompanionLobbyPayload,
  groupId: string,
  /** Called as each write lands (M19.9: the route's live signal survives a later throw). */
  touch: () => void = () => {},
): Promise<MemberDiff> {
  let refreshed = false;
  const playerIds = await ensurePlayers(
    client,
    payload.members.map((member) => ({
      puuid: member.puuid,
      summonerId: member.summonerId,
      gameName: member.gameName,
      tagLine: member.tagLine,
    })),
    {
      onRefresh: () => {
        refreshed = true;
        touch();
      },
    },
  );

  const rows = new Map<string, LobbyMemberInsert>();
  for (const member of payload.members) {
    const playerId = playerIds.get(member.puuid);
    if (playerId === undefined) continue;
    rows.set(playerId, {
      lobby_id: lobbyId,
      player_id: playerId,
      side: member.side,
      is_spectator: member.isSpectator,
    });
  }

  const keep = [...rows.keys()];

  // Read before the write, so an insert can be told from an update (only a row this post creates
  // gets the player's role for tonight copied onto it, M3.6) and an unchanged row from a moved
  // one (M19.8).
  const before = await selectStoredMembers(client, lobbyId);
  const inserted = keep.filter((playerId) => !before.has(playerId));
  const gone = [...before.keys()].filter((playerId) => !rows.has(playerId));
  const changed = [...rows.values()].filter((row) => memberRowMoved(before.get(row.player_id), row));

  if (gone.length > 0) {
    // Everyone not on the posted list, not only the rows read above: a row a concurrent post
    // added a moment ago goes too, exactly as the whole-list replace always did.
    const remove = client.from('lobby_members').delete().eq('lobby_id', lobbyId);
    const { error: deleteError } = await (keep.length === 0
      ? remove
      : remove.not('player_id', 'in', `(${keep.map((id) => `"${id}"`).join(',')})`));
    if (deleteError) throw new Error(`ingestLobby: member delete failed: ${deleteError.message}`);
    touch();
  }

  if (changed.length > 0) {
    const { error } = await client
      .from('lobby_members')
      .upsert(changed, { onConflict: 'lobby_id,player_id' });
    if (error) throw new Error(`ingestLobby: member upsert failed: ${error.message}`);
    touch();
  }

  // Playing is joining (M13.3): everyone on this group's roster is a member of it from now on.
  // `on conflict do nothing`, so an admin stays an admin. Asked for the rows this post created
  // only (M19.8): everybody else was made a member by the post that created their row, so a
  // repeated post sends no write at all. (Somebody an admin removed mid-lobby is a member again
  // from the game's end-of-game block, which ensures the whole scoreboard.)
  await ensureMemberships(client, groupId, inserted);

  return { count: keep.length, inserted, wrote: refreshed || gone.length > 0 || changed.length > 0 };
}

/** A `lobby_members` row as stored: the two columns a post can move. */
export interface StoredMember {
  side: LobbyMemberInsert['side'];
  isSpectator: boolean;
}

/** True when the posted row is new or moved a column the post owns (side, spectator flag). */
export function memberRowMoved(stored: StoredMember | undefined, posted: LobbyMemberInsert): boolean {
  if (stored === undefined) return true;
  return (
    (stored.side ?? null) !== (posted.side ?? null) || stored.isSpectator !== (posted.is_spectator ?? false)
  );
}

/** Who already has a row in this lobby, and how it is seated, before the post is applied. */
async function selectStoredMembers(
  client: ServiceClient,
  lobbyId: string,
): Promise<Map<string, StoredMember>> {
  const { data, error } = await client
    .from('lobby_members')
    .select('player_id, side, is_spectator')
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`ingestLobby: member read failed: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [row.player_id, { side: row.side, isSpectator: row.is_spectator }] as const),
  );
}

async function countMembers(client: ServiceClient, lobbyId: string): Promise<number> {
  const { count, error } = await client
    .from('lobby_members')
    .select('player_id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`ingestLobby: member count failed: ${error.message}`);
  return count ?? 0;
}
