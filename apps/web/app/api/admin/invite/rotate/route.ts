import { inviteRotateRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Replace the body's group's invite link (M13.5). Session-gated: 401 without a session, 403 for
 * anyone who is not an admin of the body's `groupId`. `{ groupId, code }`; the old link is dead.
 */
export const POST = inviteRotateRoute();
