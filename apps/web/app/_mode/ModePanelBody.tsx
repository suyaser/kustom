import { CLASS_TAGS, type ClassTag, classPool } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import type { Route } from 'next';
import Link from 'next/link';
import { championRegionMap } from '@/lib/champs/championFacts';
import { listChampions } from '@/lib/champs/names';
import { REGION_CREDIT, type RegionId, regionName } from '@/lib/champs/regions';
import {
  FEARLESS_BANNED_WORD,
  FEARLESS_CARD_SENTENCE,
  FEARLESS_EMPTY_BALANCED,
  FEARLESS_OPEN_WORD,
  fearlessNotRatedSentence,
  fearlessPoolSince,
} from '@/lib/fearless/copy';
import type { FearlessView } from '@/lib/fearless/types';
import { LANE_ORDER } from '@/lib/laneOrder';
import type { ModeCardView } from '@/lib/mode/card';
import { championTable } from '@/lib/mode/champions';
import {
  PANEL_ADMIN_END,
  PANEL_ADMIN_LEAD,
  PANEL_ADMIN_LINK,
  PANEL_NORMAL_BODY,
  panelNormalPaused,
} from '@/lib/mode/copy';
import {
  classCounts,
  classEmptyLane,
  classSentence,
  mirrorSentence,
  modeName,
  NORMAL_RULE_LIST,
  regionEmptyLane,
  regionSentence,
} from '@/lib/mode/ruleCopy';
import { ruleLabel } from '@/lib/mode/ruleNotices';
import { fearlessCounts, type LaneChoice } from '@/lib/mode/view';
import { panelHeadLine } from '@/lib/tonight/switcher';
import { FearlessPool, type PoolSide } from './FearlessPool';
import { RatedChip } from './RatedChip';
import { preloadChampionSprites } from './sprites';

/**
 * The mode panel's body (M14.30, M15.5; 05-design.md 8.5, 8.7, 8.10): the same content in the
 * overlay over Tonight (heading h2, Tonight keeps its h1) and on the direct page (h1). Reading and
 * filtering only: no picker, no Spin, no switch, no Reset (8.6 rule 6); an admin gets one line
 * pointing at the card.
 *
 * Per mode: Fearless's pool tool; Normal's sentence and the rule list; Class wars' rule, sentence,
 * counts and the class pool (minus the bans under standing Fearless); Region wars' two pools (or,
 * before Roll, when they are drawn) with the region credit; Mirror match's sentence, and on a
 * Fearless night the Fearless pool under it (M15.14).
 */
export interface ModePanelBodyProps {
  mode: GroupMode;
  fearless: FearlessView;
  /** What the card is about (M15.5). Absent: the standing mode, rated (M14 callers). */
  view?: ModeCardView | undefined;
  lane: LaneChoice;
  viewerLane: RoleValue | null;
  /** Seated in set teams: the viewer's side, whose region pool comes first (M15.5). */
  viewerSide?: 'blue' | 'red' | null | undefined;
  isAdmin: boolean;
  /** `Thu 1 Oct` (the pool's reset day in the group's zone), or `null`. */
  poolSince: string | null;
  /** M22.6 (14.5): live lobbies; with 2+ the head says they all add to this list. */
  liveTables?: number | undefined;
  /** `/g/<slug>#mode`: the card the admin line points at. */
  cardHref: string;
  heading: 'h1' | 'h2';
  headingId: string;
}

