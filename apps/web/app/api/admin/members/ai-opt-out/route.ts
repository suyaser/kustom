import { memberAiOptOutRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Leave a member of the body's group out of AI lines (M16.3b). Session-gated: 401 without a session,
 * 403 for anyone who is not an admin or the owner of the body's `groupId`, 403 for an attempt to
 * switch them back on (only the player can), 404 for a player who is not a member of it.
 */
export const POST = memberAiOptOutRoute();
