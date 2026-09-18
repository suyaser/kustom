import { fearlessResetRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clear the fearless-draft pool (M10). Session-gated: 401 without a session, 403 for
 * anyone who is not `players.is_admin`.
 */
export const POST = fearlessResetRoute();
