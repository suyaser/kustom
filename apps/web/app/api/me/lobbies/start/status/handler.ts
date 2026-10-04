import type { NextResponse } from 'next/server';
import { type MemberReadOptions, withMemberRead } from '@/lib/me/readRoute';
import { readLobbyStartStatus } from '@/lib/tonight/lobbyStartStatus';
import { nightTimeZone } from '@/lib/tonight/night';
import { startStatusQuerySchema, startStatusResponseSchema } from './schema';

export interface StartStatusRouteOptions extends MemberReadOptions {
  /** Tests only: the clock the night window is cut from. */
  now?: () => Date;
}

/**
 * The route (M19.16). Linked members of the group only (`withMemberRead`): the press is a member's
 * control and the Tonight page reads the same row for linked members only (M14.28). The answer is
 * `lib/tonight/lobbyStartStatus.ts`'s, one query, started beside the membership lookup.
 */
export function startStatusRoute(
  options: StartStatusRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withMemberRead(
    startStatusQuerySchema,
    startStatusResponseSchema,
    (query, client) =>
      readLobbyStartStatus(client, {
        groupId: query.groupId,
        now: options.now?.() ?? new Date(),
        timeZone: nightTimeZone(),
      }),
    options,
  );
}
