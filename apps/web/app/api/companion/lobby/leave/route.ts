import { companionLobbyLeavePayloadSchema, companionLobbyLeaveResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonOk } from '@/lib/http';
import { leaveLobby } from '@/lib/ingest/lobby';
import { withLiveSignal } from '@/lib/live/bump';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * M22.9: the companion's client closed lobby `partyId` and no game started. Clears the token's
 * current party if it is still that one and lets go the lobbies the token left, so the table goes
 * at once instead of after `HOST_WINDOW_MS`. The group and player come from the token. Idempotent:
 * a repeat, or a leave that lost the race to the same Kustom's next lobby post, answers
 * `released: false` and writes nothing. Never touches another group.
 */
export const POST = withCompanionAuth(companionLobbyLeavePayloadSchema, async (payload, { client, identity }) =>
  withLiveSignal(client, async (live) => {
    const released = await leaveLobby(client, {
      groupId: identity.groupId,
      playerId: identity.playerId,
      tokenId: identity.tokenId,
      partyId: payload.partyId,
      now: new Date(),
      live,
    });
    return jsonOk(companionLobbyLeaveResponseSchema, { ok: true, released });
  }),
);
