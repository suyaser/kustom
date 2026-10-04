import { setGroupModeRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Mode card's writes (M14.29, M15.3): `{ groupId, mode | rated | spin, redirectTo? }` ->
 * `{ ok: true, mode, changed, next, spun? }`. `mode` is a standing mode or a rule choice
 * (`class:Tank`, `region`, `mirror`), `rated` the next game's Rated switch, `spin: true` the
 * server's pick. Session-gated: 401 without a session, 403 for anyone who is not an admin or the
 * owner of the body's `groupId`. Posts nothing to Discord.
 */
export const POST = setGroupModeRoute();
