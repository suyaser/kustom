import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CompactReceipt, FairnessReceipt, PreGameReceipt } from '@/components/receipt';
import {
  CALIBRATION_EARLY,
  CALIBRATION_READY,
  CLEAR,
  CLOSER_RUNNER_UP,
  FIXTURE_NAMES,
  LONG_NAMES,
  ONLY_ONE,
  RATINGS_KNOWN,
  RATINGS_MISSING,
  REROLLED,
  THREE_SPLITS,
} from '@/components/receipt/fixtures';

/**
 * Kit: every variant and edge of the fairness receipt (M14.9; STRATEGY §4; 05-design.md 5.5).
 * Development only. `?theme=day` renders the whole page in Day; each section has an id
 * (`#receipt-full`, …) so a screenshot can target it. The receipts sit in an 880px column, the
 * tonight page's main column at 1440 beside its 340px rail.
 */
export const metadata: Metadata = { title: 'Kit: receipt · Kustom', robots: { index: false, follow: false } };

export default async function ReceiptKitPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { theme } = await searchParams;
  const day = theme === 'day';

  return (
    <div className="min-h-svh bg-background text-foreground" data-theme={day ? 'day' : 'night'}>
      <main className="mx-auto flex max-w-[880px] flex-col gap-10 px-(--gutter) py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-xl font-black uppercase tracking-[0.02em] font-stretch-62%">
              Fairness receipt
            </h1>
            <p className="text-sm text-muted-foreground">
              Every variant and edge, {day ? 'Day' : 'Night'}. Fixture data. Development only.
            </p>
          </div>
          <nav className="flex gap-4 text-sm font-bold text-primary-text underline underline-offset-[3px]">
            <Link href="/kit" className="inline-flex min-h-11 items-center">
              Kit
            </Link>
            <Link
              href={day ? '/kit/receipt' : '/kit/receipt?theme=day'}
              className="inline-flex min-h-11 items-center"
            >
              {day ? 'Night' : 'Day'}
            </Link>
          </nav>
        </header>

        <Variant id="receipt-full" title="Full, balanced, disclosure open (calibration ready)">
          <FairnessReceipt
            variant="balanced"
            splits={THREE_SPLITS}
            names={FIXTURE_NAMES}
            gameNumber={4}
            calibration={CALIBRATION_READY}
            disclosureId="kit-how-full"
            defaultOpen
          />
        </Variant>

        <Variant id="receipt-closed" title="Full, balanced, closed (the default)">
          <FairnessReceipt
            variant="balanced"
            splits={THREE_SPLITS}
            names={FIXTURE_NAMES}
            gameNumber={4}
            offRole={[]}
            disclosureId="kit-how-closed"
          />
        </Variant>

        <Variant id="receipt-closer" title="Runner-up with closer odds, under 20 games of calibration">
          <FairnessReceipt
            variant="balanced"
            splits={CLOSER_RUNNER_UP}
            names={FIXTURE_NAMES}
            calibration={CALIBRATION_EARLY}
            disclosureId="kit-how-closer"
            defaultOpen
          />
        </Variant>

        <Variant id="receipt-reroll" title="After a reroll (pick #2)">
          <FairnessReceipt
            variant="balanced"
            splits={REROLLED}
            names={FIXTURE_NAMES}
            disclosureId="kit-how-reroll"
            defaultOpen
          />
        </Variant>

        <Variant id="receipt-clear" title="Clearly favored, rank 1">
          <FairnessReceipt
            variant="balanced"
            splits={CLEAR}
            names={FIXTURE_NAMES}
            disclosureId="kit-how-clear"
          />
        </Variant>

        <Variant id="receipt-only" title="Only one split fit (duo locks)">
          <FairnessReceipt
            variant="balanced"
            splits={ONLY_ONE}
            names={FIXTURE_NAMES}
            disclosureId="kit-how-only"
            defaultOpen
          />
        </Variant>

        <Variant id="receipt-long" title="16-character names in every seat">
          <FairnessReceipt
            variant="balanced"
            splits={CLOSER_RUNNER_UP.map((split) =>
              split.rank === 1 ? { ...split, offRoleCount: 2 } : { ...split, offRoleCount: 4 },
            )}
            names={LONG_NAMES}
            offRole={[
              { puuid: 'p-xeta', role: 'mid' },
              { puuid: 'p-knifiy', role: 'jungle' },
            ]}
            disclosureId="kit-how-long"
            defaultOpen
          />
        </Variant>

        <Variant id="receipt-ingame" title="In game: odds at kickoff">
          <FairnessReceipt variant="in-game" splits={THREE_SPLITS} names={FIXTURE_NAMES} gameNumber={4} />
        </Variant>

        <Variant id="receipt-finished" title="Finished (an upset)">
          <FairnessReceipt
            variant="finished"
            winner={100}
            splits={THREE_SPLITS}
            names={FIXTURE_NAMES}
            gameNumber={4}
            calibration={CALIBRATION_READY}
            disclosureId="kit-how-finished"
          />
        </Variant>

        <Variant id="receipt-pregame" title="No stored split: pre-game odds, teams changed, no odds">
          <div className="flex flex-col gap-4">
            <PreGameReceipt reason="no-split" ratingsBefore={RATINGS_KNOWN} winner={200} />
            <PreGameReceipt
              reason="teams-changed"
              ratingsBefore={RATINGS_KNOWN}
              winner={100}
              rolled={{ splits: THREE_SPLITS, names: FIXTURE_NAMES }}
              disclosureId="kit-how-changed"
            />
            <PreGameReceipt reason="no-split" ratingsBefore={RATINGS_MISSING} />
          </div>
        </Variant>

        <Variant id="receipt-compact" title="Compact: history rows and the tape">
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-card">
            {[
              <CompactReceipt key="a" winner={100} blueWinProb={0.54} />,
              <CompactReceipt key="b" winner={200} blueWinProb={0.53} />,
              <CompactReceipt key="c" winner={200} blueWinProb={0.5} />,
              <CompactReceipt key="d" winner={100} blueWinProb={0.51} rank={2} />,
              <CompactReceipt key="e" winner={200} blueWinProb={0.55} aram />,
              <CompactReceipt key="f" winner={200} ratingsBefore={RATINGS_KNOWN} />,
            ].map((row, i) => (
              <li key={row.key} className="flex flex-col gap-1 px-(--card-pad) py-3">
                <span className="font-bold">
                  Game <span className="num">{i + 1}</span>
                </span>
                {row}
              </li>
            ))}
          </ul>
        </Variant>
      </main>
    </div>
  );
}

function Variant({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-3" aria-label={`Kit: ${title}`}>
      <p className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">{title}</p>
      {children}
    </section>
  );
}
