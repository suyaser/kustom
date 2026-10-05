import { REBUILD_FAILED, VOID_NOT_RATED } from '../games/copy';
import { guardBlocker, type RebuildResult, rebuildRatings } from '../ingest/rebuild';
import { FENCE_RERUNS } from '../ingest/rebuildCron';
import type { ServiceClient } from '../supabase';
import { FINISH_TONIGHT_FIRST } from './homeCopy';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * An admin's `Void game` / `Restore` (M23.1, owner bug 2026-10-05).
 *
 * A void is the owner's hand fix for game 717217f9 made a button: `games.rated = false` (which
 * already keeps a game out of the fold, the board, both Kustom tracks, awards and the Fearless
 * pool, `0032`), stamped `voided_at` and `void_reason = 'admin'` (`0052`) so a restore can tell it
 * from a game played not rated. A restore is the reverse, and is also `Rate it anyway` on a game
 * the ingest voided for ending early. Then the group's ratings are rebuilt from seeds with
 * `rebuildRatings`, the one fold `rebuild-ratings` and the nightly cron run.
 *
 * - Only a game that is in the fold (`rated`, every row carrying `r_after`) can be voided, so an
 *   ARAM, a remake or a game played not rated never triggers a rebuild.
 * - The rebuild's own guard (a live lobby, a game in the last fifteen minutes) is checked **before**
 *   the write, so a refusal changes nothing: `Finish tonight's game first.`, like `Reset ratings`.
 * - A rebuild that does not fold, or throws, has the flag put back in one conditional update and
 *   answers 503 `Couldn't update ratings. Try again in a minute.`: the game is never left flagged
 *   one way with the ratings folded the other.
 *
 * No rating math here; the fold is `lib/ingest`'s.
 */

/** No such game in this group (404). */
export const NO_SUCH_GAME = 'That game is not in this group.';

export interface SetGameVoidedInput {
  groupId: string;
  gameId: string;
  action: 'void' | 'restore';
  /** Injected in tests: the guard's clock. */
  now?: Date;
}

export interface SetGameVoidedResult {
  /** The game's state after the request. */
  voided: boolean;
  /** False when it already was (a second tap, two admins): nothing written, nothing folded. */
  changed: boolean;
  /** Whether the group's ratings were rebuilt. */
  folded: boolean;
}

export interface SetGameVoidedDeps {
  /** Injected in tests: the per-group fold. */
  rebuild?: (client: ServiceClient, groupId: string, now: Date) => Promise<RebuildResult>;
}

const defaultRebuild = (client: ServiceClient, groupId: string, now: Date) =>
  rebuildRatings(client, { groupId, force: true, now });

export async function setGameVoided(
  client: ServiceClient,
  input: SetGameVoidedInput,
  deps: SetGameVoidedDeps = {},
): Promise<AdminWriteResult<SetGameVoidedResult>> {
  const { groupId, gameId, action } = input;
  const now = input.now ?? new Date();
  const wantVoided = action === 'void';
  const rebuild = deps.rebuild ?? defaultRebuild;

  const { data: game, error } = await client
    .from('games')
    .select('id, rated, voided_at, void_reason, game_players(r_after)')
    .eq('id', gameId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`setGameVoided: game read failed: ${error.message}`);
  if (game === null) return writeFailed(404, NO_SUCH_GAME);

  if ((game.voided_at !== null) === wantVoided) {
    return writeOk({ voided: wantVoided, changed: false, folded: false });
  }
  // Only a game the fold rated has anything to take out.
  const inFold =
    game.rated && game.game_players.length > 0 && game.game_players.every((row) => row.r_after !== null);
  if (wantVoided && !inFold) return writeFailed(409, VOID_NOT_RATED);

  if ((await guardBlocker(client, groupId, now)) !== null) return writeFailed(409, FINISH_TONIGHT_FIRST);

  // Conditioned on the state just read, so two taps write once.
  const stamp = now.toISOString();
  const update = client
    .from('games')
    .update(
      wantVoided
        ? { rated: false, voided_at: stamp, void_reason: 'admin' }
        : { rated: true, voided_at: null, void_reason: null },
    )
    .eq('id', gameId)
    .eq('group_id', groupId);
  const { data: written, error: writeError } = await (wantVoided
    ? update.is('voided_at', null).eq('rated', true)
    : update.eq('voided_at', game.voided_at as string)
  ).select('id');
  if (writeError) throw new Error(`setGameVoided: write failed: ${writeError.message}`);
  if ((written ?? []).length === 0) return writeOk({ voided: !wantVoided, changed: false, folded: false });

  let folded = false;
  try {
    // The guard held a moment ago; `force` only skips asking it again. The fence (games landed
    // mid-run) is answered as the cron answers it: run again.
    let result = await rebuild(client, groupId, now);
    for (let rerun = 0; rerun < FENCE_RERUNS && !result.ok; rerun += 1) {
      result = await rebuild(client, groupId, now);
    }
    folded = result.ok;
    if (result.ok && result.report.problems.length > 0) {
      console.error(`void game: group ${groupId} rebuild problems`, result.report.problems);
    }
  } catch (rebuildError) {
    console.error(`void game: group ${groupId} rebuild failed`, rebuildError);
  }
  if (folded) return writeOk({ voided: wantVoided, changed: true, folded: true });

  // Put the flag back, conditioned on this request's own write.
  const undo = client
    .from('games')
    .update(
      wantVoided
        ? { rated: true, voided_at: null, void_reason: null }
        : { rated: false, voided_at: game.voided_at, void_reason: game.void_reason },
    )
    .eq('id', gameId)
    .eq('group_id', groupId);
  const { error: undoError } = await (wantVoided
    ? undo.eq('voided_at', stamp).eq('void_reason', 'admin')
    : undo.is('voided_at', null).eq('rated', true));
  if (undoError) throw new Error(`setGameVoided: rollback failed: ${undoError.message}`);
  return writeFailed(503, REBUILD_FAILED);
}
