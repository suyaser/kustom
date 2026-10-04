'use client';

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * AlertDialog, shadcn radix-nova restyled to docs/05-design.md 5.0 and 5.13 (M14.1). Admin only:
 * every destructive action (revoke, remove admin, fearless reset) confirms here.
 *
 * - Level 3: `--popover` (= `--card`), 1px `--border-strong`, `--shadow-overlay`, over `--scrim`.
 *   No backdrop blur.
 * - It portals to <body>; the base styles are global (globals.css), so nothing extra is needed there.
 * - Footer: on a phone the buttons stack full width with the action above Cancel (Cancel nearest
 *   the thumb); from 768 they sit inline, Cancel left, action right. Write the action first.
 * - Radix puts the initial focus on Cancel, traps focus, and returns it to the trigger. Escape
 *   cancels. Fade + scale .97 at `--dur-slow`; opacity only under reduced motion (globals.css).
 * - An async action uses a `Button` with `pending` instead of `AlertDialogAction`, so the dialog
 *   stays open until the result, and a failure is a `role="alert"` sentence inside it.
 */
function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-(--scrim) duration-(--dur-slow)',
        'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2*var(--gutter))] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4',
          'rounded-card border border-border-strong bg-popover p-(--card-pad) text-popover-foreground shadow-overlay',
          'duration-(--dur-slow) ease-out',
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-97 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-97',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className={cn('grid gap-2', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col gap-2 pt-2 md:flex-row-reverse md:justify-start', className)}
      {...props}
    />
  );
}

/** A real h2 (Radix renders one): verb + object + question, `Revoke Raafat's token?`. */
function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-bold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-base text-pretty text-muted-foreground', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  variant = 'destructive',
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button variant={variant} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn('w-full md:w-auto', className)}
        {...props}
      />
    </Button>
  );
}

function AlertDialogCancel({
  className,
  variant = 'secondary',
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button variant={variant} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn('w-full md:w-auto', className)}
        {...props}
      />
    </Button>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
