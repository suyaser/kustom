'use client';

import type { Route } from 'next';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ERROR_TITLE, errorReference, TRY_AGAIN_LABEL } from '@/lib/shellCopy';
import { StatusPage } from './StatusPage';

/**
 * An error page's body (05-design.md 5.8): `Couldn't load this page.`, `Try again` (calls the
 * boundary's `reset()`), one way back, and the digest in small mono for reporting. No stack trace and
 * no apology filler. The error is logged once for the browser console; the server already has it.
 */
export function ErrorView({
  error,
  reset,
  back,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  back: { label: string; href: Route };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage title={ERROR_TITLE} reason="" primary={back}>
      <Button onClick={reset}>{TRY_AGAIN_LABEL}</Button>
      {error.digest === undefined ? null : (
        <p className="order-last font-mono text-2xs text-muted-foreground md:basis-full">
          {errorReference(error.digest)}
        </p>
      )}
    </StatusPage>
  );
}
