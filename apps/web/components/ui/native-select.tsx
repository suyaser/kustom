import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The native <select>, styled (docs/05-design.md 5.0: keep native, ban Radix Select). The OS
 * picker is the best phone picker there is, it works with no JavaScript (the `/1v1` GET form),
 * and it adds no client bundle to a server page. 44px, 17px, `appearance: none` plus our chevron,
 * the base focus outline. `className` sizes the wrapper; the select fills it.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="native-select-wrapper" className={cn('relative w-full min-w-0', className)}>
      <select
        data-slot="native-select"
        className={cn(
          'min-h-11 w-full min-w-0 appearance-none rounded-control border border-input bg-background py-2 ps-3 pe-10 text-base text-foreground',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'aria-invalid:border-destructive',
          'disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted-foreground',
        )}
        {...props}
      />
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        data-slot="native-select-icon"
        className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function NativeSelectOption(props: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup(props: React.ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
