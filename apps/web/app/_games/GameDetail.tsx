import type { DeltaReason } from '@customs/core';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EntityLink } from '@/components/links/EntityLink';
import { FairnessReceipt, PreGameReceipt } from '@/components/receipt';
import { Chip } from '@/components/ui/chip';
import { SideGlyph } from '@/components/ui/side-glyph';
import { WhyButton, WhyPanel, WhyScope } from '@/components/why/why-scope';
import { subjectFor, WhyText } from '@/components/why/why-text';
import { ACE_LABEL, MVP_LABEL } from '@/lib/board/copy';
import { oddsGapSentence } from '@/lib/breakdown/copy';
import type { GameBreakdown } from '@/lib/breakdown/load';
import {
  BACK_TO_GAMES,
  COL_CS,
  COL_DAMAGE,
  COL_GOLD,
  COL_KDA,
  COL_VISION,
  GAMES_MODE_LABELS,
  resultForWinner,
  SCOREBOARD_LABEL,
  teamTitle,
  WON_TAG,
  YOU_WORD,
} from '@/lib/games/copy';
import type { DetailSeat, DetailTeam, GameDetailView } from '@/lib/games/detail';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHref } from '@/lib/nav';
import { NO_ODDS } from '@/lib/receipt/copy';
import { SIDE_LABELS } from '@/lib/stats/copy';
import { renderWebName } from '@/lib/tonight/copy';
import { cn } from '@/lib/utils';
import { Delta } from './Delta';

/**
 * `/g/<slug>/games/<id>` (M14.16; STRATEGY §4.5, §4.10, §6(c)): the result as the page's h1, the
 * full receipt (finished variant, `How the bot decided` closed) and both scoreboards with MVP and
 * ACE, on one page. A 2.0 root, server-rendered. Below 1024 the receipt comes first, then the two
 * teams; from 1024 the scoreboard is the main column and the receipt sits in the rail.
 */
export function GameDetail({
  game,
  backHref,
  howHref,
  afterScoreboard,
  group,
  recap,
  breakdown = null,
}: {
  game: GameDetailView;
  /**
   * M14.58 / M14.59: the fold's stored breakdown (`loadGameBreakdownOrNone`): each change opens to
   * say why it was that size, and the receipt names the rating's odds when they differ from the
   * bot's. `null` (a failed read, or none) leaves the changes as plain numbers.
   */
  breakdown?: GameBreakdown | null | undefined;
  backHref: string;
  howHref?: string | undefined;
  /** M14.41 (gap 5): every scoreboard name links to its player page in this group. */
  group?: Pick<PageGroup, 'id' | 'slug'> | undefined;
  /** Under the scoreboard: `That's me` (M14.34) or the You-vs-them line (M14.35), from the page. */
  afterScoreboard?: ReactNode;
  /** M16.4: the AI recap (`components/ai/AiRecap`), under the header, above the receipt and scoreboard. */
  recap?: ReactNode;
}) {
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-(--gutter) py-6 lg:py-8">
        <header className="flex flex-col gap-1">
          <Link
            prefetch="auto"
            href={backHref as Route}
            className="-ms-1 inline-flex min-h-11 w-fit items-center px-1 text-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {BACK_TO_GAMES}
          </Link>
          <h1 className="font-display text-display leading-[0.95] font-black tracking-[-0.01em] uppercase font-stretch-62% text-balance">
            {resultForWinner(game.winningSide)}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{game.nightLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="num">{game.durationLabel}</span>
            {game.aram ? <Chip>{GAMES_MODE_LABELS.aram}</Chip> : null}
          </p>
        </header>

        {recap}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_var(--rail-w)]">
          <div className="lg:col-start-2 lg:row-start-1">
            <GameReceipt game={game} howHref={howHref} breakdown={breakdown} />
          </div>
          <section
            aria-labelledby="scoreboard-title"
            className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1"
          >
            <h2 id="scoreboard-title" className="text-lg leading-tight font-bold">
              {SCOREBOARD_LABEL}
            </h2>
            <TeamCard team={game.blue} aram={game.aram} group={group} breakdown={breakdown} />
            <TeamCard team={game.red} aram={game.aram} group={group} breakdown={breakdown} />
            {afterScoreboard}
          </section>
        </div>
      </div>
    </div>
  );
}

