import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input, shadcn radix-nova restyled to docs/05-design.md 5.0 and 6.10 (M14.1): 44px tall,
 * 17px text at every width (iOS zooms under 16), the base focus outline, and `aria-invalid` drawn
 * as a `--destructive` border. The border is never the only signal: pair it with an error sentence
 * under the field, wired by `aria-describedby`. Always give it a visible `Label`; a placeholder is
 * a hint, never the label.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'min-h-11 w-full min-w-0 rounded-control border border-input bg-background px-3 py-2 text-base text-foreground',
        'transition-[border-color] duration-(--dur-fast) ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'aria-invalid:border-destructive',
        'disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted-foreground',
        'file:me-3 file:border-0 file:bg-transparent file:font-bold file:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
