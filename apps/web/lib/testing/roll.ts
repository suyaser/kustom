import { type RollOutcome, rollLobby } from '../admin/roll';
import { lobbyRosterKey, selectMemberPuuids } from '../ingest/lobby';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Tests only: an admin's roll against the roster stored right now, which is what a press from a
 * page that is up to date sends. Since 2026-10-03 this is the only way a lobby reaches
 * `balanced`, so every integration file that needs teams on the board calls it after its lobby
 * post, where it used to post twice ten seconds apart.
 *
 * Throws on a refusal, so a test that expected teams fails on the line that did not get them.
 * The Discord and command-queue listeners hear about it only if the caller's module graph
 * registered them (`app/api/admin/lobbies/[lobbyId]/roll/handler.ts` does).
 */
export async function rollForTest(
  client: ServiceClient,
  lobbyId: string,
  options: { now?: Date; timeZone?: string; requestOrigin?: string | null } = {},
): Promise<RollOutcome> {
  const result = await rollLobby(client, {
    lobbyId,
    rosterKey: await storedRosterKey(client, lobbyId),
    now: options.now ?? new Date(),
    timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
    requestOrigin: options.requestOrigin ?? null,
  });
  if (!result.ok) throw new Error(`roll refused: ${result.status} ${result.error}`);
  return result.value;
}

/** The `rosterKey` a press against this lobby's stored members sends. */
export async function storedRosterKey(client: ServiceClient, lobbyId: string): Promise<string> {
  return lobbyRosterKey(await selectMemberPuuids(client, lobbyId));
}
