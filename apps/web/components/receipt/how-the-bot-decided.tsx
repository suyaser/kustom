import type { Calibration } from '@customs/core';
import {
  BOT_NOTE_LABEL,
  bothSidesOdds,
  CALIBRATION_EXPECTED,
  CALIBRATION_FOLLOW_UP,
  CALIBRATION_MIN_GAMES,
  CALIBRATION_WON,
  calibrationLineParts,
  calibrationTooFewParts,
  changeFromChosenParts,
  DISAGREE_BODY,
  DISAGREE_TITLE,
  explanationShown,
  gapPoints,
  HOW_LINK,
  HOW_SUMMARY,
  howIntroParts,
  IN_PLAY,
  NOBODY_PICKED_BODY,
  NOBODY_PICKED_TITLE,
  RECEIPT_ANCHOR,
  REROLLED_PAST,
  rankedLowerParts,
  SPLIT_GAP_LABEL,
  splitRank,
  splitRolesTerm,
  THESE_TEAMS,
} from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { nameLookup, type ReceiptModel, type SplitRow } from './model';
import { RichText } from './parts';
import type { DisclosureExtras, ReceiptNames } from './types';
import { MiniBar } from './win-bar';

/**
 * `How the bot decided` (STRATEGY §4.6, 05-design.md 5.5): a native `<details>`, open to
 * everybody, closed by default. Content order: the 126-ways intro, the stored splits in rank
 * order, the two explainers, the bot's own sentence verbatim, the calibration line, the link.
 *
 * The splits are one `<ol>`. Under 768 it is a compact list (rows divided by hairlines, the one
 * in play marked by a 3px inline-start rule **and** the words `In play`, no mini bars); from 768
 * it is three cards in a row with a mini bar each. One DOM, restyled, so nothing is said twice.
 */
export function HowTheBotDecided({
  model,
  names,
  calibration,
  howHref = '/how',
  disclosureId = RECEIPT_ANCHOR,
  defaultOpen = false,
  laneless = false,
  noMain = 0,
}: {
  model: ReceiptModel;
  names: ReceiptNames;
  /** Live only (M14.41): the ten's players with no main role on record, for each split's roles term. */
  noMain?: number | undefined;
} & DisclosureExtras) {
  // M14.41 review: the stored sentence, with core's all-on-main clause following the chip.
  const explanation = explanationShown(model.chosen.explanation.trim(), noMain);
  const name = nameLookup(names);
  return (
    <details id={disclosureId} open={defaultOpen} className="group border-t border-border">
      <summary
        className={cn(
          'flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-2 px-(--card-pad)',
          'text-[1.0625rem] font-bold text-primary-text [&::-webkit-details-marker]:hidden',
        )}
      >
        {HOW_SUMMARY}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
          className="shrink-0 transition-transform duration-(--dur-base) group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>

      <div className="flex flex-col gap-3.5 px-(--card-pad) pt-1 pb-[18px] text-sm text-pretty">
        <p>
          <RichText rich={howIntroParts(model.total)} />
        </p>

        <ol className="grid md:grid-cols-3 md:gap-2.5">
          {model.rows.map((row) => (
            <SplitItem key={row.split.rank} row={row} name={name} laneless={laneless} noMain={noMain} />
          ))}
        </ol>

        <Note title={DISAGREE_TITLE} body={DISAGREE_BODY} />
        <Note title={NOBODY_PICKED_TITLE} body={NOBODY_PICKED_BODY} />

        {explanation.length > 0 ? (
          <p className="rounded-control border border-border bg-background px-3 py-2.5 font-mono text-[0.875rem] text-muted-foreground font-stretch-88%">
            {BOT_NOTE_LABEL} {explanation}
          </p>
        ) : null}

        {calibration ? <CalibrationBlock calibration={calibration} /> : null}

        <a
          href={howHref}
          className="inline-flex min-h-11 w-fit items-center font-bold text-primary-text underline underline-offset-[3px]"
        >
          {HOW_LINK}
        </a>
      </div>
    </details>
  );
}

