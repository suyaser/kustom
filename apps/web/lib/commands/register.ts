import type { LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { registerLobbyHook } from '../ingest/hooks';
import { getServiceClient } from '../supabase';
import { queueSwitchSideForBalance } from './switchSide';

/**
 * Where the command queue is plugged into the rest of the app (M4.1), and the only file in
 * `lib/commands` that knows the lobby state machine exists.
 *
 * One listener, registered at module load: the `balanced` transition queues `switch_side`
 * (M4.1/M4.3). The invite fan-out that hung off a `create_lobby` ack went with the lobby press
 * (M22.11): nothing queues `create_lobby` or `invite` any more.
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

/** Idempotent: the registry deduplicates on the object, and there is one object. */
export function registerCommandLobbyHooks(): void {
  registerLobbyHook(commandLobbyHook);
}

registerCommandLobbyHooks();
