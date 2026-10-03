import { issuePairingRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A pairing code for the join page or `/new` (M13.5). 401 without a session, 403 for a session
 * with no Discord identity or a `groupId` it did not create, 404 for no such group or a dead
 * invite. `{ code, expiresAt, group }`.
 */
export const POST = issuePairingRoute();
