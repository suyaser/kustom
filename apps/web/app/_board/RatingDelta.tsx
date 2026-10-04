import { changeWords } from '@/lib/board/copy';
import { formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { cn } from '@/lib/utils';

/**
 * A rating change (05-design 5.3): always signed with a real minus, never coloured, no arrows (they
 * would read as side glyphs; design round 1 on M14.15). A gain is foreground 600, a loss (and `−0`)
 * muted 400, zero is `±0`. The visible text is `aria-hidden` and a visually hidden span says it in
 * words (`gained 33`), or in the caller's own words (`gained 19 this week`, `58 points this week`;
 * 05-design 11.4, 11.5).
 *
 * `delta` is `displayDelta(before, after)` from the caller: this file formats, it never computes.
 *
 * `width` reserves the column (05-design 11.3): `change` is 3ch (`+19`, `−38`), `points` 4ch
 * (`+136`), tabular and right-aligned, so a column of single-digit changes lines up on the units.
 */
export function RatingDelta({
  delta,
  className,
  spoken,
  width,
}: {
  delta: number;
  className?: string;
  spoken?: string;
  width?: 'change' | 'points';
}) {
  const zero = delta === 0 && !Object.is(delta, -0);
  const gain = isGain(delta) && !zero;
  return (
    <span
      className={cn(
        'num whitespace-nowrap tabular-nums',
        width !== undefined && 'inline-block text-end',
        width === 'change' && 'min-w-[3ch]',
        width === 'points' && 'min-w-[4ch]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={gain ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}
      >
        {zero ? '±0' : formatWebDelta(delta)}
      </span>
      <span className="sr-only">{spoken ?? changeWords(delta)}</span>
    </span>
  );
}
