import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Reserved frame: shadcn's Skeleton, restyled per docs/05-design.md 5.0 and 5.9 (M14.1). A static
 * `--card` block with a 1px `--border`, holding the space a component will take so it lands
 * without shifting the page. **No pulse, no shimmer, no grey text bars**: a moving grey block is
 * the brightest motion in a dark room, and fake lines promise a shape that may not arrive.
 *
 * Use it only where the final height is known, and give that height (`className="h-(--row-min-h)"`,
 * or `rows` × a row height for a list). It is decorative (`aria-hidden`): whatever page uses it
 * announces its own loading once, never per frame. Tonight and the Board have no loading state at
 * all (05-design 5.9, amended by M14.39), so only the dev kit draws a frame today.
 */
function Frame({
  className,
  rows,
  rowClassName,
  ...props
}: React.ComponentProps<'div'> & {
  /** Draws this many hairline-divided rows inside the frame (a list, a team card's seats). */
  rows?: number;
  /** Height of each row, e.g. `h-(--seat-min-h)`. */
  rowClassName?: string;
}) {
  return (
    <div
      data-slot="frame"
      aria-hidden="true"
      className={cn(
        'rounded-card border border-border bg-card',
        rows === undefined ? null : 'flex flex-col',
        className,
      )}
      {...props}
    >
      {rows === undefined
        ? null
        : Array.from({ length: rows }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, identical rows that never reorder
            <div key={index} className={cn('border-t border-border first:border-t-0', rowClassName)} />
          ))}
    </div>
  );
}

export { Frame };
