import type { CompanionCommandKind } from '@customs/db/schemas';

/**
 * The queue's settle seam. The same shape as `lib/ingest/hooks.ts`, for the same reason: the
 * queue decides what happened, something else decides what to do about it.
 *
 * `POST /api/companion/commands/{id}/ack` and `.../nack` announce a settled row here. M4.2 hung
 * the invite fan-out off `onAcked`; M22.11 removed it with the lobby press, so nothing in
 * production listens today. The seam stays: it is the queue's contract and its tests use it.
 *
 * A hook that throws is logged and the response still goes out: the companion has already done
 * the work and its ack must not fail because a listener did.
 */

/** A command reached `acked` or `failed`. `failed` is a nack, `acked` carries the kind's result. */
export interface CommandAckedEvent {
  commandId: string;
  targetPlayerId: string;
  /** The command's group, which is its target token's (M13.3). */
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
