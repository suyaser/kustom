'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Switch, shadcn's restyled to docs/05-design.md (8.4.2's `Rated` switch; first used by M16.3b's
 * `AI lines` and `Write about me`). A `role="switch"` button named by its label. The track is
 * 44x26 with a `--border-strong` edge (the 3:1 control edge, 6.15); on, it fills `--foreground` (never amber, design round 1) and the
 * thumb moves, so state is shape and position as well as colour. An `::after` pads the hit area to
 * 44px tall. Put it in a 44px row whose label is a `<label htmlFor>`, so the whole row is the target.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-background p-0.5',
        // The hit area is 44 tall even where the row's label is not the target (6.6's 44px rule).
        "after:absolute after:-inset-y-[10px] after:-inset-x-0 after:content-['']",
        'transition-colors duration-(--dur-fast) ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'data-[state=checked]:border-foreground data-[state=checked]:bg-foreground',
        'aria-disabled:cursor-not-allowed disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-muted-foreground transition-transform duration-(--dur-fast) ease-out',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-card',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
