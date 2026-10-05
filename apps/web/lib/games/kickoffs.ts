import { KICKOFF_COLUMNS, type KickoffRow, kickoffFromRow, type LobbyKickoff } from '@customs/db/schemas';
import { mapChunks } from '../chunks';
import type { PublicClient } from '../publicClient';

/**
 * Each lobby's kickoff record (M21.4, `lobbies.kickoff_*`), for the after-game readers (M21.7):
 * a `custom` / `unrolled` record's stored odds are what a finished game's pre-game odds print when
 * its teams are the eog's (`kickoffOddsFor` in `./receipt`). The columns are granted to anon (0046).
 *
 * A lobby with no record, or a record this build cannot read (logged), has no entry. **Never
 * throws**: a failed read logs and answers what it has, and the readers fall back to `preGameOdds`
 * over the `r_before`s, which is the same number on an unchanged night. A record that names other
 * teams than the scoreboard is ignored by `kickoffOddsFor` (the end of game wins); pages do not log
 * it on every render, the result post does once (`lib/discord/assemble.ts`).
 */
export async function readKickoffs(
  client: PublicClient,
  lobbyIds: readonly string[],
  who = 'games',
): Promise<Map<string, LobbyKickoff>> {
  const kickoffs = new Map<string, LobbyKickoff>();
  const unique = [...new Set(lobbyIds)];
  if (unique.length === 0) return kickoffs;
  try {
    for (const { data, error } of await mapChunks(unique, (chunk) =>
      client.from('lobbies').select(`id, ${KICKOFF_COLUMNS}`).in('id', chunk).not('kickoff_kind', 'is', null),
    )) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as unknown as (KickoffRow & { id: string })[]) {
        const record = kickoffFromRow(row, (reason) =>
          console.warn(`${who}: lobby ${row.id} has a kickoff record this build cannot read (${reason})`),
        );
        if (record !== null) kickoffs.set(row.id, record);
      }
    }
  } catch (error) {
    console.error(`${who}: reading the kickoff records failed; pre-game odds from ratings instead`, error);
  }
  return kickoffs;
}
