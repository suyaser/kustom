'use client';

import type { RoleValue } from '@customs/db';
import { useEffect, useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { SideGlyph } from '@/components/ui/side-glyph';
import { DDRAGON_SPRITE_SHEETS, ddragonSpriteSheetUrl } from '@/lib/champs/ddragon';
import {
  FEARLESS_ALL_LANES,
  FEARLESS_BANNED_LABEL,
  FEARLESS_LANE_FILTER,
  FEARLESS_SEARCH,
  FEARLESS_SEARCH_EMPTY,
  FEARLESS_SEARCH_PLACEHOLDER,
  FEARLESS_SHOW_EVERY_LANE,
  fearlessAvailable,
  fearlessBanned,
  fearlessLaneOpen,
  fearlessLaneTitle,
  fearlessYourLaneThisGame,
} from '@/lib/fearless/copy';
import {
  availableFearless,
  type FearlessLaneDisplay,
  fearlessExact,
  fearlessLanes,
  fearlessMatches,
} from '@/lib/fearless/present';
import type { FearlessChampion } from '@/lib/fearless/types';
import { LANE_ORDER } from '@/lib/laneOrder';
import type { LaneChoice } from '@/lib/mode/view';
import { cn } from '@/lib/utils';
import { RoleIcon } from '../_icons/RoleIcon';
import { BannedChip, OpenChip } from './ChampChip';

/**
 * The pool inside the mode panel (05-design.md 8.7, 8.10): the find box, the single-select lane
 * control (`All · top · jungle · mid · adc · support`), then per lane the open champions as the
 * primary grid and the bans folded into a `Banned` disclosure, closed by default.
 *
 * - **Fearless** (M14.30): the whole roster minus the pool.
 * - **Class wars** (M15.5): `within` narrows it to the class; a lane with none says so in words
 *   (`emptyLane`). Bans exist only under standing Fearless (the caller passes none otherwise).
 * - **Region wars** (M15.5): `sides`, two pools under one find box and one lane control, side by
 *   side at ≥1024 (blue's tinted head left, red's with the hatch right), stacked below, the
 *   viewer's side first.
 *
 * - **Typing ignores the lane control**, opens every `Banned` fold and hides the per-lane counts.
 * - The lane control is client state: `?lane=` is only its first value (8.5.1).
 * - `All` at ≥1024 is the five-column draft board for one pool; one lane is a 2-column grid on phones.
 * - A sprite sheet that fails to load turns every icon off (`data-icons="off"`), one reflow.
 *
 * The panel's one client island; it loads with the panel route, never with Tonight.
 */
export interface PoolSide {
  side: 'blue' | 'red';
  /** `BLUE Ionia`: the side word and the region, the pool's accessible name. */
  title: string;
  /** The region's plain name, `Ionia`, for the head. */
  region: string;
  within: readonly number[];
  /** The viewer's side: first below 1024 (blue stays left at ≥1024). */
  first?: boolean | undefined;
  /**
   * The sentence for a lane where none of this side's champions usually plays (QA fix 2026-10-04):
   * the lane keeps its row with the sentence, never an empty column. Falls back to the pool's own.
   */
  emptyLane?: Partial<Record<RoleValue, string>> | undefined;
}

export interface FearlessPoolProps {
  banned: readonly FearlessChampion[];
  initialLane: LaneChoice;
  /** The viewer's seat this game, when they have one: `Your lane this game: <role>.` */
  viewerLane: RoleValue | null;
  /**
   * The lanes' heading level: one below the panel's title (A6, M14.41). `h3` under the overlay's
   * h2 (the default), `h2` on the direct `/g/<slug>/mode` page, whose title is the h1.
   */
  laneHeading?: 'h2' | 'h3' | undefined;
  /** M15.5, class wars: only these champion ids are in the pool. */
  within?: readonly number[] | undefined;
  /** M15.5: the sentence for a lane with no champion in the pool (class wars). */
  emptyLane?: Partial<Record<RoleValue, string>> | undefined;
  /** M15.5, region wars: one pool per side, in the order given (the viewer's side first). */
  sides?: readonly PoolSide[] | undefined;
  /**
   * M20.5: champion id -> its region words (`championRegionMap`), built on the server so the
   * region table never ships here. An id with no entry has no tag. Display only: the find box and
   * the lanes never read it.
   */
  regions?: Readonly<Record<number, readonly string[]>> | undefined;
}

interface Group {
  key: string;
  side: PoolSide | null;
  open: FearlessChampion[];
  banned: FearlessChampion[];
}

export function FearlessPool({
  banned,
  initialLane,
  viewerLane,
  laneHeading = 'h3',
  within,
  emptyLane,
  sides,
  regions,
}: FearlessPoolProps) {
  const LaneHeading = laneHeading;
  const searchId = useId();
  const answerId = useId();
  const [query, setQuery] = useState('');
  const [lane, setLane] = useState<LaneChoice>(initialLane);
  const [iconsOff, setIconsOff] = useState(false);
  const typing = query.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    for (let sheet = 0; sheet < DDRAGON_SPRITE_SHEETS; sheet += 1) {
      const image = new Image();
      image.onerror = () => {
        if (!cancelled) setIconsOff(true);
      };
      image.src = ddragonSpriteSheetUrl(sheet);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<Group[]>(() => {
    const allOpen = availableFearless(banned);
    const narrow = (ids: readonly number[] | undefined) => {
      if (ids === undefined) return { open: allOpen, banned: [...banned] };
      const set = new Set(ids);
      return {
        open: allOpen.filter((champion) => set.has(champion.id)),
        banned: banned.filter((champion) => set.has(champion.id)),
      };
    };
    if (sides !== undefined && sides.length > 0)
      return sides.map((side) => ({ key: side.side, side, ...narrow(side.within) }));
    return [{ key: 'pool', side: null, ...narrow(within) }];
  }, [banned, within, sides]);

  const shown = useMemo(
    () =>
      groups.map((group) => {
        const all = fearlessLanes(
          group.banned.filter((champion) => fearlessMatches(champion.name, query)),
          group.open.filter((champion) => fearlessMatches(champion.name, query)),
        );
        // A lane with nothing in the pool still gets its row, with the sentence (class wars; region
        // wars per side).
        const sentences = group.side?.emptyLane ?? emptyLane;
        const filled: (FearlessLaneDisplay & { empty?: string })[] =
          sentences === undefined || typing
            ? all
            : [
                ...LANE_ORDER.map(
                  (role) =>
                    all.find((one) => one.role === role) ?? {
                      role,
                      open: [],
                      banned: [],
                      empty: sentences[role],
                    },
                ),
                ...all.filter((one) => one.role === null),
              ];
        const lanes = typing || lane === 'all' ? filled : filled.filter((one) => one.role === lane);
        return { ...group, lanes };
      }),
    [groups, query, typing, lane, emptyLane],
  );

  const everyBanned = groups.flatMap((group) => group.banned);
  const everyOpen = groups.flatMap((group) => group.open);
  const bannedHit = everyBanned.find((champion) => fearlessExact(champion.name, query));
  const openHit = bannedHit ? undefined : everyOpen.find((champion) => fearlessExact(champion.name, query));
  const answer = !typing
    ? ''
    : bannedHit
      ? fearlessBanned(bannedHit.name)
      : openHit
        ? fearlessAvailable(openHit.name)
        : shown.every((group) => group.lanes.length === 0)
          ? FEARLESS_SEARCH_EMPTY
          : '';
  const two = shown.length > 1;
  const board = lane === 'all' && !typing && !two;

  return (
    <div data-icons={iconsOff ? 'off' : undefined} data-slot="fearless-pool" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
        <div className="flex flex-col gap-1.5 lg:w-[min(380px,40%)] lg:min-w-[260px]">
          <label htmlFor={searchId} className="text-xs font-bold">
            {FEARLESS_SEARCH}
          </label>
          <Input
            id={searchId}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={FEARLESS_SEARCH_PLACEHOLDER}
            value={query}
            aria-describedby={answerId}
            onChange={(event) => setQuery(event.target.value)}
            className="bg-background"
          />
        </div>
        <fieldset
          aria-label={FEARLESS_LANE_FILTER}
          className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0 min-[360px]:grid-cols-3 lg:flex lg:flex-wrap"
        >
          {(['all', ...LANE_ORDER] as const).map((choice) => {
            const pressed = lane === choice;
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={pressed}
                onClick={() => setLane(choice)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-1 rounded-control border border-border-strong bg-raised px-2',
                  'transition-[background-color,color,scale] duration-(--dur-fast) ease-out active:scale-[.98]',
                  choice === 'all'
                    ? 'text-sm font-bold'
                    : 'font-mono text-[0.9375rem] font-medium font-stretch-75%',
                  'aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-card',
                )}
              >
                {choice === 'all' ? (
                  FEARLESS_ALL_LANES
                ) : (
                  <>
                    <RoleIcon role={choice} size={20} />
                    {choice}
                  </>
                )}
              </button>
            );
          })}
        </fieldset>
      </div>

      {viewerLane !== null && lane === viewerLane && !typing ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          {fearlessYourLaneThisGame(viewerLane)}
          <button
            type="button"
            onClick={() => setLane('all')}
            className="inline-flex min-h-11 items-center font-bold underline underline-offset-3"
          >
            {FEARLESS_SHOW_EVERY_LANE}
          </button>
        </p>
      ) : null}

      <p id={answerId} role="status" className="text-md font-bold empty:hidden">
        {answer}
      </p>

      <div className={cn(two && 'flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5')}>
        {shown.map((group) => {
          const lanes = (
            <div
              className={cn('flex flex-col gap-6', board && 'lg:grid lg:grid-cols-5 lg:items-start lg:gap-4')}
            >
              {group.lanes.map((one) => {
                const role = one.role;
                const title = fearlessLaneTitle(role);
                const empty = 'empty' in one ? one.empty : undefined;
                return (
                  <section
                    key={role ?? 'other'}
                    aria-label={group.side === null ? title : `${group.side.title} ${title}`}
                    className="flex flex-col gap-3 [contain-intrinsic-size:auto_520px] [content-visibility:auto]"
                  >
                    <LaneHeading
                      className={cn(
                        'flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border pt-3',
                        // The five-column board is ~210px a column: the count takes its own line there.
                        board && 'lg:grid lg:grid-cols-[auto_minmax(0,1fr)]',
                      )}
                    >
                      {role === null ? null : <RoleIcon role={role} size={24} />}
                      <span className="font-mono text-lg font-semibold font-stretch-88%">{title}</span>
                      {typing || role === null ? null : (
                        <span
                          className={cn(
                            'num ml-auto text-md font-semibold whitespace-nowrap font-stretch-85%',
                            board && 'lg:col-span-2 lg:ml-0',
                          )}
                        >
                          {fearlessLaneOpen(one.open.length)}
                        </span>
                      )}
                    </LaneHeading>
                    {empty === undefined ? null : <p className="text-sm text-muted-foreground">{empty}</p>}
                    {one.open.length === 0 ? null : (
                      <ul
                        className={cn(
                          // Columns by text size, not screen width (8.15.4): two at 100% on 375,
                          // one at 320 or at 125% and up. rem, not em: the pool's own font is 17px,
                          // and 9em (153px) would drop the 309px panel at 375 to one column.
                          'grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2',
                          board
                            ? 'lg:grid-cols-1'
                            : two
                              ? 'lg:grid-cols-[repeat(auto-fill,minmax(min(100%,9.4rem),1fr))]'
                              : 'lg:grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))]',
                        )}
                      >
                        {one.open.map((champion) => (
                          <OpenChip
                            key={champion.id}
                            id={champion.id}
                            name={champion.name}
                            regions={regions?.[champion.id]}
                            hit={openHit?.id === champion.id}
                          />
                        ))}
                      </ul>
                    )}
                    {one.banned.length === 0 ? null : (
                      <details open={typing ? true : undefined} className="group">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
                          {FEARLESS_BANNED_LABEL}
                          <span className="num">{one.banned.length}</span>
                          <svg
                            viewBox="0 0 12 12"
                            aria-hidden="true"
                            className="size-3 transition-transform group-open:rotate-180"
                          >
                            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </summary>
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {one.banned.map((champion) => (
                            <BannedChip
                              key={champion.id}
                              id={champion.id}
                              name={champion.name}
                              regions={regions?.[champion.id]}
                              hit={bannedHit?.id === champion.id}
                            />
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                );
              })}
            </div>
          );
          if (group.side === null) return <div key={group.key}>{lanes}</div>;
          return (
            <section
              key={group.key}
              aria-label={group.side.title}
              data-side={group.side.side}
              data-viewer-side={group.side.first ? '' : undefined}
              // Blue left, red right at ≥1024 always; below it the viewer's pool comes first (round 1).
              className={cn('flex min-w-0 flex-col gap-3', group.side.first && 'max-lg:order-first')}
            >
              {/* The card's status treatment (round 1): glyph 18, the display-face side word, the region
                  in text 700 23; sticky under the panel bar below 1024 while its pool scrolls by. */}
              <p
                className={cn(
                  'z-10 flex min-h-14 items-center gap-2 rounded-control border border-border px-3 max-lg:sticky max-lg:top-14',
                  group.side.side === 'blue'
                    ? 'bg-team-blue-tint'
                    : 'bg-team-red-tint bg-(image:--hatch-strong)',
                )}
              >
                <SideGlyph
                  side={group.side.side}
                  className={cn(
                    'size-[18px]',
                    group.side.side === 'blue' ? 'text-team-blue' : 'text-team-red',
                  )}
                />
                <span className="font-display text-md font-black tracking-[0.04em] font-stretch-62%">
                  {group.side.side === 'blue' ? 'BLUE' : 'RED'}
                </span>
                <span className="text-lg font-bold">{group.side.region}</span>
              </p>
              {lanes}
            </section>
          );
        })}
      </div>
    </div>
  );
}
