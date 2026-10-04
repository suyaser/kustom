import { aiLinesRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turn AI lines on or off for the body's group (M16.3b). Session-gated: 401 without a session, 403
 * for anyone who is not an admin or the owner of the body's `groupId`, 404 for a group without
 * Premium.
 */
export const POST = aiLinesRoute();
