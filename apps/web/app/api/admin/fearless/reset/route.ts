import { fearlessResetRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clear the fearless-draft pool (M10) of the body's group. Session-gated: 401 without a session,
 * 403 for anyone who is not an admin of the body's `groupId` (M13.4).
 */
export const POST = fearlessResetRoute();
