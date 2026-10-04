import { RULE_OPTIONS, ruleKey } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SideGlyph } from '@/components/ui/side-glyph';
import { type RegionId, regionName } from '@/lib/champs/regions';
import {
  FEARLESS_BANNED_NEXT,
  FEARLESS_BANNED_WORD,
  FEARLESS_EMPTY_BALANCED,
  FEARLESS_IN_GAME,
  FEARLESS_IN_GAME_MIRROR,
  FEARLESS_NOT_RATED_FINISHED,
  FEARLESS_NOT_RATED_IN_GAME,
  FEARLESS_NOTHING_BANNED_OPEN,
  FEARLESS_OPEN_WORD,
  FEARLESS_YOUR_LANE,
  fearlessFromGame,
  fearlessLaneOpen,
  fearlessNothingBanned,
} from '@/lib/fearless/copy';
import type { FearlessChampion, FearlessView } from '@/lib/fearless/types';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { LANE_ORDER } from '@/lib/laneOrder';
import { type ModeCardView, showsFearlessPool } from '@/lib/mode/card';
import {
  MODE_ACTIONS,
  MODE_CARD_LABEL,
  MODE_CARD_NEXT_GAME,
  MODE_NOW_NORMAL_BODY,
  MODE_NOW_NORMAL_TITLE,
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
  oneGameLine,
  REGION_DIDNT_APPLY,
  REGION_STATUS_BEFORE_ROLL,
  REGION_VS,
  ruleAction,
} from '@/lib/mode/ruleCopy';
import { ruleLabel } from '@/lib/mode/ruleNotices';
import { fearlessCounts } from '@/lib/mode/view';
import { cn } from '@/lib/utils';
import { RoleIcon } from '../_icons/RoleIcon';
import { OpenChip } from './ChampChip';
import type { ModeControlsProps } from './ModeControls';
import { ModeControlsLazy } from './ModeControlsLazy';
import { RatedChip } from './RatedChip';
import { SpinReveal } from './SpinReveal';
import { SpriteIntent } from './SpriteIntent';
import { preconnectDataDragon, spriteSheetUrls } from './sprites';

/**
 * The Mode card on Tonight (M14.30; 05-design.md 8.2 to 8.4): one card summarising tonight's mode
 * in every state. The row is **one link** to the mode panel, so it works without JS (it opens the
 * full page); the admin controls sit outside the link. A server component: only the admin foot
 * (`ModeControls`) is client code.
 *
 * Per state (8.3): idle, the row; filling, the row and five lane tiles; balanced, the row with the
 * viewer's lane (and the panel opens on it); in game, `This game's ten join the ban list when it
 * ends.`; finished, `Banned next game` leads with the ten this game added (absent for an ARAM, a
 * remake or an unrated game, which add nothing). Normal: `Every champion is open.`, and for members
 * the dashed `Normal mode now.` note from a switch until the next game lands. A mirror match on a
 * Fearless night (M15.14) shows the Fearless pool as Fearless does: the open count in its status,
 * the lane tiles, `Your lane support · 24 open`, and in game its champions joining the ban list.
 * A game locked not rated on a Fearless night never promises bans (M15.15): in game `This game
 * isn't rated, so it bans nothing.`, finished `Not rated, so this game banned nothing.` in the
 * `Banned next game` slot; the finished card heads its row `Next game`, because it is about the
 * next game now and its `Rated` chip is that game's.
 */
export type ModeCardVariant = 'idle' | 'filling' | 'balanced' | 'in-game' | 'finished';

export interface ModeCardProps {
  group: PageGroup;
  mode: GroupMode;
  fearless: FearlessView;
  variant: ModeCardVariant;
  /**
   * What the card is about (M15.5, `modeCardView`): the lock while the teams are set or in game,
   * else the next game. Absent (M14 fixtures): the standing mode, rated.
   */
  view?: ModeCardView | undefined;
  /** Balanced, seated: the viewer's lane, which the row links to. */
  viewerLane?: RoleValue | null | undefined;
  /** Balanced, seated: the viewer's side, for region wars' `Your lane support · Ionia`. */
  viewerSide?: 'blue' | 'red' | null | undefined;
  /**
   * Finished: the champions this game added to the pool, and which game of the night it was.
   * `notRated` (M15.15): a Rift game played not rated, which bans nothing and says so in this slot.
   */
  bannedNext?:
    | { champions: readonly FearlessChampion[]; gameNumber: number | null; notRated?: boolean | undefined }
    | null
    | undefined;
  /** Members: the group switched to Normal tonight and no game has landed since. */
  normalJustNow?: boolean | undefined;
  /** Admins and the owner only: drawn from the session on the server. */
  controls?:
    | Omit<ModeControlsProps, 'mode' | 'banned' | 'groupId' | 'resetConfirmHref' | 'nextLine'>
    | null
    | undefined;
}

