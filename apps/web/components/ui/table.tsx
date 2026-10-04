import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table, shadcn radix-nova restyled for admin at 768 and up (docs/05-design.md 5.0, 5.12; M14.1).
 * Hairline rows, `th scope="col"` by default, and cells that wrap: no `whitespace-nowrap` and no
 * horizontal-scroll container, because a clipped token or a sideways scroll is the bug 5.12
 * exists to fix. Below 768 admin renders the same columns as stacked cards instead (5.12, a
 * later task). Put `num` on a numeric cell for tabular mono.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="w-full">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead data-slot="table-header" className={cn('[&_tr]:border-b-border-strong', className)} {...props} />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-border font-bold [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border transition-colors duration-(--dur-fast) hover:bg-accent',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn('h-11 px-3 text-start align-bottom text-xs font-bold text-muted-foreground', className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-3 align-top [overflow-wrap:anywhere]', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-3 text-start text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
