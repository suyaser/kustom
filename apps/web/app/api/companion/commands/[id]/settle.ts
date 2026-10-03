import {
  companionCommandAckRequestSchema,
  companionCommandAckResponseSchema,
  companionCommandNackRequestSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { ackCommand, nackCommand, readCommandForPlayer } from '@/lib/commands/queue';
// Registers the listeners on the queue's `onAcked` seam at module load: M4.2's invite fan-out
// hangs off a `create_lobby` that came back `done`. A side-effect import like the companion
// lobby route's — with this line removed both routes behave identically and nobody listens.
import '@/lib/commands/register';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';

/**
 * The two ways a command ends (M4.1): `POST .../commands/{id}/ack` with the kind's result, and
 * `POST .../commands/{id}/nack` with a reason. The contract is the doc comment on
 * `companionCommandsResponseSchema` in `@customs/db/schemas`.
 *
 * Both routes are the same three refusals, in the same order, and both of them matter:
 *
 * - **404** — an id that is not a uuid, does not exist, **or belongs to another player**. Never
 *   403: a 403 would confirm that somebody else's command id exists. The token decides whose
 *   queue this is; the path is only an id.
 * - **409** — the row is already `acked` or `failed`, and **nothing changes**. This is the
 *   server half of execute-once: the companion writes `commands-done.json` before it acks, so a
 *   lost ack is re-sent from that record rather than the command being re-run, and the second
 *   ack must be a refusal that changes no column rather than a second write.
 * - **422** (ack only) — the result does not match the kind's result schema, and the row is left
 *   alone. A mangled result is a companion bug; losing it is better than storing a lie M4.2
 *   will read.
 *
 * The id is curried in from the path segment by `route.ts`, as on `/api/admin/lobbies/[lobbyId]`.
 * It is checked inside the handler and not in the route, so the bearer token stays the first
 * gate: an unauthenticated caller learns nothing about this route's shape.
 */

export function ackRoute(id: string): (request: Request) => Promise<NextResponse> {
  return withCompanionAuth(companionCommandAckRequestSchema, async (body, { client, identity }) => {
    const found = await readCommandForPlayer(client, {
      id,
      targetPlayerId: identity.playerId,
      groupId: identity.groupId,
    });
    if (!found.ok) return jsonError(found.status, found.error);

    const settled = await ackCommand(client, { row: found.row, result: body.result });
    if (!settled.ok) return jsonError(settled.status, settled.error);

    return jsonOk(companionCommandAckResponseSchema, { ok: true });
  });
}

export function nackRoute(id: string): (request: Request) => Promise<NextResponse> {
  return withCompanionAuth(companionCommandNackRequestSchema, async (body, { client, identity }) => {
    const found = await readCommandForPlayer(client, {
      id,
      targetPlayerId: identity.playerId,
      groupId: identity.groupId,
    });
    if (!found.ok) return jsonError(found.status, found.error);

    // `error` is prose and is stored verbatim: the companion writes a
    // `commandFailureReasonSchema` word, then a detail after ': '. The route must not refuse a
    // prefix it does not know, because an older exe may be the one running.
    const settled = await nackCommand(client, {
      row: found.row,
      error: body.error,
      retryable: body.retryable,
    });
    if (!settled.ok) return jsonError(settled.status, settled.error);

    return jsonOk(companionCommandAckResponseSchema, { ok: true });
  });
}
