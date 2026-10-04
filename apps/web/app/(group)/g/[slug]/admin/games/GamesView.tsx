import type { Route } from 'next';
import { EntityLink } from '@/components/links/EntityLink';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CAPTURED_CAP,
  type CapturedGameRow,
  GAMES_COPY,
  type MissedLobbyRow,
  type MissedReport,
} from '@/lib/admin/games';
import {
  COLUMN_LENGTH,
  COLUMN_NIGHT,
  COLUMN_PICKED_UP,
  COLUMN_PLAYERS,
  COLUMN_RATED,
  COLUMN_REPORTED_BY,
  COLUMN_STARTED,
  COLUMN_WHAT,
  capturedCount,
  MISSED_NO_GAME,
  MISSED_STUCK,
  NOBODY,
  ratedLabel,
  SOURCE_LATER,
  SOURCE_LIVE,
  showingNewest,
} from '@/lib/admin/sectionCopy';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHref } from '@/lib/nav';
import { type StackedColumn, StackedTable } from '../_components/StackedTable';

/**
 * `/g/<slug>/admin/games`'s body (M14.23; M5.5's report, scoped and restyled): Missed and Captured on
 * the shared stacked table. Read-only by rule: no form, no post, nothing that clears the evidence.
 * M14.53: titled `Recording` (the main tab is `Games`), and the Rated column says why a game is not
 * rated (`ratedLabel`), never `Not yet`. The URL stays `/admin/games`.
 */
export function GamesView({
  group,
  missed,
  captured,
}: {
  group: PageGroup;
  missed: MissedReport;
  captured: readonly CapturedGameRow[];
}) {
  const anyStuck = missed.rows.some((row) => row.state === 'game landed, lobby never closed');
  return (
    <>
      <p className="text-base">{GAMES_COPY.intro}</p>
      <Card>
        <CardHeader>
          <CardTitle>{GAMES_COPY.missed}</CardTitle>
          <CardDescription>{GAMES_COPY.missedIntro}</CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3 px-(--card-pad) pb-(--card-pad)">
          {missed.rows.length === 0 ? (
            <Empty>{GAMES_COPY.missedEmpty}</Empty>
          ) : (
            <StackedTable
              label={GAMES_COPY.missed}
              columns={missedColumns(group)}
              rows={missed.rows}
              rowKey={(row) => row.id}
            />
          )}
          {missed.total > missed.rows.length ? (
            <p className="text-sm text-muted-foreground">{showingNewest(missed.rows.length, missed.total)}</p>
          ) : null}
          {anyStuck ? <p className="text-sm text-muted-foreground">{GAMES_COPY.lobbyNeverClosed}</p> : null}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{GAMES_COPY.captured}</CardTitle>
          <CardDescription>{GAMES_COPY.capturedIntro}</CardDescription>
        </CardHeader>
        <div className="px-(--card-pad) pb-(--card-pad)">
          {captured.length === 0 ? (
            <Empty>{GAMES_COPY.capturedEmpty}</Empty>
          ) : (
            <>
              <StackedTable
                label={GAMES_COPY.captured}
                columns={capturedColumns(group)}
                rows={captured}
                rowKey={(row) => row.id}
              />
              <p className="pt-3 text-sm text-muted-foreground">
                {capturedCount(captured.length, CAPTURED_CAP)}
              </p>
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-control border border-dashed border-border px-3 py-3 text-sm">{children}</p>;
}

function PlayerLink({ group, puuid, name }: { group: PageGroup; puuid: string; name: string }) {
  const href = groupHref(group, { page: 'player', puuid });
  if (href === null) return <>{name}</>;
  return (
    <EntityLink href={href as Route} className="underline underline-offset-3">
      {name}
    </EntityLink>
  );
}

function missedColumns(group: PageGroup): StackedColumn<MissedLobbyRow>[] {
  return [
    { label: COLUMN_NIGHT, primary: true, cell: (row) => `${row.night}, ${row.wentInGameAt}` },
    {
      label: COLUMN_REPORTED_BY,
      cell: (row) =>
        row.reportedByPuuid === null ? (
          row.reportedBy
        ) : (
          <PlayerLink group={group} puuid={row.reportedByPuuid} name={row.reportedBy} />
        ),
    },
    {
      label: COLUMN_PLAYERS,
      cell: (row) =>
        row.members.length === 0
          ? NOBODY
          : row.members.map((member, index) => (
              <span key={member.puuid}>
                {index === 0 ? '' : ', '}
                <PlayerLink group={group} puuid={member.puuid} name={member.name} />
              </span>
            )),
    },
    {
      label: COLUMN_WHAT,
      cell: (row) => (row.state === 'game landed, lobby never closed' ? MISSED_STUCK : MISSED_NO_GAME),
    },
  ];
}

function capturedColumns(group: PageGroup): StackedColumn<CapturedGameRow>[] {
  return [
    {
      label: COLUMN_STARTED,
      primary: true,
      cell: (row) => {
        const href = groupHref(group, { page: 'game', gameId: row.id });
        const text = `${row.night}, ${row.startedAt}`;
        return href === null ? (
          text
        ) : (
          <EntityLink href={href as Route} className="underline underline-offset-3">
            {text}
          </EntityLink>
        );
      },
    },
    { label: COLUMN_LENGTH, numeric: true, cell: (row) => <span className="num">{row.duration}</span> },
    { label: COLUMN_PICKED_UP, cell: (row) => (row.source === 'eog' ? SOURCE_LIVE : SOURCE_LATER) },
    { label: COLUMN_PLAYERS, numeric: true, cell: (row) => <span className="num">{row.participants}</span> },
    { label: COLUMN_RATED, cell: (row) => ratedLabel(row.ratedReason) },
  ];
}
