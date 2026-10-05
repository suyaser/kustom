'use client';

import { lockRated, type ModeLock, nextRated, RULE_OPTIONS, ruleKey } from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SideGlyph } from '@/components/ui/side-glyph';
import { type RegionId, regionName } from '@/lib/champs/regions';
import {
  FEARLESS_BANNED_WORD,
  FEARLESS_EMPTY_BALANCED,
  FEARLESS_IN_GAME,
  FEARLESS_IN_GAME_MIRROR,
  FEARLESS_NOT_RATED_FINISHED,
  FEARLESS_NOT_RATED_IN_GAME,
  FEARLESS_NOTHING_BANNED_OPEN,
  FEARLESS_OPEN_WORD,
  FEARLESS_YOUR_LANE,
  fearlessLaneOpen,
  fearlessNothingBanned,
} from '@/lib/fearless/copy';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { LANE_ORDER } from '@/lib/laneOrder';
import {
  type ClassFacts,
  lockSelectValue,
  type ModeCardView,
  modeCardViewFrom,
  type NormalNoteFacts,
  normalNote,
  type RegionFacts,
  regionTargets,
  selectValue,
  showsFearlessPool,
  tooFewForLock,
  tooFewFrom,
  type UnplayableRules,
} from '@/lib/mode/cardView';
import {
  lockKey,
  type ModeSlice,
  poolClearedSince,
  useModeSlice,
  useThisGameLock,
  useThisGameNotice,
} from '@/lib/mode/clientStore';
import {
  MODE_ACTIONS,
  MODE_CARD_LABEL,
  MODE_CARD_NEXT_GAME,
  MODE_NOW_NORMAL_BODY,
  MODE_NOW_NORMAL_TITLE,
  MODE_READ_FAILED,
  NORMAL_STATUS,
} from '@/lib/mode/copy';
import { MODE_CARD_LINK_ID, modePanelHref, modeResetConfirmHref } from '@/lib/mode/hrefs';
import {
  classLaneCount,
  drawnRegions,
  inGameRuleLine,
  isRule,
  mirrorStatus,
  modeName,
  nextRegionLine,
  oneGameLine,
  REGION_DIDNT_APPLY,
  REGION_PAIR_SHORT,
  REGION_VS,
  ruleAction,
  ruleSentence,
} from '@/lib/mode/ruleCopy';
import { ruleLabel } from '@/lib/mode/ruleNotices';
import { adminFootLines, banListInGameLine, banListLine, withLobby } from '@/lib/tonight/switcher';
import { cn } from '@/lib/utils';
import { RoleIcon } from '../_icons/RoleIcon';
import type { ModeControlsProps } from './ModeControls';
import { ModeControlsLazy } from './ModeControlsLazy';
import { RatedChip } from './RatedChip';
import { SpinReveal } from './SpinReveal';
import { SpriteIntent } from './SpriteIntent';
import { preconnectDataDragon, spriteSheetUrls } from './sprites';

/**
 * The Mode card's body, on the client (M19.13; M14.30, 05-design.md 8.2 to 8.4). The server
 * wrapper (`ModeCard`) computes everything that needs the champion table or the pool's names once
 * per render and hands it down; this renders the card.
 *
 * **With `live`** (Tonight) the card's state is the client mode store's slice (`useModeSlice`): the
 * render's props, then the `group_modes` / `fearless_state` rows the page's channel heard and the
 * controls' own answers, gated on `group_modes.updated_at`. Standing, pending rule, Rated, the chip,
 * the next-game line, the ban count and the admin controls' select all follow it with no server
 * render. The slice holds no name and no player id. **Without `live`** (the kit, old fixtures) it
 * is the server's `view` as given.
 */
export type ModeCardVariant = 'idle' | 'filling' | 'balanced' | 'in-game' | 'finished';

/** Fearless counts for the card (`fearlessCounts`, computed on the server). */
export interface CardCounts {
  total: number;
  open: number;
  banned: number;
  laneOpen: Record<RoleValue, number>;
}

