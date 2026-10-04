'use client';

import { inviteRotateResponseSchema } from '@customs/db/schemas';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from '@/app/join/_components/CopyButton';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  INVITE_LINE,
  INVITE_TITLE,
  NEW_LINK_CONFIRM_ACTION,
  NEW_LINK_CONFIRM_BODY,
  NEW_LINK_CONFIRM_TITLE,
  NEW_LINK_LABEL,
  NEW_LINK_PENDING,
  NO_INVITE_LINE,
} from '@/lib/admin/homeCopy';
import { COPY_LINK_LABEL } from '@/lib/groups/pageCopy';
import { ConfirmAction } from './ConfirmAction';

/** What the card shows: the link, none yet, or the operator's masked line (STRATEGY 3.3). */
export type InviteView =
  | { state: 'shown'; url: string }
  | { state: 'none' }
  | { state: 'hidden'; message: string };

/**
 * `Invite your group` (STRATEGY 3.2 step 3; M13.7, M13.14): the full `/join/<code>` link, wrapping in
 * mono, `Copy link` / `Copied` in place, and `New link` behind the confirm `The old link will stop
 * working.` → `Make a new link` (`POST /api/admin/invite/rotate`). The new link replaces the old one on
 * the card at once. `canRotate` is false for anyone the route would refuse (the operator; since M14.40
 * the creator before they pair may rotate), and the button is then absent rather than disabled.
 */
export function InviteCard({
  groupId,
  origin,
  invite,
  canRotate,
}: {
  groupId: string;
  /** This site's origin, to build the new link from the rotated code. */
  origin: string;
  invite: InviteView;
  canRotate: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(invite.state === 'shown' ? invite.url : null);

  return (
    <Card id="invite" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{INVITE_TITLE}</CardTitle>
        {invite.state === 'hidden' ? null : <CardDescription>{INVITE_LINE}</CardDescription>}
      </CardHeader>
      <div className="flex flex-col gap-3 px-(--card-pad) pb-(--card-pad)">
        {invite.state === 'hidden' ? (
          <p className="text-sm text-muted-foreground">{invite.message}</p>
        ) : url === null ? (
          <p className="text-sm text-muted-foreground">{NO_INVITE_LINE}</p>
        ) : (
          <p className="rounded-control border border-border bg-raised px-3 py-2 font-mono text-sm [overflow-wrap:anywhere] select-all">
            {url}
          </p>
        )}
        {invite.state === 'hidden' ? null : (
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
            {url === null ? null : <CopyButton value={url} label={COPY_LINK_LABEL} />}
            {canRotate ? (
              <ConfirmAction
                label={NEW_LINK_LABEL}
                tone="secondary"
                title={NEW_LINK_CONFIRM_TITLE}
                body={NEW_LINK_CONFIRM_BODY}
                actionLabel={NEW_LINK_CONFIRM_ACTION}
                pendingLabel={NEW_LINK_PENDING}
                url="/api/admin/invite/rotate"
                payload={{ groupId }}
                onDone={(body) => {
                  const parsed = inviteRotateResponseSchema.safeParse(body);
                  if (parsed.success)
                    setUrl(new URL(`/join/${encodeURIComponent(parsed.data.code)}`, origin).toString());
                  router.refresh();
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
