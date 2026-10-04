import type { CSSProperties } from 'react';
import { SideGlyph } from '@/components/ui/side-glyph';
import { barSentence, SIDE_LABEL } from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { barFlex, type Odds, PHONE_BAR_FLOOR } from './model';

/**
 * The win-split bar (docs/05-design.md 5.5): blue solid on the left, red hatched on the right,
 * a 3px gap at the split, both labels inside as glyph + word + %, and a 2px 50% tick crossing
 * the bar 6px above and below. The favored side's label is not bolder.
 *
 * The drawing is `aria-hidden`; the visually hidden sentence before it is what a screen reader
 * hears (`Blue 54 percent, Red 46 percent.`). Each segment carries `data-side-fill`, so forced
 * colours drop the hatch and draw a system border (globals.css 6.8).
 *
 * `size`: `full` (`--winbar-h`, 50 / 60), `compact` (`--winbar-h-compact`, 40 / 44, labels 17px).
 */
export function WinBar({ odds, size = 'full' }: { odds: Odds; size?: 'full' | 'compact' | undefined }) {
  const flex = barFlex(odds);
  const phone = barFlex(odds, PHONE_BAR_FLOOR);
  const compact = size === 'compact';
  const segment = cn(
    'flex min-w-0 items-center gap-2 text-on-team whitespace-nowrap',
    'font-display font-black tracking-[0.04em] font-stretch-70%',
    compact ? 'text-[1.0625rem]' : 'text-[1.1875rem] lg:text-[1.5rem]',
  );
  const pct = cn(
    'num font-bold tracking-[-0.02em] font-stretch-85%',
    compact ? 'text-[1.0625rem]' : 'text-[1.25rem] lg:text-[1.5rem]',
  );

  return (
    <>
      <p className="sr-only">{barSentence(odds.blueWinProb)}</p>
      <div
        aria-hidden="true"
        data-slot="win-bar"
        className={cn('relative flex gap-[3px]', compact ? 'h-(--winbar-h-compact)' : 'h-(--winbar-h)')}
      >
        <div
          data-side-fill="blue"
          className={cn(
            segment,
            'flex-(--seg-phone) rounded-l-control bg-team-blue pl-3 md:flex-(--seg-wide) lg:pl-4',
          )}
          style={{ '--seg-phone': phone.blue, '--seg-wide': flex.blue } as CSSProperties}
        >
          <SideGlyph side="blue" className="size-[13px]" />
          <span>{SIDE_LABEL.blue}</span>
          <span className={pct}>{odds.bluePct}%</span>
        </div>
        <div
          data-side-fill="red"
          className={cn(
            segment,
            'flex-(--seg-phone) justify-end rounded-r-control bg-team-red bg-(image:--hatch) pr-3 md:flex-(--seg-wide) lg:pr-4',
          )}
          style={{ '--seg-phone': phone.red, '--seg-wide': flex.red } as CSSProperties}
        >
          <span className={pct}>{odds.redPct}%</span>
          <span>{SIDE_LABEL.red}</span>
          <SideGlyph side="red" className="size-[13px]" />
        </div>
        <i className="absolute -top-1.5 -bottom-1.5 left-1/2 -ml-px w-0.5 rounded-[1px] bg-foreground forced-colors:bg-[CanvasText]" />
      </div>
    </>
  );
}

/** The 10px mini bar on the ≥768 split cards (05-design.md 5.5). Decoration: the odds are in words beside it. */
export function MiniBar({ odds, className }: { odds: Odds; className?: string | undefined }) {
  const flex = barFlex(odds);
  return (
    <div aria-hidden="true" className={cn('relative flex h-(--winbar-h-mini) gap-0.5', className)}>
      <span data-side-fill="blue" className="rounded-l-chip bg-team-blue" style={{ flex: flex.blue }} />
      <span
        data-side-fill="red"
        className="rounded-r-chip bg-team-red bg-(image:--hatch)"
        style={{ flex: flex.red }}
      />
      <i className="absolute -top-[3px] -bottom-[3px] left-1/2 -ml-px w-0.5 bg-foreground forced-colors:bg-[CanvasText]" />
    </div>
  );
}
