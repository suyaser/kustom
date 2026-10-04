import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Multi-line text field, shadcn radix-nova restyled to docs/05-design.md 5.0 and 6.10 (M14.1): the
 * same tokens, focus outline and `aria-invalid` border as `Input`, 17px at every width (iOS zooms
 * under 16), at least 44px tall, resizable vertically only. Always with a visible `Label`, and an
 * error sentence under it wired by `aria-describedby` when invalid.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content min-h-11 w-full min-w-0 resize-y rounded-control border border-input bg-background px-3 py-2 text-base text-foreground',
        'transition-[border-color] duration-(--dur-fast) ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'aria-invalid:border-destructive',
        'disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
