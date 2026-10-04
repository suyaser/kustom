import { type ReactNode, useId } from 'react';
import { SentenceText } from '@/components/why/sentence';
import type { Sentence } from '@/lib/breakdown/copy';
import {
  BAR_CAPTION,
  GAME_LABEL,
  oddsSentence,
  offRoleLineParts,
  pickChipParts,
  ratingGapChipParts,
  reasonLineParts,
  receiptChipParts,
  resultOddsLine,
  resultOddsShort,
  TITLE_BALANCED,
  TITLE_FINISHED,
  TITLE_IN_GAME,
} from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { HowTheBotDecided } from './how-the-bot-decided';
import { buildReceipt, nameLookup } from './model';
import { ChipRow, RichText } from './parts';
import type {
  DisclosureExtras,
  HeadingLevel,
  OffRoleSeat,
  ReceiptNames,
  StoredSplit,
  WinnerSide,
} from './types';
import { WinBar } from './win-bar';

/**
 * The fairness receipt (redesign/STRATEGY.md §4.2 to §4.6; docs/05-design.md 5.5).
 *
 * - `balanced`: `Win chance`, the bar, the banded sentence, chips, the reason line, the disclosure.
 * - `in-game`: `Odds at kickoff`, the compact bar and the sentence; no chips, no disclosure (5.5).
 *   It sits under the timer and never collapses away.
 * - `finished` (tonight's poster and the game page): `The odds were`, the bar, the result line
 *   (`Blue was 54%. Blue won.`, `Upset!` under 50%) in place of the sentence, then as `balanced`.
 *
 * Every number comes from the stored split columns through M14.4's helpers (`./model`); the
 * stored `explanation` is printed verbatim in the disclosure and read nowhere else. A run whose
 * chosen probability is outside `[0, 1]` renders nothing rather than a wrong bar.
 *
 * Server-renderable (no state, no effects). On a reroll the page re-renders it with the new
 * splits and speaks `rerollAnnouncement` through its own one polite region (05-design.md 6.4).
 */
export type FairnessReceiptProps = {
  splits: readonly StoredSplit[];
  names: ReceiptNames;
  /** `Game 4` in the corner, when the page knows the number. */
  gameNumber?: number | undefined;
  headingLevel?: HeadingLevel | undefined;
  /** Live only: who is off their main role tonight (core's `isOffRole`), for the off-role line. */
  offRole?: readonly OffRoleSeat[] | undefined;
  /**
   * Tonight only (M14.41): how many of the ten have no main role on record. They are not counted as
   * on-main in the chip, the off-role line, the split cards or the bot note. History leaves it out.
   */
  noMain?: number | undefined;
  className?: string | undefined;
  /**
   * `false` draws the card as `role="group"` instead of a `<section>` landmark (M14.42, quality A7):
   * the landing page shows two demo receipts with the same title, and two landmarks with one name
   * fail axe's `landmark-unique`. Every live receipt keeps the default, a labelled section.
   */
  landmark?: boolean | undefined;
} & DisclosureExtras &
  (
    | { variant: 'balanced' | 'in-game'; winner?: undefined; winnerShown?: undefined; oddsGap?: undefined }
    | {
        variant: 'finished';
        winner: WinnerSide;
        /**
         * Tonight's poster (M14.45): the headline above already says `RED WINS`, so the result line
         * is the odds only (`Red was 51%.`, `resultOddsShort`). The game page leaves it out.
         */
        winnerShown?: boolean | undefined;
        /**
         * M14.59: when the rating's odds round differently from the bot's, the one line naming
         * both (`oddsGapSentence`), under the result line. The result line itself stays the bot's
         * (its `Upset!` is the bot's call); absent or `null` when the two agree.
         */
        oddsGap?: Sentence | null | undefined;
      }
  );

