import { spinModeRoute } from '../handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Spin (M15.3, R3): `{ groupId, redirectTo? }` -> the same answer as `POST /api/admin/mode` with
 * `spin: true` (`{ ok, mode, changed, next, spun }`). The server picks with a real RNG: a family,
 * then an option; never mirror, never tonight's previous rule, never an option too small to play.
 * Session-gated like every admin route. Posts nothing to Discord. 409 when nothing is left to draw.
 */
export const POST = spinModeRoute();
