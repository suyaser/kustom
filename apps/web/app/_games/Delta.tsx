import { NOT_RATED } from '@/lib/games/copy';
import { formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { cn } from '@/lib/utils';

/**
 * A game's rating change (docs/05-design.md 5.3): always signed, never coloured, a gain at 600 in
 * the foreground and a loss at 400 muted, U+2212 for the minus. The visible number is hidden from
 * screen readers and a sentence (`gained 12`) stands in. `null` is `not rated`.
 */
export function Delta({ value, className }: { value: number | null; className?: string | undefined }) {
  if (value === null) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{NOT_RATED}</span>;
  }
  // A zero is `±0` at muted 400, not `+0` styled as a gain (M14.42, quality G1), as the board's
  // `RatingDelta` prints it. `−0` (a loss that rounded away) keeps its minus.
  const zero = value === 0 && !Object.is(value, -0);
  const gain = isGain(value) && !zero;
  const size = Math.abs(value);
  const spoken = size === 0 ? 'no change' : gain ? `gained ${size}` : `lost ${size}`;
  return (
    <span
      className={cn(
        'num',
        gain ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true">{zero ? '±0' : formatWebDelta(value)}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
