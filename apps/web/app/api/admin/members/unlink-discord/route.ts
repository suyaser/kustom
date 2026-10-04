import { memberUnlinkDiscordRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unlink a member's Discord account from their player (M14.60), everywhere: the link belongs to
 * the player, not the group. Ratings, games and memberships stay. Session-gated: 401 without a
 * session, 403 for anyone who is not an admin or the owner of the body's `groupId`, 403 `Only the
 * owner can unlink the owner's Discord.` for an admin naming the owner, 403 `Only the owner can do
 * that.` for an admin naming another admin, 404 for a player who is not a member of it. An admin
 * may unlink themselves. A repeat press is a 200 with `changed: false`.
 */
export const POST = memberUnlinkDiscordRoute();
