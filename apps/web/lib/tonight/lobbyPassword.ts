import type { ServiceClient } from '../supabase';
import type { TonightSnapshot } from './types';
import type { ViewerState } from './viewer';

/**
 * Tonight's custom-lobby password, for the one reader who may have it (M14.28).
 *
 * `lobbies.lobby_password` is not readable with the anon key (`0028`), so `loadTonight` returns
 * every lobby with `lobbyPassword: null`. The page calls {@link withLobbyPassword} after it knows
 * who is reading: **a linked member of this group** gets the password (M4.10's `Missed the invite?`
 * line), read here with the service role; an anonymous visitor, a signed-in viewer with no player
 * row, and a linked player who is not a member of this group get the snapshot untouched, so the
 * password is in neither their HTML nor their RSC payload.
 */

/** Whether this viewer may be shown this group's lobby password. */
export function maySeeLobbyPassword(viewer: ViewerState): boolean {
  return viewer.kind === 'linked' && viewer.isMember === true;
}

/** The password of one lobby of one group, read with the service role. Null when it has none. */
export async function loadLobbyPassword(
  client: ServiceClient,
  lobbyId: string,
  groupId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('lobby_password')
    .eq('id', lobbyId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`tonight: lobby password lookup failed: ${error.message}`);
  return data?.lobby_password ?? null;
}

/**
 * The snapshot with tonight's lobby password filled in for a linked member, and unchanged for
 * everyone else (`read` is never called for them). A failed read is logged and leaves the line
 * without its password rather than taking the page down.
 */
export async function withLobbyPassword(
  snapshot: TonightSnapshot,
  viewer: ViewerState,
  groupId: string,
  read: (lobbyId: string, groupId: string) => Promise<string | null>,
): Promise<TonightSnapshot> {
  if (snapshot.lobby === null || !maySeeLobbyPassword(viewer)) return snapshot;
  try {
    const lobbyPassword = await read(snapshot.lobby.id, groupId);
    return { ...snapshot, lobby: { ...snapshot.lobby, lobbyPassword } };
  } catch (error) {
    console.error('tonight: reading the lobby password failed; showing the line without it', error);
    return snapshot;
  }
}
