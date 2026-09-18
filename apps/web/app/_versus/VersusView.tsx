import Link from 'next/link';
import type { ReactNode } from 'react';
import { WINDOW_LABELS, windowSlotLine, winLossLabel } from '@/lib/board/copy';
import { capLine, noRoleFootnote, percentLabel, playersLine } from '@/lib/stats/copy';
import { matchDetail } from '@/lib/stats/funCopy';
import type { PlayerRef } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import {
  COLLIDE_HEADING,
  champIntoLine,
  formMark,
  HEATS_EMPTY,
  HEATS_HEADING,
  HEATS_INTRO,
  LANES_EMPTY,
  LANES_HEADING,
  LANES_INTRO,
  LAST_MEETING,
  LOCKS_HEADING,
  lastMeetingLine,
  NO_ALLIES,
  NO_ENEMIES,
  NO_FORM,
  NO_LAST,
  NO_LOCK,
  NO_SAME_LANE,
  NO_STREAK,
  noLaneEntries,
  PICK_HEADING,
  PICK_IDLE,
  PICK_INTRO,
  PICK_ONE,
  PICK_SAME,
  SAME_LANE_HEADING,
  SERIES_FORM,
  SERIES_STREAK,
  streakLine,
  TOGETHER_HEADING,
  TYRANTS_EMPTY,
  TYRANTS_HEADING,
  TYRANTS_INTRO,
  VERSUS_INTRO,
  VERSUS_LABEL,
  VERSUS_WORD,
  versusKdaLine,
  versusRoast,
  versusScore,
} from '@/lib/versus/copy';
import type {
  HeadToHead,
  LaneBoard,
  LaneMatchup,
  VersusView as VersusModel,
  VersusPick,
} from '@/lib/versus/types';
import { versusQuery } from '@/lib/versus/view';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { RoleIcon } from '../_icons/RoleIcon';
import { PlayerPick } from './PlayerPick';
import '../board-parts.css';

/**
 * `/1v1` (M5.34): lane series for the window, then any two people the reader names.
 *
 * A pure function of one snapshot. The numbers live in `lib/versus`; this file decides
 * nothing except order: the pick, the series those two made, lane bullies, dead heats,
 * then the five lanes.
 */

export function VersusView({ view }: { view: VersusModel }) {
  const empty = view.range === null;
  const query = versusQuery(view.leftPuuid, view.rightPuuid);

  return (
    <main className="cn-page cn-versus">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[view.window]} <span className="cn-strip-sub">{VERSUS_LABEL}</span>
        </h1>
        <p className="cn-stats-intro">{VERSUS_INTRO}</p>
        <WindowPicker
          path="/1v1"
          selected={view.window}
          {...(Object.keys(query).length === 0 ? {} : { query })}
        />
        <WindowSlot
          window={view.window}
          line={empty ? null : windowSlotLine(view.range as string, view.games)}
        />
        {view.capped ? <p className="cn-hint">{capLine(view.cap)}</p> : null}
      </header>

      {empty ? null : (
        <>
          <section className="cn-block">
            <section className="cn-card cn-stats-lines">
              <p className="cn-stats-line">{playersLine(view.players)}</p>
            </section>
          </section>
          <PickCard view={view} />
          <Spice heading={TYRANTS_HEADING} intro={TYRANTS_INTRO} empty={TYRANTS_EMPTY} rows={view.tyrants} />
          <Spice heading={HEATS_HEADING} intro={HEATS_INTRO} empty={HEATS_EMPTY} rows={view.heats} />
          <Lanes boards={view.lanes} noRoleGames={view.noRoleGames} />
        </>
      )}
    </main>
  );
}

function PickCard({ view }: { view: VersusModel }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <VersusHead title={PICK_HEADING} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{PICK_INTRO}</p>
          <PlayerPick
            key={`${view.window}:${view.leftPuuid ?? ''}:${view.rightPuuid ?? ''}`}
            window={view.window}
            roster={view.roster}
            {...(view.leftPuuid === undefined ? {} : { left: view.leftPuuid })}
            {...(view.rightPuuid === undefined ? {} : { right: view.rightPuuid })}
          />
          <PickBody pick={view.pick} />
        </div>
      </section>
    </section>
  );
}

