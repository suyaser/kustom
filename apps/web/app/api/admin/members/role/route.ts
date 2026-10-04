import { memberRoleRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Make a member of the body's group an admin of it, or back (M13.4, owner-aware since M14.11).
 * Session-gated: 401 without a session, 403 for anyone who is not an admin or the owner of the
 * body's `groupId`, 403 `Only the owner can do that.` for an admin demoting another admin, 404 for
 * a player who is not a member of it, 409 for demoting the owner (or the last admin of a group with
 * no owner yet).
 */
export const POST = memberRoleRoute();
