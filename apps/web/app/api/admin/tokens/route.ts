import { adminTokensRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revoke one of the group's companion tokens; `mint` is a 410 since Kustom 1.0 links itself with a code
 * (M17.12). Session-gated: 401 without a session, 403 for anyone who is not an admin of the body's
 * `groupId` (M13.4), 404 for a token outside it.
 */
export const POST = adminTokensRoute();
