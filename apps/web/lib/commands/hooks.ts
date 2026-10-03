import type { CompanionCommandKind } from '@customs/db/schemas';

/**
 * The seam M4.2 fills, and nothing else. The same shape as `lib/ingest/hooks.ts`, for the same
 * reason: the queue decides what happened, something else decides what to do about it.
 *
 * `POST /api/companion/commands/{id}/ack` and `.../nack` announce a settled row here. M4.2
 * hangs the invite fan-out off `onAcked` — a `create_lobby` that came back with a `partyId` is
 * the moment the invites are worth sending, and the queue must not have to know that.
 *
 * A hook that throws is logged and the response still goes out: the companion has already done
 * the work and its ack must not fail because a listener did.
 */

/** A command reached `acked` or `failed`. `failed` is a nack, `acked` carries the kind's result. */
export interface CommandAckedEvent {
  commandId: string;
  targetPlayerId: string;
  /** The command's group, which is its target token's (M13.3). The invite fan-out stays inside it. */
  groupId: string;
  kind: CompanionCommandKind;
  status: 'acked' | 'failed';
  /** The parsed result, for `acked` only. */
  result: Record<string, unknown> | null;
  /** The companion's nack text, for `failed` only. */
  error: string | null;
}

export interface CommandHook {
  onAcked?: (event: CommandAckedEvent) => void | Promise<void>;
}

const hooks: CommandHook[] = [];

/** Register a listener. Idempotent per object, like `registerLobbyHook`. */
export function registerCommandHook(hook: CommandHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

/** Tests only: forget every listener. */
export function clearCommandHooks(): void {
  hooks.length = 0;
}

export async function emitCommandAcked(event: CommandAckedEvent): Promise<void> {
  for (const hook of hooks) {
    if (!hook.onAcked) continue;
    try {
      await hook.onAcked(event);
    } catch (error) {
      console.error(`command hook onAcked failed for ${event.commandId}`, error);
    }
  }
}
