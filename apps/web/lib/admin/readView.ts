import type { AdminAccess, AdminInviteView } from '@customs/db/schemas';
import type { AdminReader } from '../adminAuth';

/**
 * What an admin read shows, by who is reading (M13.6 / M14.19). Pure: the reader from the read gate
 * in, the view out. Every admin GET and every admin page read goes through these, so the operator's
 * masking is one function, not a rule each page remembers.
 */

/**
 * The invite link's place for an operator who is not this group's admin (STRATEGY §3.3, product's
 * copy). Seeing the link is a door to joining, so the operator never gets it.
 */
export const INVITE_HIDDEN = "Hidden. Only this group's admins can see the invite link.";

/** The hairline line on every admin page an operator reads (M13.14, product's copy). */
export const ADMIN_READ_ONLY_LINE = 'Read only. You are not an admin of this group.';

export function adminAccess(reader: AdminReader): AdminAccess {
  return reader.kind === 'group_admin'
    ? { kind: 'group_admin', role: reader.role, readOnly: false }
    : { kind: 'operator', readOnly: true };
}

/** The `/join/<code>` link on this origin. */
export function inviteUrl(origin: string, code: string): string {
  return new URL(`/join/${encodeURIComponent(code)}`, origin).toString();
}

/**
 * The invite as `reader` may see it. The operator gets `hidden` whether or not a code exists; the
 * stored code is not even looked at for them.
 */
export function adminInviteView(
  reader: AdminReader,
  invite: { code: string; rotatedAt: string } | null,
  origin: string,
): AdminInviteView {
  if (reader.kind !== 'group_admin') return { state: 'hidden', message: INVITE_HIDDEN };
  if (invite === null) return { state: 'none' };
  return {
    state: 'shown',
    code: invite.code,
    url: inviteUrl(origin, invite.code),
    rotatedAt: invite.rotatedAt,
  };
}
