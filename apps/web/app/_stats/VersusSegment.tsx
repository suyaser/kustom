import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { winLossLabel } from '@/lib/board/copy';
import {
  BEST_TOGETHER,
  DUOS_HEADING,
  NO_DUOS,
  noRoleFootnote,
  pairLabel,
  percentLabel,
  WORST_TOGETHER,
} from '@/lib/stats/copy';
import { matchDetail } from '@/lib/stats/funCopy';
import type { DuoRecord, FunFactsView, StatsView } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import {
  COLLIDE_HEADING,
  COMPARE,
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
  PICK_LEFT,
  PICK_ONE,
  PICK_PLAYER,
  PICK_RIGHT,
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
  VERSUS_WORD,
  versusKdaLine,
  versusScore,
} from '@/lib/versus/copy';
import type { HeadToHead, LaneMatchup, VersusView } from '@/lib/versus/types';
import {
  capRows,
  Empty,
  Openings,
  PlayerName,
  RoleTitle,
  Row,
  Rows,
  ShowAll,
  StatSection,
  type StatsLinks,
  SubBlock,
} from './parts';

/**
 * Stats → 1v1 (M14.17): who has whose number. Pick two (any two people, `?a=&b=`, opens filled),
 * **the one duos block** in the app (best and worst together, and nemesis: it replaces 1.0's
 * Stats → Duos and Fun → Friends and enemies, whose `Best duo` list was the same pairs a second
 * time), lane bully, dead heat and the five lane wars. Rift only, as `/1v1` always was.
 */
export function VersusSegment({
  versus,
  stats,
  fun,
  links,
  action,
}: {
  versus: VersusView;
  stats: StatsView;
  /** Only the rivals block is drawn here (nemesis), and only it is read (`loadVersusSegment`). */
  fun: Pick<FunFactsView, 'rivals'>;
  links: StatsLinks;
  /** The Pick two form's GET target: this segment's path. */
  action: string;
}) {
  return (
    <>
      <p className="text-sm text-pretty text-muted-foreground">{VERSUS_INTRO}</p>
      <PickTwo versus={versus} links={links} action={action} />
      <Duos stats={stats} fun={fun} links={links} />
      <Matchups
        id="bully"
        title={TYRANTS_HEADING}
        intro={TYRANTS_INTRO}
        empty={TYRANTS_EMPTY}
        rows={versus.tyrants}
        links={links}
      />
      <Matchups
        id="heat"
        title={HEATS_HEADING}
        intro={HEATS_INTRO}
        empty={HEATS_EMPTY}
        rows={versus.heats}
        links={links}
      />
      <StatSection
        roasts={links.roasts}
        id="lanes"
        title={LANES_HEADING}
        intro={LANES_INTRO}
        rule={versus.noRoleGames === 0 ? undefined : noRoleFootnote(versus.noRoleGames)}
      >
        {versus.lanes.some((board) => board.entries.length > 0) ? null : <Empty>{LANES_EMPTY}</Empty>}
        {versus.lanes.map((board) => (
          <SubBlock roasts={links.roasts} key={board.role} title="" icon={<RoleTitle role={board.role} />}>
            {board.entries.length === 0 ? (
              <Empty>{noLaneEntries(board.role)}</Empty>
            ) : (
              <Rows>
                {board.entries.map((row) => (
                  <MatchupRow
                    key={`${row.a.puuid}|${row.b.puuid}`}
                    row={row}
                    links={links}
                    showRole={false}
                  />
                ))}
              </Rows>
            )}
          </SubBlock>
        ))}
      </StatSection>
    </>
  );
}

/** A GET form of two native selects (05-design 5.0: 17px, no iOS zoom), so a pick is a URL. */
function PickTwo({ versus, links, action }: { versus: VersusView; links: StatsLinks; action: string }) {
  const options = versus.roster.map((player) => (
    <NativeSelectOption key={player.puuid} value={player.puuid}>
      {renderWebName(player.name)}
    </NativeSelectOption>
  ));
  return (
    <StatSection roasts={links.roasts} id="pick" title={PICK_HEADING} intro={PICK_INTRO}>
      <form method="get" action={action} className="flex flex-col gap-3 px-(--card-pad) pb-(--card-pad)">
        <input type="hidden" name="window" value={versus.window} />
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="pick-a" className="text-xs font-bold text-muted-foreground">
              {PICK_LEFT}
            </label>
            <NativeSelect id="pick-a" name="a" defaultValue={versus.leftPuuid ?? ''}>
              <NativeSelectOption value="">{PICK_PLAYER}</NativeSelectOption>
              {options}
            </NativeSelect>
          </div>
          <span aria-hidden="true" className="hidden pb-2.5 text-sm text-muted-foreground md:block">
            {VERSUS_WORD}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="pick-b" className="text-xs font-bold text-muted-foreground">
              {PICK_RIGHT}
            </label>
            <NativeSelect id="pick-b" name="b" defaultValue={versus.rightPuuid ?? ''}>
              <NativeSelectOption value="">{PICK_PLAYER}</NativeSelectOption>
              {options}
            </NativeSelect>
          </div>
        </div>
        <Button type="submit" variant="secondary" className="w-full md:w-fit">
          {COMPARE}
        </Button>
      </form>
      <div className="border-t border-border">
        {versus.pick.kind === 'idle' ? <Empty>{PICK_IDLE}</Empty> : null}
        {versus.pick.kind === 'one' ? <Empty>{PICK_ONE}</Empty> : null}
        {versus.pick.kind === 'same' ? <Empty>{PICK_SAME}</Empty> : null}
        {versus.pick.kind === 'ready' ? <Series series={versus.pick.series} links={links} /> : null}
      </div>
    </StatSection>
  );
}

