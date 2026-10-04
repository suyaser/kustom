import { preGameOdds } from '@customs/core';
import { Chip } from '@/components/ui/chip';
import { SentenceText } from '@/components/why/sentence';
import type { Sentence } from '@/lib/breakdown/copy';
import { ARAM_LABEL, pickTag, resultOdds, UPSET_TAG } from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { oddsOf } from './model';
import type { RatingsBefore, WinnerSide } from './types';

/**
 * The compact receipt (STRATEGY §4.7; docs/05-design.md 5.5 "Compact"): one line for a games
 * list row, a player's game list or a tape tile. It says it in words and draws no bar (5.5:
 * "History rows and tape tiles do not draw a bar"); the row links to the game page, which has
 * the full receipt.
 *
 * `Blue was 54%. Blue won.` / `50–50. Red won.`, plus small tags: `Upset` under 50%, `pick #2`
 * after a reroll, `ARAM`. The odds are the chosen split's stored `blueWinProb`, or, for a game
 * with no split, core's `preGameOdds`; with neither it renders nothing (no odds, no claim).
 */
export type CompactReceiptProps = {
  winner: WinnerSide;
  /** ARAM keeps the line and adds the label; no rating claims. */
  aram?: boolean | undefined;
  /**
   * The row's own title already says who won (the games list's `Red won`), so the line stops at
   * the odds: `Red was 46%.` / `50–50.` (M14.42, scene-walk gap 12).
   */
  winnerInTitle?: boolean | undefined;
  className?: string | undefined;
} & (
  | {
      blueWinProb: number;
      rank?: number | undefined;
      ratingsBefore?: undefined;
      ratingBlueWinProb?: undefined;
      /** M14.59: both odds named once, on its own line, when they round differently. */
      oddsGap?: Sentence | null | undefined;
    }
  | {
      ratingsBefore: RatingsBefore;
      /** M14.59: the fold's stored blue probability, used instead of `preGameOdds` when known. */
      ratingBlueWinProb?: number | null | undefined;
      blueWinProb?: undefined;
      rank?: undefined;
      oddsGap?: undefined;
    }
);

export function CompactReceipt(props: CompactReceiptProps) {
  const { winner, aram = false, winnerInTitle = false, className } = props;
  const prob =
    props.ratingsBefore === undefined
      ? props.blueWinProb
      : (props.ratingBlueWinProb ?? preGameOdds(props.ratingsBefore.blue, props.ratingsBefore.red));
  const odds = prob === null ? null : oddsOf(prob);
  if (odds === null) return null;

  const result = resultOdds(odds.blueWinProb, winner);
  const { upset } = result;
  const line = winnerInTitle ? result.odds : result.line;
  const rank = props.ratingsBefore === undefined ? props.rank : undefined;

  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-muted-foreground',
        className,
      )}
    >
      <span>{line}</span>
      {upset ? <Chip>{UPSET_TAG}</Chip> : null}
      {rank !== undefined && rank > 1 ? (
        <Chip className="num text-2xs font-stretch-85%">{pickTag(rank)}</Chip>
      ) : null}
      {aram ? <Chip>{ARAM_LABEL}</Chip> : null}
      {props.oddsGap ? (
        <span data-slot="odds-gap" className="basis-full text-sm text-pretty">
          <SentenceText sentence={props.oddsGap} />
        </span>
      ) : null}
    </p>
  );
}
