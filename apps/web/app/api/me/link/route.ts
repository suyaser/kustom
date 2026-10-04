import { selfLinkRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Link the signed-in Discord account to a player row, once, by picking yourself out of
 * tonight's lobby or a game that ended in the last 12 hours (M3.6, M14.34).
 *
 * 401 without a session, 403 for a session with no Discord identity, 403 for a PUUID that is
 * in neither, 409 for a player somebody is already linked to and for a session
 * that is already linked. A wrong link is undone by an admin's `Unlink Discord` (M14.60).
 */
export const POST = selfLinkRoute();
