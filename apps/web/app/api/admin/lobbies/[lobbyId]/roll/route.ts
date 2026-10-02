import type { NextResponse } from 'next/server';
import { rollRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Balance an `open` lobby: the admin's press that replaced the ten-second auto-balance
 * (2026-10-03). 401 without a session, 403 for a non-admin, 409 for a stale roster, fewer than
 * ten, or a lobby past `balanced`. A repeat press answers the split already up.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ lobbyId: string }> },
): Promise<NextResponse> {
  const { lobbyId } = await context.params;
  return rollRoute(lobbyId)(request);
}
