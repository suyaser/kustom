import { memberRemoveRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Remove a player from the body's group (M14.11). Session-gated: 401 without a session, 403 for
 * anyone who is not an admin or the owner of the body's `groupId`, 403 `Only the owner can do
 * that.` for an admin removing an admin, 404 for a player who is not a member, 409 `The owner
 * can't be removed. Hand ownership to an admin first.` for the owner.
 */
export const POST = memberRemoveRoute();
