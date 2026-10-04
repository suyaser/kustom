import { SETTLING_GAMES } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { Route } from 'next';
import { useId } from 'react';
import { EntityLink } from '@/components/links/EntityLink';
import { NameText } from '@/components/names/name-text';
import { Chip } from '@/components/ui/chip';
import { SideGlyph } from '@/components/ui/side-glyph';
import { WhyButton, WhyPanel, WhyScope } from '@/components/why/why-scope';
import { WhyText } from '@/components/why/why-text';
import type { KustomReason } from '@/lib/breakdown/read';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHref } from '@/lib/nav';
import { formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { renderWebName } from '@/lib/tonight/copy';
import { seatStanding } from '@/lib/tonight/screen';
import { settlingChip, teamHeading, WON_TAG, YOU_SR, YOU_TAG, YOUR_SIDE_TAG } from '@/lib/tonight/screenCopy';
import type { PlayerName } from '@/lib/tonight/types';
import { cn } from '@/lib/utils';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * One side (05-design.md 5.1). The page's first question is "am I in, and which side?", so:
 *
 * - a solid colour-blocked header (blue solid, red hatched) with the glyph and the side word, and
 *   `Your side` on the viewer's team; `Won` and a foreground outline on the winner;
 * - five seats in lane order, an `<ol>`; each the role (icon over word), the name (**never
 *   truncated**: it wraps, 6.6), chips under it (`You`, `off-role`, `settling · 4/10`), and the
 *   Rating (`round(r)`, M18.6) top-aligned with the name's first line;
 * - the viewer's seat: the `You` sticker, a 2px `--you` outline, the wash, and `(you)` for screen
 *   readers (four signals; colour is never alone).
 *
 * **No team totals and no win chance** in the header (STRATEGY §4.2): the receipt holds the odds.
 * A server component.
 */
export interface TeamSeat {
  puuid: string;
  name: PlayerName;
  /** The same-name suffix, muted (M14.69). */
  nameSuffix?: string | null | undefined;
  role: RoleValue | null;
  /** The Rating to print, or `null` (an unrated result row prints none). */
  rating: number | null;
  offRole: boolean;
  /** `ratings.games` in this group, for the settling chip; `null` is not known. */
  ratedGames: number | null;
  /** Finished, rated: the display delta (`displayDelta`, may be `-0`). */
  delta?: number | null | undefined;
  /**
   * Finished, rated (M14.58): why the change was that size, from the fold's stored breakdown. With
   * it the change is a button that opens the explanation under the seat; without it, a plain number.
   */
  reason?: KustomReason | null | undefined;
}

export interface TeamCardProps {
  side: 'blue' | 'red';
  seats: readonly TeamSeat[];
  viewerPuuid: string | null;
  /** Finished: this side won. */
  won?: boolean | undefined;
  className?: string | undefined;
  /** M14.41 (gap 5): each name links to its player page in this group. Absent: plain names. */
  group?: Pick<PageGroup, 'id' | 'slug'> | undefined;
}

export function TeamCard({ side, seats, viewerPuuid, won = false, className, group }: TeamCardProps) {
  const titleId = useId();
  const heading = teamHeading(side);
  const yours = viewerPuuid !== null && seats.some((seat) => seat.puuid === viewerPuuid);
  // 05-design 13.2: a card with no lane on any seat (a side changed after the roll, in game) has no
  // role column at all; the name starts at the card padding rather than after an empty gutter.
  const laneless = seats.length > 0 && seats.every((seat) => seat.role === null);

  return (
    <section
      aria-labelledby={titleId}
      data-slot="team-card"
      data-side={side}
      className={cn(
        'overflow-hidden rounded-card border border-border bg-card',
        won && 'outline-2 outline-foreground',
        className,
      )}
    >
      <div
        data-side-fill={side}
        className={cn(
          'flex min-h-(--thead-h) items-center gap-3 pr-3 text-on-team',
          side === 'blue' ? 'bg-team-blue' : 'bg-team-red bg-(image:--hatch)',
        )}
      >
        <span
          className={cn(
            'flex w-(--side-block-w) shrink-0 items-center justify-center self-stretch',
            side === 'blue' ? 'bg-(--stripe)' : 'bg-(--stripe) bg-(image:--hatch)',
          )}
        >
          <SideGlyph side={side} className="size-[18px]" />
        </span>
        <h2
          id={titleId}
          className="flex-1 font-display text-xl font-black tracking-[0.02em] font-stretch-62%"
        >
          <span aria-hidden="true">{heading.visible}</span>
          <span className="sr-only">{heading.sr}</span>
        </h2>
        {won ? <HeaderTag>{WON_TAG}</HeaderTag> : null}
        {yours ? <HeaderTag>{YOUR_SIDE_TAG}</HeaderTag> : null}
      </div>
      <ol>
        {seats.map((seat) => {
          const you = seat.puuid === viewerPuuid;
          const href = group === undefined ? null : groupHref(group, { page: 'player', puuid: seat.puuid });
          const explained = seat.reason != null && seat.delta != null;
          const row = (
            <Seat
              key={seat.puuid}
              seat={seat}
              you={you}
              href={href}
              explained={explained}
              laneless={laneless}
            />
          );
          return explained ? <WhyScope key={seat.puuid}>{row}</WhyScope> : row;
        })}
      </ol>
    </section>
  );
}

function HeaderTag({ children }: { children: string }) {
  return (
    <span className="rounded-chip border-[1.5px] border-current px-2 py-0.5 text-xs font-bold">
      {children}
    </span>
  );
}

function Seat({
  seat,
  you,
  href,
  explained,
  laneless,
}: {
  seat: TeamSeat;
  you: boolean;
  href: Route | null;
  explained: boolean;
  /** Every seat on the card has no role (13.2): two columns, no role cell. */
  laneless: boolean;
}) {
  const main = laneless ? 'col-start-1' : 'col-start-2';
  const standing = seatStanding(seat.ratedGames);
  const settling = (standing === 'settling' || standing === 'new') && seat.ratedGames !== null;
  const number =
    seat.rating === null && (seat.delta === undefined || seat.delta === null) ? null : (
      <>
        {seat.rating === null ? null : (
          <span className="num text-md font-semibold font-stretch-82%">{seat.rating}</span>
        )}
        {seat.delta === undefined || seat.delta === null ? null : explained ? (
          // M14.58: the change opens why it was that size; 44px, above the seat's stretched link.
          <WhyButton className="-my-2 -me-1.5 pe-1.5">
            <Delta value={seat.delta} />
          </WhyButton>
        ) : (
          <Delta value={seat.delta} />
        )}
      </>
    );

  return (
    <li
      data-you={you ? '' : undefined}
      className={cn(
        // 05-design 5.1 at every width: role (icon over word), the name (wraps), the Rating
        // right-aligned on the name's first line in an `auto` third column.
        // Below 1024 the role cell is 52px and the gaps 6px, so a 16-character all-caps name fits on
        // one line at 375 (6.14); from 1024 the full 60px cell.
        'relative grid min-h-(--seat-min-h) content-start items-start gap-x-1.5 gap-y-1 border-t border-border py-2.5 pr-2.5 first:border-t-0',
        'lg:gap-x-2 lg:pr-3',
        laneless
          ? 'grid-cols-[minmax(0,1fr)_auto] pl-(--card-pad) lg:grid-cols-[minmax(0,1fr)_auto]'
          : 'grid-cols-[3.25rem_minmax(0,1fr)_auto] pl-1 lg:grid-cols-[var(--role-cell-w)_minmax(0,1fr)_auto]',
        you && 'bg-you-wash outline-2 -outline-offset-2 outline-you',
        href !== null && !you && 'has-[a:hover]:bg-accent',
      )}
    >
      {laneless ? null : (
        <span className="row-span-3 flex flex-col items-center gap-0.5 pt-0.5 text-muted-foreground">
          {seat.role === null ? null : (
            <>
              <RoleIcon role={seat.role} size={22} />
              <span
                className={cn(
                  'font-mono text-[0.75rem] font-medium tracking-[-0.02em] font-stretch-75% lg:text-2xs lg:tracking-normal',
                  seat.offRole && 'underline decoration-dotted underline-offset-2',
                )}
              >
                {seat.role}
              </span>
            </>
          )}
        </span>
      )}
      <span className={cn(main, 'block min-w-0 text-md font-bold [overflow-wrap:break-word]')}>
        {href === null ? (
          <NameText name={seat.name} suffix={seat.nameSuffix} />
        ) : (
          // The whole seat is the target (≥ 64px, 05-design 5.1), through a stretched link: the
          // name stays the link's accessible name. The one other control is a finished seat's
          // change (M14.58), raised above the link.
          <EntityLink
            href={href}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
          >
            <NameText name={seat.name} suffix={seat.nameSuffix} />
          </EntityLink>
        )}
        {you ? <span className="sr-only">{YOU_SR}</span> : null}
      </span>
      {number === null ? null : (
        <span
          className={cn(
            laneless ? 'col-start-2' : 'col-start-3',
            'row-span-2 row-start-1 flex flex-col items-end',
          )}
        >
          {number}
        </span>
      )}
      {!you && !seat.offRole && !settling ? null : (
        <span className={cn(main, 'flex flex-wrap items-center gap-x-2 gap-y-1.5')}>
          {you ? (
            <Chip variant="you" className="-rotate-2">
              {YOU_TAG}
            </Chip>
          ) : null}
          {seat.offRole ? <Chip variant="off-role">off-role</Chip> : null}
          {settling && seat.ratedGames !== null ? (
            <Chip variant="settling">{settlingChip(seat.ratedGames, SETTLING_GAMES)}</Chip>
          ) : null}
        </span>
      )}
      {explained && seat.reason ? (
        <WhyPanel className={cn(main, 'col-span-2 row-start-3 me-0.5 mt-1')}>
          <WhyText
            reason={seat.reason}
            subject={you ? { kind: 'you' } : { kind: 'name', name: renderWebName(seat.name) }}
          />
        </WhyPanel>
      ) : null}
    </li>
  );
}

/** 5.3: always signed, never coloured; the visible text is hidden and a sentence is read instead. */
function Delta({ value }: { value: number }) {
  const gain = isGain(value);
  const sr =
    Object.is(value, -0) || value === 0 ? 'no change' : gain ? `gained ${value}` : `lost ${Math.abs(value)}`;
  return (
    <span className={cn('num text-sm font-stretch-85%', gain ? 'font-semibold' : 'text-muted-foreground')}>
      <span aria-hidden="true">{formatWebDelta(value)}</span>
      <span className="sr-only">{sr}</span>
    </span>
  );
}
