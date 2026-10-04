import type { OpsGroup } from '@customs/db/schemas';
import type { Route } from 'next';
import Link from 'next/link';
import { type StackedColumn, StackedTable } from '@/app/(group)/g/[slug]/admin/_components/StackedTable';
import {
  COLUMN_ADMINS,
  COLUMN_CREATED,
  COLUMN_DISCORD,
  COLUMN_GROUP,
  COLUMN_LAST_GAME,
  COLUMN_MEMBERS,
  COLUMN_OPS_ACTIONS,
  COLUMN_PREMIUM,
  DISCORD_STATE_CONNECTED,
  DISCORD_STATE_NOT_CONNECTED,
  NO_GAMES_YET,
  OPEN_ADMIN,
  OPS_EMPTY,
  OPS_LINE,
  OPS_TITLE,
  PREMIUM_CAP_REACHED,
  PREMIUM_OFF,
  PREMIUM_ON,
  premiumCap,
  premiumSince,
} from '@/lib/admin/sectionCopy';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * `/ops`'s body (M13.14, M14.23): every group, from M14.19's `listOpsGroups`, each linking to its admin
 * pages, which an operator reads with every write control absent. One h1, the shared stacked table, a
 * 2.0 root. Nothing here writes, and nothing here is a mode or fearless control. Premium (M16.2) is
 * read-only: the operator changes it with the `set-premium` script, never from here.
 */
export function OpsView({ groups }: { groups: readonly OpsGroup[] }) {
  const columns: StackedColumn<OpsGroup>[] = [
    {
      label: COLUMN_GROUP,
      primary: true,
      wrap: 'anywhere',
      cell: (group) => (
        <span className="flex flex-col gap-0.5">
          <span>{group.name}</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">/g/{group.slug}</span>
        </span>
      ),
    },
    {
      label: COLUMN_CREATED,
      cell: (group) => <span className="whitespace-nowrap">{DATE.format(new Date(group.createdAt))}</span>,
    },
    {
      label: COLUMN_MEMBERS,
      numeric: true,
      cell: (group) => <span className="num">{group.memberCount}</span>,
    },
    { label: COLUMN_ADMINS, numeric: true, cell: (group) => <span className="num">{group.adminCount}</span> },
    {
      label: COLUMN_LAST_GAME,
      cell: (group) =>
        group.lastGameAt === null ? (
          NO_GAMES_YET
        ) : (
          <span className="whitespace-nowrap">{DATE.format(new Date(group.lastGameAt))}</span>
        ),
    },
    {
      label: COLUMN_DISCORD,
      cell: (group) => (group.webhookSet ? DISCORD_STATE_CONNECTED : DISCORD_STATE_NOT_CONNECTED),
    },
    {
      label: COLUMN_PREMIUM,
      cell: ({ premium, aiCapReached }) => (
        <span className="flex flex-col gap-0.5">
          <span>
            {premium.premium ? PREMIUM_ON : PREMIUM_OFF}
            {premium.premium && premium.premiumChangedAt !== null
              ? ` ${premiumSince(DATE.format(new Date(premium.premiumChangedAt)))}`
              : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {premiumCap(premium.monthlyCapUsd.toFixed(2))}
          </span>
          {aiCapReached === true ? <span className="text-xs font-bold">{PREMIUM_CAP_REACHED}</span> : null}
        </span>
      ),
    },
    {
      label: COLUMN_OPS_ACTIONS,
      bare: true,
      cell: (group) => (
        <Link
          href={`/g/${encodeURIComponent(group.slug)}/admin` as Route}
          className="inline-flex min-h-11 items-center font-bold underline underline-offset-3"
          aria-label={`${OPEN_ADMIN}: ${group.name}`}
        >
          {OPEN_ADMIN}
        </Link>
      ),
    },
  ];

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-8 *:max-w-5xl lg:py-12">
        <h1 className="font-display text-xl font-black tracking-[0.02em] font-stretch-70%">{OPS_TITLE}</h1>
        <p className="text-base">{OPS_LINE}</p>
        {groups.length === 0 ? (
          <p className="rounded-control border border-dashed border-border-strong px-3 py-3 text-sm">
            {OPS_EMPTY}
          </p>
        ) : (
          <StackedTable
            from="lg"
            label={OPS_TITLE}
            columns={columns}
            rows={groups}
            rowKey={(group) => group.id}
          />
        )}
      </div>
    </div>
  );
}