function Series({ series, links }: { series: HeadToHead; links: StatsLinks }) {
  const a = renderWebName(series.a.name);
  const b = renderWebName(series.b.name);
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 px-(--card-pad) py-3">
        <p className="text-lg leading-tight font-bold text-balance">{series.verdict}</p>
        {/* Below 768 the two names and the score stack, full width, so a long Riot ID never breaks mid-word. */}
        <p className="flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-3">
          <span className="min-w-0">
            <PlayerName player={series.a} links={links} />
          </span>
          <span className="num text-xl font-bold">
            <span aria-hidden="true">{versusScore(series.aWins, series.bWins)}</span>
            <span className="sr-only">
              {a} {series.aWins}, {b} {series.bWins}
            </span>
          </span>
          <span className="min-w-0 md:text-end">
            <PlayerName player={series.b} links={links} />
          </span>
        </p>
      </div>
      <SubBlock roasts={links.roasts} title={COLLIDE_HEADING}>
        {series.enemies === 0 ? (
          <Empty>{NO_ENEMIES}</Empty>
        ) : (
          <Rows ordered={false}>
            <Row
              who={LAST_MEETING}
              detail={
                series.lastMeeting === null
                  ? NO_LAST
                  : lastMeetingLine(
                      matchDetail(series.lastMeeting.startedAt, series.lastMeeting.durationS),
                      series.lastMeeting.winner.name,
                    )
              }
            />
            <Row
              who={SERIES_STREAK}
              detail={
                series.streak === null
                  ? NO_STREAK
                  : streakLine(series.streak.holder.name, series.streak.length)
              }
            />
            <Row
              who={SERIES_FORM}
              value={series.form.length === 0 ? NO_FORM : series.form.map(formMark).join(' ')}
            />
            {series.aKda === null ? null : (
              <Row
                who={
                  <NameOver
                    name={a}
                    value={versusKdaLine(series.aKda.kills, series.aKda.deaths, series.aKda.assists)}
                  />
                }
              />
            )}
            {series.bKda === null ? null : (
              <Row
                who={
                  <NameOver
                    name={b}
                    value={versusKdaLine(series.bKda.kills, series.bKda.deaths, series.bKda.assists)}
                  />
                }
              />
            )}
          </Rows>
        )}
      </SubBlock>
      <SubBlock roasts={links.roasts} title={LOCKS_HEADING}>
        <Rows ordered={false}>
          <Row
            who={a}
            detail={
              series.aChamp === null ? NO_LOCK : champIntoLine(series.aChamp.champion, series.aChamp.count)
            }
          />
          <Row
            who={b}
            detail={
              series.bChamp === null ? NO_LOCK : champIntoLine(series.bChamp.champion, series.bChamp.count)
            }
          />
        </Rows>
      </SubBlock>
      <SubBlock roasts={links.roasts} title={SAME_LANE_HEADING}>
        {series.lanes.length === 0 ? (
          <Empty>{NO_SAME_LANE}</Empty>
        ) : (
          <Rows>
            {series.lanes.map((row) => (
              <MatchupRow key={row.role} row={row} links={links} showRole />
            ))}
          </Rows>
        )}
      </SubBlock>
      <SubBlock roasts={links.roasts} title={TOGETHER_HEADING}>
        {series.allies === 0 ? (
          <Empty>{NO_ALLIES}</Empty>
        ) : (
          <Rows ordered={false}>
            <Row
              who={TOGETHER_HEADING}
              value={
                series.allyWinRate === null
                  ? winLossLabel(series.allyWins, series.allyLosses)
                  : `${winLossLabel(series.allyWins, series.allyLosses)} · ${percentLabel(series.allyWinRate)}`
              }
            />
          </Rows>
        )}
      </SubBlock>
    </div>
  );
}

