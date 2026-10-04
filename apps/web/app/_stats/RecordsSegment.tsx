import { gamesLabel, ROLE_RECORD_HEADING, winLossLabel } from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import {
  AWARDS_HEADING,
  averageGameLine,
  blueWinLine,
  LONGEST_LOSS,
  LONGEST_WIN,
  latestLabel,
  NOBODY_ON_A_STREAK,
  noRoleEntries,
  noRoleFootnote,
  ON_A_STREAK,
  percentLabel,
  playersLine,
  RIFT_ONLY_NOTE,
  ROLE_TOP_SHOWN,
  SHOW_FEWER,
  STREAKS_HEADING,
  seeAllRoleLabel,
  tiedLabel,
} from '@/lib/stats/copy';
import {
  CS_HEADING,
  CS_HIGH_LABEL,
  CS_LOW_LABEL,
  DEATH_HALL_TITLE,
  FATES_HEADING,
  HABITS_HEADING,
  noCsAtRole,
  RECORDS_HEADING,
  THIEF_EMPTY,
  THIEF_TITLE,
} from '@/lib/stats/funCopy';
import type {
  FunBloodGroup,
  FunBloodRow,
  FunFactsView,
  FunHolder,
  FunOdds,
  FunRecord,
  FunSection,
  RoleCsPair,
  StatsView,
  StreakHolders,
} from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import type { StatsLinks } from './parts';
import { RecordGroupLabel, RecordList, RecordRow, RecordSection } from './records-parts';

/**
 * Stats → Records (M14.17; the Records ruling, design round 1): who holds the records. `/stats`'
 * awards, group numbers, roles and streaks, and `/fun`'s one-game records, museums, deaths, steals,
 * luck and the odds. No section here appears in another segment.
 *
 * Every section is a `<details>` with its name and count; `One game` is open. Every record is one
 * row link of at most two lines. Two columns from 1024 (the frame's `wide`).
 *
 * The rating sections (awards, roles, streaks) fold every map, as `/stats` always has, so the ARAM
 * view leaves them out with one sentence rather than repeating the Rift numbers under ARAM.
 */
export function RecordsSegment({
  stats,
  fun,
  links,
}: {
  stats: StatsView;
  fun: FunFactsView;
  links: StatsLinks;
}) {
  const rift = fun.queue === 'sr';
  const oneGame = fun.records.filter((record) => !isHabit(record.id));
  const habits = fun.records.filter((record) => isHabit(record.id));
  return (
    <>
      {/* The window's group numbers, one card, no title: they name themselves (1.0's band). */}
      <div className="mb-4 break-inside-avoid overflow-hidden rounded-card border border-border bg-card lg:mb-5">
        <ul className="divide-y divide-border">
          {rift && stats.blueWinRate !== null ? <Line>{blueWinLine(stats.blueWinRate)}</Line> : null}
          {rift && stats.averageMinutes !== null ? (
            <Line>{averageGameLine(stats.averageMinutes)}</Line>
          ) : null}
          <Line>{playersLine(rift ? stats.players : fun.players)}</Line>
          {rift ? null : <Line muted>{RIFT_ONLY_NOTE}</Line>}
        </ul>
      </div>
      <Records id="one-game" heading={RECORDS_HEADING} records={oneGame} links={links} open />
      {rift ? <Awards stats={stats} links={links} /> : null}
      {rift ? <CsByRole pairs={fun.csByRole} links={links} /> : null}
      <Museum id="first-blood" museum={fun.museum} links={links} />
      {fun.donated.rows.length === 0 ? null : <Museum id="donated" museum={fun.donated} links={links} />}
      {fun.halls.map((hall, index) => (
        <Museum key={hall.title} id={`hall-${index}`} museum={hall} links={links} />
      ))}
      <Records id="deaths" heading={DEATH_HALL_TITLE} records={fun.deathHall} links={links} />
      {rift ? (
        fun.thieves.length === 0 ? (
          <RecordSection roasts={links.roasts} id="thieves" title={THIEF_TITLE} count={0}>
            <RecordList>
              <RecordRow title={THIEF_EMPTY} muted />
            </RecordList>
          </RecordSection>
        ) : (
          <Records id="thieves" heading={THIEF_TITLE} records={fun.thieves} links={links} />
        )
      ) : null}
      <Records id="luck" heading={FATES_HEADING} records={fun.fates} links={links} />
      <AgainstTheOdds odds={fun.odds} links={links} />
      {rift ? <Roles stats={stats} links={links} /> : null}
      {rift ? <Streaks stats={stats} links={links} /> : null}
      <Records id="habit" heading={HABITS_HEADING} records={habits} links={links} />
    </>
  );
}

