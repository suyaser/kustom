import { companionLobbyPayloadSchema, companionLobbyResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import { ingestLobby, mayReportLobby } from '@/lib/ingest/lobby';
import { sweepIdleLobbies } from '@/lib/lobbyState';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companion posts the whole lobby member list every time it changes. Idempotent: posting
 * the same lobby twice leaves exactly one live row and the same members.
 *
 * `reported_by_player_id` comes from the token, never from the body.
 *
 * Refused here, before anything is written:
 * - 403 when the token's player is neither in the posted `members` nor already the reporter
 *   of this party's live lobby (architecture "Security": a companion may only report a lobby
 *   it is in).
 *
 * From `in_game` on the roster is frozen (M2.9): the post still answers 200 and the lobby
 * name and password still refresh, but no `lobby_members` row is added, removed or changed.
 * Once the row is `dropped`, `finished` or `abandoned` the next post starts the night's next
 * cycle (M2.14, M5.11).
 *
 * This route never balances (2026-10-03): `open` -> `balanced` is an admin's press,
 * `POST /api/admin/lobbies/[lobbyId]/roll`. A roster change still sends a `balanced` lobby back
 * to `open`. The answer carries `ranksNeeded`, the PUUIDs on this list whose rank is missing or
 * over a week old (M2.4), and `recheckInMs`, which is always `null` now and stays on the wire
 * for the companions already installed. The Discord and command-queue listeners are therefore
 * registered by the roll route, not here.
 *
 * Bot and placeholder entries are dropped by the payload schema before any of this, so an old
 * companion that posts a bot loses the bot and keeps its nine friends (M2.10, point 4). The
 * M1.8 caller check below therefore runs on the filtered list, which is the order the brief
 * asks for.
 */
export const POST = withCompanionAuth(companionLobbyPayloadSchema, async (payload, { client, identity }) => {
  if (payload.droppedMembers > 0) {
    console.warn(
      `companion lobby ${payload.partyId}: dropped ${payload.droppedMembers} bot or placeholder member(s)`,
    );
  }

  // Two statements at the start of every companion post: a lobby nobody has mentioned for
  // two hours is given up on (M2.5) — `abandoned` if it never started, `dropped` if it did
  // and no result ever came (M5.11). The second is what lets this very post open the
  // night's next cycle for a party whose last game was never closed.
  const now = new Date();
  await sweepIdleLobbies(client, now);

  if (!(await mayReportLobby(client, payload, identity))) {
    return jsonError(403, 'a companion may only report a lobby it is in');
  }

  const result = await ingestLobby(client, payload, identity.playerId, { now });

  return jsonOk(companionLobbyResponseSchema, {
    ok: true,
    lobbyId: result.lobbyId,
    status: result.status,
    created: result.created,
    memberCount: result.memberCount,
    rosterFrozen: result.rosterFrozen,
    recheckInMs: result.recheckInMs,
    ranksNeeded: result.ranksNeeded,
  });
});
