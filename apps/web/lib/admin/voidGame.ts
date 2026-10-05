import { VOID_NOT_RATED } from '../games/copy';
import { guardBlocker, rebuildRatings } from '../ingest/rebuild';
import { FENCE_RERUNS } from '../ingest/rebuildCron';
import type { ServiceClient } from '../supabase';
import { FINISH_TONIGHT_FIRST } from './homeCopy';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * An admin's `Void game` / `Restore` (M23.1, owner bug 2026-10-05).
 *
 * A void is the owner's hand fix for game 717217f9 made a button: `games.rated = false` (which
 * already keeps a game out of the fold, the board, both Kustom tracks, awards and the Fearless
 * pool, `0032`), stamped `voided_at` (`0052`) so a restore can tell it from a game played not
 * rated. A restore is the reverse. Then the group's ratings are rebuilt from seeds with
 * `rebuildRatings`, the one fold `rebuild-ratings` and the nightly cron run, so the numbers are as
 * if the game was never played (or played, for a restore).
 *
 * The rebuild's own guard (a live lobby, a game in the last fifteen minutes) is checked **before**
 * the write, so a refusal changes nothing: `Finish tonight's game first.`, like `Reset ratings`. No
 * rating math here; the fold is `lib/ingest`'s.
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
  /** Whether the group's ratings were rebuilt (false only for a fold fenced on every rerun). */
  folded: boolean;
}

export async function setGameVoided(
  client: ServiceClient,
  input: SetGameVoidedInput,
): Promise<AdminWriteResult<SetGameVoidedResult>> {
  const { groupId, gameId, action } = input;
  const now = input.now ?? new Date();
  const wantVoided = action === 'void';

  const { data: game, error } = await client
    .from('games')
    .select('id, rated, voided_at')
    .eq('id', gameId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`setGameVoided: game read failed: ${error.message}`);
  if (game === null) return writeFailed(404, NO_SUCH_GAME);

  const unchanged = writeOk({ voided: game.voided_at !== null, changed: false, folded: false });
  if ((game.voided_at !== null) === wantVoided) return unchanged;
  // A game played not rated has nothing to take out, and a restore would rate it.
  if (wantVoided && !game.rated) return writeFailed(409, VOID_NOT_RATED);

  if ((await guardBlocker(client, groupId, now)) !== null) return writeFailed(409, FINISH_TONIGHT_FIRST);

  // Conditioned on the state just read, so two taps write once.
  const update = client
    .from('games')
    .update(wantVoided ? { rated: false, voided_at: now.toISOString() } : { rated: true, voided_at: null })
    .eq('id', gameId)
    .eq('group_id', groupId);
  const { data: written, error: writeError } = await (wantVoided
    ? update.is('voided_at', null).eq('rated', true)
    : update.not('voided_at', 'is', null)
  ).select('id');
  if (writeError) throw new Error(`setGameVoided: write failed: ${writeError.message}`);
  if ((written ?? []).length === 0) return writeOk({ voided: !wantVoided, changed: false, folded: false });

  // The guard held a moment ago; `force` only skips asking it again. The fence (games landed
  // mid-run) is answered as the cron answers it: run again.
  let result = await rebuildRatings(client, { groupId, force: true, now });
  for (let rerun = 0; rerun < FENCE_RERUNS && !result.ok; rerun += 1) {
    result = await rebuildRatings(client, { groupId, force: true, now });
  }
  if (result.ok && result.report.problems.length > 0) {
    console.error(`void game: group ${groupId} rebuild problems`, result.report.problems);
  }
  return writeOk({ voided: wantVoided, changed: true, folded: result.ok });
}
