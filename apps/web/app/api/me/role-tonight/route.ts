import { roleTonightRoute } from './handler';

// The service-role client and the session lookup keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Set (or clear) the role a player wants for tonight (M3.6).
 *
 * Session-gated, and the first route of the **third class**: a Supabase session with a linked
 * player who is a member of the body's `groupId` (M13.4). 401 without a session, 403 for a
 * session with no linked player or not in the group, 403 for a body that names somebody else's
 * PUUID unless the caller is an admin of that group, 404 for a lobby that is not the group's.
 */
export const POST = roleTonightRoute();
