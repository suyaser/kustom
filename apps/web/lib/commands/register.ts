import type { LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { registerLobbyHook } from '../ingest/hooks';
import { getServiceClient } from '../supabase';
import { registerCommandHook } from './hooks';
import { inviteFanOutHook } from './invites';
import { queueSwitchSideForBalance } from './switchSide';

/**
 * Where the command queue is plugged into the rest of the app (M4.1, M4.2), and the only file in
 * `lib/commands` that knows the lobby state machine exists.
 *
 * Two listeners, both registered at module load:
 *
 * - the `balanced` transition queues `switch_side` (M4.1/M4.3);
 * - a `create_lobby` coming back `done` fans out the invites (M4.2). That one hangs off the
 *   queue's own `onAcked` seam, so the ack routes (`app/api/companion/commands/[id]/*`) import
 *   this module for the same side effect the lobby route does.
 *
 * Same seam and same rule as `lib/ingest/discord.ts`: `lobby.ts` announces that a lobby
 * balanced and never imports a queue writer; importing *this* module is what makes anybody
 * listen. The roll route does it (`app/api/admin/lobbies/[lobbyId]/roll/handler.ts`), because
 * since 2026-10-03 the admin's roll is the only thing that fires `balanced`. With this import
 * removed, the roll still balances and nothing is queued — the property the seam exists for.
 *
 * The other direction (a lobby *leaving* `balanced` supersedes what it queued) is not a hook:
 * it is in `moveLobby` itself, because there is exactly one function that moves a lobby and a
 * superseded command is part of the move, not a reaction to it.
 */
export const commandLobbyHook: LobbyHook = {
  onBalanced: async (event: LobbyBalancedEvent): Promise<void> => {
    // `getServiceClient` reads the environment when it is called, never at import, so this
    // module can be imported by a build that has no Supabase keys.
    await queueSwitchSideForBalance(getServiceClient(), event);
  },
};

/**
 * The invite fan-out, with the process-wide clock, gate and client (M4.2). Built once so
 * `registerCommandHook`'s deduplication has one object to compare, exactly as above.
 */
export const commandInviteHook = inviteFanOutHook();

/** Idempotent: both registries deduplicate on the object, and there is one object each. */
export function registerCommandLobbyHooks(): void {
  registerLobbyHook(commandLobbyHook);
  registerCommandHook(commandInviteHook);
}

registerCommandLobbyHooks();