export function FairnessReceipt(props: FairnessReceiptProps) {
  const { splits, names, gameNumber, headingLevel = 'h2', offRole, className, variant, landmark } = props;
  // Absent everywhere but Tonight (live receipts and, since the M14.41 lead ruling, Tonight's own
  // finished poster); the game page and history never pass it, so they print the stored count.
  const noMain = props.noMain ?? 0;
  const titleId = useId();
  const model = buildReceipt(splits);
  if (model === null) return null;

  const { chosen, odds, total, next } = model;
  const name = nameLookup(names);
  const compact = variant === 'in-game';
  const title =
    variant === 'balanced' ? TITLE_BALANCED : variant === 'in-game' ? TITLE_IN_GAME : TITLE_FINISHED;

  const verdict =
    props.variant === 'finished'
      ? (props.winnerShown === true ? resultOddsShort : resultOddsLine)(chosen.blueWinProb, props.winner)
      : oddsSentence(chosen.blueWinProb, chosen.rank);

  // `null` after a reroll reached the last split, or when no swap can be named: no line at all.
  const reason = reasonLineParts(chosen, next, total, name, props.laneless === true);

  return (
    <ReceiptFrame
      titleId={titleId}
      title={title}
      headingLevel={headingLevel}
      gameNumber={gameNumber}
      className={className}
      landmark={landmark}
    >
      <div className="px-(--card-pad) pb-4">
        <div className={compact ? 'mt-2.5' : 'mt-3'}>
          <WinBar odds={odds} size={compact ? 'compact' : 'full'} />
        </div>
        {compact ? null : (
          <p className="mt-3 text-center text-[0.875rem] text-muted-foreground">{BAR_CAPTION}</p>
        )}

        <p
          className={cn(
            'font-bold text-balance',
            compact ? 'mt-2.5 text-md' : 'mt-3.5 text-lg leading-tight',
          )}
        >
          {verdict}
        </p>

        {props.variant === 'finished' && props.oddsGap ? (
          <p data-slot="odds-gap" className="mt-1.5 text-sm text-pretty text-muted-foreground">
            <SentenceText sentence={props.oddsGap} />
          </p>
        ) : null}

        {compact || reason === null ? null : (
          <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
            <RichText rich={reason} />
          </p>
        )}

        {offRole !== undefined &&
        variant !== 'finished' &&
        offRoleLineShown(offRole, compact, props.laneless) ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            <RichText rich={offRoleLineParts(offRole, name, noMain)} />
          </p>
        ) : null}

        {compact ? null : (
          <ChipRow
            className="mt-3.5"
            chips={
              props.laneless === true
                ? [ratingGapChipParts(chosen.gap), pickChipParts(chosen.rank, total)]
                : receiptChipParts(chosen, total, noMain)
            }
          />
        )}
      </div>

      {compact ? null : (
        <HowTheBotDecided
          model={model}
          names={names}
          calibration={props.calibration}
          howHref={props.howHref}
          disclosureId={props.disclosureId}
          defaultOpen={props.defaultOpen}
          laneless={props.laneless}
          noMain={noMain}
        />
      )}
    </ReceiptFrame>
  );
}

/**
 * Whether the off-role line says anything the chip row does not (M14.45). Beside the chips,
 * `Main roles 6/6 · 4 new` already says `4 people have no main role yet.`, `Main roles 10/10`
 * already says `Everyone's on their main role.`, and `3 off main role` already says `3 people are
 * off their main role.`: only one person off-role, named with their lane, adds to it. In game the
 * receipt has no chips, and a laneless lobby has no roles chip, so the line stays there.
 */
function offRoleLineShown(
  offRole: readonly OffRoleSeat[],
  compact: boolean,
  laneless: boolean | undefined,
): boolean {
  return compact || laneless === true || offRole.length === 1;
}

/** The one card with a `--border-strong` edge (5.5), titled, labelled by its title. */
export function ReceiptFrame({
  titleId,
  title,
  headingLevel,
  gameNumber,
  className,
  landmark = true,
  children,
}: {
  titleId: string;
  title: string;
  headingLevel: HeadingLevel;
  gameNumber?: number | undefined;
  className?: string | undefined;
  /** `false`: a `role="group"` div, not a landmark (see `FairnessReceiptProps.landmark`). */
  landmark?: boolean | undefined;
  children: ReactNode;
}) {
  const Heading = headingLevel;
  const Frame = landmark ? 'section' : 'div';
  return (
    <Frame
      role={landmark ? undefined : 'group'}
      aria-labelledby={titleId}
      data-slot="fairness-receipt"
      className={cn(
        'overflow-hidden rounded-card border border-border-strong bg-card text-card-foreground',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3 px-(--card-pad) pt-3.5">
        <Heading id={titleId} className="text-[1.125rem] leading-[1.3] font-bold">
          {title}
        </Heading>
        {gameNumber === undefined ? null : (
          <span className="text-xs text-muted-foreground">
            {GAME_LABEL} <span className="num">{gameNumber}</span>
          </span>
        )}
      </div>
      {children}
    </Frame>
  );
}
