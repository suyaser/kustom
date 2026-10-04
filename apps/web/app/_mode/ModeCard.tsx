import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import { championRegionNames } from '@/lib/champs/championFacts';
import { FEARLESS_BANNED_NEXT, fearlessFromGame } from '@/lib/fearless/copy';
import { EMPTY_FEARLESS, type FearlessChampion, type FearlessView } from '@/lib/fearless/types';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { LANE_ORDER } from '@/lib/laneOrder';
import type { ModeCardView } from '@/lib/mode/cardView';
import { fearlessCounts } from '@/lib/mode/view';
import { RoleIcon } from '../_icons/RoleIcon';
import { OpenChip } from './ChampChip';
import { ModeCardBody, type ModeCardLive, type ModeCardVariant } from './ModeCardBody';
import type { ModeControlsProps } from './ModeControls';

export type { ModeCardLive, ModeCardVariant } from './ModeCardBody';

/**
 * The Mode card on Tonight (M14.30; 05-design.md 8.2 to 8.4): one card summarising tonight's mode
 * in every state. The row is **one link** to the mode panel, so it works without JS (it opens the
 * full page); the admin controls sit outside the link.
 *
 * M19.13: this server half computes what needs the champion table or the pool's names (the
 * Fearless counts, the ten a finished game banned, rendered here) and hands the rest to
 * `ModeCardBody`, a client component that renders the card from the client mode store when
 * `live` is given (decision row 2026-10-04: the name-free Mode card may be patched on the client).
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
  /**
   * M19.13: the facts the client mode store needs to render the card for a state it hears after
   * this render (Tonight). Absent: the card is `view` as given, never patched.
   */
  live?: ModeCardLive | null | undefined;
}

export function ModeCard(props: ModeCardProps) {
  const banned = props.bannedNext ?? null;
  return (
    <ModeCardBody
      group={props.group}
      variant={props.variant}
      view={props.view ?? standingView(props.mode)}
      counts={fearlessCounts(props.fearless)}
      emptyCounts={fearlessCounts(EMPTY_FEARLESS)}
      viewerLane={props.viewerLane ?? null}
      viewerSide={props.viewerSide ?? null}
      bannedNext={
        banned === null
          ? null
          : {
              count: banned.champions.length,
              notRated: banned.notRated === true,
              node:
                banned.champions.length > 0 ? (
                  <BannedNext champions={banned.champions} gameNumber={banned.gameNumber} />
                ) : null,
            }
      }
      normalJustNow={props.normalJustNow ?? false}
      controls={props.controls ?? null}
      live={props.live ?? null}
    />
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

/**
 * Finished: `Banned next game · from game 4` and the ten, five rows of a role and its two chips
 * (blue's seat, then red's), in the open dress: here the ban is the news (8.7.3), each with its
 * region tag (8.15, M20.5). Rendered on the server (champion names, sprites and the region table
 * stay out of the client card's code).
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
            {/* 8.15.4 by text size: two chips a row at 100% on 375 (the list is 241px there, so
                8.15.4's 8em would make it one), one at 125% and up. */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] gap-2">
              {row.champions.map((champion) => (
                <OpenChip
                  key={champion.id}
                  id={champion.id}
                  name={champion.name}
                  regions={championRegionNames(champion.id)}
                  square
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
