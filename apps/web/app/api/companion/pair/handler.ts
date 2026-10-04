import { companionPairRequestSchema, companionPairResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { ServerEnvError } from '@/lib/env';
import { PAIRING_RATE_LIMITED } from '@/lib/groups/copy';
import { allowPairAttempt, clientAddress, redeemPairingCode } from '@/lib/groups/pairing';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';
import { getServiceClient, type ServiceClient } from '@/lib/supabase';

/**
 * `POST /api/companion/pair { code, puuid, mode? }` (M13.5; host mode M14.12): Kustom sends the
 * code a person typed and the PUUID it reads from League on that PC. **The one companion route with
 * no token** -- the person pairing has none.
 *
 * `mode: 'overlay'` or no mode is M13.5 exactly: `{ ok, group }`, never a token. `mode: 'host'`
 * links the same way and then, when the code's session is the group's owner or an admin and the
 * PUUID is their own linked account, mints a host token and returns it **once** as
 * `companionToken`; a member gets `hostRefusal` instead (`lib/groups/pairing.ts`, decision row
 * 2026-10-03). The token is in this response and nowhere else: never logged, stored as SHA-256.
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

      const mode = body.data.mode ?? 'overlay';
      const result = await redeemPairingCode(client, body.data.code, body.data.puuid, mode);
      if (!result.ok) return jsonError(result.status, result.error);

      const { group, companionToken, hostRefusal } = result.value;
      return jsonOk(companionPairResponseSchema, {
        ok: true,
        group,
        ...(companionToken === undefined ? {} : { companionToken }),
        ...(hostRefusal === undefined ? {} : { hostRefusal }),
      });
    } catch (error) {
      // Never the token: nothing above throws with it in the message.
      console.error('companion pair failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