/** The server's facts that let the client store render the card for any state it hears. */
export interface ModeCardLive {
  /** The render's row (the next game), `group_modes.updated_at` and `fearless_state.reset_at`. */
  slice: ModeSlice;
  lobbyStatus: LobbyStatusValue | null;
  /** This game: the lobby's lock (server render only, never patched on the client). */
  lock: ModeLock | null;
  /** The lock's `locked_at`, or null. */
  lockedAt?: string | null | undefined;
  /** The lobby the card is drawn for (the Roll answer's notice is keyed on it), or null. */
  lobbyId?: string | null | undefined;
  classFacts: ClassFacts;
  unplayable: UnplayableRules;
  /** M20.10: region wars' draw rule with tonight's bans and with none (`regionFacts`). */
  regions: RegionFacts;
  normalFacts: NormalNoteFacts;
  /** The render's `group_modes` read failed: `slice` is a stand-in (keep the last good one). */
  readFailed?: boolean | undefined;
  /**
   * M22.6 (05-design.md 14.5): two or more lobbies live. `count` of them, the drawn lobby's
   * `label`, and its card's client store key (`modeCardKey`: its own for a forked lobby). Absent
   * or null with one lobby: today's card, keyed on the group.
   */
  lobbies?: { count: number; label: string; storeKey: string } | null | undefined;
}

export interface ModeCardBodyProps {
  group: PageGroup;
  variant: ModeCardVariant;
  /** The server's answer for the render's state (used as is without `live`). */
  view: ModeCardView;
  counts: CardCounts;
  /** The counts with an empty pool, for a reset heard after the render. */
  emptyCounts: CardCounts;
  viewerLane: RoleValue | null;
  viewerSide: 'blue' | 'red' | null;
  /** Finished: the ten this game added (rendered on the server) and whether it banned nothing. */
  bannedNext: { count: number; notRated: boolean; node: ReactNode } | null;
  normalJustNow: boolean;
  controls: Omit<ModeControlsProps, 'mode' | 'banned' | 'groupId' | 'resetConfirmHref'> | null;
  live: ModeCardLive | null;
}

/** Stands in for the slice when there is no `live` (the hook still runs, its answer unused). */
const NO_SLICE: ModeSlice = {
  row: { standing: 'normal', pending: null, rated: null },
  updatedAt: null,
  resetAt: null,
};

