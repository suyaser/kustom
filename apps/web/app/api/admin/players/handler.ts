import type { NextResponse } from 'next/server';
import {
  setPlayerAdmin,
  setPlayerBackfill,
  setPlayerDiscordId,
  setPlayerDisplayName,
} from '@/lib/admin/players';
import type { AdminWriteResult } from '@/lib/admin/result';
import type { AdminContext } from '@/lib/adminRoute';
import { type AdminPlayersRequest, adminPlayersResponseSchema } from './schema';

/** M5.17's refusal, for the one caller that can still reach `set-roles`: a stale open tab. */
export const ROLES_ARE_INFERRED =
  'Roles are worked out from the games people play, so there is nothing to set here. Reload the page to see the current pair.';

/** Everything the route still does. `set-roles` is refused before this type is ever reached. */
type LiveAction = Exclude<AdminPlayersRequest, { action: 'set-roles' }>;

/**
 * Separate from `route.ts` because a Next route file may only export HTTP verbs, and the
 * integration tests need the handler with a fake session wrapped around it (there is no way to
 * drive a real Discord OAuth flow from vitest).
 */
export async function handleAdminPlayers(
  input: AdminPlayersRequest,
  context: AdminContext,
): Promise<NextResponse> {
  // 410 rather than 404 or a silent success: the action existed, it is gone, and the sentence
  // says what replaced it (M5.17).
  if (input.action === 'set-roles') return context.fail(410, ROLES_ARE_INFERRED);

  const result = await runAction(input, context);
  if (!result.ok) return context.fail(result.status, result.error);

  return context.respond(
    adminPlayersResponseSchema,
    { ok: true, action: input.action, playerId: result.value },
    noticeFor(input),
  );
}

function runAction(input: LiveAction, context: AdminContext): Promise<AdminWriteResult<string>> {
  switch (input.action) {
    case 'set-name':
      return setPlayerDisplayName(context.client, {
        groupId: context.groupId,
        playerId: input.playerId,
        displayName: input.displayName,
      });
    case 'set-discord':
      return setPlayerDiscordId(context.client, {
        groupId: context.groupId,
        playerId: input.playerId,
        discordId: input.discordId,
      });
    case 'set-admin':
      // The member's role in this group (M13.4), the same write as `/api/admin/members/role`:
      // demoting the group's last admin is a 409, demoting yourself with another admin left is
      // allowed (that is how a group is handed on).
      return setPlayerAdmin(context.client, {
        groupId: context.groupId,
        playerId: input.playerId,
        isAdmin: input.isAdmin,
      });
    case 'set-backfill':
      // No self-rule here, unlike `set-admin`: approving your own companion is the ordinary
      // case (M5.1's live check is the user approving themselves), and revoking backfill locks
      // nobody out of anything.
      return setPlayerBackfill(context.client, {
        groupId: context.groupId,
        playerId: input.playerId,
        approved: input.approved,
      });
  }
}

function noticeFor(input: LiveAction): string {
  switch (input.action) {
    case 'set-name':
      // Both halves matter to the admin: what the name is now, and whether the client may
      // still move it. "back on automatic" is the only way to tell a cleared field worked.
      return input.displayName === null
        ? 'name cleared: it follows the Riot ID again'
        : `name saved: ${input.displayName}`;
    case 'set-discord':
      return input.discordId === null ? 'Discord id cleared' : 'Discord id linked';
    case 'set-admin':
      return input.isAdmin ? 'admin granted' : 'admin removed';
    case 'set-backfill':
      // The second sentence is the whole reason M5.1 and M5.2 ship together: an admin who
      // approves someone and then looks at the leaderboard must not think backfill is broken.
      return input.approved
        ? 'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.'
        : 'backfill revoked';
  }
}
