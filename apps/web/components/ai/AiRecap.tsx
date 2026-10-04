import type { ReactNode } from 'react';
import { AI_RECAP_LABEL, AI_RECAP_TAP } from '@/lib/ai/recapCopy';
import { HideLine } from './HideLine';
import { RecapWaiter } from './RecapWaiter';

/**
 * The game recap line (M16.4; brief m16.1 1.2, 1.3, 1.5): on Tonight's finished poster and on the
 * game page, under the result and above the receipt, **never inside it**.
 *
 * A caption, quieter than any number around it and with nothing of the receipt's look: a small
 * `AI recap` label (tap or hover for how it was written), then the line in body text. The line is
 * plain text: React escapes it, and the checker already refused links, markdown and emoji.
 *
 * - `recap === null` renders **nothing at all**, so the page is exactly a non-Premium group's.
 * - `waiting` (a live game whose line may still land) renders no markup either: only a client
 *   island that asks the page for a fresh render a few times, so the line appears when it lands.
 * - `canHide` draws the admin's `Hide` beside the label. The page decides it from the session
 *   (admins and the owner only); the route checks again.
 */
export type AiRecapView = { kind: 'line'; lineId: string; text: string } | { kind: 'waiting' };

export function AiRecap({
  recap,
  groupId,
  canHide = false,
  hideRedirect,
  tap = AI_RECAP_TAP,
  label = AI_RECAP_LABEL,
  footnote,
}: {
  recap: AiRecapView | null;
  groupId: string;
  canHide?: boolean;
  /** The label's tap text: the game line's by default; the weekly storyline passes its own (M16.5). */
  tap?: string;
  /** Where a no-JS `Hide` form post comes back to: this page. */
  hideRedirect?: string;
  /** The label: `AI recap` by default; the scouting report passes `AI scouting report` (M16.6). */
  label?: string;
  /** A quiet line under the text: the scouting report's `Written Sunday 4 Oct` (M16.6). */
  footnote?: string;
}): ReactNode {
  if (recap === null) return null;
  if (recap.kind === 'waiting') return <RecapWaiter />;

  const body = (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-start gap-x-3">
        <details className="group min-w-0">
          <summary
            title={tap}
            className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase underline decoration-dotted underline-offset-4 marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
          >
            {label}
          </summary>
          <p className="max-w-prose pb-1 text-xs text-muted-foreground">{tap}</p>
        </details>
      </div>
      <p className="max-w-prose text-sm leading-snug text-foreground/85 [overflow-wrap:anywhere]">
        {recap.text}
      </p>
      {footnote === undefined ? null : <p className="text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );

  if (!canHide) return body;
  return (
    <HideLine groupId={groupId} lineId={recap.lineId} redirectTo={hideRedirect}>
      {body}
    </HideLine>
  );
}
