import {
  type MemberUnlinkDiscordRequest,
  memberUnlinkDiscordRequestSchema,
  memberUnlinkDiscordResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import {
  DISCORD_UNLINKED,
  supabaseUnlinkDiscordStore,
  type UnlinkDiscordStore,
  unlinkMemberDiscord,
} from '@/lib/admin/unlinkDiscord';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import type { ServiceClient } from '@/lib/supabase';

/**
 * `POST /api/admin/members/unlink-discord { groupId, playerId }` (M14.60): clear a member's
 * `players.discord_id`. The rules are `lib/admin/unlinkDiscord.ts`'s; this is the boundary. The
 * actor is the session's player as the gate resolved it, never the body's. A form post (no
 * JavaScript) is sent back to its `redirectTo` with a notice or the refusal, like remove.
 */
export function memberUnlinkDiscordHandler(store: (client: ServiceClient) => UnlinkDiscordStore) {
  return async (input: MemberUnlinkDiscordRequest, context: AdminContext): Promise<NextResponse> => {
    const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

    const result = await unlinkMemberDiscord(store(context.client), {
      groupId: context.groupId,
      actorId: context.admin.playerId,
      playerId: input.playerId,
    });
    if (!result.ok) {
      return context.form
        ? redirectBack(context.request, back, { error: result.error })
        : context.fail(result.status, result.error);
    }

    if (context.form) return redirectBack(context.request, back, { notice: DISCORD_UNLINKED });

    return context.respond(
      memberUnlinkDiscordResponseSchema,
      { ok: true, groupId: context.groupId, playerId: result.value.playerId, changed: result.value.changed },
      DISCORD_UNLINKED,
    );
  };
}

export interface UnlinkDiscordRouteOptions extends AdminRouteOptions {
  /** Injection point for the unit tests. Defaults to the service-role tables. */
  store?: (client: ServiceClient) => UnlinkDiscordStore;
}

export function memberUnlinkDiscordRoute(
  options: UnlinkDiscordRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const { store = supabaseUnlinkDiscordStore, ...rest } = options;
  return withAdminAuth(memberUnlinkDiscordRequestSchema, memberUnlinkDiscordHandler(store), {
    section: 'members',
    ...rest,
  });
}
