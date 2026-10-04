import { preGameOdds } from '@customs/core';
import { useId } from 'react';
import {
  BAR_CAPTION,
  KICKOFF_TEAMS_CHANGED,
  NO_ODDS,
  PRE_GAME_NO_SPLIT,
  PRE_GAME_TEAMS_CHANGED,
  resultOddsLine,
  resultOddsShort,
  TITLE_IN_GAME,
  TITLE_PRE_GAME,
} from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { ReceiptFrame } from './fairness-receipt';
import { HowTheBotDecided } from './how-the-bot-decided';
import { buildReceipt, oddsOf } from './model';
import type {
  DisclosureExtras,
  HeadingLevel,
  RatingsBefore,
  ReceiptNames,
  StoredSplit,
  WinnerSide,
} from './types';
import { WinBar } from './win-bar';

/**
 * A game with no usable split (STRATEGY §4.10): backfilled, played without a roll, or whose
 * teams changed in the lobby after the roll.
 *
 * The odds are core's `preGameOdds` over everyone's all-time `r_before` (M18.5): no gap, no
 * off-role, no pick number, because none of it exists. Any rating missing and there are no
 * odds: the receipt hides and only `No odds for this game.` is said.
 *
 * `teams-changed` still shows the splits the bot rolled, in the disclosure, when `rolled` is given.
 *
 * M21.5, `kickoff`: Tonight while the game is on, for teams Kustom did not roll (`custom`, or
 * `unrolled`). The title is `Odds at kickoff`, the number is the stored kickoff odds (never
 * recomputed here), and a changed game's line says `the teams playing now`. `blueWinProb: null`
 * is a game whose odds are not shown (not rated, M15.18): only `No odds for this game.`.
 */
export type PreGameReceiptProps = (
  | { ratingsBefore: RatingsBefore; kickoff?: undefined }
  | { kickoff: { blueWinProb: number | null }; ratingsBefore?: undefined }
) & {
  reason: 'no-split' | 'teams-changed';
  /** The winner, when the game is over: the result line replaces nothing, it leads. */
  winner?: WinnerSide | undefined;
  /** Tonight's poster (M14.45): its headline names the winner, so the line is the odds only. */
  winnerShown?: boolean | undefined;
  /** `teams-changed` only: the run the bot rolled, for `How the bot decided`. */
  rolled?: { splits: readonly StoredSplit[]; names: ReceiptNames } | undefined;
  gameNumber?: number | undefined;
  /**
   * M14.59: the rating fold's stored blue probability for this game, when the page has it. A game
   * the bot did not pick shows the fold's own number, so the bar can never disagree with the
   * explanation under a change. Absent or `null`: core's `preGameOdds` over the befores, as before.
   */
  ratingBlueWinProb?: number | null | undefined;
  headingLevel?: HeadingLevel | undefined;
  className?: string | undefined;
} & DisclosureExtras;

export function PreGameReceipt(props: PreGameReceiptProps) {
  const { reason, winner, rolled, gameNumber, headingLevel = 'h2', className } = props;
  const titleId = useId();
  const kickoff = props.kickoff !== undefined;
  const blueWinProb =
    props.kickoff !== undefined
      ? props.kickoff.blueWinProb
      : (props.ratingBlueWinProb ?? preGameOdds(props.ratingsBefore.blue, props.ratingsBefore.red));
  const odds = blueWinProb === null ? null : oddsOf(blueWinProb);

  if (odds === null) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{NO_ODDS}</p>;
  }

  const model = reason === 'teams-changed' && rolled !== undefined ? buildReceipt(rolled.splits) : null;

  return (
    <ReceiptFrame
      titleId={titleId}
      title={kickoff ? TITLE_IN_GAME : TITLE_PRE_GAME}
      headingLevel={headingLevel}
      gameNumber={gameNumber}
      className={className}
    >
      <div className="px-(--card-pad) pb-4">
        <div className="mt-3">
          <WinBar odds={odds} />
        </div>
        <p className="mt-3 text-center text-[0.875rem] text-muted-foreground">{BAR_CAPTION}</p>
        {winner === undefined ? null : (
          <p className="mt-3.5 text-lg leading-tight font-bold text-balance">
            {(props.winnerShown === true ? resultOddsShort : resultOddsLine)(odds.blueWinProb, winner)}
          </p>
        )}
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
          {reason === 'no-split'
            ? PRE_GAME_NO_SPLIT
            : kickoff
              ? KICKOFF_TEAMS_CHANGED
              : PRE_GAME_TEAMS_CHANGED}
        </p>
      </div>
      {model !== null && rolled !== undefined ? (
        <HowTheBotDecided
          model={model}
          names={rolled.names}
          calibration={props.calibration}
          howHref={props.howHref}
          disclosureId={props.disclosureId}
          defaultOpen={props.defaultOpen}
        />
      ) : null}
    </ReceiptFrame>
  );
}
