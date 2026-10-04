import type { LobbyStatusValue } from '@customs/db';
import {
  type CommandGate,
  isCommandKindEnabled,
  queueSwitchSideForBalance,
  type SeatedMember,
  type SidedSplit,
} from '../commands';
import { readAssignments } from '../discord/assemble';
import type { ServiceClient } from '../supabase';
import { idSchema } from './formValues';
import { NO_MORE_SPLITS } from './rerollCopy';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Reroll (M3.2): promoting one of the lobby's stored splits to `is_chosen`.
 *
 * Somebody in voice says "nah, run it again" and one person taps once. There is no random
 * reroll and there never will be: core returns three ranked splits and this moves the flag
 * between them, **by split id**, so a double tap on a slow phone is a no-op instead of a skip
 * to split 3.
 *
 * Nothing here posts to Discord. The route promotes first and posts second, because the
 * promotion has to stand whatever Discord answers: a webhook that is down costs the group a
 * message, never the teams.
 */

// The sentence for a third press lives in `./rerollCopy` (M14.44) so the client control can have
// it without this file's imports; re-exported here for the route and its tests.
export { NO_MORE_SPLITS } from './rerollCopy';

/**
 * A lobby id that names nothing, whether it is a well-formed uuid we have no row for or a
 * path segment that is not a uuid at all. One answer for both: a caller who guessed wrong
 * learns the same thing either way, and `lobbies.id` is a uuid column, so a non-uuid is a
 * lookup that cannot match rather than an error worth its own status.
 */
export const NO_SUCH_LOBBY = 'no lobby with that id';

/** One of the lobby's stored splits, as `/admin` and the route need it. */
export interface RerollSplit {
  id: string;
  /** 1, 2 or 3. Core returns them best first and `storeSplits` writes the index plus one. */
  rank: number;
  gap: number;
  explanation: string;
  isChosen: boolean;
}

export interface RerollOutcome {
  splitId: string;
  rank: number;
  /** How many splits this lobby stored, so a caller can say "reroll 1 of 2" honestly. */
  splitCount: number;
  /**
   * False when the split asked for was already the chosen one: nothing moved and nothing is
   * posted. Two taps produce one message.
   */
  promoted: boolean;
}

/**
 * Promote a split of a lobby, or say why not.
 *
 * The order of the refusals is the order of the brief, so the answer never depends on which
 * check happened to run first:
 *
 * 1. the lobby must be `balanced` — once the game has started, the teams on the rift are the
 *    teams, and an `open` lobby has no teams until an admin rolls it (`roll.ts`);
 * 2. the split must belong to this lobby;
 * 3. already chosen is a success that changes nothing;
 * 4. there is no third reroll: with the last split already up, the only promotion left is back
 *    to split 1, the teams the balancer actually chose;
 * 5. the ten must still all be in the lobby — checked here rather than discovered by
 *    `postTeamsForSplit`, which would answer `skipped` after the old chosen row was gone.
 *
 * Then the two statements `storeSplits` uses, in the same order:
 * `splits_one_chosen_per_lobby_idx` allows exactly one chosen row per lobby, so the old flag
 * comes off before the new one goes on.
 *
 * And then the command queue (M4.1): the promoted split's `switch_side` rows, and the previous
 * split's superseded in the same write. A reroll never leaves `balanced`, so no transition
 * fires and this is the **only** place that can do it — without it the ten would be pulled to
 * the sides the group just rerolled away from. It runs after the promotion and can never undo
 * it: a queue that will not write is one log line, exactly as a webhook that will not post is.
 */
export async function promoteSplit(
  client: ServiceClient,
  input: { lobbyId: string; splitId: string },
  /** Tests only: per-kind override of the verification gate. Production reads the constant. */
  options: { gate?: CommandGate } = {},
): Promise<AdminWriteResult<RerollOutcome>> {
  // The lobby id is a path segment, so it arrives unvalidated. `lobbies.id` is a uuid column
  // and Postgres answers a malformed one with 22P02, which would surface as a 500 — an
  // "our bug" status for a request that is simply asking about a lobby that does not exist.
  if (!idSchema.safeParse(input.lobbyId).success) return writeFailed(404, NO_SUCH_LOBBY);

  const { data: lobby, error: lobbyError } = await client
    .from('lobbies')
    .select('id, status')
    .eq('id', input.lobbyId)
    .maybeSingle();
  if (lobbyError) throw new Error(`promoteSplit: lobby lookup failed: ${lobbyError.message}`);
  if (!lobby) return writeFailed(404, NO_SUCH_LOBBY);
  if (lobby.status !== 'balanced') return writeFailed(409, notBalancedMessage(lobby.status));

  const splits = await listSplits(client, input.lobbyId);
  const target = splits.find((split) => split.id === input.splitId);
  if (target === undefined) return writeFailed(404, 'that split does not belong to this lobby');

  if (target.isChosen) {
    return writeOk({ splitId: target.id, rank: target.rank, splitCount: splits.length, promoted: false });
  }

  const chosen = splits.find((split) => split.isChosen);
  const lastRank = splits.reduce((highest, split) => Math.max(highest, split.rank), 0);
  // The third press. Core returns three splits, so there are two rerolls; with the last one
  // already on the board the group has seen the whole list. Split 1 stays reachable because
  // it is not a reroll — it is the teams the balancer chose, and an admin may put them back.
  if (chosen !== undefined && chosen.rank === lastRank && target.rank > 1) {
    return writeFailed(409, NO_MORE_SPLITS);
  }

  const sides = await readSplitSides(client, target.id);
  if (sides === null || !(await tenAreStillHere(client, input.lobbyId, sides))) {
    return writeFailed(
      409,
      'the ten in that split are not all in the lobby any more, so nothing was promoted; roll the lobby again for new teams',
    );
  }

  const { error: clearError } = await client
    .from('splits')
    .update({ is_chosen: false })
    .eq('lobby_id', input.lobbyId)
    .eq('is_chosen', true);
  if (clearError) throw new Error(`promoteSplit: clearing is_chosen failed: ${clearError.message}`);

  const { error: setError } = await client
    .from('splits')
    .update({ is_chosen: true })
    .eq('id', target.id)
    .eq('lobby_id', input.lobbyId);
  if (setError) throw new Error(`promoteSplit: setting is_chosen failed: ${setError.message}`);

  await queueSwitchSideForPromotedSplit(client, input.lobbyId, sides, options.gate);

  return writeOk({ splitId: target.id, rank: target.rank, splitCount: splits.length, promoted: true });
}