function GameReceipt({
  game,
  howHref,
  breakdown,
}: {
  game: GameDetailView;
  howHref?: string | undefined;
  breakdown: GameBreakdown | null;
}) {
  const { receipt } = game;
  const odds = breakdown?.odds ?? null;
  if (receipt.kind === 'rolled') {
    return (
      <FairnessReceipt
        variant="finished"
        winner={game.winningSide}
        splits={receipt.splits}
        names={game.names}
        calibration={game.calibration}
        howHref={howHref}
        laneless={game.aram}
        oddsGap={odds === null ? null : oddsGapSentence(odds, game.winningSide)}
      />
    );
  }
  if (receipt.kind === 'pre-game') {
    return (
      <PreGameReceipt
        reason={receipt.reason}
        ratingsBefore={receipt.ratingsBefore}
        ratingBlueWinProb={odds?.ratingBlueWinProb ?? null}
        winner={game.winningSide}
        rolled={receipt.rolled === null ? undefined : { splits: receipt.rolled, names: game.names }}
        calibration={game.calibration}
        howHref={howHref}
      />
    );
  }
  return (
    <p className="rounded-card border border-dashed border-border-strong p-(--card-pad) text-sm text-muted-foreground">
      {NO_ODDS}
    </p>
  );
}

const HEADER_FILL = {
  100: 'bg-team-blue',
  200: 'bg-team-red bg-(image:--hatch)',
} as const;

