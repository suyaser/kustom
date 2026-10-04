import { type GroupRole, isAtLeast } from '@customs/db/schemas';
import { cache } from 'react';
import { type PlayerInGroupLookup, supabasePlayerInGroup } from '../groups/membership';
import type { PageGroup } from '../groups/pageGroup';
import { currentPageIdentity, currentPlayerInGroup, type PageIdentity } from '../groups/pageSession';
import { getServiceClient, type ServiceClient } from '../supabase';
import { isSuperAdmin } from '../superAdmin';

/**
 * Who may open `/g/<slug>/admin/*` (M14.21, M14.22; M13.14), decided on the server for every
 * request. A rendering decision only: every control on the page posts to an `/api/admin/*` or
 * `/api/me/*` route that checks the session again before it writes (CLAUDE.md: the admin check is
 * never only the client's). Read only, unlike `resolveAdmin`, which may write the bootstrap admin.
 *
 * - `runs-group`: an `owner` or `admin` membership in **this** group (M14.11).
 * - `creator-unlinked`: the session that created the group (`groups.created_by`, M13.5) and has no
 *   player row yet. It lands here straight from `/new` (STRATEGY 3.3) but is not a member, so it is
 *   not the owner until it pairs: it sees the checklist, the invite card and the host card, and may
 *   make the setup writes the server allows it -- `POST /api/me/pairing { groupId }`, and since M14.40
 *   Connect Discord, the test post, `discord-config` and `New link` (`authorizeSetupWrite`) -- and
 *   nothing that needs a membership.
 * - `operator`: a super-admin (`SUPER_ADMIN_USER_IDS`, M14.19) who does not run this group. Reads
 *   everything, with every write control absent, `ADMIN_READ_ONLY_LINE`, and the invite masked. The
 *   same rule order as `resolveAdminRead`: the membership first, the list only after it says no.
 * - `not-admin`, `signed-out`: their own states on the page.
 */
export type AdminAccess =
  | { kind: 'signed-out' }
  | { kind: 'not-admin' }
  | { kind: 'creator-unlinked' }
  | { kind: 'operator' }
  | { kind: 'runs-group'; role: Extract<GroupRole, 'owner' | 'admin'>; playerId: string };

export interface DecideOptions {
  /** Injection point for tests; defaults to the env list. */
  isSuperAdmin?: (userId: string) => boolean;
  /**
   * The player-and-membership read (one query). Defaults to `supabasePlayerInGroup(client)`;
   * {@link currentAdminAccess} passes the request-cached one the group layout's viewer also uses.
   */
  lookupMember?: PlayerInGroupLookup;
}

export async function decideAdminAccess(
  client: ServiceClient,
  session: PageIdentity,
  group: Pick<PageGroup, 'id'>,
  options: DecideOptions = {},
): Promise<AdminAccess> {
  if (session.kind === 'anonymous') return { kind: 'signed-out' };
  const superAdmin = options.isSuperAdmin ?? ((userId: string) => isSuperAdmin(userId));
  const operatorOr = (fallback: AdminAccess): AdminAccess =>
    superAdmin(session.userId) ? { kind: 'operator' } : fallback;

  if (session.kind === 'no-discord') return operatorOr({ kind: 'not-admin' });

  // The player and their membership in this group, together: `null` is no player row (the
  // unlinked case below), a player with `role: null` is a linked non-member.
  const member = await (options.lookupMember ?? supabasePlayerInGroup(client))(session.discordId, group.id);
  if (member !== null) {
    const { role } = member;
    if (role !== null && isAtLeast(role, 'admin')) {
      return {
        kind: 'runs-group',
        role: role === 'owner' ? 'owner' : 'admin',
        playerId: member.player.playerId,
      };
    }
    return operatorOr({ kind: 'not-admin' });
  }

  const { data, error } = await client.from('groups').select('created_by').eq('id', group.id).maybeSingle();
  if (error) throw new Error(`admin page: reading the group's creator failed: ${error.message}`);
  if (data !== null && data.created_by !== null && data.created_by === session.userId) {
    return { kind: 'creator-unlinked' };
  }
  return operatorOr({ kind: 'not-admin' });
}

/** {@link decideAdminAccess} for this request, shared by the layout, the pages and anything else. */
export const currentAdminAccess: (group: PageGroup) => Promise<AdminAccess> = cache(
  async (group: PageGroup) =>
    decideAdminAccess(getServiceClient(), await currentPageIdentity(), group, {
      lookupMember: currentPlayerInGroup,
    }),
);

/**
 * M14.51: the session created this group and has not linked a League account yet. Before they link
 * they have no membership, so the shell's `Admin` and the You tab's Admin card (both drawn from the
 * membership) would leave them no way back to the admin home `/new` landed them on. A drawing
 * decision only, like {@link currentAdminAccess}; a failed read is `false` (logged), never an error
 * page on a public group page.
 */
export async function isUnlinkedCreator(group: PageGroup): Promise<boolean> {
  try {
    return (await currentAdminAccess(group)).kind === 'creator-unlinked';
  } catch (error) {
    console.error('admin access: reading the group creator failed', error);
    return false;
  }
}
