import { meAiOptOutRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in player's own `Write about me` in the body's group (M16.3b). 401 without a session,
 * 403 without a linked player or a membership in the body's `groupId`.
 */
export const POST = meAiOptOutRoute();