function isHabit(id: string): boolean {
  return id === 'attendance' || id === 'longest' || id === 'shortest';
}

function Line({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li
      className={
        muted ? 'px-(--card-pad) py-2.5 text-sm text-muted-foreground' : 'px-(--card-pad) py-2.5 text-base'
      }
    >
      {children}
    </li>
  );
}

/** Where a holder's row goes: the one game, else the Games list filtered to them. */
function holderHref(holder: FunHolder, links: StatsLinks): string {
  if (holder.openings.length <= 1 && holder.game !== null) return links.game(holder.game.id);
  return links.playerGames(holder.puuid);
}

function holderLine(holders: readonly FunHolder[], first: FunHolder): string {
  const parts = [renderWebName(first.name), first.detail].filter((part): part is string => !!part);
  if (holders.length > 1) parts.push(tiedLabel(holders.length - 1));
  return parts.join(' · ');
}

/** One row per record: its title and value, then who · when. Ties name the first and count the rest. */
function Records({
  id,
  heading,
  records,
  links,
  open = false,
}: {
  id: string;
  heading: string;
  records: readonly FunRecord[];
  links: StatsLinks;
  open?: boolean;
}) {
  if (records.length === 0) return null;
  return (
    <RecordSection
      roasts={links.roasts}
      id={id}
      title={heading}
      count={records.filter((record) => record.holders.length > 0).length}
      open={open}
      rules={records.map((record) => ({ title: record.title, rule: record.rule }))}
    >
      <RecordList>
        {records.map((record) => {
          const first = record.holders[0];
          if (first === undefined)
            return <RecordRow key={record.id} title={record.title} line={record.empty} muted />;
          return (
            <RecordRow
              key={record.id}
              title={record.title}
              value={first.valueLabel}
              line={holderLine(record.holders, first)}
              href={holderHref(first, links)}
              rule={record.rule}
            />
          );
        })}
      </RecordList>
    </RecordSection>
  );
}

/** Three statements on a closed window, nothing otherwise (the running line is the frame's hint). */
function Awards({ stats, links }: { stats: StatsView; links: StatsLinks }) {
  const awards = stats.awards;
  if (awards === null || awards.kind === 'running') return null;
  return (
    <RecordSection
      roasts={links.roasts}
      id="awards"
      title={AWARDS_HEADING}
      count={awards.blocks.filter((block) => block.won).length}
      intro={awards.intro}
      rules={awards.blocks.map((block) => ({
        title: block.label,
        rule: [block.rule, block.note].filter(Boolean).join(' '),
      }))}
    >
      <RecordList>
        {awards.blocks.map((block) => (
          <RecordRow
            key={block.label}
            title={block.label}
            line={block.lines.map((line) => line.text).join(' ')}
            rule={block.rule}
            muted={!block.won}
          />
        ))}
      </RecordList>
    </RecordSection>
  );
}

interface CsRow {
  key: string;
  title: string;
  holder: FunHolder | null;
}