function PickBody({ pick }: { pick: VersusPick }) {
  if (pick.kind === 'idle') return <p className="cn-stats-empty">{PICK_IDLE}</p>;
  if (pick.kind === 'one') return <p className="cn-stats-empty">{PICK_ONE}</p>;
  if (pick.kind === 'same') return <p className="cn-stats-empty">{PICK_SAME}</p>;
  return <Series series={pick.series} />;
}

function Series({ series }: { series: HeadToHead }) {
  const total = series.enemies;
  const aShare = total === 0 ? 50 : (series.aWins / total) * 100;
  const aLeads = series.aWins > series.bWins;
  const bLeads = series.bWins > series.aWins;

  return (
    <div className="cn-versus-series">
      <p className="cn-versus-verdict">{series.verdict}</p>
      <div className="cn-versus-duel">
        <Fighter player={series.a} wins={series.aWins} lead={aLeads} />
        <p className="cn-versus-score cn-display">{versusScore(series.aWins, series.bWins)}</p>
        <Fighter player={series.b} wins={series.bWins} lead={bLeads} align="end" />
      </div>
      {total === 0 ? null : (
        <div
          className="cn-versus-bar"
          role="img"
          aria-label={`${renderWebName(series.a.name)} ${series.aWins}, ${renderWebName(series.b.name)} ${series.bWins}`}
        >
          <span
            className={aLeads ? 'cn-versus-bar-lead' : 'cn-versus-bar-trail'}
            style={{ width: `${aShare}%` }}
          />
          <span
            className={bLeads ? 'cn-versus-bar-lead' : 'cn-versus-bar-trail'}
            style={{ width: `${100 - aShare}%` }}
          />
        </div>
      )}

      <StatBlock title={COLLIDE_HEADING}>
        {series.enemies === 0 ? (
          <p className="cn-stats-empty">{NO_ENEMIES}</p>
        ) : (
          <ul className="cn-records">
            <StatRow
              label={LAST_MEETING}
              value={
                series.lastMeeting === null
                  ? NO_LAST
                  : lastMeetingLine(
                      matchDetail(series.lastMeeting.startedAt, series.lastMeeting.durationS),
                      series.lastMeeting.winner.name,
                    )
              }
            />
            <StatRow
              label={SERIES_STREAK}
              value={
                series.streak === null
                  ? NO_STREAK
                  : streakLine(series.streak.holder.name, series.streak.length)
              }
            />
            <li className="cn-record cn-stats-duo">
              <span className="cn-stats-pair">{SERIES_FORM}</span>
              <span className="cn-num cn-record-wl">
                {series.form.length === 0 ? NO_FORM : series.form.map(formMark).join(' ')}
              </span>
            </li>
            {series.aKda === null ? null : (
              <StatRow
                label={renderWebName(series.a.name)}
                value={versusKdaLine(series.aKda.kills, series.aKda.deaths, series.aKda.assists)}
              />
            )}
            {series.bKda === null ? null : (
              <StatRow
                label={renderWebName(series.b.name)}
                value={versusKdaLine(series.bKda.kills, series.bKda.deaths, series.bKda.assists)}
              />
            )}
          </ul>
        )}
      </StatBlock>

      <StatBlock title={LOCKS_HEADING}>
        <ul className="cn-records">
          <StatRow
            label={renderWebName(series.a.name)}
            value={
              series.aChamp === null ? NO_LOCK : champIntoLine(series.aChamp.champion, series.aChamp.count)
            }
          />
          <StatRow
            label={renderWebName(series.b.name)}
            value={
              series.bChamp === null ? NO_LOCK : champIntoLine(series.bChamp.champion, series.bChamp.count)
            }
          />
        </ul>
      </StatBlock>

      <StatBlock title={SAME_LANE_HEADING}>
        {series.lanes.length === 0 ? (
          <p className="cn-stats-empty">{NO_SAME_LANE}</p>
        ) : (
          <ol className="cn-records">
            {series.lanes.map((row) => (
              <MatchupRow key={row.role} row={row} />
            ))}
          </ol>
        )}
      </StatBlock>

      <StatBlock title={TOGETHER_HEADING}>
        {series.allies === 0 ? (
          <p className="cn-stats-empty">{NO_ALLIES}</p>
        ) : (
          <ul className="cn-records">
            <StatRow
              label={TOGETHER_HEADING}
              value={
                series.allyWinRate === null
                  ? winLossLabel(series.allyWins, series.allyLosses)
                  : `${winLossLabel(series.allyWins, series.allyLosses)} · ${percentLabel(series.allyWinRate)}`
              }
            />
          </ul>
        )}
      </StatBlock>
    </div>
  );
}

