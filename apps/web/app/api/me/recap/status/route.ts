import { recapStatusRoute } from './handler';

// The service-role client and the session lookup keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Has this game's recap line landed (M19.16): `{ landed }` for a linked member of the query's
 * `groupId`. 401 signed out, 403 unlinked or not a member.
 */
export const GET = recapStatusRoute();
