import { startStatusRoute } from './handler';

// The service-role client and the session lookup keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where tonight's Start a lobby press is (M19.16): `{ status, host }` for a linked member of the
 * query's `groupId`. 401 signed out, 403 unlinked or not a member. A page polls it while pending.
 */
export const GET = startStatusRoute();
