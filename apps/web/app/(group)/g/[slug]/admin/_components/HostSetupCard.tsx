'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { PairingCode } from '@/app/join/_components/PairingCode';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  HOST_ANOTHER_PC_LABEL,
  HOST_CARD_TITLE,
  HOST_STEP_CODE,
  HOST_STEP_DOWNLOAD,
  HOST_STEP_DOWNLOAD_LINK,
  HOST_STEP_OPEN,
} from '@/lib/admin/homeCopy';
import { RELEASES_URL } from '@/lib/nav';

/**
 * `Set up your PC as host` (STRATEGY 3.2 step 4, M14.12): download, open Kustom, type
 * the six-character code. The code is `POST /api/me/pairing { groupId }`, allowed for the group's
 * creator and its owner and admins; Kustom's pairing links the account if it is not yet
 * and mints this admin's host token, so no token is ever copied by hand. Asked for on a tap, so a
 * page view mints nothing. When Kustom uses it the page refreshes, and the checklist's row 4 moves.
 */
export function HostSetupCard({
  groupId,
  quiet = false,
  preview,
  linkedHref = null,
}: {
  groupId: string;
  /**
   * Where to go once Kustom uses the code, when the pairing also links this viewer's account (an
   * unlinked creator): the You tab's welcome card (M14.33). `null` refreshes in place.
   */
  linkedHref?: Route | null;
  /** A host is already seen: `Get a code` drops to secondary, it is no longer the page's next step. */
  quiet?: boolean;
  /** Dev kit only. */
  preview?: { kind: 'waiting'; code: string } | { kind: 'expired' } | undefined;
}) {
  const router = useRouter();
  const steps = (
    <ol className="flex flex-col gap-4 px-(--card-pad) pb-(--card-pad)">
      <Step n={1}>
        <p>{HOST_STEP_DOWNLOAD}</p>
        <a
          href={RELEASES_URL}
          className="inline-flex min-h-11 w-fit items-center font-bold text-foreground underline underline-offset-3"
        >
          {HOST_STEP_DOWNLOAD_LINK}
        </a>
      </Step>
      <Step n={2}>
        <p>{HOST_STEP_OPEN}</p>
      </Step>
      <Step n={3}>
        <p>{HOST_STEP_CODE}</p>
        <PairingCode
          request={{ groupId }}
          autoStart={false}
          startVariant={quiet ? 'secondary' : 'default'}
          preview={preview}
          onUsed={() => (linkedHref === null ? router.refresh() : router.push(linkedHref))}
        />
      </Step>
    </ol>
  );

  // M14.55: once a host is seen this is no longer the page's next step, so it folds into a native
  // disclosure (`Set up another PC`) that works without JavaScript.
  if (quiet) {
    return (
      <details
        id="host"
        className="group scroll-mt-20 overflow-hidden rounded-card border border-border-strong bg-card text-card-foreground"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-(--card-pad) py-3 hover:bg-accent focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
          <h2 className="text-md font-bold">{HOST_ANOTHER_PC_LABEL}</h2>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) group-open:rotate-180"
          >
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        {steps}
      </details>
    );
  }

  return (
    <Card id="host" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{HOST_CARD_TITLE}</CardTitle>
      </CardHeader>
      {steps}
    </Card>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="num flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-sm"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">{children}</div>
    </li>
  );
}
