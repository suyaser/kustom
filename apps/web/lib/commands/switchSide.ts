import type { SideValue } from '@customs/db';
import type { CompanionCommandKind } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type CommandGate, isCommandKindEnabled } from './gate';
import { type CommandToQueue, enqueueCommands, supersedeCommands, supersededError } from './queue';

/**
 * What the server queues when a split goes on the board, and it is exactly one kind:
 * `switch_side`, for a member of the chosen ten whose client has them on the other side
 * (M4.3's rules, wired here because M4.1 owns the queue).
 *
 * A split goes on the board in two ways and **both** come through here: the `balanced`
 * transition (`register.ts`, on the `onBalanced` hook) and a reroll (`lib/admin/reroll.ts`,
 * which promotes another split without the lobby ever leaving `balanced`, so no transition
 * fires and nothing else could).
 *
 * **`create_lobby` is never queued from a transition.** Somebody presses a button and a lobby
 * opens; that is M4.2's route, and a lobby that opened itself because ten people happened to be
 * around is the opposite of what this product does. `invite` likewise rides on M4.2's fan-out.
 *
 * Who gets a row, from M4.3's brief, all three clauses:
 *
 * - **a.** an unrevoked companion token seen in the last ten minutes — `last_seen_at` means
 *   "at their PC with League open", which is exactly what the commands poll made it mean;
 * - **b.** a `lobby_members.side` that differs from the side the chosen split gives them;
 * - **c.** a `side` that is **not null**. The easy one to miss: a friend in the spectator slot
 *   who is among the chosen ten has no side, and a toggle cannot seat a spectator. They are
 *   never queued, and the line on the page is what tells them to move.
 *
 * Nobody outside the chosen ten is ever queued — a sitter is not moved by us.
 */

/** An unrevoked token seen this recently means the friend is at their PC with League open. */
export const COMPANION_AROUND_MS = 10 * 60_000;

/**
 * The part of a split this file needs: which puuids are on which side. Core's `Split` satisfies
 * it, and so do the `splits.blue` / `splits.red` columns read back on a reroll — the two
 * callers are the `balanced` transition and `promoteSplit`, and neither should have to
 * reconstruct the other's shape.
 */
export interface SidedSplit {
  blue: readonly { puuid: string }[];
  red: readonly { puuid: string }[];
}

/** The part of one of the chosen ten this file needs. `PoolMember` satisfies it. */
export interface SeatedMember {
  playerId: string;
  puuid: string;
  /** Where the client has them: null for a spectator or somebody not placed yet. */
  side: SideValue | null;
}

/** The event either caller passes: a lobby, the split now on the board, and who is in it. */
export interface ChosenSplitEvent {
  lobbyId: string;
  split: SidedSplit;
  playing: readonly SeatedMember[];
}

/** The kinds a lobby transition may touch. `create_lobby` and `invite` are M4.2's, not a transition's. */
export const TRANSITION_COMMAND_KINDS: readonly CompanionCommandKind[] = ['switch_side'];

export interface SwitchSideMove {
  playerId: string;
  puuid: string;
  /** Where the client has them now. Never null: clause (c) drops those before this exists. */
  from: SideValue;
  /** Where the chosen split puts them. */
  to: SideValue;
}

/**
 * Clauses (b) and (c), as a pure function of the split and the ten: who is on the wrong side.
 *
 * Blue is 100 and red is 200, matching the client. The order is the split's own — blue in lane
 * order, then red — so two runs of the same balance queue the same rows in the same order.
 */
export function switchSideMoves(split: SidedSplit, playing: readonly SeatedMember[]): SwitchSideMove[] {
  const byPuuid = new Map(playing.map((member) => [member.puuid, member]));
  const moves: SwitchSideMove[] = [];

  for (const [side, assignments] of [
    [100, split.blue],
    [200, split.red],
  ] as const) {
    for (const assignment of assignments) {
      const member = byPuuid.get(assignment.puuid);
      // Not one of the ten we know about (cannot happen: the split is built from them), or a
      // spectator / someone the client has not placed yet — clause (c).
      if (member === undefined || member.side === null) continue;
      if (member.side === side) continue;
      moves.push({ playerId: member.playerId, puuid: member.puuid, from: member.side, to: side });
    }
  }

  return moves;
}

