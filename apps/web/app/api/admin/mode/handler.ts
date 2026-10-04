import type { ChampionTable, ModeState, Rng, RuleOption } from '@customs/core';
import { ruleChoiceOf, ruleOptionOf } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { readServerEnv } from '@/lib/env';
import { serverRng } from '@/lib/mode/rng';
import {
  NOTHING_TO_SPIN,
  RULE_TOO_FEW_OPEN,
  ratedNotice,
  ruleChosenNotice,
  spinNotice,
  standingNotice,
} from '@/lib/mode/ruleNotices';
import { type ModeAction, nextGameOf, writeModeCard } from '@/lib/mode/set';
import { ruleCheck, spinDraw } from '@/lib/mode/spin';
import { type ModeStore, supabaseModeStore } from '@/lib/mode/state';
import {
  type SetGroupModeRequest,
  type SpinModeRequest,
  setGroupModeRequestSchema,
  setGroupModeResponseSchema,
  spinModeRequestSchema,
} from './schema';

/**
 * The Mode card's writes (M14.29, extended by M15.3), one body each, exactly one of:
 *
 * - `mode`: `normal` / `fearless` sets the standing mode and clears a pending rule; a rule choice
 *   (`class:Tank` … `region`, `mirror`) queues the next game's rule;
 * - `rated`: the Rated switch for the next game, either way, in any mode (R9);
 * - `spin: true`: the server's pick (R3), with a real RNG; the browser never chooses.
 *
 * Gated like every `/api/admin/*` route (401 signed out, 403 for anyone who is not an admin or the
 * owner of the body's `groupId`), zod on the body (400). Core decides every new state; the write is
 * compare-and-set on `group_modes.version`. A change after Roll is for the next game: the lobby
 * keeps its lock (`lib/mode/lock.ts`). Posts nothing to Discord. A no-op (a repeat standing pick)
 * is a 200 with `changed: false`. A Spin with nothing left to draw is a 409. A rule pick with too
 * few champions open tonight (core's `rulePlayable`, Fearless bans counted on a Fearless night) is
 * a 409 `That rule has too few champions open tonight.` (QA fix 2026-10-04); the rule already
 * pending stays pickable.
 */

export interface ModeRouteDeps {
  rng?: Rng;
  now?: () => Date;
  /** The night's time zone for "tonight's previous rule" (default `CUSTOMS_NIGHT_TZ`). */
  timeZone?: string;
  table?: ChampionTable;
  /** Tests only: the card store (default: the group's `group_modes` row). */
  store?: ModeStore;
  /** Tests only: Spin's draw (default: `spinDraw` over the database and `rng`). */
  draw?: (state: ModeState) => Promise<RuleOption | null>;
  /** Tests only: the rule check (default: `ruleCheck` over the database and `table`). */
  playable?: (state: ModeState, rule: RuleOption) => Promise<boolean>;
}

export async function handleSetGroupMode(
  input: SetGroupModeRequest,
  context: AdminContext,
  deps: ModeRouteDeps = {},
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const groupId = context.groupId;
  const store = deps.store ?? supabaseModeStore(context.client);

  let action: ModeAction;
  if (input.spin === true) {
    action = {
      kind: 'spin',
      draw:
        deps.draw ??
        spinDraw(context.client, {
          groupId,
          now: deps.now?.() ?? new Date(),
          timeZone: deps.timeZone ?? readServerEnv().CUSTOMS_NIGHT_TZ,
          rng: deps.rng ?? serverRng,
          ...(deps.table === undefined ? {} : { table: deps.table }),
        }),
    };
  } else if (input.rated !== undefined) {
    action = { kind: 'rated', rated: input.rated };
  } else if (input.mode !== undefined) {
    const rule = ruleOptionOf(input.mode);
    action =
      rule === null
        ? { kind: 'standing', standing: input.mode === 'fearless' ? 'fearless' : 'normal' }
        : {
            kind: 'rule',
            rule,
            playable:
              deps.playable ??
              ruleCheck(context.client, {
                groupId,
                ...(deps.table === undefined ? {} : { table: deps.table }),
              }),
          };
  } else {
    // The schema refuses a body with none of the three; this is the type's exhaustiveness.
    return context.fail(400, 'name exactly one of mode, rated or spin');
  }

  // `context.groupId` and `context.admin.playerId`: the group the gate checked and the actor the
  // session resolved, never anything else out of the body.
  const before = action.kind === 'standing' ? await store.read(groupId) : null;
  const result = await writeModeCard(store, { groupId, playerId: context.admin.playerId, action });

  if (!result.ok) {
    const refusal = result.reason === 'too-few-open' ? RULE_TOO_FEW_OPEN : NOTHING_TO_SPIN;
    return context.form
      ? redirectBack(context.request, back, { error: refusal })
      : context.fail(409, refusal);
  }

  const next = nextGameOf(result.state);
  const notice =
    action.kind === 'standing'
      ? standingNotice(result.state.standing, result.changed && before?.state.pending != null)
      : action.kind === 'rated'
        ? ratedNotice(next.rated)
        : action.kind === 'rule'
          ? ruleChosenNotice(action.rule, next.rated)
          : // A Spin that wrote always carries its pick.
            spinNotice(result.spun ?? { id: 'region' });

  if (context.form) return redirectBack(context.request, back, { notice });

  return context.respond(
    setGroupModeResponseSchema,
    {
      ok: true,
      mode: result.state.standing,
      changed: result.changed,
      next,
      ...(result.spun === null ? {} : { spun: ruleChoiceOf(result.spun) }),
    },
    notice,
  );
}

export function setGroupModeRoute(
  options: AdminRouteOptions & ModeRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  const { routeOptions, deps } = splitOptions(options);
  return withAdminAuth(
    setGroupModeRequestSchema,
    (input, context) => handleSetGroupMode(input, context, deps),
    routeOptions,
  );
}

/**
 * `POST /api/admin/mode/spin` (the milestone's route): `{ groupId, redirectTo? }`, the same write
 * as `POST /api/admin/mode` with `spin: true`, and the same answer.
 */
export function spinModeRoute(
  options: AdminRouteOptions & ModeRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  const { routeOptions, deps } = splitOptions(options);
  return withAdminAuth(
    spinModeRequestSchema,
    (input: SpinModeRequest, context) =>
      handleSetGroupMode(
        {
          groupId: input.groupId,
          spin: true,
          ...(input.redirectTo === undefined ? {} : { redirectTo: input.redirectTo }),
        },
        context,
        deps,
      ),
    routeOptions,
  );
}

function splitOptions(options: AdminRouteOptions & ModeRouteDeps): {
  routeOptions: AdminRouteOptions;
  deps: ModeRouteDeps;
} {
  const { rng, now, timeZone, table, store, draw, playable, ...routeOptions } = options;
  return {
    routeOptions,
    deps: {
      ...(rng ? { rng } : {}),
      ...(now ? { now } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(table ? { table } : {}),
      ...(store ? { store } : {}),
      ...(draw ? { draw } : {}),
      ...(playable ? { playable } : {}),
    },
  };
}
