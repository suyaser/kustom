import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button, shadcn radix-nova restyled to docs/05-design.md 5.0 (M14.1).
 *
 * - Every size is at least 44px (`--tap`). shadcn's `xs`/`sm`/`lg` and small icon sizes are
 *   gone: no control under 44 on a public page.
 * - Focus is the base 2px `--ring` outline (globals.css), not a box-shadow ring, so it survives
 *   forced colours.
 * - Labels wrap, never truncate (6.6).
 * - `pending` is the M3.20 pattern: the button stays focusable and announced, reads as quiet
 *   (`aria-disabled`, `data-pending`), and its `onClick` is not called. **Never `disabled` for
 *   in-flight work**: a disabled control drops focus to <body>. A pending *submit* button with no
 *   `onClick` still submits natively, so its form's submit handler short-circuits while pending,
 *   exactly as `RollControl` does.
 * - It stays a server component (no 'use client'): the click wrapper is attached only when the
 *   caller passes `onClick`, which only a client component can.
 * - `destructive` is admin only (3.5), drawn as an outline in `--destructive`: the label carries
 *   the verb and the caller adds the warning icon; colour is the third signal.
 * - One `default` (primary, amber) per view.
 */
const buttonVariants = cva(
  [
    'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-control border border-transparent',
    'px-4 py-2 text-center text-base leading-tight font-bold select-none',
    'transition-[background-color,border-color,color,scale] duration-(--dur-fast) ease-out',
    'active:scale-[.98] active:duration-(--dur-press)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-raised aria-disabled:text-muted-foreground aria-disabled:active:scale-100',
    'disabled:cursor-not-allowed disabled:border-border disabled:bg-raised disabled:text-muted-foreground',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border-border-strong bg-secondary text-secondary-foreground hover:border-muted-foreground',
        outline: 'border-border-strong bg-transparent text-foreground hover:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent',
        link: 'bg-transparent px-1 text-foreground underline underline-offset-3 hover:decoration-2',
        destructive: 'border-destructive bg-transparent text-destructive hover:bg-destructive/10',
      },
      size: {
        default: '',
        icon: 'size-11 px-0 py-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** In-flight: quiet, focusable, `onClick` ignored. See the file comment. */
    pending?: boolean;
  };

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  pending = false,
  onClick,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';

  // Only a client component can pass `onClick`, so only then is there a function to attach;
  // a server-rendered Button gets none (React cannot serialise one across the boundary).
  const handleClick =
    onClick === undefined
      ? undefined
      : (event: React.MouseEvent<HTMLButtonElement>): void => {
          if (pending) {
            // Also stops a submit button from submitting its form a second time.
            event.preventDefault();
            return;
          }
          onClick(event);
        };

  return (
    <Comp
      {...props}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-pending={pending ? '' : undefined}
      aria-disabled={pending || props['aria-disabled'] || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={handleClick}
    />
  );
}

export { Button, type ButtonProps, buttonVariants };
