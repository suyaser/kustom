import type { Calibration } from '@customs/core';
import { FairnessReceipt } from '@/components/receipt';
import { RichText } from '@/components/receipt/parts';
import type { PageGroup } from '@/lib/groups/pageGroup';
import {
  EXAMPLE_RECEIPT_CAPTION,
  HOW_CALIBRATION_EXPLAIN,
  HOW_CALIBRATION_LEAD,
  HOW_CALIBRATION_TITLE,
  HOW_CAN_LINE,
  HOW_CANT_LINES,
  HOW_CANT_TITLE,
  HOW_INDEX,
  HOW_INDEX_LABEL,
  HOW_LEAD,
  HOW_RATING_LINES,
  HOW_RATING_TITLE,
  HOW_RECEIPT_LEAD,
  HOW_RECEIPT_PARTS,
  HOW_RECEIPT_TITLE,
  HOW_SPLIT_LINES,
  HOW_SPLIT_TITLE,
  HOW_TITLE,
  inGroupCalibrationParts,
} from '@/lib/landing/copy';
import { EXAMPLE_NAMES, EXAMPLE_SPLITS } from '@/lib/landing/example';
import { CALIBRATION_FOLLOW_UP, calibrationLineParts } from '@/lib/receipt/copy';
import { PageColumn, Section, TermList } from './parts';

/**
 * `/how`, "How the bot decides" (M14.24; STRATEGY §2.6): the rating in plain words, how a split
 * is picked, the receipt explained part by part on the worked example (with `How the bot decided`
 * open), whether the odds are honest (the demo group's calibration line once it has 20 games),
 * and what admins can't do. The footer's `How the bot decides` and every receipt's `More on how
 * it works` land here. Replaces M14.7b's footer disclosure.
 */
export function HowPage({ demo, calibration }: { demo: PageGroup | null; calibration: Calibration | null }) {
  return (
    <div className="flex-1">
      <PageColumn className="*:max-w-3xl">
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-bold text-balance">{HOW_TITLE}</h1>
          <p className="text-md text-pretty">{HOW_LEAD}</p>
          <nav aria-label={HOW_INDEX_LABEL}>
            <ul className="flex flex-wrap gap-x-5">
              {HOW_INDEX.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="inline-flex min-h-11 items-center font-bold text-foreground underline underline-offset-3"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <Section id="rating" title={HOW_RATING_TITLE}>
          <Paragraphs lines={HOW_RATING_LINES} />
        </Section>

        <Section id="splits" title={HOW_SPLIT_TITLE}>
          <Paragraphs lines={HOW_SPLIT_LINES} />
        </Section>

        <Section id="receipt" title={HOW_RECEIPT_TITLE}>
          <p className="text-pretty">{HOW_RECEIPT_LEAD}</p>
          <figure className="flex flex-col gap-2">
            <FairnessReceipt
              variant="balanced"
              splits={EXAMPLE_SPLITS}
              names={EXAMPLE_NAMES}
              headingLevel="h3"
              disclosureId="how-example"
              defaultOpen
            />
            <figcaption className="text-sm text-muted-foreground">{EXAMPLE_RECEIPT_CAPTION}</figcaption>
          </figure>
          <TermList items={HOW_RECEIPT_PARTS} />
        </Section>

        <Section id="calibration" title={HOW_CALIBRATION_TITLE}>
          <p className="text-pretty">{HOW_CALIBRATION_LEAD}</p>
          <p className="text-pretty text-muted-foreground">{HOW_CALIBRATION_EXPLAIN}</p>
          {calibration === null ||
          demo === null ||
          calibration.actualPct === null ||
          calibration.expectedPct === null ? null : (
            <p className="rounded-card border border-border bg-card p-(--card-pad) text-pretty">
              <RichText
                rich={inGroupCalibrationParts(
                  demo.name,
                  calibrationLineParts(
                    calibration.n,
                    calibration.favoredWon,
                    calibration.actualPct,
                    calibration.expectedPct,
                  ),
                )}
              />{' '}
              <span className="text-muted-foreground">{CALIBRATION_FOLLOW_UP}</span>
            </p>
          )}
        </Section>

        <Section id="admins" title={HOW_CANT_TITLE}>
          <ul className="flex flex-col gap-2">
            {HOW_CANT_LINES.map((line) => (
              <li key={line} className="border-s-[3px] border-border-strong ps-3 text-pretty">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-pretty text-muted-foreground">{HOW_CAN_LINE}</p>
        </Section>
      </PageColumn>
    </div>
  );
}

function Paragraphs({ lines }: { lines: readonly string[] }) {
  return (
    <div className="flex flex-col gap-3">
      {lines.map((line) => (
        <p key={line} className="text-pretty">
          {line}
        </p>
      ))}
    </div>
  );
}
