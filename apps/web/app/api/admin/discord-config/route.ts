import { withAdminAuth } from '@/lib/adminRoute';
import { handleDiscordConfig } from './handler';
import { discordConfigRequestSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Save the group's guild id, results webhook and the voice channel ids the bot (M4) moves people
 * between. Session-gated: 401 without a session, 403 for anyone who is not an admin of the body's
 * `groupId` (M13.4).
 */
export const POST = withAdminAuth(discordConfigRequestSchema, handleDiscordConfig, {
  redirectTo: '/admin/discord',
});