export function ModePanelBody(props: ModePanelBodyProps) {
  const { mode, fearless, isAdmin, heading: Heading, headingId } = props;
  const counts = fearlessCounts(fearless);
  const shown = props.view?.shown ?? { id: mode };
  const rated = props.view?.rated ?? true;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Heading id={headingId} tabIndex={-1} className="text-xl font-bold focus:outline-none">
          {modeName(shown)}
        </Heading>
        <RatedChip rated={rated} />
      </div>

      {shown.id === 'fearless' ? (
        <FearlessBody {...props} counts={counts} />
      ) : shown.id === 'class' ? (
        <ClassBody {...props} tag={shown.tag} rated={rated} />
      ) : shown.id === 'region' ? (
        <RegionBody
          {...props}
          regions={{ blue: shown.blue as RegionId, red: shown.red as RegionId }}
          rated={rated}
        />
      ) : shown.id === 'mirror' ? (
        <>
          <p className="text-base">{mirrorSentence(rated)}</p>
          {/* M15.14: on a Fearless night the bans still stand, so the pool follows, folded as Fearless. */}
          {(props.view?.standing ?? mode) === 'fearless' ? <FearlessBody {...props} counts={counts} /> : null}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-base">{PANEL_NORMAL_BODY}</p>
          {counts.banned === 0 ? null : (
            <p className="text-sm text-muted-foreground">{panelNormalPaused(counts.banned)}</p>
          )}
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {NORMAL_RULE_LIST.map((line) => {
              // `Class wars:` in 700, the sentence in 400 (round 1). `Spin lets…` has no name.
              const cut = line.indexOf(':');
              return (
                <li key={line}>
                  {cut === -1 ? (
                    line
                  ) : (
                    <>
                      <b className="font-bold">{line.slice(0, cut + 1)}</b>
                      {line.slice(cut + 1)}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isAdmin ? (
        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          {PANEL_ADMIN_LEAD}
          <Link
            href={props.cardHref as Route}
            className="font-bold text-foreground underline underline-offset-3"
          >
            {PANEL_ADMIN_LINK}
          </Link>
          {PANEL_ADMIN_END}
        </p>
      ) : null}
    </div>
  );
}

/** Bans count only while the standing mode is Fearless (D7); under Normal a rule's whole pool shows. */
function bansFor(props: ModePanelBodyProps) {
  return (props.view?.standing ?? props.mode) === 'fearless' ? props.fearless.champions : [];
}

function ClassBody(props: ModePanelBodyProps & { tag: ClassTag; rated: boolean }) {
  const { tag, rated } = props;
  preloadChampionSprites();
  const within = classPool(tag, championTable());
  const bans = bansFor(props);
  const banned = new Set(bans.map((champion) => champion.id));
  const bannedHere = within.filter((id) => banned.has(id)).length;
  const emptyLane = Object.fromEntries(LANE_ORDER.map((role) => [role, classEmptyLane(tag, role)])) as Record<
    RoleValue,
    string
  >;
  return (
    <>
      <p className="text-lg font-bold">{ruleLabel({ id: 'class', tag })}</p>
      <p className="text-sm text-muted-foreground">{classSentence(tag, rated)}</p>
      <p className="text-[1.0625rem] font-bold">{classCounts(tag, within.length, listChampions().length)}</p>
      {bans.length === 0 ? null : (
        // Under standing Fearless, the card's `Tanks only · 40 open` as Fearless's count line (round 1).
        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span>
            <span className="num text-xl font-semibold font-stretch-85%">{within.length - bannedHere}</span>{' '}
            <span className="text-[1.0625rem] font-bold">{FEARLESS_OPEN_WORD}</span>
          </span>
          <span className="text-muted-foreground">
            <span className="num text-md font-semibold">{bannedHere}</span>{' '}
            <span className="text-[0.9375rem]">{FEARLESS_BANNED_WORD}</span>
          </span>
        </p>
      )}
      <FearlessPool
        banned={bans}
        within={within}
        emptyLane={emptyLane}
        regions={championRegionMap(within)}
        initialLane={props.lane}
        viewerLane={props.viewerLane}
        laneHeading={props.heading === 'h1' ? 'h2' : 'h3'}
      />
    </>
  );
}

function RegionBody(
  // M20 D9: region wars always carries its pair, before Roll (the row's) and after (the lock's).
  props: ModePanelBodyProps & { regions: { blue: RegionId; red: RegionId }; rated: boolean },
) {
  const { regions, rated } = props;
  preloadChampionSprites();
  const table = championTable();
  const ids = (region: RegionId) =>
    [...table].filter(([, facts]) => facts.region?.includes(region)).map(([id]) => id);
  const pool = (side: 'blue' | 'red'): PoolSide => ({
    side,
    title: `${side === 'blue' ? 'BLUE' : 'RED'} ${regionName(regions[side])}`,
    region: regionName(regions[side]),
    within: ids(regions[side]),
    first: props.viewerSide === side,
    emptyLane: Object.fromEntries(LANE_ORDER.map((role) => [role, regionEmptyLane(regions[side])])),
  });
  const blue = pool('blue');
  const red = pool('red');
  return (
    <>
      <p className="text-sm text-muted-foreground">{regionSentence(regions.blue, regions.red, rated)}</p>
      <FearlessPool
        banned={bansFor(props)}
        // Always blue then red (blue left at ≥1024); the viewer's pool moves first below 1024 only.
        sides={[blue, red]}
        regions={championRegionMap([...blue.within, ...red.within])}
        initialLane={props.lane}
        viewerLane={props.viewerLane}
        laneHeading={props.heading === 'h1' ? 'h2' : 'h3'}
      />
      <p className="text-xs text-muted-foreground">{REGION_CREDIT}</p>
    </>
  );
}

function FearlessBody({
  fearless,
  lane,
  viewerLane,
  poolSince,
  heading,
  counts,
  view,
  liveTables = 0,
}: ModePanelBodyProps & { counts: ReturnType<typeof fearlessCounts> }) {
  preloadChampionSprites();
  // M15.15: a game that is not rated bans nothing, so the sentence makes no promise for it.
  const notRated = view !== undefined && view.standing === 'fearless' && !view.rated;
  return (
    <>
      <p className="text-sm text-muted-foreground">{fearlessPoolSince(poolSince, fearless.games ?? 0)}</p>
      {liveTables >= 2 ? <p className="text-sm text-muted-foreground">{panelHeadLine(liveTables)}</p> : null}
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="num text-xl font-semibold font-stretch-85%">{counts.open}</span>{' '}
          <span className="text-[1.0625rem] font-bold">{FEARLESS_OPEN_WORD}</span>
        </span>
        <span className="text-muted-foreground">
          <span className="num text-md font-semibold">{counts.banned}</span>{' '}
          <span className="text-[0.9375rem]">{FEARLESS_BANNED_WORD}</span>
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        {notRated
          ? fearlessNotRatedSentence(counts.banned === 0, view.locked)
          : counts.banned === 0
            ? FEARLESS_EMPTY_BALANCED
            : FEARLESS_CARD_SENTENCE}
      </p>
      <FearlessPool
        banned={fearless.champions}
        regions={rosterRegions(fearless)}
        initialLane={lane}
        viewerLane={viewerLane}
        laneHeading={heading === 'h1' ? 'h2' : 'h3'}
      />
    </>
  );
}

/**
 * M20.5: the region words for every chip the Fearless pool can draw (the roster, plus any banned id
 * the roster lacks), built here on the server so the table stays out of the client island.
 */
function rosterRegions(fearless: FearlessView) {
  return championRegionMap([
    ...listChampions().map((champion) => champion.id),
    ...fearless.champions.map((champion) => champion.id),
  ]);
}

/** Keeps `CLASS_TAGS` in the bundle's graph honest for the type above. */
export const PANEL_CLASSES: readonly ClassTag[] = CLASS_TAGS;
