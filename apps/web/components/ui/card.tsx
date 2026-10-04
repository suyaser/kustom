import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card, shadcn radix-nova restyled to docs/05-design.md 5.0 and 2.8 (M14.1): level 1, `--card`
 * with a 1px `--border` (card vs page is only 1.19:1, so the border does the separating), radius
 * `card`, no shadow and no ring. Padding is `--card-pad` (16, 20 from 1024).
 *
 * `CardTitle` is a real heading. Pick the level that fits the page outline (`as="h3"` under an
 * h2); headings never skip levels (6.3).
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min items-start gap-1 px-(--card-pad) pt-(--card-pad) pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
        className,
      )}
      {...props}
    />
  );
}

type CardTitleProps = React.ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'h4' };

/** Text face 700 at `--fs-md` (19): 05-design.md 2.7 has no 18 step. */
function CardTitle({ className, as: Heading = 'h2', ...props }: CardTitleProps) {
  return <Heading data-slot="card-title" className={cn('text-md font-bold', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-(--card-pad) pb-(--card-pad) first:pt-(--card-pad)', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-3 border-t border-border p-(--card-pad)', className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