function Fighter({
  player,
  wins,
  lead,
  align = 'start',
}: {
  player: PlayerRef;
  wins: number;
  lead: boolean;
  align?: 'start' | 'end';
}) {
  return (
    <div className={align === 'end' ? 'cn-versus-fighter cn-versus-fighter-end' : 'cn-versus-fighter'}>
      <PlayerName player={player} />
      <p className={lead ? 'cn-versus-wins cn-versus-wins-lead' : 'cn-versus-wins'}>{wins}</p>
    </div>
  );
}

function StatBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cn-versus-block">
      <VersusHead title={title} as="p" className="cn-stats-subtitle" />
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="cn-record cn-stats-duo">
      <span className="cn-stats-pair">{label}</span>
      <span className="cn-num cn-record-wl">{value}</span>
    </li>
  );
}

function Spice({
  heading,
  intro,
  empty,
  rows,
}: {
  heading: string;
  intro: string;
  empty: string;
  rows: readonly LaneMatchup[];
}) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <VersusHead title={heading} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{intro}</p>
          {rows.length === 0 ? (
            <p className="cn-stats-empty">{empty}</p>
          ) : (
            <ol className="cn-records">
              {rows.map((row) => (
                <MatchupRow key={`${row.role}|${row.a.puuid}|${row.b.puuid}`} row={row} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </section>
  );
}

function Lanes({ boards, noRoleGames }: { boards: readonly LaneBoard[]; noRoleGames: number }) {
  const any = boards.some((board) => board.entries.length > 0);
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <VersusHead title={LANES_HEADING} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{LANES_INTRO}</p>
          {any ? null : <p className="cn-stats-empty">{LANES_EMPTY}</p>}
        </div>
        {boards.map((board) => (
          <div key={board.role} className="cn-role-block">
            <p className="cn-num cn-lineup-role">
              <RoleIcon role={board.role} size={16} />
              {board.role}
            </p>
            {board.entries.length === 0 ? (
              <p className="cn-stats-empty">{noLaneEntries(board.role)}</p>
            ) : (
              <ol className="cn-records">
                {board.entries.map((row) => (
                  <MatchupRow key={`${row.a.puuid}|${row.b.puuid}`} row={row} />
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>
      {noRoleGames === 0 ? null : <p className="cn-hint">{noRoleFootnote(noRoleGames)}</p>}
    </section>
  );
}

function MatchupRow({ row }: { row: LaneMatchup }) {
  const record =
    row.winRate === null
      ? winLossLabel(row.aWins, row.bWins)
      : `${winLossLabel(row.aWins, row.bWins)} · ${percentLabel(row.winRate)}`;
  return (
    <li className="cn-record cn-versus-row">
      <span className="cn-num cn-lineup-role">
        <RoleIcon role={row.role} size={14} />
        {row.role}
      </span>
      <span className="cn-versus-names">
        <PlayerName player={row.a} />
        <span className="cn-versus-vs-inline">{VERSUS_WORD}</span>
        <PlayerName player={row.b} />
      </span>
      <span className="cn-num cn-record-wl">{record}</span>
    </li>
  );
}

function VersusHead({
  title,
  as: Tag = 'h2',
  className = 'cn-board-title',
}: {
  title: string;
  as?: 'h2' | 'p';
  className?: string;
}) {
  const roast = versusRoast(title);
  return (
    <div className="cn-fun-named">
      <Tag className={className}>{title}</Tag>
      {roast === null ? null : (
        <p className="cn-fun-roast" lang="ar" dir="rtl">
          {roast}
        </p>
      )}
    </div>
  );
}

function PlayerName({ player }: { player: PlayerRef }) {
  return (
    <Link className="cn-stats-name" href={`/p/${player.puuid}`}>
      {renderWebName(player.name)}
    </Link>
  );
}
