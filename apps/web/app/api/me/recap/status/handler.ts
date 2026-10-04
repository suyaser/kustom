import type { NextResponse } from 'next/server';
import { readRecapLanded } from '@/lib/ai/recapLanded';
import { type MemberReadOptions, withMemberRead } from '@/lib/me/readRoute';
import { recapStatusQuerySchema, recapStatusResponseSchema } from './schema';

/**
 * The route (M19.16). Linked members of the group only (`withMemberRead`), one indexed read of
 * `ai_lines` started beside the membership lookup (`lib/ai/recapLanded.ts`).
 */
export function recapStatusRoute(
  options: MemberReadOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withMemberRead(
    recapStatusQuerySchema,
    recapStatusResponseSchema,
    async (query, client) => ({
      landed: await readRecapLanded(client, { groupId: query.groupId, gameId: query.gameId }),
    }),
    options,
  );
}
