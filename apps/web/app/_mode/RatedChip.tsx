import { Chip } from '@/components/ui/chip';
import { NOT_RATED_CHIP, RATED_CHIP } from '@/lib/mode/copy';
import { cn } from '@/lib/utils';

/**
 * `Rated` (neutral chip) or `Not rated` (dashed, muted: dashed means "absent", 5.7)
 * (05-design.md 8.4.1). Since M15.5 the flag is the game's: the lock at Roll, else the next game's
 * Rated switch or its mode's default.
 */
export function RatedChip({ rated }: { rated: boolean }) {
  return (
    <Chip
      variant={rated ? 'neutral' : 'off-role'}
      className={cn('text-[0.875rem] font-bold', rated && 'text-foreground')}
    >
      {rated ? RATED_CHIP : NOT_RATED_CHIP}
    </Chip>
  );
}
