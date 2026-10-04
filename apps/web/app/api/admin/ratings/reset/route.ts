import { ratingsResetRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The owner's `Reset ratings` (M14.18). Session-gated: 401 without a session, 403 for anyone who is
 * not an admin of the body's `groupId`, 403 `Only the owner can reset ratings.` for an admin, 400
 * when the typed slug is wrong, 409 `Finish tonight's game first.` while a lobby is live or a game
 * landed in the last 15 minutes.
 */
export const POST = ratingsResetRoute();
