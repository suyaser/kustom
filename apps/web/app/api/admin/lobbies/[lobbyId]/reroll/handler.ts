import type { NextResponse } from 'next/server';
import { NO_SUCH_LOBBY, promoteSplit } from '@/lib/admin/reroll';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { postTeamsForSplit } from '@/lib/discord/post';
import { lobbyInGroup } from '@/lib/groups/membership';
import { noteWrite, withLiveSignal } from '@/lib/live/bump';
import { siteOrigin } from '@/lib/siteUrl';
import { type RerollRequest, rerollRequestSchema, rerollResponseSchema } from './schema';

/**
 * Reroll (M3.2). See `app/api/admin/tokens/handler.ts` for why the handler is not in
 * `route.ts`; here there is a second reason — the lobby id comes from the path, so the route
 * curries it in and the tests can too.
 *
 * Promote, then post. In that order and never the other way round: the promotion is what the
 * group agreed to and it stands whatever Discord answers. The response says whether the
 * message went out, and nothing retries it.
 *
 * The lobby id is a path segment and is validated by `promoteSplit`, which is the first thing
 * this calls and does no read before it: a segment that is not a uuid is a 404, not the 500
 * Postgres's 22P02 would have produced. It is checked there rather than in `route.ts` so that
 * the session is still the first gate — an unauthenticated caller learns nothing about this
 * route's shape, which is the rule the rest of `/api/admin/*` keeps.
 */
export async function handleReroll(
  lobbyId: string,
  input: RerollRequest,
  context: AdminContext,
): Promise<NextResponse> {
  // Where a *form* post goes back to. `/admin` unless the body names another page on this
  // site — the tonight page's no-JavaScript fallback names `/` (M3.4). Re-validated here
  // rather than trusted from the body: `safeNextPath` is the same check the sign-in round
  // trip uses, and a body must never be able to redirect an admin off-site.
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const fail = (status: number, error: string): NextResponse =>
    context.form ? redirectBack(context.request, back, { error }) : context.fail(status, error);

  // A lobby of another group answers exactly like one that does not exist (M13.4): an admin of A
  // does not learn which of B's lobby ids are real. Checked before anything is read or written.
  if (!(await lobbyInGroup(context.client, lobbyId, context.groupId))) return fail(404, NO_SUCH_LOBBY);

  // Tonight's live signal (M19.9), flushed after the promotion and its Discord post (and the post's
  // message-id write), and also when the post throws: the split is up either way, and the retry
  // answers `promoted: false`. A second tap promoted nothing and says nothing.
  return withLiveSignal(context.client, async (live) => {
    const result = await noteWrite(
      live,
      context.groupId,
      'split',
      () => promoteSplit(context.client, { lobbyId, splitId: input.splitId }),
      (promotion) => promotion.ok && promotion.value.promoted,
    );
    // A lobby that is not `balanced`, a split of another lobby, or a third press: the envelope
    // for a JSON caller, a 303 back to the page it was pressed on with `?error=` for the form.
    // Nothing was written and nothing was posted either way.
    if (!result.ok) return fail(result.status, result.error);

    const { splitId, rank, splitCount, promoted } = result.value;

    // Already chosen: 200, nothing promoted, nothing posted. Two taps produce one message.
    const outcome = promoted
      ? await postTeamsForSplit(context.client, splitId, { requestOrigin: siteOrigin(context.request) })
      : null;
    return answerReroll(context, back, lobbyId, { splitId, rank, splitCount, promoted, outcome });
  });
}

function answerReroll(
  context: AdminContext,
  back: string,
  lobbyId: string,
  {
    splitId,
    rank,
    splitCount,
    promoted,
    outcome,
  }: {
    splitId: string;
    rank: number;
    splitCount: number;
    promoted: boolean;
    outcome: { status: 'posted' | 'skipped' | 'failed' } | null;
  },
): NextResponse {
  const message = notice({ rank, splitCount, promoted, post: outcome === null ? null : outcome.status });

  if (context.form) return redirectBack(context.request, back, { notice: message });

  return context.respond(
    rerollResponseSchema,
    {
      ok: true,
      lobbyId,
      splitId,
      rank,
      splitCount,
      promoted,
      post: outcome === null ? null : outcome.status,
    },
    message,
  );
}

/** What `/admin` says after the press, in the words the channel just saw. */
function notice(result: {
  rank: number;
  splitCount: number;
  promoted: boolean;
  post: 'posted' | 'skipped' | 'failed' | null;
}): string {
  if (!result.promoted) {
    return `Split ${result.rank} was already the one on the board. Nothing was posted.`;
  }

  const rerolls = Math.max(result.splitCount - 1, result.rank - 1);
  const which =
    result.rank === 1
      ? 'Split 1 is back on the board.'
      : `Split ${result.rank} is up: reroll ${result.rank - 1} of ${rerolls}.`;

  switch (result.post) {
    case 'posted':
      return `${which} Posted to Discord.`;
    case 'skipped':
      return `${which} No webhook is configured, so nothing was posted.`;
    default:
      return `${which} Discord did not take the post, but the teams stand.`;
  }
}

/**
 * The route, with the lobby id from the path already in hand.
 *
 * `redirectTo` is `/admin` by default: that is where a form post lands unless the body names
 * another page on this site. The tonight page's control posts JSON and never navigates; its
 * no-JavaScript fallback sends `redirectTo=/` (M3.4).
 */
export function rerollRoute(
  lobbyId: string,
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(rerollRequestSchema, (input, context) => handleReroll(lobbyId, input, context), {
    ...options,
  });
}
