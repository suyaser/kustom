import { mysteryGuessRequestSchema, mysteryGuessResponseSchema } from '@customs/db/schemas';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';
import { visitorFromRequest, withMysteryCookie } from '@/lib/mystery/request';
import { submitGuess } from '@/lib/mystery/service';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lock one guess. After this the visitor sees the answer, the full performance, and
 * today's anonymous community numbers. A second post returns the same locked result. An optional
 * `group` (M13.4) that is not the challenge's group is the same 404 as no challenge.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> },
): Promise<Response> {
  const parsed = await parseJsonBody(request, mysteryGuessRequestSchema);
  if (!parsed.ok) return parsed.response;
  const visitorId = visitorFromRequest(request, parsed.data.anonymousVisitorId);
  if (visitorId === null) return jsonError(400, 'anonymous visitor id is required');

  const { challengeId } = await context.params;
  const result = await submitGuess(getServiceClient(), {
    challengeId,
    visitorId,
    playerId: parsed.data.playerId,
    now: new Date(),
    timeZone: nightTimeZone(),
    groupId: parsed.data.group,
  });
  if ('error' in result) return jsonError(result.status, result.error);
  return withMysteryCookie(
    jsonOk(mysteryGuessResponseSchema, { ok: true, result: result.result }),
    visitorId,
  );
}
