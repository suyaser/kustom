import { joinGroupRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Join a group by its invite link, one tap, for a linked session (M13.5). 401 without a session,
 * 403 when the session has no player yet, 404 for a dead link.
 */
export const POST = joinGroupRoute();
