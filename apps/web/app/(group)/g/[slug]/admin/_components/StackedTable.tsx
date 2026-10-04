// biome-ignore-all lint/a11y/useSemanticElements: one markup is a table from 768 and stacked cards below it (05-design 5.12); a `display: block` <table> loses its semantics in Safari, so the roles are explicit on divs.
// biome-ignore-all lint/a11y/useFocusableInteractive: table rows and cells are not interactive; their role is structure, read with table navigation.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StackedColumn<Row> {
  label: string;
  cell: (row: Row) => ReactNode;
  /** The row's heading: first, larger, and the card's title under 768. Exactly one column. */
  primary?: boolean;
  /** Numbers right-align in the desktop table. */
  numeric?: boolean;
  /** No label under 768 (an actions cell: the buttons say what they do). Never wraps on desktop. */
  bare?: boolean;
  /**
   * `anywhere` for mono tokens, links and ids that have no spaces to break at: they may break mid-word
   * at every width. Words never do from 768 (designer round 1: "Workin g"); under 768 a long name may.
   */
  wrap?: 'anywhere';
}

/**
 * Every class that changes at the table breakpoint, spelled out once per breakpoint so Tailwind sees
 * them as literals (a computed `md:` → `lg:` swap would never be generated).
 */
const AT = {
  md: {
    table: 'flex flex-col gap-3 md:table md:w-full md:gap-0',
    head: 'max-md:sr-only md:table-header-group',
    headRow: 'md:table-row',
    th: 'md:table-cell md:border-b md:border-border md:px-3 md:py-2 md:text-start md:text-xs md:font-bold md:text-muted-foreground',
    thNumeric: 'md:text-end',
    body: 'flex flex-col gap-3 md:table-row-group',
    row: 'flex flex-col gap-2 rounded-card border border-border bg-card p-(--card-pad) md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0',
    cell: 'md:table-cell md:border-b md:border-border md:px-3 md:py-2 md:align-middle',
    primary: 'text-md font-bold md:text-base',
    bare: 'pt-1 md:pt-2 md:[&_a]:whitespace-nowrap md:[&_button]:whitespace-nowrap',
    labelled: 'grid grid-cols-[7rem_1fr] gap-2 text-sm md:text-base',
    numeric: 'md:text-end',
    cardLabel: 'text-xs text-muted-foreground md:hidden',
    wrapNarrow: 'max-md:[overflow-wrap:anywhere]',
  },
  lg: {
    table: 'flex flex-col gap-3 lg:table lg:w-full lg:gap-0',
    head: 'max-lg:sr-only lg:table-header-group',
    headRow: 'lg:table-row',
    th: 'lg:table-cell lg:border-b lg:border-border lg:px-3 lg:py-2 lg:text-start lg:text-xs lg:font-bold lg:text-muted-foreground',
    thNumeric: 'lg:text-end',
    body: 'flex flex-col gap-3 lg:table-row-group',
    row: 'flex flex-col gap-2 rounded-card border border-border bg-card p-(--card-pad) lg:table-row lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0',
    cell: 'lg:table-cell lg:border-b lg:border-border lg:px-3 lg:py-2 lg:align-middle',
    primary: 'text-md font-bold lg:text-base',
    bare: 'pt-1 lg:pt-2 lg:[&_a]:whitespace-nowrap lg:[&_button]:whitespace-nowrap',
    labelled: 'grid grid-cols-[7rem_1fr] gap-2 text-sm lg:text-base',
    numeric: 'lg:text-end',
    cardLabel: 'text-xs text-muted-foreground lg:hidden',
    wrapNarrow: 'max-lg:[overflow-wrap:anywhere]',
  },
} as const;

/**
 * 05-design 5.12's admin table: a table from 768 (or from 1024 for a wide one, `from="lg"`), stacked
 * cards under it, from **one** set of column definitions so the two layouts cannot drift. Roles are
 * explicit (a `display: block` table loses them); in the card layout each cell shows its column's
 * label, hidden from assistive tech because the column header already names it. Words wrap but never
 * break mid-word in the table; nothing clips, and there is no horizontal scroll.
 */
export function StackedTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  from = 'md',
}: {
  /** The table's accessible name. */
  label: string;
  columns: readonly StackedColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Where the table layout starts: `md` (768) by default, `lg` (1024) for six or more columns. */
  from?: 'md' | 'lg';
}) {
  const at = AT[from];
  const wrap = (column: StackedColumn<Row>) =>
    column.wrap === 'anywhere' ? '[overflow-wrap:anywhere]' : at.wrapNarrow;
  return (
    <div role="table" aria-label={label} className={at.table}>
      <div role="rowgroup" className={at.head}>
        <div role="row" className={at.headRow}>
          {columns.map((column) => (
            <span
              key={column.label}
              role="columnheader"
              className={cn(at.th, column.numeric && at.thNumeric)}
            >
              {column.label}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className={at.body}>
        {rows.map((row) => (
          <div key={rowKey(row)} role="row" className={at.row}>
            {columns.map((column) =>
              column.primary ? (
                <span key={column.label} role="rowheader" className={cn(at.cell, at.primary, wrap(column))}>
                  {column.cell(row)}
                </span>
              ) : column.bare ? (
                <span key={column.label} role="cell" className={cn(at.cell, at.bare)}>
                  {column.cell(row)}
                </span>
              ) : (
                <span
                  key={column.label}
                  role="cell"
                  className={cn(at.cell, at.labelled, column.numeric && at.numeric)}
                >
                  <span aria-hidden="true" className={at.cardLabel}>
                    {column.label}
                  </span>
                  <span className={wrap(column)}>{column.cell(row)}</span>
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