function SplitItem({
  row,
  name,
  laneless = false,
  noMain = 0,
}: {
  row: SplitRow;
  name: (puuid: string) => string;
  laneless?: boolean;
  noMain?: number;
}) {
  const roles = splitRolesTerm(row.split.offRoleCount, noMain);
  const change = row.inPlay ? null : changeFromChosenParts(row.swap, name, laneless);
  return (
    <li
      className={cn(
        // Phone: a list row. The one in play gets the 3px inline-start rule.
        'flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0',
        row.inPlay && 'border-s-[3px] border-s-primary-text ps-3',
        // ≥768: a card.
        'md:rounded-control md:border md:border-border md:bg-background md:p-3 md:first:border-t',
        row.inPlay && 'md:border-2 md:border-primary-text md:p-[11px]',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[1.375rem] leading-none font-black font-stretch-70%">
            {splitRank(row.split.rank)}
          </span>
          {row.inPlay ? (
            <span className="rounded-chip border border-border-strong bg-raised px-2 py-px text-xs font-bold">
              {IN_PLAY}
            </span>
          ) : null}
        </span>
        <span className="font-bold">{bothSidesOdds(row.odds.blueWinProb)}</span>
      </div>

      <MiniBar odds={row.odds} className="my-2 hidden md:flex" />

      <dl className="flex flex-wrap gap-x-3 text-[0.875rem] text-muted-foreground md:grid md:grid-cols-2">
        <div className="md:flex md:flex-col">
          <dt className="inline md:block">{SPLIT_GAP_LABEL} </dt>
          <dd className="num inline font-semibold text-foreground font-stretch-88% md:block md:text-base">
            {gapPoints(row.split.gap)}
          </dd>
        </div>
        {laneless ? null : (
          <div className="md:flex md:flex-col">
            <dt className={roles.termHidden ? 'sr-only' : 'inline md:block'}>{roles.term} </dt>
            <dd className="num inline font-semibold text-foreground font-stretch-88% md:block md:text-base">
              {roles.value}
            </dd>
          </div>
        )}
      </dl>

      {row.inPlay || change !== null ? (
        <p className="mt-1 text-[0.9375rem] md:text-[0.875rem]">
          {change === null ? THESE_TEAMS : <RichText rich={change} />}
        </p>
      ) : null}

      {row.why ? (
        <p className="text-[0.9375rem] md:text-[0.875rem] text-muted-foreground md:mt-1.5 md:border-t md:border-dashed md:border-border md:pt-2">
          <RichText rich={rankedLowerParts(row.why, row.closer)} />
        </p>
      ) : row.rerolledPast ? (
        <p className="text-[0.9375rem] md:text-[0.875rem] text-muted-foreground md:mt-1.5 md:border-t md:border-dashed md:border-border md:pt-2">
          {REROLLED_PAST}
        </p>
      ) : null}
    </li>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <p className="border-s-[3px] border-border-strong py-0.5 ps-3">
      <b className="block">{title}</b>
      {body}
    </p>
  );
}

function CalibrationBlock({ calibration }: { calibration: Calibration }) {
  const { n, favoredWon, actualPct, expectedPct } = calibration;
  if (n < CALIBRATION_MIN_GAMES || actualPct === null || expectedPct === null) {
    return (
      <p className="rounded-control border border-border bg-background p-3 text-muted-foreground">
        <RichText rich={calibrationTooFewParts(n)} />
      </p>
    );
  }
  return (
    <div className="rounded-control border border-border bg-background p-3">
      <p className="font-bold">
        <RichText rich={calibrationLineParts(n, favoredWon, actualPct, expectedPct)} />
      </p>
      <div
        aria-hidden="true"
        className="my-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1.5 text-[0.875rem] text-muted-foreground"
      >
        <span>{CALIBRATION_WON}</span>
        <span className="relative h-2.5 overflow-hidden rounded-[3px] border border-border bg-raised">
          <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${actualPct}%` }} />
        </span>
        <span className="num">{actualPct}%</span>
        <span>{CALIBRATION_EXPECTED}</span>
        <span className="relative h-2.5 overflow-hidden rounded-[3px] border border-border bg-raised">
          <span
            className="absolute inset-y-0 left-0 bg-muted-foreground"
            style={{ width: `${expectedPct}%` }}
          />
        </span>
        <span className="num">{expectedPct}%</span>
      </div>
      <p className="text-[0.9375rem] text-muted-foreground">{CALIBRATION_FOLLOW_UP}</p>
    </div>
  );
}
