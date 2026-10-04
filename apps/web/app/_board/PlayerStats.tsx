import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { SideGlyph } from '@/components/ui/side-glyph';
import { gamesLabel, ROLE_RECORD_HEADING, winLossLabel } from '@/lib/board/copy';
import { formatStreak, type Streak } from '@/lib/board/streak';
import {
  averageGameLine,
  BEST_TOGETHER,
  CURRENT_STREAK,
  capLine,
  LONGEST_LOSS,
  LONGEST_WIN,
  NO_PARTNERS,
  noRoleFootnote,
  PARTNERS_HEADING,
  percentLabel,
  SIDE_LABELS,
  SIDE_RECORD_HEADING,
  STREAKS_HEADING,
  WORST_TOGETHER,
} from '@/lib/stats/copy';
import type { PartnerRecord, PlayerStatsView, StatsRecord } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * The player page's records (M5.20), 2.0: by role, by side, partners, streaks. Every number is
 * `lib/stats`' own fold (`loadPlayerStats` over the page's window and group), so a record here and
 * the same record on Stats are one computation. Nothing is computed in this file.
 */
export function PlayerStats({
  stats,
  playerHref,
}: {
  stats: PlayerStatsView;
  playerHref: (puuid: string) => Route;
}) {
  if (stats.games === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {stats.awards.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {stats.awards.map((line) => (
            <li key={line} className="font-bold">
              {line}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard title={ROLE_RECORD_HEADING}>
          {stats.roles.length === 0 ? (
            <p className="px-(--card-pad) py-3 text-sm text-muted-foreground">
              {noRoleFootnote(stats.noRoleGames)}
            </p>
          ) : (
            <ul>
              {stats.roles.map((record) => (
                <RecordRow
                  key={record.role}
                  label={
                    <span className="num inline-flex items-center gap-2 text-sm tracking-[0.04em]">
                      <RoleIcon role={record.role} size={16} />
                      {record.role}
                    </span>
                  }
                  record={record}
                />
              ))}
            </ul>
          )}
          {stats.noRoleGames === 0 || stats.roles.length === 0 ? null : (
            <p className="border-t border-border px-(--card-pad) py-3 text-xs text-muted-foreground">
              {noRoleFootnote(stats.noRoleGames)}
            </p>
          )}
        </StatCard>

        <StatCard title={SIDE_RECORD_HEADING}>
          <ul>
            {stats.sides.map(({ side, record }) => (
              <RecordRow
                key={side}
                label={
                  <span className="inline-flex items-center gap-2 font-bold">
                    <SideGlyph side={side === 100 ? 'blue' : 'red'} />
                    {SIDE_LABELS[side]}
                  </span>
                }
                record={record}
              />
            ))}
          </ul>
        </StatCard>

        <StatCard title={PARTNERS_HEADING}>
          {stats.bestPartners.length === 0 ? (
            <p className="px-(--card-pad) py-3 text-sm text-muted-foreground">{NO_PARTNERS}</p>
          ) : (
            <>
              <PartnerList title={BEST_TOGETHER} partners={stats.bestPartners} playerHref={playerHref} />
              {stats.worstPartners.length === 0 ? null : (
                <PartnerList title={WORST_TOGETHER} partners={stats.worstPartners} playerHref={playerHref} />
              )}
            </>
          )}
        </StatCard>

        {stats.streaks === null ? null : (
          <StatCard title={STREAKS_HEADING}>
            <ul>
              <StreakRow label={CURRENT_STREAK} streak={stats.streaks.current} />
              <StreakRow label={LONGEST_WIN} streak={run('W', stats.streaks.longestWin)} />
              <StreakRow label={LONGEST_LOSS} streak={run('L', stats.streaks.longestLoss)} />
            </ul>
          </StatCard>
        )}
      </div>

      {stats.averageMinutes === null ? null : (
        <p className="text-sm text-muted-foreground">{averageGameLine(stats.averageMinutes)}</p>
      )}
      {stats.capped ? <p className="text-sm text-muted-foreground">{capLine(stats.cap)}</p> : null}
    </div>
  );
}

function StatCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

const ROW =
  'flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-(--card-pad) py-2';

function RecordRow({ label, record }: { label: ReactNode; record: StatsRecord }) {
  return (
    <li className={ROW}>
      {label}
      <Record record={record} />
    </li>
  );
}

function PartnerList({
  title,
  partners,
  playerHref,
}: {
  title: string;
  partners: PartnerRecord[];
  playerHref: (puuid: string) => Route;
}) {
  return (
    <div>
      <p className="border-t border-border px-(--card-pad) pt-3 pb-1 text-xs text-muted-foreground">
        {title}
      </p>
      <ul>
        {partners.map((partner) => (
          <li key={partner.puuid} className={ROW}>
            <Link
              href={playerHref(partner.puuid)}
              className="inline-flex min-h-11 items-center font-bold underline underline-offset-3 [overflow-wrap:anywhere]"
            >
              {renderWebName(partner.name)}
            </Link>
            <Record record={partner} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StreakRow({ label, streak }: { label: string; streak: Streak | null }) {
  if (streak === null) return null;
  return (
    <li className={ROW}>
      <span>{label}</span>
      <span className="num font-semibold">{formatStreak(streak)}</span>
    </li>
  );
}

function run(kind: 'W' | 'L', length: number): Streak | null {
  return length === 0 ? null : { kind, length };
}

function Record({ record }: { record: StatsRecord }) {
  return (
    <span className="num text-sm whitespace-nowrap">
      {winLossLabel(record.wins, record.losses)}
      {record.winRate === null ? null : ` · ${percentLabel(record.winRate)}`}
      <span className="sr-only"> over {gamesLabel(record.games)}</span>
    </span>
  );
}