export function ModeCardBody(props: ModeCardBodyProps) {
  const { group, variant, viewerLane, viewerSide, live } = props;
  const readFailed = live?.readFailed === true;
  const lobbies = live?.lobbies ?? null;
  const storeKey = lobbies?.storeKey ?? group.id;
  const merged = useModeSlice(storeKey, live?.slice ?? NO_SLICE, true, readFailed);
  // M20.18: this game's lock, with this page's own `this` answers on it at once (balanced only:
  // in game the lock is frozen, so nothing patches it).
  const lock =
    useThisGameLock(
      storeKey,
      live !== null && live.lock !== null && live.lobbyStatus === 'balanced' && live.lobbyId != null
        ? { lobbyId: live.lobbyId, lock: live.lock }
        : null,
    ) ??
    live?.lock ??
    null;
  const poolCleared = live !== null && poolClearedSince(live.slice, merged);
  const view: ModeCardView =
    live === null
      ? props.view
      : modeCardViewFrom({
          row: merged.row,
          lobbyStatus: live.lobbyStatus,
          lock,
          classFacts: live.classFacts,
          poolCleared,
          rowUpdatedAt: merged.updatedAt,
          lockedAt: live.lockedAt,
        });
  const counts = poolCleared ? props.emptyCounts : props.counts;
  // M20 D11: Roll redrew a short pair; this game's notice, until the game starts (balanced only).
  const rollNotice = useThisGameNotice(storeKey, live?.lobbyId ?? null);
  const shortPair =
    rollNotice !== null && live?.lobbyStatus === 'balanced' && view.locked && view.shown.id === 'region'
      ? rollNotice
      : null;
  const normalJustNow =
    live === null
      ? props.normalJustNow
      : normalNote(live.normalFacts, {
          standing: merged.row.standing,
          pending: merged.row.pending,
          // The admin write that switched Fearless off, as this page heard it; never `updated_at`,
          // which Roll and the hand-backs move too.
          since: merged.normalSince,
        });
  // M20.10: the region pairs still open to change, and whether the next game's went short (D11).
  const targets =
    live === null
      ? { this: null, next: null }
      : regionTargets({
          row: merged.row,
          lobbyStatus: live.lobbyStatus,
          lock,
          facts: live.regions,
          poolCleared,
        });
  // Under the status, for everyone, while the status is the next game's pair (before Roll).
  const pairShort = !view.locked && view.shown.id === 'region' && targets.next?.short === true;
  // M20.16: while the card is this game's (balanced or in game), the next game's region pair for
  // everyone, under this game's lines, with the short-pair line under it when the pair fails the
  // draw rule. It follows the row live like the rest of the card.
  const nextPending = view.locked && view.pending?.id === 'region' ? view.pending : null;
  const nextPairShort = nextPending !== null && targets.next?.short === true;
  // A failed read hides the controls: nobody sets a mode from a picture the page could not read.
  let controls = readFailed ? null : props.controls;
  if (controls !== null && live !== null) {
    // The controls show what is set (the pending rule, else the standing mode), before and after
    // Roll: never a prediction of what the record will leave (audit, owner bug 1).
    // M20.18: balanced, the picker, Spin and Rated are this game's (the lock's values); in game
    // the lock is frozen and they are the next game's, as before.
    const thisGame =
      live.lobbyStatus === 'balanced' && view.locked && lock !== null && live.lobbyId != null
        ? {
            lobbyId: live.lobbyId,
            selected: lockSelectValue(lock),
            rated: lockRated(lock),
            standing: lock.standing,
            tooFew: tooFewForLock(lock, live.unplayable, poolCleared),
          }
        : null;
    controls = {
      ...controls,
      inGame: view.locked || variant === 'in-game',
      thisGame,
      selected: selectValue(merged.row),
      tooFew: tooFewFrom(merged.row, live.unplayable, poolCleared),
      nextRated: nextRated(merged.row),
      regions: targets,
      // The status block says the next game's short pair (before Roll, and after it M20.16's line).
      statusShowsNext: !view.locked || nextPending !== null,
      // M20.15: the card the outcome line is checked against (another admin's write clears it).
      card: {
        updatedAt: merged.updatedAt,
        thisPair: targets.this === null ? null : `${targets.this.blue}|${targets.this.red}`,
        thisLock: thisGame === null || lock === null ? null : lockKey(lock),
      },
    };
  }

  const shown = view.shown;
  const fearlessOn = shown.id === 'fearless';
  // M15.14: a mirror match on a Fearless night shows the Fearless pool (its bans still stand).
  const poolOn = showsFearlessPool(view);
  const mirrorPool = poolOn && shown.id === 'mirror';
  const rule = isRule(shown);
  const regions = drawnRegions(shown);
  const seatedLane = variant === 'balanced' && viewerLane !== null ? viewerLane : null;
  const laneLine =
    seatedLane === null
      ? null
      : poolOn
        ? fearlessLaneOpen(counts.laneOpen[seatedLane])
        : shown.id === 'class' && view.laneCounts !== null
          ? classLaneCount(shown.tag, view.laneCounts[seatedLane])
          : regions !== null && viewerSide !== null
            ? regionName(regions[viewerSide])
            : null;
  const lane = laneLine !== null && seatedLane !== null ? seatedLane : 'all';
  const bannedNext = view.standing === 'fearless' && variant === 'finished' ? props.bannedNext : null;
  const showTen = bannedNext !== null && !bannedNext.notRated && bannedNext.count > 0 && !poolCleared;
  const bannedNothing = bannedNext?.notRated === true;
  // M15.15: on a Fearless night a game locked not rated adds nothing to the pool, so no line may
  // promise its champions join it (R4).
  const notRatedPool = view.standing === 'fearless' && !view.rated;
  // Balanced with nothing banned: the whole card is the dashed "not yet" card (8.7.7).
  const emptyBalanced = fearlessOn && variant === 'balanced' && counts.banned === 0;
  const tiles: Record<RoleValue, number> | null =
    variant !== 'filling' ? null : poolOn ? counts.laneOpen : (view.laneCounts ?? null);
  const inGameLine = variant !== 'in-game' ? null : rule ? inGameRuleLine(shown) : null;
  const banLine =
    variant !== 'in-game' || view.standing !== 'fearless'
      ? null
      : notRatedPool
        ? FEARLESS_NOT_RATED_IN_GAME
        : fearlessOn
          ? lobbies === null
            ? FEARLESS_IN_GAME
            : banListInGameLine(lobbies.count)
          : mirrorPool
            ? FEARLESS_IN_GAME_MIRROR
            : null;
  // Before Roll the card is the next game's, so its one-game line says so, as the picker's sentence
  // does (M20.10 design round 1); `This game only.` once the lobby has locked it.
  const oneGame =
    rule && inGameLine === null && banLine === null
      ? view.locked
        ? oneGameLine(view.standing)
        : ruleSentence(view.standing)
      : null;
  // The panel is one tap away: warm the connection to the sprites wherever a pool shows. The
  // sheets themselves load on intent, from the links (M14.45): the card's ten are their own squares.
  const pooled = poolOn || shown.id === 'class' || regions !== null;
  if (pooled) preconnectDataDragon();

  return (
    <section
      id="mode"
      aria-labelledby="mode-card-label mode-card-title"
      data-slot="mode-card"
      className={cn(
        // `@container`: the admin row goes to one line by the card's width, never the viewport's.
        '@container scroll-mt-4 overflow-hidden rounded-card border',
        emptyBalanced ? 'border-dashed border-border-strong bg-transparent' : 'border-border bg-card',
      )}
    >
      {/* The card's label, `Mode` (the brief's copy table), before the mode's name. */}
      <span id="mode-card-label" hidden>
        {MODE_CARD_LABEL}
      </span>
      {pooled ? <SpriteIntent sheets={spriteSheetUrls()} /> : null}
      {showTen ? bannedNext.node : null}
      {bannedNothing ? (
        <p className="border-b border-border px-(--card-pad) py-4 text-base">{FEARLESS_NOT_RATED_FINISHED}</p>
      ) : null}
      {readFailed ? (
        <p
          data-slot="mode-read-failed"
          className="mx-(--card-pad) mt-4 rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm"
        >
          {MODE_READ_FAILED}
        </p>
      ) : null}
      {shortPair === null ? null : (
        <p
          data-slot="mode-roll-notice"
          className="mx-(--card-pad) mt-4 rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm"
        >
          {shortPair}
        </p>
      )}
      {/* Design round 1: the didn't-apply note leads the card, before the mode it fell back to. */}
      {view.didntApply ? (
        <p className="mx-(--card-pad) mt-4 rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm">
          {REGION_DIDNT_APPLY}
        </p>
      ) : null}

      <Link
        data-warm-sprites={pooled ? '' : undefined}
        id={MODE_CARD_LINK_ID}
        href={
          lobbies === null || live?.lobbyId == null
            ? modePanelHref(group, lane)
            : withLobby(modePanelHref(group, lane), live.lobbyId)
        }
        scroll={false}
        className="block px-(--card-pad) py-4 hover:bg-accent @[520px]:grid @[520px]:grid-cols-[minmax(0,1fr)_auto] @[520px]:items-center @[520px]:gap-4"
      >
        <span className="flex flex-col gap-1.5">
          {variant === 'finished' ? (
            <span className="text-sm text-muted-foreground">{MODE_CARD_NEXT_GAME}</span>
          ) : null}
          {/* `data-spin-hide`: everything that already names the result keeps its place but goes
              invisible while a Spin cycles (`[data-spin-cycling]`, design round 2), so nothing spoils it. */}
          <span data-spin-hide="" className="flex flex-wrap items-center gap-2">
            <h2 id="mode-card-title" className="text-md font-bold">
              {modeName(shown)}
            </h2>
            <RatedChip rated={view.rated} />
          </span>
          {/* The status slot: a Spin's cycle and landing play here, in the status's own type (round 1). */}
          <SpinReveal labels={SPIN_LABELS} pending={view.pending}>
            {fearlessOn ? (
              <FearlessStatus counts={counts} emptyLine={variant !== 'balanced'} />
            ) : shown.id === 'normal' ? (
              <span className="text-base">{NORMAL_STATUS}</span>
            ) : shown.id === 'class' ? (
              <span className="text-lg font-bold">
                {ruleLabel(shown)}
                {view.classOpen === null ? null : (
                  <span className="whitespace-nowrap">{` · ${view.classOpen} open`}</span>
                )}
              </span>
            ) : regions !== null ? (
              <RegionStatus blue={regions.blue} red={regions.red} />
            ) : mirrorPool ? (
              <span className="text-md font-bold">
                {mirrorStatus(null)}
                <span className="whitespace-nowrap">{` · ${counts.open} open`}</span>
              </span>
            ) : (
              <span className="text-md font-bold">{mirrorStatus(null)}</span>
            )}
          </SpinReveal>
          {lobbies !== null && poolOn && variant !== 'in-game' ? (
            <span data-spin-hide="" data-slot="mode-ban-list" className="text-xs text-muted-foreground">
              {banListLine(lobbies.count)}
            </span>
          ) : null}
          {pairShort ? (
            <span data-spin-hide="" data-slot="mode-pair-short" className="text-sm font-bold">
              {REGION_PAIR_SHORT}
            </span>
          ) : null}
          {laneLine !== null && seatedLane !== null ? (
            <span data-spin-hide="" className="flex flex-wrap items-center gap-x-2 text-sm">
              <RoleIcon role={seatedLane} size={20} />
              {FEARLESS_YOUR_LANE}
              <span className="font-mono font-medium">{seatedLane}</span>
              <span aria-hidden="true">·</span>
              <span className={poolOn || shown.id === 'class' ? 'num' : 'font-bold'}>{laneLine}</span>
            </span>
          ) : null}
          {inGameLine === null ? null : (
            <span data-spin-hide="" className="text-sm text-muted-foreground">
              {inGameLine}
            </span>
          )}
          {banLine === null ? null : (
            <span data-spin-hide="" className="text-sm text-muted-foreground">
              {banLine}
            </span>
          )}
          {oneGame === null ? null : (
            <span data-spin-hide="" className="text-sm text-muted-foreground">
              {oneGame}
            </span>
          )}
          {nextPending === null ? null : (
            <span data-spin-hide="" data-slot="mode-next-region" className="text-sm">
              {nextRegionLine(nextPending)}
            </span>
          )}
          {nextPairShort ? (
            <span data-spin-hide="" data-slot="mode-pair-short" className="text-sm font-bold">
              {REGION_PAIR_SHORT}
            </span>
          ) : null}
        </span>
        <span
          data-spin-hide=""
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-3 @[520px]:mt-0"
        >
          {ruleAction(shown) ?? MODE_ACTIONS[shown.id === 'fearless' ? 'fearless' : 'normal']}
          <span aria-hidden="true">&nbsp;›</span>
        </span>
      </Link>

      {fearlessOn && variant === 'balanced' && counts.banned === 0 ? (
        <p className="px-(--card-pad) pb-4 text-sm">
          {notRatedPool
            ? `${FEARLESS_NOTHING_BANNED_OPEN} ${FEARLESS_NOT_RATED_IN_GAME}`
            : FEARLESS_EMPTY_BALANCED}
        </p>
      ) : null}

      {tiles === null ? null : <LaneTiles group={group} counts={tiles} />}

      {shown.id === 'normal' && normalJustNow && controls === null ? (
        <Dashed>
          <b className="font-bold">{MODE_NOW_NORMAL_TITLE}</b> {MODE_NOW_NORMAL_BODY}
        </Dashed>
      ) : null}

      {controls === null ? null : (
        <ModeControlsLazy
          {...controls}
          groupId={group.id}
          {...(lobbies === null
            ? {}
            : {
                lobbyId: live?.lobbyId ?? null,
                storeKey,
                lobbyNote: adminFootLines(lobbies.label),
                lobbyCount: lobbies.count,
              })}
          mode={view.standing}
          banned={counts.banned}
          resetConfirmHref={modeResetConfirmHref(group)}
        />
      )}
    </section>
  );
}

