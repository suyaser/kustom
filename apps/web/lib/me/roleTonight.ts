import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { isActiveLobbyStatus } from '../lobbyRules';
import { nightEnd } from '../night';
import type { ServiceClient } from '../supabase';
// Every sentence these rules answer with is product's, and they all live in one file.
import { ROLE_TAP_NO_LOBBY, ROLE_TAP_NOT_IN_LOBBY, ROLE_TAP_NOT_YOURS, UNKNOWN_PLAYER } from './copy';
import type { MePlayer } from './identity';

/**
 * The role tap (M3.6): the player's preference for the night, and the live lobby row the
 * balancer reads.
 *
 * It is a **preference, not a lock**. Core turns it into that player's main and demotes their
 * usual main to backup (`resolveRoles`); the balancer may still seat them somewhere else, and
 * when it does the stored explanation names them like anybody else who is off-role. Nothing
 * here rebalances: teams that are already posted do not move for a tap, because a rebalance on
 * a role tap is an unlimited reroll that any one of ten people can pull.
 *
 * **Two writes, in this order** (decision 2026-09-10, after the reviewer's second pass):
 *
 *   1. `players.role_tonight` / `players.role_tonight_until` — the night's preference, which
 *      outlives any `lobby_members` row. Rows are deleted and recreated by every companion
 *      post that changes the roster, so the row alone could never hold a choice that is
 *      supposed to last until 06:00.
 *   2. `lobby_members.role_override` on the live row — what the balancer reads, unchanged.
 *
 * The player write goes first on purpose: if the second one fails, the next companion post
 * copies the preference back onto the row by itself (`roleCarry.ts`), so the tap heals. The
 * other order would leave a row set for tonight and nothing behind it.
 *
 * The rules are a pure function of four small reads, so the whole of "who may write what" is a
 * unit test rather than a night in voice. {@link supabaseRoleTonightStore} is the only part
 * that touches Postgres.
 */

export type RoleTonightResult =
  | { ok: true; value: { puuid: string; role: RoleValue | null; status: LobbyStatusValue } }
  | { ok: false; status: 403 | 404 | 409; error: string };

export interface RoleTonightStore {
  /** `players.id` for a PUUID, or `null` when we have never seen that player. */
  findPlayerIdByPuuid(puuid: string): Promise<string | null>;
  /**
   * The lobby's status, or `null` when there is no such row **in this group** (M13.4): a lobby of
   * another group is the same 404 as one that does not exist.
   */
  findLobbyStatus(lobbyId: string, groupId: string): Promise<LobbyStatusValue | null>;
  /** Is this player in that lobby? A sitter counts: they are in `lobby_members`. */
  isMember(lobbyId: string, playerId: string): Promise<boolean>;
  /** The night's preference. `null` clears it, and `until` goes with it. */
  writePreference(playerId: string, role: RoleValue | null, until: Date | null): Promise<void>;
  /** The live lobby row the balancer reads. */
  writeOverride(lobbyId: string, playerId: string, role: RoleValue | null): Promise<void>;
}

/**
 * The player tapping, and whether they are an admin **of the request's group** (M13.4) — the one
 * thing that lets a body name somebody else's PUUID.
 */
export interface RoleTonightActor extends MePlayer {
  isAdmin: boolean;
}

export interface RoleTonightInput {
  /** The group the request named, already checked: the actor is a member of it. */
  groupId: string;
  lobbyId: string;
  role: RoleValue | null;
  /** From the body. `undefined` — the ordinary case — means the caller's own row. */
  puuid?: string | undefined;
}

export interface RoleTonightOptions {
  /** Injected so "the night ends at 06:00" is a test and not a wait. */
  now?: Date;
  timeZone?: string;
}

export async function setRoleTonight(
  store: RoleTonightStore,
  actor: RoleTonightActor,
  input: RoleTonightInput,
  options: RoleTonightOptions = {},
): Promise<RoleTonightResult> {
  const target = input.puuid ?? actor.puuid;

  // **First gate, before any read.** A non-admin body that names somebody else is a 403 and
  // never a silent write to the caller's own row (M3.6, "Who can set it").
  if (target !== actor.puuid && !actor.isAdmin) {
    return { ok: false, status: 403, error: ROLE_TAP_NOT_YOURS };
  }

  const status = await store.findLobbyStatus(input.lobbyId, input.groupId);
  if (status === null) return { ok: false, status: 404, error: ROLE_TAP_NO_LOBBY };
  // `finished`, `dropped` and `abandoned` are records of what happened. The control is not
  // drawn for them, and a post that arrives anyway changes nothing.
  if (!isActiveLobbyStatus(status)) return { ok: false, status: 409, error: ROLE_TAP_NO_LOBBY };

  const playerId = await store.findPlayerIdByPuuid(target);
  if (playerId === null) return { ok: false, status: 404, error: UNKNOWN_PLAYER };

  if (!(await store.isMember(input.lobbyId, playerId))) {
    return { ok: false, status: 409, error: ROLE_TAP_NOT_IN_LOBBY };
  }

  const now = options.now ?? new Date();
  // Clearing writes null to both columns, so nothing can come back later.
  await store.writePreference(
    playerId,
    input.role,
    input.role === null ? null : nightEnd(now, options.timeZone),
  );
  await store.writeOverride(input.lobbyId, playerId, input.role);

  return { ok: true, value: { puuid: target, role: input.role, status } };
}

/**
 * True when the teams for this lobby are already posted, so the tap counts at the **next**
 * balance and the control says so instead of pretending.
 */
export function savedForNextGame(status: LobbyStatusValue): boolean {
  return status !== 'open';
}

export function supabaseRoleTonightStore(client: ServiceClient): RoleTonightStore {
  return {
    async findPlayerIdByPuuid(puuid) {
      const { data, error } = await client.from('players').select('id').eq('puuid', puuid).maybeSingle();
      if (error) throw new Error(`role tonight: player lookup failed: ${error.message}`);
      return data?.id ?? null;
    },

    async findLobbyStatus(lobbyId, groupId) {
      const { data, error } = await client
        .from('lobbies')
        .select('status')
        .eq('id', lobbyId)
        .eq('group_id', groupId)
        .maybeSingle();
      if (error) throw new Error(`role tonight: lobby lookup failed: ${error.message}`);
      return data?.status ?? null;
    },

    async isMember(lobbyId, playerId) {
      const { count, error } = await client
        .from('lobby_members')
        .select('player_id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId)
        .eq('player_id', playerId);
      if (error) throw new Error(`role tonight: member lookup failed: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async writePreference(playerId, role, until) {
      // One statement, both columns: a role with no expiry would last forever and an expiry
      // with no role would be a night nobody picked anything in.
      const { error } = await client
        .from('players')
        .update({ role_tonight: role, role_tonight_until: until?.toISOString() ?? null })
        .eq('id', playerId);
      if (error) throw new Error(`role tonight: preference write failed: ${error.message}`);
    },

    async writeOverride(lobbyId, playerId, role) {
      // An update, never an upsert: the row is the companion's to create (M2.9), and a tap
      // must not be able to invent a member of a lobby.
      const { error } = await client
        .from('lobby_members')
        .update({ role_override: role })
        .eq('lobby_id', lobbyId)
        .eq('player_id', playerId);
      if (error) throw new Error(`role tonight: write failed: ${error.message}`);
    },
  };
}
