import { ownerTransferRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hand the body's group to one of its admins (M14.11). Session-gated: 401 without a session, 403
 * for anyone who is not an admin or the owner of the body's `groupId`, 403 `Only the owner can do
 * that.` for an admin, 404 for a player who is not a member, 409 for a member who is not an admin.
 */
export const POST = ownerTransferRoute();
