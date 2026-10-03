import {
  COMMANDS_POLL_INTERVAL_MS,
  companionCommandsQuerySchema,
  companionCommandsResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { claimCommands, sweepExpiredCommands } from '@/lib/commands/queue';
import { withCompanionIdentity } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companion asks for work (M4.1). The whole contract is the doc comment on
 * `companionCommandsResponseSchema` in `@customs/db/schemas`; this route implements it and
 * restates nothing.
 *
 * `?clientConnected=true|false` is **required** and it is the whole shape of this route:
 *
 * - `true` — sweep, then hand out at most ten of this player's live commands, oldest first,
 *   marking each `sent` with `attempts + 1`. `last_seen_at` is touched as on every other
 *   companion route.
 * - `false` — sweep, answer `{ commands: [] }`, and **move nothing**: no `status`, no
 *   `attempts`, and no `last_seen_at` write. That last one is what makes `last_seen_at` mean
 *   "this friend was at their PC with League open", which is the signal M4.2's "around" and
 *   M4.3's token check are built on (`04-decisions.md`, 2026-09-09).
 *
 * The rows are always this token's player's, in this token's group (M13.3). There is no way to
 * ask for another player's queue, or another group's, and no parameter that would express one:
 * the token decides who the caller is, as everywhere else in `/api/companion/*`.
 */
export const GET = withCompanionIdentity(
  async (request, { client, identity }): Promise<NextResponse> => {
    const query = companionCommandsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return jsonError(400, 'clientConnected must be true or false');
    }

    // First, every time, whatever the answer will be: a command past its `expires_at` is
    // `failed` with `expired` and is never handed to anybody. The server owns expiry.
    const now = new Date();
    const expired = await sweepExpiredCommands(client, now);
    if (expired > 0) {
      console.info(`command sweep: ${expired} command(s) past their expiry -> failed`);
    }

    // This token's player, in this token's group (M13.3).
    const commands = query.data.clientConnected
      ? await claimCommands(client, identity.playerId, identity.groupId, now)
      : [];

    return jsonOk(companionCommandsResponseSchema, {
      ok: true,
      commands,
      // The server's dial, exactly as `recheckInMs` is (M2.5): the companion obeys the number.
      nextPollInMs: COMMANDS_POLL_INTERVAL_MS,
    });
  },
  {
    // Read from the query string before the token is even looked up: a poll that says the
    // client is down must leave `last_seen_at` exactly where it was.
    shouldTouch: (request) => new URL(request.url).searchParams.get('clientConnected') === 'true',
  },
);