export interface QueueSwitchSideResult {
  /** Rows from an earlier split that this write failed with `superseded`. */
  superseded: number;
  /**
   * Rows written now. Real rows since the `switch_side` row went green on 16.18 (2026-09-12);
   * zero only when the gate is off again — a `gate` override, or the row back to `unverified`.
   */
  queued: number;
  /** Everyone the split moves, before the token check. For the log and the tests. */
  moves: SwitchSideMove[];
}

export interface QueueSwitchSideOptions {
  now?: Date;
  gate?: CommandGate;
}

/**
 * What a chosen split writes, in one statement each way: supersede, then queue.
 *
 * **Two callers, and both of them matter.** The `balanced` transition (`register.ts`, on the
 * `onBalanced` hook) and `promoteSplit` (`lib/admin/reroll.ts`, M3.2). A reroll promotes
 * another split of the same ten **without leaving `balanced`**, so no transition fires and
 * nothing else would ever supersede the old split's rows: with only the first caller wired, the
 * ten would be dragged to the sides the group just rerolled away from, for up to the TTL, and
 * nobody would be sent to the new ones.
 *
 * **Supersede first, always.** Failing the previous split's rows in the same write that queues
 * the new ones is what keeps "at most one pending `switch_side` per player" true.
 *
 * **The switch-side row in `docs/03-lcu-reference.md` went green on 16.18 (2026-09-12)**, so this
 * writes rows. With the gate off again — a `gate` override, or the row back to `unverified`
 * because a patch broke the path — it writes nothing at all and does not read the database either.
 */
export async function queueSwitchSideForBalance(
  client: ServiceClient,
  event: ChosenSplitEvent,
  options: QueueSwitchSideOptions = {},
): Promise<QueueSwitchSideResult> {
  const moves = switchSideMoves(event.split, event.playing);
  if (!isCommandKindEnabled('switch_side', options.gate)) {
    return { superseded: 0, queued: 0, moves };
  }

  const now = options.now ?? new Date();
  // The lobby's group (M13.3): only that group's tokens are asked to move, and the rows are
  // written in it, so a host in two groups gets them on the token of the group they are playing in.
  const groupId = await lobbyGroup(client, event.lobbyId);
  const superseded = await supersedeCommands(client, {
    playerIds: event.playing.map((member) => member.playerId),
    kinds: ['switch_side'],
    error: supersededError('another split was chosen'),
    now,
  });

  const around = await playersWithALiveCompanion(
    client,
    moves.map((move) => move.playerId),
    groupId,
    now,
  );

  const commands: CommandToQueue[] = moves
    .filter((move) => around.has(move.playerId))
    .map((move) => ({
      targetPlayerId: move.playerId,
      groupId,
      kind: 'switch_side',
      payload: { targetSide: move.to },
    }));

  const { queued } = await enqueueCommands(client, commands, { now, gate: options.gate });
  if (queued.length > 0 || superseded > 0) {
    console.info(
      `lobby ${event.lobbyId}: queued ${queued.length} switch_side command(s), superseded ${superseded}`,
    );
  }
  return { superseded, queued: queued.length, moves };
}

/** `lobbies.group_id`. Throws for a lobby that does not exist: a split always has one. */
async function lobbyGroup(client: ServiceClient, lobbyId: string): Promise<string> {
  const { data, error } = await client.from('lobbies').select('group_id').eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`queueSwitchSideForBalance: lobby group lookup failed: ${error.message}`);
  if (data === null) throw new Error(`queueSwitchSideForBalance: no lobby ${lobbyId}`);
  return data.group_id;
}

/**
 * Clause (a): an unrevoked token **of this group** seen in the last ten minutes (M13.3). One
 * select, at most ten ids.
 */
export async function playersWithALiveCompanion(
  client: ServiceClient,
  playerIds: readonly string[],
  groupId: string,
  now: Date = new Date(),
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();

  const seenSince = new Date(now.getTime() - COMPANION_AROUND_MS).toISOString();
  const { data, error } = await client
    .from('companion_tokens')
    .select('player_id')
    .eq('group_id', groupId)
    .in('player_id', [...playerIds])
    .is('revoked_at', null)
    .gte('last_seen_at', seenSince);
  if (error) throw new Error(`playersWithALiveCompanion: ${error.message}`);
  return new Set((data ?? []).map((row) => row.player_id));
}