/**
 * The promoted split's `switch_side` commands, and the previous split's superseded (M4.1).
 *
 * Never throws: the promotion is what the group agreed to and it stands whatever the queue
 * answers, the same rule the module's header states for Discord. With the gate off this reads
 * nothing at all — the check is here as well as inside the writer so a gated reroll costs no
 * query.
 */
async function queueSwitchSideForPromotedSplit(
  client: ServiceClient,
  lobbyId: string,
  split: SidedSplit,
  gate: CommandGate | undefined,
): Promise<void> {
  if (!isCommandKindEnabled('switch_side', gate)) return;
  try {
    const playing = await readSeatedMembers(client, lobbyId);
    await queueSwitchSideForBalance(client, { lobbyId, split, playing }, gate ? { gate } : {});
  } catch (error) {
    console.error(`promoteSplit: queueing switch_side for lobby ${lobbyId} failed`, error);
  }
}

/** The lobby's members as the queue reads them: who they are and where the client has them. */
async function readSeatedMembers(client: ServiceClient, lobbyId: string): Promise<SeatedMember[]> {
  const { data, error } = await client
    .from('lobby_members')
    .select('player_id, side, players!inner(puuid)')
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`promoteSplit: seat lookup failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    playerId: row.player_id,
    puuid: row.players.puuid,
    // `lobby_members.side` is a smallint with a check, so it types as `number | null`; anything
    // that is not one of the client's two numbers is "not on a side", which is the same answer
    // a spectator gets and the reason clause (c) exists (`lib/ingest/balance.ts` does this too).
    side: row.side === 100 || row.side === 200 ? row.side : null,
  }));
}

/** Why a lobby that is not `balanced` has nothing to reroll. One sentence per status. */
function notBalancedMessage(status: LobbyStatusValue): string {
  switch (status) {
    case 'open':
      return 'that lobby has no teams yet; an admin rolls them once everyone who is staying is in';
    case 'in_game':
    // A `dropped` lobby is one whose game started and whose result never arrived (M5.11).
    // The same sentence is still the true one, and the admin page gains no new word for it.
    case 'dropped':
      return 'the game has started, so the teams on the rift are the teams';
    case 'finished':
      return 'that game is over';
    default:
      return 'that lobby was abandoned';
  }
}

/** The lobby's stored splits, best first. Used by the route and by the `/admin` control. */
export async function listSplits(client: ServiceClient, lobbyId: string): Promise<RerollSplit[]> {
  const { data, error } = await client
    .from('splits')
    .select('id, rank, gap, explanation, is_chosen')
    .eq('lobby_id', lobbyId)
    .order('rank', { ascending: true });
  if (error) throw new Error(`promoteSplit: split lookup failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    rank: row.rank,
    gap: row.gap,
    explanation: row.explanation,
    isChosen: row.is_chosen,
  }));
}

/**
 * Are the split's ten still the people in this lobby?
 *
 * A reroll promotes another arrangement of the ten already chosen; it never re-picks them. If
 * somebody has left, ingest has already put the lobby back to `open` and the status check
 * above answered — this is the narrow window where it has not yet, and refusing costs a
 * message the group would have had to ignore anyway.
 */
async function tenAreStillHere(client: ServiceClient, lobbyId: string, split: SidedSplit): Promise<boolean> {
  const { data: members, error: memberError } = await client
    .from('lobby_members')
    .select('players!inner(puuid)')
    .eq('lobby_id', lobbyId);
  if (memberError) throw new Error(`promoteSplit: member lookup failed: ${memberError.message}`);

  const around = new Set((members ?? []).map((row) => row.players.puuid));
  const ten = [...split.blue, ...split.red];
  return ten.length > 0 && ten.every((assignment) => around.has(assignment.puuid));
}

/**
 * A split's two sides, as puuids. The same rows the check above reads and the command queue
 * writes from, so a reroll reads them once and both callers see the split that was promoted.
 */
async function readSplitSides(client: ServiceClient, splitId: string): Promise<SidedSplit | null> {
  const { data, error } = await client.from('splits').select('blue, red').eq('id', splitId).maybeSingle();
  if (error) throw new Error(`promoteSplit: split sides lookup failed: ${error.message}`);
  if (!data) return null;
  return { blue: readAssignments(data.blue), red: readAssignments(data.red) };
}

/**
 * The newest lobby with teams on the board, if there is one, and its splits. `/admin` draws
 * the reroll control from this; the tonight page gets its own live version in M3.4.
 */
export interface RerollableLobby {
  id: string;
  lobbyName: string | null;
  updatedAt: string;
  splits: RerollSplit[];
}

export async function getRerollableLobby(client: ServiceClient): Promise<RerollableLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('id, lobby_name, updated_at')
    .eq('status', 'balanced')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getRerollableLobby failed: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    lobbyName: data.lobby_name,
    updatedAt: data.updated_at,
    splits: await listSplits(client, data.id),
  };
}
