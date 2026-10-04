import type { GroupRole } from '@customs/db/schemas';

/**
 * Which buttons a member's row shows, for who is looking (M14.22; STRATEGY 3.5). Pure. The routes
 * (`/api/admin/members/role`, `/members/remove`, `/owner/transfer`) and their definer functions decide
 * for real; this draws only what they would allow, so nobody is offered a button that can only fail.
 *
 * | viewer \ target | owner | admin                               | member               |
 * |-----------------|-------|-------------------------------------|----------------------|
 * | owner           | none  | Make member, Make owner, Remove     | Make admin, Remove   |
 * | admin           | none  | none (only the owner touches admins) | Make admin, Remove   |
 * | anyone else     | none  | none                                | none                 |
 *
 * The owner's own row has no actions: the owner is never removed or demoted, they hand ownership on
 * first (from an admin's row). An admin stepping down is allowed by the route but not offered here;
 * the owner does it for them (STRATEGY 3.5 lists no step-down).
 */
export type MemberAction = 'make-admin' | 'make-member' | 'make-owner' | 'remove';

export type MemberViewer = { role: 'owner' | 'admin'; playerId: string } | { role: 'read-only' };

export function memberActions(
  viewer: MemberViewer,
  target: { playerId: string; role: GroupRole },
): MemberAction[] {
  if (viewer.role === 'read-only' || target.role === 'owner') return [];
  if (target.playerId === viewer.playerId) return [];
  if (target.role === 'member') return ['make-admin', 'remove'];
  // target is an admin
  return viewer.role === 'owner' ? ['make-member', 'make-owner', 'remove'] : [];
}

/**
 * M14.60: does the row offer `Unlink Discord`? Only when a Discord account is linked to the player.
 * The owner unlinks admins and members but never themselves (they hand ownership on first); an admin
 * unlinks members and themselves, never the owner or another admin (`lib/admin/unlinkDiscord.ts` decides for real; in a group with no owner yet
 * it also lets an admin unlink an admin, which this does not offer, like the role buttons above).
 */
export function canUnlinkDiscord(
  viewer: MemberViewer,
  target: { playerId: string; role: GroupRole; discordLinked: boolean },
): boolean {
  if (viewer.role === 'read-only' || !target.discordLinked) return false;
  if (target.playerId === viewer.playerId) return viewer.role !== 'owner';
  if (viewer.role === 'owner') return true;
  return target.role === 'member';
}