function CsByRole({ pairs, links }: { pairs: readonly RoleCsPair[]; links: StatsLinks }) {
  const rows: CsRow[] = pairs.flatMap((pair): CsRow[] =>
    pair.highest === null || pair.lowest === null
      ? [{ key: pair.role, title: noCsAtRole(pair.role), holder: null }]
      : [
          { key: `${pair.role}-high`, title: `${pair.role} · ${CS_HIGH_LABEL}`, holder: pair.highest },
          { key: `${pair.role}-low`, title: `${pair.role} · ${CS_LOW_LABEL}`, holder: pair.lowest },
        ],
  );
  return (
    <RecordSection
      roasts={links.roasts}
      id="cs"
      title={CS_HEADING}
      count={rows.filter((row) => row.holder !== null).length}
    >
      <RecordList>
        {rows.map((row) =>
          row.holder === null ? (
            <RecordRow key={row.key} title={row.title} muted />
          ) : (
            <RecordRow
              key={row.key}
              title={row.title}
              value={row.holder.valueLabel}
              line={holderLine([row.holder], row.holder)}
              href={holderHref(row.holder, links)}
            />
          ),
        )}
      </RecordList>
    </RecordSection>
  );
}

/** The value cell stays short (it never wraps): champion and haul; the opponent goes on line two. */
function champHaul(row: FunBloodRow): string {
  return `${row.champion}${row.haul === null ? '' : ` · ${row.haul}`}`;
}

/** `22 Aug` out of `22 Aug · 23 min`. */
function nightOf(row: FunBloodRow): string {
  return row.when.split(' · ')[0] ?? row.when;
}

function bloodDetail(row: FunBloodRow): string {
  const versus = row.opponent === null ? '' : ` · vs ${row.opponent}`;
  return row.victim === null
    ? `${row.when}${versus}`
    : `${row.when} · ${row.foeVerb} ${renderWebName(row.victim.name)}${versus}`;
}

/** One row per killer: their count (or the one game), and their latest. */
function Museum({ id, museum, links }: { id: string; museum: FunSection<FunBloodGroup>; links: StatsLinks }) {
  return (
    <RecordSection
      roasts={links.roasts}
      id={id}
      title={museum.title}
      count={museum.rows.length}
      rules={[{ title: museum.title, rule: museum.intro }]}
    >
      <RecordList>
        {museum.rows.length === 0 ? <RecordRow title={museum.empty} muted /> : null}
        {museum.rows.map((group) => {
          const latest = group.openings[0];
          const only = group.openings.length === 1 ? latest : undefined;
          return (
            <RecordRow
              key={group.taker.puuid}
              title={renderWebName(group.taker.name)}
              value={only === undefined ? group.countLabel : champHaul(only)}
              line={
                only !== undefined
                  ? bloodDetail(only)
                  : latest === undefined
                    ? null
                    : latestLabel(`${latest.champion} · ${nightOf(latest)}`)
              }
              href={only?.game ? links.game(only.game.id) : links.playerGames(group.taker.puuid)}
            />
          );
        })}
      </RecordList>
    </RecordSection>
  );
}

function AgainstTheOdds({ odds, links }: { odds: FunOdds; links: StatsLinks }) {
  return (
    <RecordSection
      roasts={links.roasts}
      id="odds"
      title={odds.title}
      count={odds.rows.length + (odds.record === null ? 0 : 1)}
      rules={[
        { title: odds.title, rule: `${odds.intro} ${odds.rule}` },
        { title: odds.recordTitle, rule: odds.recordRule },
      ]}
    >
      <RecordList>
        {odds.record === null ? null : (
          <RecordRow
            title={odds.recordTitle}
            value={odds.record.when}
            line={`${odds.record.line} ${odds.record.players.map((player) => renderWebName(player.name)).join(', ')}`}
            href={links.game(odds.record.game.id)}
            rule={odds.recordRule}
          />
        )}
        {odds.rows.length === 0 ? <RecordRow title={odds.empty} muted /> : null}
        {odds.rows.map((row) => (
          <RecordRow
            key={row.puuid}
            title={renderWebName(row.name)}
            value={row.valueLabel}
            line={row.games.map((win) => `${win.percent}%`).join(', ')}
            href={links.playerGames(row.puuid)}
          />
        ))}
      </RecordList>
    </RecordSection>
  );
}

