import { memberRoleRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Make a member of the body's group an admin of it, or back (M13.4). Session-gated: 401 without a
 * session, 403 for anyone who is not an admin of the body's `groupId`, 404 for a player who is not
 * a member of it, 409 `This group needs at least one admin.` for demoting the last one.
 */
export const POST = memberRoleRoute();
