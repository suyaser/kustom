import { withAdminAuth } from '@/lib/adminRoute';
import { handleAdminTokens } from './handler';
import { adminTokensRequestSchema } from './schema';

// node:crypto mints the token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mint a companion token (shown once) for a member of the body's group, or revoke one of the
 * group's tokens. Session-gated: 401 without a session, 403 for anyone who is not an admin of the
 * body's `groupId` (M13.4), 404 for a player or token outside it.
 */
export const POST = withAdminAuth(adminTokensRequestSchema, handleAdminTokens, {
  redirectTo: '/admin/tokens',
});
