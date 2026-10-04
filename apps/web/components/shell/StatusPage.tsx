import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export interface StatusAction {
  label: string;
  href: Route;
}

/**
 * The body of a 404 or an error page (05-design.md 5.8): an h1 in the text face (not display), the
 * reason in one specific sentence, then at most two Buttons, full width below 768. `children` is for
 * the error page's `Try again` and its reference line. A 2.0 root of its own.
 */
export function StatusPage({
  title,
  reason,
  primary,
  secondary,
  children,
}: {
  title: string;
  reason: string;
  primary?: StatusAction | undefined;
  secondary?: StatusAction | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-10 *:max-w-3xl lg:py-16">
        <h1 className="text-xl font-bold">{title}</h1>
        {reason === '' ? null : <p className="text-base">{reason}</p>}
        <div className="flex flex-col gap-3 pt-2 md:flex-row md:flex-wrap">
          {children}
          {primary === undefined ? null : (
            <Button asChild variant={children === undefined ? 'default' : 'secondary'}>
              <Link prefetch="auto" href={primary.href}>
                {primary.label}
              </Link>
            </Button>
          )}
          {secondary === undefined ? null : (
            <Button asChild variant="secondary">
              <Link prefetch="auto" href={secondary.href}>
                {secondary.label}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
