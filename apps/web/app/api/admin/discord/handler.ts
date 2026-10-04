import { adminDiscordQuerySchema, adminDiscordResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { type AdminReadRouteOptions, withAdminRead } from '@/lib/adminRoute';
import { type DiscordConnectStore, supabaseDiscordConnectStore } from '@/lib/discord/connect';
import { jsonOk } from '@/lib/http';
import type { ServiceClient } from '@/lib/supabase';

/**
 * `GET /api/admin/discord?groupId=` (M14.20): the admin Discord page's state -- connected or not,
 * the guild and channel ids, when the last test post landed, Discord's reason when it did not.
 * Never the webhook URL, not even masked. Through the read gate: the group's admins, and the
 * operator read-only (M14.19).
 */
export function adminDiscordRoute(
  options: AdminReadRouteOptions & { store?: (client: ServiceClient) => DiscordConnectStore } = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminRead(
    adminDiscordQuerySchema,
    async (_query, context) => {
      const status = await (options.store ?? supabaseDiscordConnectStore)(context.client).readStatus(
        context.groupId,
      );
      return jsonOk(adminDiscordResponseSchema, {
        ok: true,
        connected: status?.webhookSet ?? false,
        guildId: status?.guildId ?? null,
        channelId: status?.channelId ?? null,
        testPostAt: status?.testPostAt ?? null,
        testPostError: status?.testPostError ?? null,
      });
    },
    options,
  );
}
