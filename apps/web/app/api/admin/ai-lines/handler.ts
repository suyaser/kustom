import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, withAdminAuth } from '@/lib/adminRoute';
import { setAiLinesEnabled } from '@/lib/ai/switches';
import { type AiLinesRequest, aiLinesRequestSchema, aiLinesResponseSchema } from './schema';

/**
 * The admins' `AI lines` switch (M16.3b; brief 1.5). Any admin or the owner of the body's group may
 * flip it, both ways, with no confirm. A group without Premium has no such switch: a 404, the same
 * answer as for a group that does not exist, so the route never tells anyone which groups are
 * Premium (D1).
 */
export async function handleAiLines(input: AiLinesRequest, context: AdminContext): Promise<NextResponse> {
  const result = await setAiLinesEnabled(context.client, {
    groupId: context.groupId,
    enabled: input.enabled,
  });
  if (!result.ok) return context.fail(404, 'not found');
  return context.respond(
    aiLinesResponseSchema,
    { ok: true, groupId: context.groupId, enabled: result.enabled },
    result.enabled ? 'AI lines on.' : 'AI lines off.',
  );
}

export function aiLinesRoute(options: AdminRouteOptions = {}): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(aiLinesRequestSchema, handleAiLines, options);
}
