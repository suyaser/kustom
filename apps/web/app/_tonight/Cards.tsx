import type { Route } from 'next';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { NameText } from '@/components/names/name-text';
import { CompactReceipt } from '@/components/receipt';
import { buttonVariants } from '@/components/ui/button';
import { SideGlyph } from '@/components/ui/side-glyph';
import { SEE_FALLBACK, winLossLabel } from '@/lib/board/copy';
import { rowChange } from '@/lib/board/rowChange';
import type { BoardRow, EmptyWindowFallback } from '@/lib/board/types';
import { windowHref } from '@/lib/board/windowKinds';
import { formatMinutes } from '@/lib/games/duration';
import type { PageGroup } from '@/lib/groups/pageGroup';
import {
  categoryLabel,
  challengeHeading,
  gameCopy,
  kdaLine,
  MYSTERY_CORRECT,
  MYSTERY_GUESS,
  MYSTERY_WRONG,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import { groupHref } from '@/lib/nav';
import { joinWebNames, renderWebName } from '@/lib/tonight/copy';
import type { LastGame } from '@/lib/tonight/lastGame';
import { ratingsBefore } from '@/lib/tonight/screen';
import {
  ACE_TAG,
  EMPTY_GROUP_ADMIN_BODY,
  EMPTY_GROUP_ADMIN_TITLE,
  FINISH_SETUP,
  FULL_BOARD,
  LAST_GAME_TITLE,
  SEE_THE_GAME,
  TOP_EMPTY,
  TOP_TITLE,
  TOP_WINDOW,
  YOU_SR,
} from '@/lib/tonight/screenCopy';
import {
  SIT_OUT_PAST,
  SIT_OUT_VIEWER_LEAD,
  SIT_OUT_VIEWER_NEXT,
  SIT_OUT_VIEWER_PAST,
  type SitOutRule,
  sitOutReasonSentence,
  sitOutVerb,
} from '@/lib/tonight/sitOut';
import type { MemberView, PlayerName, ResultView } from '@/lib/tonight/types';
import { cn } from '@/lib/utils';
import { Delta } from '../_games/Delta';
import { MvpSticker } from './Tape';

/** A titled card: `--card`, a border, a real heading (5.0 Card). */
export function TitledCard({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn('overflow-hidden rounded-card border border-border bg-card', className)}
    >
      <div className="flex items-baseline justify-between gap-3 px-(--card-pad) pt-(--card-pad) pb-3">
        <h2 id={titleId} className="text-md font-bold">
          {title}
        </h2>
        {meta === undefined ? null : <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * This week's top five (STRATEGY §6(a) idle; the desktop rail): the board's own rows and order
 * (`loadTopPlayers`, the leaderboard's default window). Each row links to the player.
 *
 * **No Rating on these rows** (M14.41, scene-walk gap 1): the row carries the week's W–L and
 * net points (`rowChange`, M14.57) under `Top this week`, the number the week board is sorted on.
 */
export function TopFive({
  rows,
  group,
  viewerPuuid,
  fallback = null,
}: {
  rows: readonly BoardRow[];
  group: PageGroup;
  viewerPuuid: string | null;
  /** M14.70: an empty week points to last week (or all time) on the board. */
  fallback?: EmptyWindowFallback | null;
}) {
  const boardHref = groupHref(group, { page: 'leaderboard' });
  const fallbackHref = boardHref === null || fallback === null ? null : windowHref(boardHref, fallback);
  return (
    <TitledCard
      title={TOP_TITLE}
      meta={
        boardHref === null ? (
          TOP_WINDOW
        ) : (
          <Link
            href={boardHref}
            className="inline-flex min-h-11 items-center text-sm font-bold text-primary-text underline underline-offset-3"
          >
            {FULL_BOARD}
          </Link>
        )
      }
    >
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-(--card-pad) pb-(--card-pad)">
          <p className="text-sm text-muted-foreground">{TOP_EMPTY}</p>
          {fallbackHref === null || fallback === null ? null : (
            <Link href={fallbackHref as Route} className={cn(buttonVariants({ variant: 'secondary' }))}>
              {SEE_FALLBACK[fallback]}
            </Link>
          )}
        </div>
      ) : (
        <ol>
          {rows.map((row, index) => {
            const href = groupHref(group, { page: 'player', puuid: row.puuid });
            const you = row.puuid === viewerPuuid;
            const inner = (
              <>
                <span className="num w-[3ch] text-sm text-muted-foreground">{index + 1}</span>
                {/* M14.41 (gap 1): the week's record and change, never the weekly Rating, which
                    is a second four-digit number beside the group Rating on the team cards. The
                    record sits under the name so a 16-character name keeps its line at 375. */}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold [overflow-wrap:anywhere]">
                    <NameText name={row.name} suffix={row.nameSuffix} />
                    {you ? <span className="sr-only">{YOU_SR}</span> : null}
                  </span>
                  <span className="num text-xs text-muted-foreground font-stretch-85%">
                    {winLossLabel(row.wins, row.losses)}
                  </span>
                </span>
                {rowChange(row) === null ? null : (
                  <Delta
                    value={rowChange(row) as number}
                    className="w-[5ch] shrink-0 text-right text-md font-stretch-82%"
                  />
                )}
              </>
            );
            const rowClass = cn(
              'flex min-h-12 items-center gap-3 border-t border-border px-(--card-pad) py-2',
              you && 'bg-you-wash outline-2 -outline-offset-2 outline-you',
            );
            return (
              <li key={row.puuid}>
                {href === null ? (
                  <div className={rowClass}>{inner}</div>
                ) : (
                  <Link href={href} className={cn(rowClass, 'hover:bg-accent')}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </TitledCard>
  );
}

/**
 * Today's Daily, as one card on Tonight (STRATEGY §2.4: idle and finished, every width, a card in
 * the phone stack). The game's own heading, the day's question in one line, and what a tap does,
 * all from `lib/mystery/copy.ts`. Nothing when there is no daily page or no game today.
 */
export function DailyCard({ mystery, group }: { mystery: MysteryPageState | null; group: PageGroup }) {
  const href = groupHref(group, { page: 'mystery' });
  if (href === null || mystery === null || mystery.kind === 'empty') return null;
  const day = mystery.kind === 'play' ? mystery.play : mystery.result;
  const action =
    mystery.kind === 'play'
      ? MYSTERY_GUESS
      : mystery.result.personal.correct
        ? MYSTERY_CORRECT
        : MYSTERY_WRONG;

  return (
    <Link
      href={href}
      data-slot="daily-card"
      className="flex min-h-(--row-min-h) items-center gap-3 rounded-card border border-border bg-card p-(--card-pad) hover:border-border-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-md font-bold">{challengeHeading(day.kind, day.challengeNumber)}</span>
        <span className="block text-sm text-muted-foreground">{categoryLabel(day.category)}</span>
        {/* Design review: the KDA (or the closed kicker) is its own line, never after a dangling `·`. */}
        {mystery.kind === 'play' ? (
          <span className="num block text-sm whitespace-nowrap text-muted-foreground">
            {kdaLine(day.hook.kills, day.hook.deaths, day.hook.assists)}
          </span>
        ) : (
          <span className="block text-sm text-muted-foreground">{gameCopy(day.kind).closedKicker}</span>
        )}
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-bold',
          mystery.kind === 'play'
            ? 'text-primary-text underline underline-offset-3'
            : 'text-muted-foreground',
        )}
      >
        {action}
      </span>
    </Link>
  );
}

/**
 * Idle: the group's last game as a compact poster (STRATEGY §6(a)): the winner's side block, the
 * compact receipt line, MVP and ACE, and a link to the game page where the full receipt lives.
 */
export function LastGameCard({
  last,
  group,
  dateLabel,
}: {
  last: LastGame;
  group: PageGroup;
  /** `Fri 2 Oct`, formatted on the server in the group's zone. */
  dateLabel: string;
}) {
  const { result } = last;
  const side = result.winningSide === 100 ? 'blue' : 'red';
  const href = groupHref(group, { page: 'game', gameId: last.gameId });
  const before = ratingsBefore(result);

  return (
    <TitledCard title={LAST_GAME_TITLE} meta={dateLabel}>
      <div className="flex gap-3 px-(--card-pad) pb-(--card-pad)">
        <span
          data-side-fill={side}
          className={cn(
            'flex w-[54px] shrink-0 flex-col items-center justify-center gap-1 rounded-control py-3 font-display text-sm font-black tracking-[0.04em] text-on-team font-stretch-70%',
            side === 'blue' ? 'bg-team-blue' : 'bg-team-red bg-(image:--hatch)',
          )}
        >
          <SideGlyph side={side} />
          {side.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="num text-sm text-muted-foreground font-stretch-85%">
            {formatMinutes(result.durationS)}
          </p>
          {result.blueWinProb === null ? (
            <CompactReceipt winner={result.winningSide} ratingsBefore={before} aram={last.aram} />
          ) : (
            <CompactReceipt
              winner={result.winningSide}
              blueWinProb={result.blueWinProb}
              rank={last.rank ?? undefined}
              aram={last.aram}
            />
          )}
          {result.award === null ? null : <AwardLine award={result.award} group={group} />}
          {href === null ? null : (
            <Link
              href={href}
              className="mt-1 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-3"
            >
              {SEE_THE_GAME}
            </Link>
          )}
        </div>
      </div>
    </TitledCard>
  );
}

/**
 * `MVP Lena · ACE Omar`, as stickers (5.0 Chip `mvp`). M14.41 (gap 5): each name links to its
 * player page when the award carries the puuid, a standalone link with a 44px target.
 */
export function AwardLine({
  award,
  group,
}: {
  award: NonNullable<ResultView['award']>;
  group?: PageGroup | undefined;
}) {
  const href = (puuid: string | undefined) =>
    puuid === undefined || group === undefined ? null : groupHref(group, { page: 'player', puuid });
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-bold">
      <span className="flex items-center gap-1.5">
        <MvpSticker />
        <PlayerLinkOrText name={award.mvp} href={href(award.mvpPuuid)} />
      </span>
      <span className="flex items-center gap-1.5">
        <MvpSticker label={ACE_TAG} />
        <PlayerLinkOrText name={award.ace} href={href(award.acePuuid)} />
      </span>
    </p>
  );
}

/** A name that links to its player page (44px tall, underlined), or plain text with no page. */
function PlayerLinkOrText({ name, href }: { name: PlayerName; href: Route | null }) {
  if (href === null) return <span className="[overflow-wrap:anywhere]">{renderWebName(name)}</span>;
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 [overflow-wrap:anywhere] hover:decoration-2"
    >
      {renderWebName(name)}
    </Link>
  );
}

/**
 * The sit-out note (05-design.md 5.15): dashed edge, no fill, the name in 700. M14.41 (scene-walk
 * gap 4): the first card after the strip while the teams are up, for everyone, and the reason is
 * the one sentence the Discord teams embed prints (`lib/tonight/sitOut.ts`), naming the rule that
 * actually decided. After the game (`finished`) it says who sat, with no reason: the pool has moved.
 */
export function SitOutCard({
  sitters,
  viewerSits,
  rule = null,
  finished = false,
}: {
  sitters: readonly MemberView[];
  viewerSits: boolean;
  /** Why they sit (`loadSitOutRuleOrNone`); `null` or absent prints the lead alone. */
  rule?: SitOutRule | null | undefined;
  finished?: boolean | undefined;
}) {
  if (sitters.length === 0) return null;
  const names = joinWebNames(sitters.map((member) => member.name));
  const plural = sitters.length > 1;
  const reason =
    finished || rule === null
      ? null
      : sitOutReasonSentence(
          rule,
          viewerSits ? { who: 'You', plural: true, you: true } : { who: names, plural },
        );
  return (
    <p
      data-slot="sit-out"
      className="rounded-card border border-dashed border-border-strong px-(--card-pad) py-3 text-sm"
    >
      {viewerSits ? (
        finished ? (
          SIT_OUT_VIEWER_PAST
        ) : (
          SIT_OUT_VIEWER_LEAD
        )
      ) : (
        <>
          <strong className="font-bold [overflow-wrap:anywhere]">{names}</strong>
          {finished ? SIT_OUT_PAST : sitOutVerb(plural)}
        </>
      )}
      {reason === null ? null : ` ${reason}`}
      {viewerSits && !finished ? ` ${SIT_OUT_VIEWER_NEXT}` : null}
    </p>
  );
}

/** A group that has never played (STRATEGY §6(a) "Empty group"). */
export function EmptyGroup({ isAdmin, group }: { isAdmin: boolean; group: PageGroup }) {
  const adminHref = groupHref(group, { page: 'admin' });
  if (isAdmin) {
    return (
      <TitledCard title={EMPTY_GROUP_ADMIN_TITLE}>
        <div className="flex flex-col items-start gap-3 px-(--card-pad) pb-(--card-pad)">
          <p className="text-base">{EMPTY_GROUP_ADMIN_BODY}</p>
          {adminHref === null ? null : (
            <Link href={adminHref} className={buttonVariants({ variant: 'default' })}>
              {FINISH_SETUP}
            </Link>
          )}
        </div>
      </TitledCard>
    );
  }
  // A member: the strip already says it (`NOBODY IN YET` and the sub-line); nothing to add.
  return null;
}
