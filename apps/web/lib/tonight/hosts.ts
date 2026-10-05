import 'server-only';
import { type HostPresence, readHostPresence } from '../hostPresence';
import { getServiceClient } from '../supabase';
import type { TonightSnapshot } from './types';

/**
 * Who hosts, and whether any of them is up, for Tonight (M14.66): so idle can say
 * `Nobody's Kustom is running right now. Ask Yasser or Omar to open it.` in the strip.
 *
 * Read with the service role on the server (`companion_tokens` has no anon policy); only the
 * names and one boolean reach the page. Null on any failure: the page keeps the anon
 * snapshot's "unknown" (no line), because whether the night is happening may not depend on it.
 */
export async function loadHostPresenceOrNone(groupId: string, now?: Date): Promise<HostPresence | null> {
  try {
    return await readHostPresence(getServiceClient(), { groupId, now });
  } catch (error) {
    console.error('tonight: reading the hosts failed', error);
    return null;
  }
}

/** The snapshot with the server's host facts on it; unchanged for a failed read. */
export function withHostPresence(snapshot: TonightSnapshot, presence: HostPresence | null): TonightSnapshot {
  if (presence === null) return snapshot;
  return { ...snapshot, hostNames: presence.hostNames, hostSeenRecently: presence.hostSeenRecently };
}