/** One side's scoreboard (05-design 5.1's header, 5.2's rows): a section, an ordered list in lane order. */
function TeamCard({
  team,
  aram,
  group,
  breakdown,
}: {
  team: DetailTeam;
  aram: boolean;
  group?: Pick<PageGroup, 'id' | 'slug'> | undefined;
  breakdown: GameBreakdown | null;
}) {
  const titleId = `team-${team.side}`;
  const side = team.side === 100 ? 'blue' : 'red';
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'overflow-hidden rounded-card border border-border bg-card',
        team.won && 'outline-2 -outline-offset-2 outline-foreground',
      )}
    >
      <header
        className={cn(
          'flex min-h-(--thead-h) items-center gap-3 pe-(--card-pad) text-on-team',
          HEADER_FILL[team.side],
        )}
      >
        <span className="flex w-(--side-block-w) shrink-0 items-center justify-center self-stretch bg-(--side-block-shade)">
          <SideGlyph side={side} className="size-4" />
        </span>
        <h3
          id={titleId}
          className="flex-1 font-display text-xl leading-none font-black tracking-[0.04em] uppercase font-stretch-70%"
        >
          <span aria-hidden="true">{SIDE_LABELS[team.side]}</span>
          <span className="sr-only">{teamTitle(team.side)}</span>
        </h3>
        <span className="num text-sm font-bold">
          {team.kills}
          <span className="sr-only"> kills</span>
        </span>
        {team.won ? (
          <span className="rounded-chip border-[1.5px] border-current px-1.5 py-0.5 text-xs font-bold">
            {WON_TAG}
          </span>
        ) : null}
      </header>
      <ol>
        {team.seats.map((seat) => (
          <SeatRow
            key={seat.puuid}
            seat={seat}
            aram={aram}
            href={group === undefined ? null : groupHref(group, { page: 'player', puuid: seat.puuid })}
            reason={breakdown?.reasons.get(seat.puuid) ?? null}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * ARAM has one lane, so its seats draw no role cell (design round 1). A rated seat's change is a
 * button that opens why it was that size (M14.58) as a full row under the name, above the stats.
 */
function SeatRow({
  seat,
  aram,
  href,
  reason,
}: {
  seat: DetailSeat;
  aram: boolean;
  href: Route | null;
  reason: DeltaReason | null;
}) {
  const explained = !aram && seat.delta !== null && reason !== null;
  const row = <SeatRowBody seat={seat} aram={aram} href={href} reason={explained ? reason : null} />;
  return explained ? <WhyScope>{row}</WhyScope> : row;
}

function SeatRowBody({
  seat,
  aram,
  href,
  reason,
}: {
  seat: DetailSeat;
  aram: boolean;
  href: Route | null;
  reason: DeltaReason | null;
}) {
  const stats: readonly { label: string; value: string }[] = [
    { label: COL_KDA, value: seat.kda },
    { label: COL_DAMAGE, value: seat.damageLabel },
    { label: COL_GOLD, value: seat.goldLabel },
    { label: COL_CS, value: String(seat.cs) },
    { label: COL_VISION, value: seat.vision === null ? '–' : String(seat.vision) },
  ];
  return (
    <li
      className={cn(
        'grid gap-x-2 gap-y-2 border-t border-border px-(--card-pad) py-3 first:border-t-0',
        aram ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[var(--role-cell-w)_minmax(0,1fr)_auto]',
        seat.isViewer && 'bg-you-wash outline-2 -outline-offset-2 outline-you',
      )}
    >
      {aram ? null : (
        <span className="pt-0.5 font-mono text-2xs text-muted-foreground font-stretch-75%">
          {seat.role ?? ''}
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-md leading-tight font-bold [overflow-wrap:break-word]">
          {href === null ? (
            renderWebName(seat.name)
          ) : (
            // A standalone link with a 44px target (05-design 5.14): the box grows, the line does not.
            <EntityLink
              href={href}
              className="-my-3 inline-block py-3 underline decoration-1 underline-offset-3 hover:decoration-2"
            >
              {renderWebName(seat.name)}
            </EntityLink>
          )}
          {seat.isViewer ? <span className="sr-only"> ({YOU_WORD.toLowerCase()})</span> : null}
        </span>
        {seat.champion === null ? null : (
          <span className="text-xs text-muted-foreground">{seat.champion}</span>
        )}
        {seat.isViewer || seat.award !== null ? (
          <span className="flex flex-wrap gap-1.5">
            {seat.isViewer ? (
              <Chip variant="you" className="-rotate-2">
                {YOU_WORD}
              </Chip>
            ) : null}
            {seat.award === null ? null : (
              <Chip className="border-foreground bg-foreground font-bold text-card">
                {seat.award === 'mvp' ? MVP_LABEL : ACE_LABEL}
              </Chip>
            )}
          </span>
        ) : null}
      </span>
      {/* ARAM is unrated: no change and no `not rated` on every seat. */}
      {aram ? (
        <span />
      ) : reason === null ? (
        <Delta value={seat.delta} className="pt-0.5 text-sm" />
      ) : (
        <WhyButton className="-my-3 -me-1 self-start ps-1 pe-1">
          <Delta value={seat.delta} className="text-sm" />
        </WhyButton>
      )}
      {reason === null ? null : (
        <WhyPanel className="col-span-full md:col-span-2 md:col-start-2">
          <WhyText
            reason={reason}
            subject={subjectFor(seat.puuid, seat.isViewer ? seat.puuid : null, seat.name)}
          />
        </WhyPanel>
      )}
      {/* Below 768 the stats take the whole row (design round 1): five columns, each at least its widest value. */}
      <dl
        className={cn(
          'col-span-full col-start-1 grid grid-cols-[repeat(5,minmax(max-content,1fr))] gap-x-3 tabular-nums',
          aram ? null : 'md:col-span-2 md:col-start-2',
        )}
      >
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col">
            <dt className="text-2xs text-muted-foreground">{stat.label}</dt>
            <dd className="num text-xs whitespace-nowrap tabular-nums font-stretch-85%">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