/**
 * **The** duos block (M14.17 acceptance 11: it exists once in the app). Best and worst together
 * are `/stats`' `duoRecords`, split so no pair is in both (`splitDuos`); nemesis is `/fun`'s fold.
 */
function Duos({
  stats,
  fun,
  links,
}: {
  stats: StatsView;
  fun: Pick<FunFactsView, 'rivals'>;
  links: StatsLinks;
}) {
  const nemesis = fun.rivals.nemesis;
  const { shown, total } = capRows(nemesis.rows, 'nemesis', links);
  return (
    <StatSection roasts={links.roasts} id="duos" title={DUOS_HEADING}>
      <DuoList title={BEST_TOGETHER} pairs={stats.bestDuos} links={links} />
      {/* Under two qualifying pairs there is no worst duo: only `Best together` shows (the duos bug). */}
      {stats.worstDuos.length === 0 ? null : (
        <DuoList title={WORST_TOGETHER} pairs={stats.worstDuos} links={links} />
      )}
      <SubBlock roasts={links.roasts} title={nemesis.title} rule={nemesis.rule}>
        <p className="px-(--card-pad) pb-2 text-sm text-pretty text-muted-foreground">{nemesis.intro}</p>
        {total === 0 ? (
          <Empty>{nemesis.empty}</Empty>
        ) : (
          <Rows>
            {shown.map((row) => (
              <Row
                key={row.player.puuid}
                who={<PlayerName player={row.player} links={links} />}
                value={row.countLabel}
                detail={row.valueLabel}
              >
                <Openings
                  items={row.openings.map((opening) => ({
                    gameId: opening.game.id,
                    label: opening.label ?? opening.detail,
                    detail: opening.label === null ? null : opening.detail,
                  }))}
                  playerPuuid={row.player.puuid}
                  links={links}
                />
              </Row>
            ))}
          </Rows>
        )}
        <ShowAll listId="nemesis" total={total} links={links} />
      </SubBlock>
    </StatSection>
  );
}

function DuoList({ title, pairs, links }: { title: string; pairs: readonly DuoRecord[]; links: StatsLinks }) {
  return (
    <SubBlock roasts={links.roasts} title={title}>
      {pairs.length === 0 ? (
        <Empty>{NO_DUOS}</Empty>
      ) : (
        <Rows>
          {pairs.map((pair) => (
            <Row
              key={`${pair.players[0].puuid}|${pair.players[1].puuid}`}
              who={
                <span>
                  <PlayerName player={pair.players[0]} links={links} />
                  <span className="text-muted-foreground"> and </span>
                  <PlayerName player={pair.players[1]} links={links} />
                  <span className="sr-only">
                    {' '}
                    ({pairLabel(renderWebName(pair.players[0].name), renderWebName(pair.players[1].name))})
                  </span>
                </span>
              }
              value={`${winLossLabel(pair.wins, pair.losses)} · ${percentLabel(pair.winRate)}`}
            />
          ))}
        </Rows>
      )}
    </SubBlock>
  );
}

function Matchups({
  id,
  title,
  intro,
  empty,
  rows,
  links,
}: {
  id: string;
  title: string;
  intro: string;
  empty: string;
  rows: readonly LaneMatchup[];
  links: StatsLinks;
}) {
  const { shown, total } = capRows(rows, id, links);
  return (
    <StatSection roasts={links.roasts} id={id} title={title} intro={intro}>
      {total === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <Rows>
          {shown.map((row) => (
            <MatchupRow key={`${row.role}|${row.a.puuid}|${row.b.puuid}`} row={row} links={links} showRole />
          ))}
        </Rows>
      )}
      <ShowAll listId={id} total={total} links={links} />
    </StatSection>
  );
}

function MatchupRow({ row, links, showRole }: { row: LaneMatchup; links: StatsLinks; showRole: boolean }) {
  const record =
    row.winRate === null
      ? winLossLabel(row.aWins, row.bWins)
      : `${winLossLabel(row.aWins, row.bWins)} · ${percentLabel(row.winRate)}`;
  return (
    <Row
      who={
        <span className="flex flex-col gap-0.5">
          {showRole ? (
            <span className="text-xs text-muted-foreground">
              <RoleTitle role={row.role} />
            </span>
          ) : null}
          <span>
            <PlayerName player={row.a} links={links} />
            <span className="text-muted-foreground"> {VERSUS_WORD} </span>
            <PlayerName player={row.b} links={links} />
          </span>
        </span>
      }
      value={record}
    />
  );
}

/** A long Riot ID over its number (design round 1): the name gets the whole row, never broken mid-word. */
function NameOver({ name, value }: { name: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span>{name}</span>
      <span className="num text-sm">{value}</span>
    </span>
  );
}
