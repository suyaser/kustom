import type * as React from 'react';
import { cn } from '@/lib/utils';

export type Side = 'blue' | 'red';

/**
 * The side glyphs (docs/05-design.md 3.3, carrier 2): ◣ for blue and ◥ for red, from where each
 * base sits on the map (blue bottom-left, red top-right). Inline SVG in `currentColor`, not a
 * font glyph and not an emoji, so it survives forced colours. Always beside the side word, so it
 * is hidden from screen readers. 12px inline by default; pass `size-4` in a card header.
 */
function SideGlyph({ side, className, ...props }: React.ComponentProps<'svg'> & { side: Side }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      data-slot="side-glyph"
      className={cn('size-3 shrink-0', className)}
      {...props}
    >
      <path d={side === 'blue' ? 'M0 0V12H12Z' : 'M0 0H12V12Z'} fill="currentColor" />
    </svg>
  );
}

export { SideGlyph };
