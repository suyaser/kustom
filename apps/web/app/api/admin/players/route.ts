import { withAdminAuth } from '@/lib/adminRoute';
import { handleAdminPlayers } from './handler';
import { adminPlayersRequestSchema } from './schema';

// The service-role client and node:crypto (through the session lookup) keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rename a member, link or unlink their Discord id, or make them an admin of the group or back
 * (`set-roles` and `set-backfill` are retired and answer 410). Session-gated: 401 without a session, 403 for anyone who is not an admin
 * of the body's `groupId` (M13.4), 404 for a player who is not a member of that group.
 */
export const POST = withAdminAuth(adminPlayersRequestSchema, handleAdminPlayers, {
  redirectTo: '/admin/players',
});
