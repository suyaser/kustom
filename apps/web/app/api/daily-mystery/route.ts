import { mysteryPlayViewSchema, mysteryTodayQuerySchema } from '@customs/db/schemas';
import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { visitorFromRequest, withMysteryCookie } from '@/lib/mystery/request';
import { loadMysteryPage } from '@/lib/mystery/service';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const emptyResponseSchema = z.object({
  ok: z.literal(true),
  empty: z.literal(true),
  expiresAt: z.string(),
});

const playResponseSchema = z.object({
  ok: z.literal(true),
  empty: z.literal(false),
  completed: z.literal(false),
  challenge: mysteryPlayViewSchema,
});

const closedResponseSchema = z.object({
  ok: z.literal(true),
  empty: z.literal(false),
  completed: z.literal(true),
  challengeId: z.string().uuid(),
});

/**
 * Today's Daily Mystery (M5.32) of `?group=<groupId>` (M13.4). Public fields only: the crime, the
 * suspects, already revealed clues. Never the answer, never community distribution, never
 * unrevealed clues. No membership: the page it serves is public by link, like every group page.
 * A group id that names no group is the empty card — it has no games.
 */
export async function GET(request: Request): Promise<Response> {
  const query = mysteryTodayQuerySchema.safeParse({
    group: new URL(request.url).searchParams.get('group') ?? undefined,
  });
  if (!query.success) return jsonError(400, 'group is required');

  const visitorId = visitorFromRequest(request);
  const state = await loadMysteryPage(getServiceClient(), {
    now: new Date(),
    timeZone: nightTimeZone(),
    visitorId,
    groupId: query.data.group,
  });

  if (state.kind === 'empty') {
    return withMysteryCookie(
      jsonOk(emptyResponseSchema, { ok: true, empty: true, expiresAt: state.empty.expiresAt }),
      visitorId,
    );
  }
  if (state.kind === 'closed') {
    return withMysteryCookie(
      jsonOk(closedResponseSchema, {
        ok: true,
        empty: false,
        completed: true,
        challengeId: state.result.challengeId,
      }),
      visitorId,
    );
  }
  return withMysteryCookie(
    jsonOk(playResponseSchema, {
      ok: true,
      empty: false,
      completed: false,
      challenge: state.play,
    }),
    visitorId,
  );
}

export function POST(): Response {
  return jsonError(405, 'use POST /api/daily-mystery/{id}/guess');
}
