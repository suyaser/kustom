import { companionPairRequestSchema, companionPairResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { ServerEnvError } from '@/lib/env';
import { PAIRING_RATE_LIMITED } from '@/lib/groups/copy';
import { allowPairAttempt, clientAddress, redeemPairingCode } from '@/lib/groups/pairing';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';
import { getServiceClient, type ServiceClient } from '@/lib/supabase';

/**
 * `POST /api/companion/pair { code, puuid }` (M13.5): Kustom sends the code a person typed and the
 * PUUID it reads from League on that PC. **The one companion route with no token** -- the person
 * pairing has none, and joining never mints one (decision 2026-09-23).
 *
 * Order: the rate limit first (10 a minute per address, every attempt counted, a malformed one
 * too), then the body, then `redeem_pairing_code`. Every refusal is the envelope with the sentence
 * Kustom prints verbatim: 429, 404 for a code nobody was given, 410 for a used or expired one, 409
 * for the two "already linked" cases. A refusal writes nothing and leaves the code usable.
 *
 * The PUUID in the body is trusted for exactly one thing: it is who is signed into League on the
 * PC the person is sitting at. Who the person is on Discord comes from the code, which only their
 * own signed-in session could have been given.
 */
export interface PairRouteOptions {
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: () => ServiceClient;
}

export function companionPairRoute(options: PairRouteOptions = {}) {
  return async (request: Request): Promise<NextResponse> => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`companion pair: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      if (!(await allowPairAttempt(client, clientAddress(request)))) {
        return jsonError(429, PAIRING_RATE_LIMITED);
      }

      const body = await parseJsonBody(request, companionPairRequestSchema);
      if (!body.ok) return body.response;

      const result = await redeemPairingCode(client, body.data.code, body.data.puuid);
      if (!result.ok) return jsonError(result.status, result.error);

      return jsonOk(companionPairResponseSchema, { ok: true, group: result.value.group });
    } catch (error) {
      console.error('companion pair failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
