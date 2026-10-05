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
  ruleOf,
  type TransitionContext,
} from '@customs/core';
import {
  type ModeGame,
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
  NO_THIS_GAME,
  NOTHING_TO_SPIN,
  nextPairNotice,
  PAIR_SHORT,
  PICK_A_LOBBY_FIRST,
  REGION_SHORT,
  REGIONS_STAY,
  ROLLED_TO_THIS_GAME,
  RULE_TOO_FEW_OPEN,
  ratedNotice,
  ruleChosenNotice,
  SAME_REGION,
  spinNotice,
  standingNotice,
  THIS_GAME_STAYS,
  thisPairNotice,
  thisStandingNotice,
} from '@/lib/mode/ruleNotices';
import { type LiveLock, readLiveLock, writeLock, writeModeCard } from '@/lib/mode/set';
import { hasOpenLobby, previousRule } from '@/lib/mode/spin';
import type { ModeStore, StoredModeRow } from '@/lib/mode/state';
import { type ModeTable, modeTableForRoute, PICK_A_LOBBY, tableModeStore } from '@/lib/mode/table';
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
 * the same update. Every action changes the next game (`game: 'next'`, the default: the row) or
 * this game (`'this'`: the balanced lobby's lock, then the teams post again as a Reroll does; the
 * pair since M20 D9, the rule, Spin and Rated since M20.18, the owner's "until the game starts,
 * mode changes are for this game"). A `this` action writes the row only for a standing pick (its `mode`); once the game has
 * started it is a 409 (the lock is frozen in game; the card sends those taps as `next`).
 *
 * Refusals are 409 with M20.1's words (a form post goes back with `?error=`): a rule with too few
 * champions open, nothing to spin, a region under 8 open, the same region twice, a pair failing
 * the union rule, no other pair to redraw, this game once it has started (`REGIONS_STAY` for the
 * pair, `THIS_GAME_STAYS` for the rule, Spin and Rated), `this` with no rolled game, and a region
 * action with no region wars on its target. Tonight's live signal: one `group_live` bump of kind `mode`
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
  /**
   * Tests only: Spin's previous rule and open-lobby read for the game it targets (default: the
   * database). `lobbyOpen` blocks mirror.
   */
  spinFacts?: (game: ModeGame) => Promise<{ previous: PendingRule | null; lobbyOpen: boolean }>;
  /** Tests only: the group's live lock, read for a next-game region refusal (default: the database). */
  liveLock?: () => Promise<LiveLock | null>;
  /**
   * Tests only: which lobby's card the action is for (M22.4; default `modeTableForRoute` over the
   * database: the group's card on every one-lobby night).
   */
  modeTable?: () => Promise<ModeTable | typeof PICK_A_LOBBY>;
}

type RouteRefusal =
  | Refusal
  | 'started'
  | 'no-lock'
  | 'rolled'
  | 'mode-started'
  | 'no-this-game'
  | typeof PICK_A_LOBBY;

const REFUSAL_WORDS: Record<RouteRefusal, string> = {
  'too-few-open': RULE_TOO_FEW_OPEN,
  'nothing-to-spin': NOTHING_TO_SPIN,
  'no-region-rule': NO_REGION_RULE,
  'no-other-pair': NO_OTHER_PAIR,
  'same-region': SAME_REGION,
  'region-short': REGION_SHORT,
  'pair-short': PAIR_SHORT,
  started: REGIONS_STAY,
  'no-lock': NO_REGION_RULE,
  rolled: ROLLED_TO_THIS_GAME,
  'mode-started': THIS_GAME_STAYS,
  'no-this-game': NO_THIS_GAME,
  [PICK_A_LOBBY]: PICK_A_LOBBY_FIRST,
};

