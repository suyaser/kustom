import { mysteryClueRequestSchema, mysteryClueResponseSchema } from '@customs/db/schemas';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';
import { visitorFromRequest, withMysteryCookie } from '@/lib/mystery/request';
import { revealNextClue } from '@/lib/mystery/service';
import { getServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reveal the next clue. Returns that clue only. Does not return later clues, the
 * answer, or community stats. An optional `group` (M13.4) that is not the challenge's group is
 * the same 404 as a challenge that does not exist.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> },
): Promise<Response> {
  const parsed = await parseJsonBody(request, mysteryClueRequestSchema);
  if (!parsed.ok) return parsed.response;
  const visitorId = visitorFromRequest(request, parsed.data.anonymousVisitorId);
  if (visitorId === null) return jsonError(400, 'anonymous visitor id is required');

  const { challengeId } = await context.params;
  const result = await revealNextClue(getServiceClient(), {
    challengeId,
    visitorId,
    now: new Date(),
    groupId: parsed.data.group,
  });
  if ('error' in result) return jsonError(result.status, result.error);
  return withMysteryCookie(jsonOk(mysteryClueResponseSchema, { ok: true, ...result }), visitorId);
}
