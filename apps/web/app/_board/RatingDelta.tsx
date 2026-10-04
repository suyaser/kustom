import { changeWords } from '@/lib/board/copy';
import { formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { cn } from '@/lib/utils';

/**
 * A rating change (05-design 5.3): always signed with a real minus, never coloured, no arrows (they
 * would read as side glyphs; design round 1 on M14.15). A gain is foreground 600, a loss (and `−0`)
 * muted 400, zero is `±0`. The visible text is `aria-hidden` and a visually hidden span says it in
 * words (`gained 33`).
 *
 * `delta` is `displayDelta(before, after)` from the caller: this file formats, it never computes.
 */
export function RatingDelta({ delta, className }: { delta: number; className?: string }) {
  const zero = delta === 0 && !Object.is(delta, -0);
  const gain = isGain(delta) && !zero;
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      <span
        aria-hidden="true"
        className={gain ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}
      >
        {zero ? '±0' : formatWebDelta(delta)}
      </span>
      <span className="sr-only">{changeWords(delta)}</span>
    </span>
  );
}
