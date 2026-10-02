import { discordLobbyHook } from '../discord/post';
import { registerLobbyHook } from './hooks';

/**
 * Where Discord is plugged into ingest (M3.1, M3.3), and the only file in `lib/ingest` that
 * knows Discord exists.
 *
 * The roll (`lib/admin/roll.ts`) and the game route announce what happened through `hooks.ts`
 * and never import a poster; importing *this* module is what makes anybody listen. The routes
 * that fire them do it — the roll route and the companion game route — because a route module
 * is loaded once per process and the routes are where the app is composed. The roll still
 * balances with this import removed — that is the property the seam exists to protect.
 */

/** Idempotent: `registerLobbyHook` deduplicates on the object, and there is one object. */
export function registerDiscordHooks(): void {
  registerLobbyHook(discordLobbyHook);
}

registerDiscordHooks();
