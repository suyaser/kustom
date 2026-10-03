import {
  pairingRequestSchema,
  pairingResponseSchema,
  pairingStatusQuerySchema,
  pairingStatusResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { issuePairingCode, pairingStatus } from '@/lib/groups/pairing';
import { type SessionRouteOptions, withSession } from '@/lib/groups/sessionRoute';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';

/**
 * `POST /api/me/pairing { groupId | inviteCode }` (M13.5): a six-character code for this session
 * and group, 15 minutes, single use, replacing any earlier one. Allowed for the group's creator
 * (`groupId`) or a holder of the live invite (`inviteCode`): 403 for a `groupId` the session did
 * not create, 404 for no such group or a dead invite.
 */
export function issuePairingRoute(options: SessionRouteOptions & { now?: () => Date } = {}) {
  return withSession(async (request, { client, me }): Promise<NextResponse> => {
    const body = await parseJsonBody(request, pairingRequestSchema);
    if (!body.ok) return body.response;

    const result = await issuePairingCode(
      client,
      { userId: me.userId, discordId: me.discordId },
      body.data,
      options.now ? { now: options.now() } : {},
    );
    if (!result.ok) return jsonError(result.status, result.error);

    return jsonOk(pairingResponseSchema, { ok: true, ...result.value });
  }, options);
}

/**
 * `GET /api/me/pairing/status?code=` (M13.5): `waiting`, `used` (with the group, so the page can
 * move to it) or `expired`, for a code this session was given. 404 for any other code. The page
 * asks every 3 s.
 */
export function pairingStatusRoute(options: SessionRouteOptions & { now?: () => Date } = {}) {
  return withSession(async (request, { client, me }): Promise<NextResponse> => {
    const parsed = pairingStatusQuerySchema.safeParse({
      code: new URL(request.url).searchParams.get('code') ?? undefined,
    });
    if (!parsed.success) return jsonError(400, 'code is required');

    const result = await pairingStatus(client, me.userId, parsed.data.code, options.now?.() ?? new Date());
    if (!result.ok) return jsonError(result.status, result.error);

    return jsonOk(pairingStatusResponseSchema, result.value);
  }, options);
}
