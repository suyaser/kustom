import type { GroupSummary } from '@customs/db/schemas';
import { getServiceClient } from '../supabase';
import { groupByInviteCode } from './invites';
import { supabaseGroupRole } from './membership';
import { currentPageSession } from './pageSession';

/**
 * What `/join/<code>` shows (M13.13, M14.21; STRATEGY 3.4), decided on the server. Read only: joining
 * and pairing are the client's posts to `POST /api/groups/join` and `POST /api/me/pairing`.
 *
 * - `dead`: a rotated, unknown or malformed code. Checked **before** the session, so a dead link
 *   reads the same to everybody and a signed-out visitor is not sent through Discord for nothing.
 * - `signed-out`: the pitch and the sign-in, coming back here.
 * - `member`: already in the group, whatever their role; the page sends them to it.
 * - `linked`: a player row and no membership: the one-tap `Join <Group>`.
 * - `unlinked`: signed in with no player row: `Which League account is yours?`.
 *
 * The code is service-role only (`group_invites` has no read policy), so the lookup is the server's;
 * the page never sees anything but the group's id, slug and name.
 */
export type JoinState =
  | { kind: 'dead' }
  | { kind: 'signed-out'; group: GroupSummary }
  | { kind: 'member'; group: GroupSummary }
  | { kind: 'linked'; group: GroupSummary }
  | { kind: 'unlinked'; group: GroupSummary };

export async function loadJoinState(code: string): Promise<JoinState> {
  const client = getServiceClient();
  const found = await groupByInviteCode(client, code);
  if (found === null) return { kind: 'dead' };
  const group: GroupSummary = { id: found.id, slug: found.slug, name: found.name };

  const session = await currentPageSession();
  if (session.kind !== 'signed-in') return { kind: 'signed-out', group };
  if (session.player === null) return { kind: 'unlinked', group };

  const role = await supabaseGroupRole(client)(session.player.playerId, group.id);
  return role === null ? { kind: 'linked', group } : { kind: 'member', group };
}
