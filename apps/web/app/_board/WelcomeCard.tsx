'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { type ReactNode, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { WELCOME_PARAM } from '@/lib/board/hrefs';
import { BACK_TO_TONIGHT_LABEL } from '@/lib/shellCopy';

/**
 * The welcome card (M14.33): the first thing a viewer sees on the You tab after linking themselves,
 * with their whole history in one line. Not a toast: it stays until they leave the page.
 *
 * On its first client render it drops `?welcome=1` from the address bar (`history.replaceState`,
 * not a navigation, so the card stays on screen) so a reload or a copied link does not replay it.
 * The line and the chip are rendered by the server from the self lens's own numbers.
 */
export function WelcomeCard({ line, chip, home }: { line: string; chip?: ReactNode; home: Route }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(WELCOME_PARAM)) return;
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <Card className="border-border-strong">
      <div className="flex flex-col gap-2 p-(--card-pad)">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-md font-bold text-pretty">
          <span>{line}</span>
          {chip ?? null}
        </p>
        <Link
          href={home}
          className="inline-flex min-h-11 w-fit items-center font-bold text-primary-text underline underline-offset-3"
        >
          {BACK_TO_TONIGHT_LABEL}
        </Link>
      </div>
    </Card>
  );
}
