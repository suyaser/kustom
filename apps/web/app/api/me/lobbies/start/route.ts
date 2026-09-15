import type { NextResponse } from 'next/server';
import { startLobbyRoute } from './handler';

// The service-role client and the session lookup keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Open tonight's lobby on somebody's client (M4.2): one `create_lobby` command for the host the
 * server picked, and the invites follow off its ack.
 *
 * Session-gated on M3.6's third class since M4.13: 401 without a session, 403 for a session
 * with no linked player, and **no admin check anywhere** — every one of the twenty people who
 * has picked themselves out of a lobby may press it, admins included and not specially. The
 * body carries nothing but where a form post goes back to.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return startLobbyRoute()(request);
}
