import { setGroupModeRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Mode card's writes (M14.29, M15.3, M20.7): `{ groupId, mode | rated | spin | redraw |
 * side+region, game?, redirectTo? }` -> `{ ok: true, state, notice, changed, thisGame?, spun? }`.
 * `mode` is a standing mode or a rule choice (`class:Tank`, `region`, `mirror`; region wars draws
 * its pair in the same write), `rated` the next game's Rated switch, `spin: true` the server's pick,
 * `redraw` / `side` the region pair. Every action is for the next game (the row), or with
 * `game: 'this'` for the balanced lobby's lock (M20 D9; M20.18 for the rule, Spin and Rated), a 409
 * once the game has started. Session-gated: 401 without a session, 403 for anyone who is not an
 * admin or the owner of the body's `groupId`. Posts to Discord only for a `this` change (the teams
 * post again with the lock's rule line).
 */
export const POST = setGroupModeRoute();