/** Every rule's short name by key, for the Spin reveal's cycle and its landing. */
const SPIN_LABELS: Record<string, string> = Object.fromEntries(
  RULE_OPTIONS.map((rule) => [ruleKey(rule), ruleLabel(rule)]),
);

/** Region wars, before and after Roll (M20 D9): `◣ BLUE Ionia` vs `◥ RED Noxus` (05-design 8.10). */
function RegionStatus({ blue, red }: { blue: RegionId; red: RegionId }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <RegionSide side="blue" region={blue} />
      <span className="text-sm text-muted-foreground">{REGION_VS}</span>
      <RegionSide side="red" region={red} />
    </span>
  );
}

function RegionSide({ side, region }: { side: 'blue' | 'red'; region: RegionId }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SideGlyph
        side={side}
        className={cn('size-3.5', side === 'blue' ? 'text-team-blue' : 'text-team-red')}
      />
      <span className="font-display text-sm font-black tracking-[0.04em] font-stretch-62%">
        {side === 'blue' ? 'BLUE' : 'RED'}
      </span>
      <span className="text-lg font-bold">{regionName(region)}</span>
    </span>
  );
}

function FearlessStatus({
  counts,
  emptyLine,
}: {
  counts: CardCounts;
  /** An empty pool reads as a sentence, except in balanced, where the dashed note says it (8.3). */
  emptyLine: boolean;
}) {
  if (counts.banned === 0 && emptyLine)
    return <span className="text-base">{fearlessNothingBanned(counts.total)}</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-3">
      <span>
        <span className="num text-lg font-semibold font-stretch-85%">{counts.open}</span>{' '}
        <span className="text-[0.9375rem] text-muted-foreground">{FEARLESS_OPEN_WORD}</span>
      </span>
      <span className="text-muted-foreground">
        <span className="num text-[1.0625rem]">{counts.banned}</span>{' '}
        <span className="text-[0.9375rem]">{FEARLESS_BANNED_WORD}</span>
      </span>
    </span>
  );
}

/** Filling: five lane tiles, each a link to the panel on that lane (8.3). */
function LaneTiles({ group, counts }: { group: PageGroup; counts: Record<RoleValue, number> }) {
  return (
    <ul className="grid grid-cols-3 gap-2 px-(--card-pad) pb-4 sm:grid-cols-5">
      {LANE_ORDER.map((role) => (
        <li key={role}>
          <Link
            data-warm-sprites=""
            href={modePanelHref(group, role)}
            scroll={false}
            className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-control border border-border-strong bg-raised px-2 hover:border-muted-foreground"
          >
            {/* Below `sm` the icon sits over the word, so `support` fits a third of 320 (round 1). */}
            <span className="flex flex-col items-center gap-0.5 font-mono text-sm font-medium font-stretch-85% sm:flex-row sm:gap-1.5">
              <RoleIcon role={role} size={16} />
              {role}
            </span>{' '}
            <span className="num text-md font-semibold">{counts[role]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dashed({ children }: { children: ReactNode }) {
  return (
    <p
      className={cn(
        'mx-(--card-pad) mb-4 rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm',
      )}
    >
      {children}
    </p>
  );
}