function Roles({ stats, links }: { stats: StatsView; links: StatsLinks }) {
  return (
    <RecordSection
      roasts={links.roasts}
      id="roles"
      title={ROLE_RECORD_HEADING}
      // The rows on screen, not every qualifier behind `See all` (design).
      count={stats.roles.reduce(
        (sum, block) =>
          sum +
          (links.expanded === `role-${block.role}`
            ? block.entries.length
            : Math.min(ROLE_TOP_SHOWN, block.entries.length)),
        0,
      )}
      // Opened by a `See all <role>` link for one of these roles, so the list it asked for is on screen.
      open={stats.roles.some((block) => links.expanded === `role-${block.role}`)}
      rules={
        stats.noRoleGames === 0
          ? undefined
          : [{ title: ROLE_RECORD_HEADING, rule: noRoleFootnote(stats.noRoleGames) }]
      }
    >
      {stats.roles.map((block) => {
        // The lead's ruling (M14.17 design round 1): the top three per role, the rest one tap away.
        const listId = `role-${block.role}`;
        const all = links.expanded === listId;
        const shown = all ? block.entries : block.entries.slice(0, ROLE_TOP_SHOWN);
        return (
          <div key={block.role} id={listId} className="scroll-mt-20">
            <RecordGroupLabel>{block.role}</RecordGroupLabel>
            <RecordList>
              {block.entries.length === 0 ? <RecordRow title={noRoleEntries(block.role)} muted /> : null}
              {shown.map((entry, index) => (
                <RecordRow
                  key={entry.puuid}
                  title={
                    <>
                      <span className="num me-2 text-muted-foreground">{index + 1}</span>
                      {renderWebName(entry.name)}
                    </>
                  }
                  value={
                    <>
                      {winLossLabel(entry.wins, entry.losses)}
                      {entry.winRate === null ? null : ` · ${percentLabel(entry.winRate)}`}
                      <span className="sr-only"> over {gamesLabel(entry.games)}</span>
                    </>
                  }
                  href={links.player(entry.puuid)}
                  truncateTo={renderWebName(entry.name)}
                />
              ))}
              {block.entries.length > ROLE_TOP_SHOWN ? (
                <RecordRow
                  title={all ? SHOW_FEWER : seeAllRoleLabel(block.role, block.entries.length)}
                  href={all ? links.showFewer(listId) : links.showAll(listId)}
                  muted
                />
              ) : null}
            </RecordList>
          </div>
        );
      })}
    </RecordSection>
  );
}

function Streaks({ stats, links }: { stats: StatsView; links: StatsLinks }) {
  const longest = (title: string, kind: 'W' | 'L', holders: StreakHolders | null) => {
    if (holders === null) return null;
    const first = holders.holders[0];
    return (
      <RecordRow
        title={title}
        value={formatStreak({ kind, length: holders.length })}
        line={holders.holders.map((ref) => renderWebName(ref.name)).join(', ')}
        href={first === undefined ? null : links.player(first.puuid)}
      />
    );
  };
  return (
    <RecordSection
      roasts={links.roasts}
      id="streaks"
      title={STREAKS_HEADING}
      count={2 + stats.onAStreak.length}
    >
      <RecordList>
        {longest(LONGEST_WIN, 'W', stats.longestWin)}
        {longest(LONGEST_LOSS, 'L', stats.longestLoss)}
      </RecordList>
      <RecordGroupLabel>{ON_A_STREAK}</RecordGroupLabel>
      <RecordList>
        {stats.onAStreak.length === 0 ? <RecordRow title={NOBODY_ON_A_STREAK} muted /> : null}
        {stats.onAStreak.map((streak) => (
          <RecordRow
            key={streak.puuid}
            title={renderWebName(streak.name)}
            value={streak.current === null ? '' : formatStreak(streak.current)}
            href={links.player(streak.puuid)}
          />
        ))}
      </RecordList>
    </RecordSection>
  );
}
