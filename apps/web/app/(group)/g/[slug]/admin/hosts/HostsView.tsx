import type { Route } from 'next';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { COLUMN_ACTIONS } from '@/lib/admin/homeCopy';
import { hostName } from '@/lib/admin/hostName';
import {
  COLUMN_ADDED,
  COLUMN_HOST,
  COLUMN_LAST_SEEN,
  COLUMN_PERSON,
  COLUMN_STATUS,
  HOST_ACTIVE,
  HOST_STOPPED,
  HOSTS_EMPTY,
  HOSTS_INTRO_LEAD,
  HOSTS_INTRO_LINK,
  HOSTS_INTRO_TAIL,
  HOSTS_LIST_TITLE,
  NEVER_SEEN,
  REVOKE,
  REVOKE_BODY,
  revokeTitle,
  stoppedHosts,
} from '@/lib/admin/sectionCopy';
import { timeAgoLabel } from '@/lib/admin/timeAgo';
import { ConfirmAction } from '../_components/ConfirmAction';
import { type StackedColumn, StackedTable } from '../_components/StackedTable';

export interface HostRow {
  id: string;
  /** `playerLabel` of the account it posts for. */
  person: string;
  /** `hostAccount` of that account: names a paired PC (`Hana’s PC`), `null` when it has no name. */
  account: string | null;
  label: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  stopped: boolean;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * `/g/<slug>/admin/hosts`'s body (M14.23; replaces `/admin/tokens`): the list with last seen, each live
 * one stoppable behind its confirm. M17.12 (Kustom 1.0): no hand-made keys any more; every host links
 * itself with a code from the admin home's host card, which the intro links to. Words only, no developer copy:
 * a revoked token is `Stopped`, a hash is never mentioned, nobody is asked for an id.
 *
 * M14.50: each PC is named after its person (`hostName`), and stopped hosts fold under a closed
 * `Stopped (N)` disclosure below the working ones, so the list is the PCs that can still record.
 */
export function HostsView({
  groupId,
  hostCardHref,
  hosts,
  readOnly,
  now,
}: {
  groupId: string;
  /** The admin home's `Set up your PC as host` card. */
  hostCardHref: Route;
  hosts: readonly HostRow[];
  readOnly: boolean;
  now: Date;
}) {
  const columns: StackedColumn<HostRow>[] = [
    { label: COLUMN_HOST, primary: true, cell: (row) => hostName(row) },
    { label: COLUMN_PERSON, cell: (row) => row.person },
    {
      label: COLUMN_ADDED,
      cell: (row) => <span className="whitespace-nowrap">{DATE.format(new Date(row.createdAt))}</span>,
    },
    {
      label: COLUMN_LAST_SEEN,
      cell: (row) => (row.lastSeenAt === null ? NEVER_SEEN : timeAgoLabel(row.lastSeenAt, now)),
    },
    { label: COLUMN_STATUS, cell: (row) => (row.stopped ? HOST_STOPPED : HOST_ACTIVE) },
  ];
  if (!readOnly) {
    columns.push({
      label: COLUMN_ACTIONS,
      bare: true,
      cell: (row) =>
        row.stopped ? null : (
          <ConfirmAction
            label={REVOKE}
            tone="destructive"
            title={revokeTitle(hostName(row))}
            body={REVOKE_BODY}
            actionLabel={REVOKE}
            url="/api/admin/tokens"
            payload={{ action: 'revoke', groupId, tokenId: row.id }}
          />
        ),
    });
  }

  const working = hosts.filter((host) => !host.stopped);
  const stopped = hosts.filter((host) => host.stopped);

  return (
    <>
      <p className="text-base">
        {HOSTS_INTRO_LEAD}{' '}
        <Link href={hostCardHref} className="font-bold underline underline-offset-3">
          {HOSTS_INTRO_LINK}
        </Link>{' '}
        {HOSTS_INTRO_TAIL}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>{HOSTS_LIST_TITLE}</CardTitle>
        </CardHeader>
        <div className="px-(--card-pad) pb-(--card-pad)">
          {working.length === 0 ? (
            <p className="rounded-control border border-dashed border-border px-3 py-3 text-sm">
              {HOSTS_EMPTY}
            </p>
          ) : (
            <StackedTable
              from="lg"
              label={HOSTS_LIST_TITLE}
              columns={columns}
              rows={working}
              rowKey={(row) => row.id}
            />
          )}
          {stopped.length === 0 ? null : (
            <details className="group mt-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-bold text-primary-text underline underline-offset-3 [&::-webkit-details-marker]:hidden">
                {stoppedHosts(stopped.length)}
              </summary>
              <div className="mt-2">
                <StackedTable
                  from="lg"
                  label={stoppedHosts(stopped.length)}
                  columns={columns.filter((column) => column.label !== COLUMN_ACTIONS)}
                  rows={stopped}
                  rowKey={(row) => row.id}
                />
              </div>
            </details>
          )}
        </div>
      </Card>
    </>
  );
}