export function ModeCard(props: ModeCardProps) {
  const { group, mode, fearless, variant, viewerLane = null, viewerSide = null, controls = null } = props;
  const view: ModeCardView = props.view ?? standingView(mode);
  const shown = view.shown;
  const counts = fearlessCounts(fearless);
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
  const bannedNext =
    view.standing === 'fearless' && variant === 'finished' ? (props.bannedNext ?? null) : null;
  const showTen = bannedNext !== null && bannedNext.notRated !== true && bannedNext.champions.length > 0;
  const bannedNothing = bannedNext !== null && bannedNext.notRated === true;
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
          ? FEARLESS_IN_GAME
          : mirrorPool
            ? FEARLESS_IN_GAME_MIRROR
            : null;
  const oneGame = rule && inGameLine === null && banLine === null ? oneGameLine(view.standing) : null;
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
      {showTen ? <BannedNext champions={bannedNext.champions} gameNumber={bannedNext.gameNumber} /> : null}
      {bannedNothing ? (
        <p className="border-b border-border px-(--card-pad) py-4 text-base">{FEARLESS_NOT_RATED_FINISHED}</p>
      ) : null}
      {/* Design round 1: the didn't-apply note leads the card, before the mode it fell back to. */}
      {view.didntApply ? (
        <p className="mx-(--card-pad) mt-4 rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm">
          {REGION_DIDNT_APPLY}
        </p>
      ) : null}

      <Link
        data-warm-sprites={pooled ? '' : undefined}
        id={MODE_CARD_LINK_ID}
        href={modePanelHref(group, lane)}
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
          <SpinReveal labels={SPIN_LABELS} pendingKey={view.pendingKey}>
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
            ) : shown.id === 'region' ? (
              <span className="text-md font-bold">{REGION_STATUS_BEFORE_ROLL}</span>
            ) : mirrorPool ? (
              <span className="text-md font-bold">
                {mirrorStatus(null)}
                <span className="whitespace-nowrap">{` · ${counts.open} open`}</span>
              </span>
            ) : (
              <span className="text-md font-bold">{mirrorStatus(null)}</span>
            )}
          </SpinReveal>
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

      {shown.id === 'normal' && props.normalJustNow && controls === null ? (
        <Dashed>
          <b className="font-bold">{MODE_NOW_NORMAL_TITLE}</b> {MODE_NOW_NORMAL_BODY}
        </Dashed>
      ) : null}

      {controls === null ? null : (
        <ModeControlsLazy
          {...controls}
          groupId={group.id}
          mode={view.standing}
          banned={counts.banned}
          nextLine={view.nextLine}
          resetConfirmHref={modeResetConfirmHref(group)}
        />
      )}
    </section>
  );
}

/** M14's card with no M15 view: the standing mode, rated, nothing locked. */
function standingView(mode: GroupMode): ModeCardView {
  return {
    shown: { id: mode },
    rated: true,
    standing: mode,
    locked: false,
    nextLine: null,
    didntApply: false,
    classOpen: null,
    laneCounts: null,
    pendingKey: null,
  };
}

/** Every rule's short name by key, for the Spin reveal's cycle and its landing. */
const SPIN_LABELS: Record<string, string> = Object.fromEntries(
  RULE_OPTIONS.map((rule) => [ruleKey(rule), ruleLabel(rule)]),
);

/** Region wars after Roll: `◣ BLUE Ionia` vs `◥ RED Noxus` (05-design 8.10). */
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
  counts: ReturnType<typeof fearlessCounts>;
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

/**
 * Finished: `Banned next game · from game 4` and the ten, five rows of a role and its two chips
 * (blue's seat, then red's), in the open dress: here the ban is the news (8.7.3).
 */
function BannedNext({
  champions,
  gameNumber,
}: {
  champions: readonly FearlessChampion[];
  gameNumber: number | null;
}) {
  const rows = [
    ...LANE_ORDER.map((role) => ({ role, champions: champions.filter((c) => c.role === role) })),
    { role: null, champions: champions.filter((c) => c.role === null) },
  ].filter((row) => row.champions.length > 0);
  return (
    <div className="border-b border-border px-(--card-pad) pt-4 pb-3">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-md font-bold">{FEARLESS_BANNED_NEXT}</span>
        {gameNumber === null ? null : (
          <span className="text-xs text-muted-foreground">{fearlessFromGame(gameNumber)}</span>
        )}
      </p>
      <ul className="mt-2 flex flex-col">
        {rows.map((row) => (
          <li
            key={row.role ?? 'other'}
            className="grid grid-cols-[var(--role-cell-w)_minmax(0,1fr)] items-center gap-2 border-t border-border py-2 first:border-t-0"
          >
            <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
              {row.role === null ? null : <RoleIcon role={row.role} size={20} />}
              <span className="font-mono text-2xs font-medium font-stretch-75%">{row.role ?? 'other'}</span>
            </span>
            <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              {row.champions.map((champion) => (
                <OpenChip key={champion.id} id={champion.id} name={champion.name} square />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
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
