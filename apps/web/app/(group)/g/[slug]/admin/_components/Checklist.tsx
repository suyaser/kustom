import type { Route } from 'next';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import type { Checklist as ChecklistData, ChecklistRow, ChecklistState } from '@/lib/admin/checklist';
import {
  CHECKLIST_READY,
  CHECKLIST_TITLE,
  CONNECT_DISCORD_LABEL,
  GET_INVITE_LABEL,
  SET_UP_HOST_LABEL,
  STATE_DONE,
  STATE_TO_DO,
  STATE_WAITING,
} from '@/lib/admin/homeCopy';
import { cn } from '@/lib/utils';

/**
 * `Get your group ready` (STRATEGY 3.1): a status board, not a wizard. Each row says its state in a
 * word **and** an icon (colour is never the only signal), then its fact or its one-line why. Ready
 * (Kustom seen and a first game) collapses the card to `Your group is ready for game night.`
 */
export function Checklist({
  checklist,
  discordHref,
  hostHref,
  inviteHref = null,
  discordHint = null,
}: {
  checklist: ChecklistData;
  /** Where `Connect Discord` goes, or `null` while this group has no Discord page yet (M14.23). */
  discordHref: Route | null;
  /** The host card on this page (`#host`), or `null` when it is not drawn. */
  hostHref: string | null;
  /** The invite card on this page (`#invite`), or `null`. */
  inviteHref?: string | null;
  /** A line in place of `Connect Discord` when it cannot be offered yet (the unlinked creator). */
  discordHint?: string | null;
}) {
  if (checklist.ready) {
    return (
      <Card>
        <h2 className="flex min-h-11 items-center gap-3 p-(--card-pad) text-md font-bold">
          <StateIcon state="done" />
          {CHECKLIST_READY}
        </h2>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{CHECKLIST_TITLE}</CardTitle>
      </CardHeader>
      <ol className="flex flex-col">
        {checklist.rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            action={actionFor(row, discordHref, hostHref, inviteHref)}
            hint={row.key === 'discord' && row.state !== 'done' ? discordHint : null}
          />
        ))}
      </ol>
    </Card>
  );
}

function actionFor(
  row: ChecklistRow,
  discordHref: Route | null,
  hostHref: string | null,
  inviteHref: string | null,
): { label: string; href: string } | null {
  if (row.state === 'done') return null;
  if (row.key === 'discord' && discordHref !== null)
    return { label: CONNECT_DISCORD_LABEL, href: discordHref };
  if (row.key === 'kustom' && hostHref !== null) return { label: SET_UP_HOST_LABEL, href: hostHref };
  if (row.key === 'invite' && inviteHref !== null) return { label: GET_INVITE_LABEL, href: inviteHref };
  return null;
}

function Row({
  row,
  action,
  hint = null,
}: {
  row: ChecklistRow;
  action: { label: string; href: string } | null;
  hint?: string | null;
}) {
  return (
    <li className="flex gap-3 border-t border-border px-(--card-pad) py-3">
      <span className="pt-0.5">
        <StateIcon state={row.state} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-base font-bold">{row.title}</h3>
        <p
          className={cn(
            'text-sm [overflow-wrap:anywhere]',
            row.state === 'done' ? '' : 'text-muted-foreground',
          )}
        >
          <span className="font-bold text-foreground">{stateWord(row.state)}</span>
          {row.detail === null ? null : ` · ${row.detail}`}
        </p>
        {row.why === null ? null : <p className="text-sm text-muted-foreground">{row.why}</p>}
        {hint === null ? null : <p className="text-sm font-bold">{hint}</p>}
        {action === null ? null : (
          <Link
            href={action.href as Route}
            className="inline-flex min-h-11 w-fit items-center font-bold text-foreground underline underline-offset-3"
          >
            {action.label}
          </Link>
        )}
      </div>
    </li>
  );
}

function stateWord(state: ChecklistState): string {
  if (state === 'done') return STATE_DONE;
  if (state === 'waiting') return STATE_WAITING;
  return STATE_TO_DO;
}

/** Done: a filled check. To do: a dashed ring (the product's "not yet" shape). Waiting: a ring with a dot. */
function StateIcon({ state }: { state: ChecklistState }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-6 shrink-0">
      {state === 'done' ? (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path
            d="m7.5 12.5 3 3 6-6.5"
            fill="none"
            stroke="var(--card)"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={state === 'to-do' ? '3 3' : undefined}
          className="text-muted-foreground"
        />
      )}
      {state === 'waiting' ? (
        <circle cx="12" cy="12" r="3" fill="currentColor" className="text-muted-foreground" />
      ) : null}
    </svg>
  );
}