export async function handleSetGroupMode(
  input: SetGroupModeRequest,
  context: AdminContext,
  deps: ModeRouteDeps = {},
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const groupId = context.groupId;
  const client = context.client;
  const refuse = (refusal: RouteRefusal): NextResponse => {
    const words = REFUSAL_WORDS[refusal];
    return context.form ? redirectBack(context.request, back, { error: words }) : context.fail(409, words);
  };
  // M22.4: whose card. Every one-lobby night is the group's (one read, nothing forked); with two
  // lobbies live the body names one (`lobbyId`) or the action is refused. Wall clock: liveness is
  // read against the lobby rows' own times.
  const table = await (
    deps.modeTable ?? (() => modeTableForRoute(client, groupId, input.lobbyId, new Date()))
  )();
  if (table === PICK_A_LOBBY) return refuse(PICK_A_LOBBY);
  const store = deps.store ?? tableModeStore(client, table);
  const contextFor =
    deps.context ??
    ((standing: StoredModeRow['row']['standing']) =>
      modeContext(client, groupId, standing, {
        ...(deps.rng === undefined ? {} : { rng: deps.rng }),
        ...(deps.table === undefined ? {} : { table: deps.table }),
      }));

  const regionAction: RegionAction | null =
    input.redraw === true
      ? { type: 'redraw' }
      : input.side !== undefined && input.region !== undefined
        ? { type: 'set-side', side: input.side, region: input.region }
        : null;

  const thisGame = input.game === 'this';
  let action: ModeAction;
  if (regionAction !== null) action = regionAction;
  else if (input.spin === true) {
    const facts = await (deps.spinFacts ?? ((game: ModeGame) => spinFactsOf(context, deps, game, table)))(
      thisGame ? 'this' : 'next',
    );
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

  // This game (M20 D9 for the pair, M20.18 for the rule, Spin and Rated): the lock, while the lobby
  // is balanced, in one conditional update; only a standing pick also sets the row's `mode`. The teams post goes again.
  if (thisGame) {
    const lockAction = action;
    return withLiveSignal(client, async (live) => {
      const result = await noteWrite(
        live,
        groupId,
        'mode',
        () =>
          writeLock(client, {
            groupId,
            action: lockAction,
            context: (lock) => contextFor(lock.standing),
            store,
            playerId: context.admin.playerId,
            partyId: table.partyId,
          }),
        (written) => written.ok,
      );
      if (!result.ok) {
        if (regionAction === null && result.refusal === 'started') return refuse('mode-started');
        if (regionAction === null && result.refusal === 'no-lock') return refuse('no-this-game');
        return refuse(result.refusal);
      }
      await repostTeams(context, result.lobbyId, regionAction !== null);
      const after = await store.read(groupId);
      return answer(context, back, {
        after,
        notice: thisGameNotice(lockAction, result.before, result.lock),
        changed: true,
        thisGame: lockState(result.lobbyId, result.lock),
        ...(result.spun === null ? {} : { spun: result.spun }),
      });
    });
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
  if (!result.ok) {
    // M20.17: a next-game region tap that lost to Roll. The row has no region rule because Roll
    // moved it onto the balanced lobby's lock, so say that, not that region wars is off.
    if (result.refusal === 'no-region-rule' && regionAction !== null) {
      const live = await (deps.liveLock ?? (() => readLiveLock(client, groupId, table.partyId)))();
      if (live !== null && live.status === 'balanced' && live.stored.lock.mode.id === 'region') {
        return refuse('rolled');
      }
    }
    return refuse(result.refusal);
  }

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
      // A pick that wrote always leaves its rule pending (region wars with its pair).
      notice =
        row.pending === null
          ? standingNotice(row.standing, false)
          : ruleChosenNotice(row.pending, nextRated(row));
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

/** The notice for an action on this game's lock (M20.18; the pair's words since M20.1). */
function thisGameNotice(action: ModeAction, before: ModeLock, lock: ModeLock): string {
  switch (action.type) {
    case 'standing':
      return thisStandingNotice(action.standing, ruleOf(before.mode) !== null);
    case 'rated':
      return ratedNotice(lockRated(lock), 'this');
    case 'spin':
    case 'pick': {
      // A pick or Spin that wrote always leaves a rule on the lock.
      const rule = lock.mode as PendingRule;
      return action.type === 'spin' ? spinNotice(rule) : ruleChosenNotice(rule, lockRated(lock), 'this');
    }
    default:
      return lock.mode.id === 'region' ? thisPairNotice(lock.mode) : NO_REGION_RULE;
  }
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

/**
 * Spin's facts. For the next game: tonight's previous rule (the live lock first) and whether a
 * lobby is filling (mirror blocked then). For this game (M20.18): the rule played before this
 * game (the live lock is the one being replaced), and mirror always blocked, because this game's
 * lobby is already made, as it was made (Blind Pick is chosen when the custom is made).
 */
async function spinFactsOf(
  context: AdminContext,
  deps: ModeRouteDeps,
  game: ModeGame,
  table: ModeTable,
): Promise<{ previous: PendingRule | null; lobbyOpen: boolean }> {
  // M22.4: on a forked night, the table's own previous rule and its own lobby (null party: today's).
  const [previous, lobbyOpen] = await Promise.all([
    previousRule(
      context.client,
      context.groupId,
      deps.now?.() ?? new Date(),
      deps.timeZone ?? readServerEnv().CUSTOMS_NIGHT_TZ,
      { live: game === 'next', partyId: table.partyId },
    ),
    game === 'this' ? true : hasOpenLobby(context.client, context.groupId, table.partyId),
  ]);
  const rule = previous === null || previous.id === 'normal' || previous.id === 'fearless' ? null : previous;
  return { previous: rule, lobbyOpen };
}

/**
 * This game's lock changed: the teams post again, the same post a Reroll sends (M20 D5), its rule
 * line read from the lock as it is now. `newRegions` (a pair change) words a region line
 * `This game: region wars, new regions.`; a rule, Spin or Rated change (M20.18) gets the lock's
 * plain line. The change stands whatever Discord answers; a failure is a log line.
 */
async function repostTeams(context: AdminContext, lobbyId: string, newRegions: boolean): Promise<void> {
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
      await postTeamsForSplit(context.client, data.id, {
        requestOrigin: siteOrigin(context.request),
        newRegions,
      });
  } catch (error) {
    console.error(`mode: reposting the teams for lobby ${lobbyId} failed; the change stands`, error);
  }
}

export function setGroupModeRoute(
  options: AdminRouteOptions & ModeRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  const { rng, now, timeZone, table, store, context, spinFacts, liveLock, modeTable, ...routeOptions } =
    options;
  const deps: ModeRouteDeps = {
    ...(rng ? { rng } : {}),
    ...(now ? { now } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(table ? { table } : {}),
    ...(store ? { store } : {}),
    ...(context ? { context } : {}),
    ...(spinFacts ? { spinFacts } : {}),
    ...(liveLock ? { liveLock } : {}),
    ...(modeTable ? { modeTable } : {}),
  };
  return withAdminAuth(
    setGroupModeRequestSchema,
    (input, adminContext) => handleSetGroupMode(input, adminContext, deps),
    routeOptions,
  );
}
