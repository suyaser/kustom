import {
  type ChampionTable,
  lockRated,
  type ModeAction,
  type ModeLock,
  nextRated,
  type PendingRule,
  type Refusal,
  type RegionAction,
  type Rng,
  type TransitionContext,
} from '@customs/core';
import {
  type ModeLockState,
  type ModeRowState,
  ruleChoiceOf,
  ruleOptionOf,
  type SetGroupModeRequest,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { postTeamsForSplit } from '@/lib/discord/post';
import { readServerEnv } from '@/lib/env';
import { noteWrite, withLiveSignal } from '@/lib/live/bump';
import { modeContext } from '@/lib/mode/context';
import {
  NO_OTHER_PAIR,
  NO_REGION_RULE,
  NOTHING_TO_SPIN,
  nextPairNotice,
  PAIR_SHORT,
  REGION_SHORT,
  REGIONS_STAY,
  RULE_TOO_FEW_OPEN,
  ratedNotice,
  ruleChosenNotice,
  SAME_REGION,
  spinNotice,
  standingNotice,
  thisPairNotice,
} from '@/lib/mode/ruleNotices';
import { nextGameOf, writeLockRegions, writeModeCard } from '@/lib/mode/set';
import { hasOpenLobby, previousRule } from '@/lib/mode/spin';
import { type ModeStore, type StoredModeRow, supabaseModeStore } from '@/lib/mode/state';
import { siteOrigin } from '@/lib/siteUrl';
import { setGroupModeRequestSchema, setGroupModeResponseSchema } from './schema';

/**
 * `POST /api/admin/mode`: every Mode card action (M14.29, M15.3; one route since M20.7, the Spin
 * route merged in). One body each, exactly one of `mode`, `rated`, `spin`, `redraw`, `side`
 * (`setGroupModeRequestSchema`); one answer, `{ state, notice }` (`setGroupModeResponseSchema`).
 *
 * Gated like every `/api/admin/*` route (401 signed out, 403 for anyone who is not an admin or the
 * owner of the body's `groupId`), zod on the body (400). Core's `transition` decides every patch
 * and the patch is written as one update of only its fields (M20 D7: last write wins). Region wars
 * is drawn when it is chosen (M20 D9): Set mode, Spin and re-queue write the rule and its pair in
 * the same update. `redraw` and `side` change the next game's pair (`game: 'next'`, the default) or
 * this game's (`'this'`: the balanced lobby's lock, then the teams post again as a Reroll does).
 *
 * Refusals are 409 with M20.1's words (a form post goes back with `?error=`): a rule with too few
 * champions open, nothing to spin, a region under 8 open, the same region twice, a pair failing
 * the union rule, no other pair to redraw, this game once it has started, and a region action
 * with no region wars on its target. Tonight's live signal: one `group_live` bump of kind `mode`
 * per action that wrote (M19.9).
 */

export interface ModeRouteDeps {
  rng?: Rng;
  now?: () => Date;
  /** The night's time zone for "tonight's previous rule" (default `CUSTOMS_NIGHT_TZ`). */
  timeZone?: string;
  table?: ChampionTable;
  /** Tests only: the card store (default: the group's `group_modes` row). */
  store?: ModeStore;
  /** Tests only: the draw inputs (default: `modeContext` over the database). */
  context?: (standing: StoredModeRow['row']['standing']) => Promise<TransitionContext>;
  /** Tests only: Spin's previous rule and open-lobby read (default: the database). */
  spinFacts?: () => Promise<{ previous: PendingRule | null; lobbyOpen: boolean }>;
}

const REFUSAL_WORDS: Record<Refusal | 'started' | 'no-lock', string> = {
  'too-few-open': RULE_TOO_FEW_OPEN,
  'nothing-to-spin': NOTHING_TO_SPIN,
  'no-region-rule': NO_REGION_RULE,
  'no-other-pair': NO_OTHER_PAIR,
  'same-region': SAME_REGION,
  'region-short': REGION_SHORT,
  'pair-short': PAIR_SHORT,
  started: REGIONS_STAY,
  'no-lock': NO_REGION_RULE,
};

export async function handleSetGroupMode(
  input: SetGroupModeRequest,
  context: AdminContext,
  deps: ModeRouteDeps = {},
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const groupId = context.groupId;
  const client = context.client;
  const store = deps.store ?? supabaseModeStore(client);
  const contextFor =
    deps.context ??
    ((standing: StoredModeRow['row']['standing']) =>
      modeContext(client, groupId, standing, {
        ...(deps.rng === undefined ? {} : { rng: deps.rng }),
        ...(deps.table === undefined ? {} : { table: deps.table }),
      }));
  const refuse = (refusal: Refusal | 'started' | 'no-lock'): NextResponse => {
    const words = REFUSAL_WORDS[refusal];
    return context.form ? redirectBack(context.request, back, { error: words }) : context.fail(409, words);
  };

  const regionAction: RegionAction | null =
    input.redraw === true
      ? { type: 'redraw' }
      : input.side !== undefined && input.region !== undefined
        ? { type: 'set-side', side: input.side, region: input.region }
        : null;

  // This game's pair (M20 D9, D5): the lock, while the lobby is balanced. Teams post again.
  if (regionAction !== null && input.game === 'this') {
    return withLiveSignal(client, async (live) => {
      const result = await noteWrite(
        live,
        groupId,
        'mode',
        () =>
          writeLockRegions(client, {
            groupId,
            action: regionAction,
            context: (lock) => contextFor(lock.standing),
          }),
        (written) => written.ok,
      );
      if (!result.ok) return refuse(result.refusal);
      await repostTeams(context, result.lobbyId);
      const after = await store.read(groupId);
      const notice = result.lock.mode.id === 'region' ? thisPairNotice(result.lock.mode) : NO_REGION_RULE;
      return answer(context, back, {
        after,
        notice,
        changed: true,
        thisGame: lockState(result.lobbyId, result.lock),
      });
    });
  }

  let action: ModeAction;
  if (regionAction !== null) action = regionAction;
  else if (input.spin === true) {
    const facts = await (deps.spinFacts ?? (() => spinFactsOf(context, deps)))();
    action = {
      type: 'spin',
      previous: facts.previous,
      ...(facts.lobbyOpen ? { blocked: [{ id: 'mirror' }] } : {}),
    };
  } else if (input.rated !== undefined) action = { type: 'rated', rated: input.rated };
  else if (input.mode !== undefined) {
    const rule = ruleOptionOf(input.mode);
    action =
      rule === null
        ? { type: 'standing', standing: input.mode === 'fearless' ? 'fearless' : 'normal' }
        : { type: 'pick', rule };
  } else {
    // The schema refuses a body with none of them; this is the type's exhaustiveness.
    return context.fail(400, 'name exactly one of mode, rated, spin, redraw or side');
  }

  // `context.groupId` and `context.admin.playerId`: the group the gate checked and the actor the
  // session resolved, never anything else out of the body. The card's write is the request's last,
  // so the live bump follows it directly, also when the write throws after landing.
  const result = await withLiveSignal(client, (live) =>
    noteWrite(
      live,
      groupId,
      'mode',
      () =>
        writeModeCard(store, {
          groupId,
          playerId: context.admin.playerId,
          action,
          context: (before) => contextFor(before.row.standing),
        }),
      (written) => written.ok && written.changed,
    ),
  );
  if (!result.ok) return refuse(result.refusal);

  const row = result.after.row;
  let notice: string;
  switch (action.type) {
    case 'standing':
      notice = standingNotice(row.standing, result.changed && result.before.row.pending !== null);
      break;
    case 'rated':
      notice = ratedNotice(nextRated(row));
      break;
    case 'pick':
      notice = ruleChosenNotice(row.pending ?? action.rule, nextRated(row));
      break;
    case 'spin':
      // A Spin that wrote always carries its pick.
      notice = spinNotice(row.pending ?? result.spun ?? { id: 'mirror' });
      break;
    default:
      notice = row.pending?.id === 'region' ? nextPairNotice(row.pending) : NO_REGION_RULE;
  }
  return answer(context, back, {
    after: result.after,
    notice,
    changed: result.changed,
    ...(result.spun === null ? {} : { spun: result.spun }),
  });
}

function answer(
  context: AdminContext,
  back: string,
  out: {
    after: StoredModeRow;
    notice: string;
    changed: boolean;
    thisGame?: ModeLockState;
    spun?: Parameters<typeof ruleChoiceOf>[0];
  },
): NextResponse {
  if (context.form) return redirectBack(context.request, back, { notice: out.notice });
  return context.respond(
    setGroupModeResponseSchema,
    {
      ok: true,
      state: rowState(out.after),
      notice: out.notice,
      changed: out.changed,
      ...(out.thisGame === undefined ? {} : { thisGame: out.thisGame }),
      ...(out.spun === undefined ? {} : { spun: ruleChoiceOf(out.spun) }),
      mode: out.after.row.standing,
      next: nextGameOf(out.after),
    },
    out.notice,
  );
}

export function rowState(stored: StoredModeRow): ModeRowState {
  return {
    standing: stored.row.standing,
    pending: stored.row.pending,
    rated: stored.row.rated,
    nextRated: nextRated(stored.row),
    updatedAt: stored.updatedAt,
  };
}

function lockState(lobbyId: string, lock: ModeLock): ModeLockState {
  return {
    lobbyId,
    standing: lock.standing,
    mode: lock.mode,
    rated: lock.rated,
    effectiveRated: lockRated(lock),
  };
}

async function spinFactsOf(
  context: AdminContext,
  deps: ModeRouteDeps,
): Promise<{ previous: PendingRule | null; lobbyOpen: boolean }> {
  const [previous, lobbyOpen] = await Promise.all([
    previousRule(
      context.client,
      context.groupId,
      deps.now?.() ?? new Date(),
      deps.timeZone ?? readServerEnv().CUSTOMS_NIGHT_TZ,
    ),
    hasOpenLobby(context.client, context.groupId),
  ]);
  const rule = previous === null || previous.id === 'normal' || previous.id === 'fearless' ? null : previous;
  return { previous: rule, lobbyOpen };
}

/**
 * This game's regions changed: the teams post again, the same post a Reroll sends (M20 D5). The
 * change stands whatever Discord answers; a failure is a log line.
 */
async function repostTeams(context: AdminContext, lobbyId: string): Promise<void> {
  try {
    const { data, error } = await context.client
      .from('splits')
      .select('id')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data !== null)
      await postTeamsForSplit(context.client, data.id, { requestOrigin: siteOrigin(context.request) });
  } catch (error) {
    console.error(`mode: reposting the teams for lobby ${lobbyId} failed; the new regions stand`, error);
  }
}

export function setGroupModeRoute(
  options: AdminRouteOptions & ModeRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  const { rng, now, timeZone, table, store, context, spinFacts, ...routeOptions } = options;
  const deps: ModeRouteDeps = {
    ...(rng ? { rng } : {}),
    ...(now ? { now } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(table ? { table } : {}),
    ...(store ? { store } : {}),
    ...(context ? { context } : {}),
    ...(spinFacts ? { spinFacts } : {}),
  };
  return withAdminAuth(
    setGroupModeRequestSchema,
    (input, adminContext) => handleSetGroupMode(input, adminContext, deps),
    routeOptions,
  );
}
