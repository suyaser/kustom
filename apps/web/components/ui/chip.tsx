import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { type Side, SideGlyph } from './side-glyph';

/**
 * Chip: shadcn's Badge, restyled and renamed per docs/05-design.md 5.0 (M14.1).
 *
 * Static by default (a `span`, `--chip-h` tall). Pass `pressed` and it becomes a toggle: a
 * `button` with `aria-pressed`, grown to the 44px tap floor. Colour is never the only signal:
 *
 * - `neutral`: level 2 (`--raised`), for labels and values.
 * - `you`: the solid amber `YOU` mark. Amber on white is 1.46, so Day adds a `--primary-text`
 *   edge. It always says the word.
 * - `settling` / `off-role`: dashed `--border-strong`, the product's "not final" shape (5.6).
 *   Settling is mono, because it is a count (`settling 8/30`).
 * - `side`: glyph + word on the solid team fill, `--on-team` text, the red fill hatched (3.3).
 *   The word defaults to `BLUE` / `RED`.
 */
const chipVariants = cva(
  [
    'inline-flex w-fit max-w-full shrink-0 items-center gap-1.5 rounded-chip border border-transparent',
    'min-h-(--chip-h) px-2 py-0.5 text-xs leading-tight',
  ],
  {
    variants: {
      variant: {
        neutral: 'border-border bg-raised text-muted-foreground',
        you: 'bg-primary-fill font-bold tracking-[0.05em] text-on-primary-fill uppercase day:border-primary-text',
        settling:
          'border-dashed border-border-strong bg-transparent font-mono text-2xs font-medium text-muted-foreground font-stretch-85%',
        'off-role': 'border-dashed border-border-strong bg-transparent text-muted-foreground',
        side: 'font-display text-sm font-black tracking-[0.04em] text-on-team uppercase font-stretch-70%',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

const toggleClasses = [
  'min-h-11 cursor-pointer border-border-strong px-3 text-sm select-none',
  'transition-[background-color,border-color,color,scale] duration-(--dur-fast) ease-out active:scale-[.98]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  'aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:text-foreground',
];

const sideFill: Record<Side, string> = {
  blue: 'bg-team-blue',
  red: 'bg-team-red bg-(image:--hatch)',
};

type ChipVariant = NonNullable<VariantProps<typeof chipVariants>['variant']>;

type VariantProp = { variant: 'side'; side: Side } | { variant?: Exclude<ChipVariant, 'side'>; side?: never };

type StaticChipProps = VariantProp & React.ComponentProps<'span'> & { pressed?: undefined };

type ToggleChipProps = VariantProp &
  Omit<React.ComponentProps<'button'>, 'type' | 'aria-pressed'> & {
    /** Makes the chip a toggle button with this `aria-pressed` state. */
    pressed: boolean;
  };

type ChipProps = StaticChipProps | ToggleChipProps;

function Chip(props: ChipProps) {
  const variant = props.variant ?? 'neutral';
  const side = props.variant === 'side' ? props.side : undefined;
  const content =
    side === undefined ? (
      props.children
    ) : (
      <>
        <SideGlyph side={side} />
        {props.children ?? side.toUpperCase()}
      </>
    );
  const classes = cn(
    chipVariants({ variant }),
    side === undefined ? null : sideFill[side],
    props.pressed === undefined ? null : toggleClasses,
    props.className,
  );
  const shared = {
    'data-slot': 'chip',
    'data-variant': variant,
    'data-side-fill': side,
  } as const;

  if (props.pressed !== undefined) {
    const { variant: _v, side: _s, pressed, className: _c, children: _ch, ...rest } = props;
    return (
      <button type="button" aria-pressed={pressed} {...rest} {...shared} className={classes}>
        {content}
      </button>
    );
  }

  const { variant: _v, side: _s, pressed: _p, className: _c, children: _ch, ...rest } = props;
  return (
    <span {...rest} {...shared} className={classes}>
      {content}
    </span>
  );
}

export { Chip, type ChipProps, chipVariants };
