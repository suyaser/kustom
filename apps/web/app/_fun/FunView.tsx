import Link from 'next/link';
import type { ReactNode } from 'react';
import { WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import type { HistoryGame } from '@/lib/games/types';
import { capLine, playersLine } from '@/lib/stats/copy';
import {
  CS_HEADING,
  CS_HIGH_LABEL,
  CS_LOW_LABEL,
  DEATH_HALL_TITLE,
  FATES_HEADING,
  FEAR_BAN_RULE,
  FUN_LABEL,
  funRoast,
  HABITS_HEADING,
  MOST_BANNED_RULE,
  MOST_PICKED_RULE,
  noCsAtRole,
  POOLS_HEADING,
  RECORDS_HEADING,
  RIVALS_HEADING,
  SEE_CHAMPS,
  SEE_GAMES,
  THIEF_EMPTY,
  THIEF_TITLE,
  THIS_GAME,
} from '@/lib/stats/funCopy';
import type {
  FunBloodGroup,
  FunBloodRow,
  FunChampRow,
  FunDuoRow,
  FunFactsView,
  FunFearBan,
  FunHolder,
  FunOpening,
  FunPool,
  FunPoolRow,
  FunRecord,
  FunRivalRow,
  FunRivalsView,
  FunSection,
  PlayerRef,
  RoleCsPair,
} from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { MatchSheet } from '../_games/MatchSheet';
import { QueuePicker } from '../_games/QueuePicker';
import { RoleIcon } from '../_icons/RoleIcon';
import '../board-parts.css';

/**
 * `/fun` (M5.24, M5.27): the window's records, in the same shell `/stats` already wears.
 *
 * A pure function of one snapshot. The numbers live in `lib/stats/fun.ts`; this file decides
 * nothing except order: first blood, multi-kill halls, first turret, deaths, steals,
 * fear bans, most banned / picked, who they lock (OTP vs variety), luck (lowest
 * winning KDA / highest losing KDA), friends and enemies (nemesis, best duo),
 * then CS by role, then one-game records, then habits. The Rift / ARAM picker is the same chips `/games` wears.
 * CS-by-role, objective steals and most banned are Rift only. Rows are labelled (name left,
 * number right) so a long Riot ID cannot wrap into the score.
 */

export function FunView({ facts }: { facts: FunFactsView }) {
  const empty = facts.range === null;
  const queueQuery = facts.queue === 'sr' ? {} : { queue: facts.queue };

  return (
    <main className="cn-page cn-fun">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[facts.window]} <span className="cn-strip-sub">{FUN_LABEL}</span>
        </h1>
        <WindowPicker
          path="/fun"
          selected={facts.window}
          {...(Object.keys(queueQuery).length === 0 ? {} : { query: queueQuery })}
        />
        <QueuePicker path="/fun" window={facts.window} selected={facts.queue} />
        <WindowSlot
          window={facts.window}
          line={empty ? null : windowSlotLine(facts.range as string, facts.games)}
        />
        {facts.capped ? <p className="cn-hint">{capLine(facts.cap)}</p> : null}
      </header>

      {empty ? null : (
        <>
          <section className="cn-block">
            <section className="cn-card cn-stats-lines">
              <p className="cn-stats-line">{playersLine(facts.players)}</p>
            </section>
          </section>
          <Museum museum={facts.museum} />
          {facts.donated.rows.length === 0 ? null : <Museum museum={facts.donated} />}
          {facts.halls.map((hall) => (
            <Museum key={hall.title} museum={hall} />
          ))}
          <Records heading={DEATH_HALL_TITLE} records={facts.deathHall} />
          {facts.queue === 'aram' ? null : <Thieves records={facts.thieves} />}
          <FearBans section={facts.fearBans} />
          {facts.queue === 'aram' ? null : <ChampTable section={facts.mostBanned} rule={MOST_BANNED_RULE} />}
          <ChampTable section={facts.mostPicked} rule={MOST_PICKED_RULE} />
          <Pools pools={facts.pools} />
          <Records heading={FATES_HEADING} records={facts.fates} />
          <Rivals rivals={facts.rivals} />
          {facts.queue === 'aram' ? null : <CsByRole pairs={facts.csByRole} />}
          <Records
            heading={RECORDS_HEADING}
            records={facts.records.filter((record) => !isHabit(record.id))}
          />
          <Records heading={HABITS_HEADING} records={facts.records.filter((record) => isHabit(record.id))} />
        </>
      )}
    </main>
  );
}

function isHabit(id: string): boolean {
  return id === 'attendance' || id === 'longest' || id === 'shortest';
}

function FunHead({
  title,
  as: Tag = 'h2',
  className = 'cn-board-title',
}: {
  title: string;
  as?: 'h2' | 'p';
  className?: string;
}) {
  const roast = funRoast(title);
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

function Museum({ museum }: { museum: FunSection<FunBloodGroup> }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={museum.title} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{museum.intro}</p>
          {museum.rows.length === 0 ? (
            <p className="cn-stats-empty">{museum.empty}</p>
          ) : (
            <ol className="cn-fun-groups">
              {museum.rows.map((group) => (
                <BloodGroup key={group.taker.puuid} group={group} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </section>
  );
}

function Pools({ pools }: { pools: FunPool[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={POOLS_HEADING} />
        </header>
        {pools.map((pool) => (
          <div key={pool.id} className="cn-role-block">
            <FunHead title={pool.title} as="p" className="cn-stats-subtitle" />
            <p className="cn-stats-intro">{pool.intro}</p>
            {pool.rows.length === 0 ? (
              <p className="cn-stats-empty">{pool.empty}</p>
            ) : (
              <ol className="cn-fun-groups">
                {pool.rows.map((row) => (
                  <PoolRow key={row.puuid} row={row} />
                ))}
              </ol>
            )}
            <p className="cn-award-rule">{pool.rule}</p>
          </div>
        ))}
      </section>
    </section>
  );
}

function PoolRow({ row }: { row: FunPoolRow }) {
  if (row.champs.length === 0) {
    return (
      <li className="cn-record cn-fun-holder">
        <PlayerName player={row} />
        <span className="cn-fun-stat">
          <span className="cn-num cn-record-wl">{row.valueLabel}</span>
        </span>
      </li>
    );
  }

  return (
    <li className="cn-fun-group">
      <details className="cn-fun-game">
        <summary className="cn-record cn-fun-holder">
          <PlayerName player={row} />
          <span className="cn-fun-stat">
            <span className="cn-num cn-record-wl">{row.valueLabel}</span>
            <span className="cn-fun-toggle">{SEE_CHAMPS}</span>
          </span>
        </summary>
        <ol className="cn-fun-openings">
          {row.champs.map((champ) => (
            <li key={champ.championId} className="cn-record cn-fun-holder">
              <span className="cn-stats-name">{champ.champion}</span>
              <span className="cn-fun-stat">
                <span className="cn-num cn-record-wl">{champ.valueLabel}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

function ChampTable({ section, rule }: { section: FunSection<FunChampRow>; rule: string }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={section.title} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{section.intro}</p>
          {section.rows.length === 0 ? (
            <p className="cn-stats-empty">{section.empty}</p>
          ) : (
            <ol className="cn-records">
              {section.rows.map((row) => (
                <li key={row.championId} className="cn-record cn-fun-holder">
                  <span className="cn-stats-name">{row.champion}</span>
                  <span className="cn-fun-stat">
                    <span className="cn-num cn-record-wl">{row.valueLabel}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="cn-award-rule">{rule}</p>
        </div>
      </section>
    </section>
  );
}

function Thieves({ records }: { records: FunRecord[] }) {
  if (records.length === 0) {
    return (
      <section className="cn-block">
        <section className="cn-card cn-list-card">
          <header className="cn-card-head cn-list-head cn-fun-head">
            <FunHead title={THIEF_TITLE} />
          </header>
          <div className="cn-role-block">
            <p className="cn-stats-empty">{THIEF_EMPTY}</p>
          </div>
        </section>
      </section>
    );
  }
  return <Records heading={THIEF_TITLE} records={records} />;
}

function FearBans({ section }: { section: FunSection<FunFearBan> }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={section.title} />
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{section.intro}</p>
          <p className="cn-award-rule">{FEAR_BAN_RULE}</p>
          {section.rows.length === 0 ? (
            <p className="cn-stats-empty">{section.empty}</p>
          ) : (
            <ul className="cn-records">
              {section.rows.map((row) => (
                <li key={row.player.puuid} className="cn-record cn-fun-holder">
                  <PlayerName player={row.player} />
                  <span className="cn-fun-stat">
                    <span className="cn-num cn-record-wl">{row.rate}%</span>
                    <span className="cn-fun-when cn-fun-fear">{row.line}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}

function CsByRole({ pairs }: { pairs: RoleCsPair[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={CS_HEADING} />
        </header>
        {pairs.map((pair) => (
          <div key={pair.role} className="cn-role-block">
            <p className="cn-num cn-lineup-role">
              <RoleIcon role={pair.role} size={16} />
              {pair.role}
            </p>
            {pair.highest === null || pair.lowest === null ? (
              <p className="cn-stats-empty">{noCsAtRole(pair.role)}</p>
            ) : (
              <ul className="cn-records">
                <CsRow label={CS_HIGH_LABEL} holder={pair.highest} />
                <CsRow label={CS_LOW_LABEL} holder={pair.lowest} />
              </ul>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}

function CsRow({ label, holder }: { label: string; holder: FunHolder }) {
  return <HolderRow holder={holder} label={label} />;
}

function Records({ heading, records }: { heading: string; records: FunRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={heading} />
        </header>
        {records.map((block) => (
          <div key={block.id} className="cn-role-block">
            <FunHead title={block.title} as="p" className="cn-stats-subtitle" />
            {block.holders.length === 0 ? (
              <p className="cn-stats-empty">{block.empty}</p>
            ) : (
              <ul className="cn-records">
                {block.holders.map((holder) => (
                  <HolderRow key={holder.puuid} holder={holder} />
                ))}
              </ul>
            )}
            <p className="cn-award-rule">{block.rule}</p>
          </div>
        ))}
      </section>
    </section>
  );
}

function HolderRow({ holder, label }: { holder: FunHolder; label?: string }) {
  const className = label === undefined ? 'cn-fun-holder' : 'cn-fun-cs';

  if (holder.openings.length > 1) {
    return (
      <li className="cn-fun-group">
        <details className="cn-fun-game">
          <summary className={`cn-record ${className}`}>
            {label === undefined ? null : <span className="cn-stats-subtitle">{label}</span>}
            <PlayerName player={holder} />
            <span className="cn-fun-stat">
              <span className="cn-num cn-record-wl">{holder.valueLabel}</span>
              <span className="cn-fun-toggle">{SEE_GAMES}</span>
            </span>
          </summary>
          <ol className="cn-fun-openings">
            {holder.openings.map((opening) => (
              <OpeningRow key={opening.game.id} opening={opening} focusPuuid={holder.puuid} />
            ))}
          </ol>
        </details>
      </li>
    );
  }

  const row = (
    <>
      {label === undefined ? null : <span className="cn-stats-subtitle">{label}</span>}
      <PlayerName player={holder} />
      <span className="cn-fun-stat">
        <span className="cn-num cn-record-wl">{holder.valueLabel}</span>
        {holder.detail === null ? null : <span className="cn-fun-when">{holder.detail}</span>}
        {holder.game === null ? null : <span className="cn-fun-toggle">{THIS_GAME}</span>}
      </span>
    </>
  );

  if (holder.game === null) {
    return <li className={label === undefined ? 'cn-record cn-fun-holder' : 'cn-record cn-fun-cs'}>{row}</li>;
  }

  return (
    <li>
      <GameReveal game={holder.game} focusPuuid={holder.puuid} className={className}>
        {row}
      </GameReveal>
    </li>
  );
}

function OpeningRow({ opening, focusPuuid }: { opening: FunOpening; focusPuuid: string }) {
  return (
    <li>
      <GameReveal game={opening.game} focusPuuid={focusPuuid} className="cn-fun-holder">
        <span className="cn-stats-name">{opening.label ?? opening.detail}</span>
        <span className="cn-fun-stat">
          {opening.label === null ? null : <span className="cn-fun-when">{opening.detail}</span>}
          <span className="cn-fun-toggle">{THIS_GAME}</span>
        </span>
      </GameReveal>
    </li>
  );
}

function BloodGroup({ group }: { group: FunBloodGroup }) {
  if (group.openings.length === 1 && group.openings[0] !== undefined) {
    return <BloodRow row={group.openings[0]} />;
  }

  return (
    <li className="cn-fun-group">
      <details className="cn-fun-game">
        <summary className="cn-record cn-fun-holder">
          <PlayerName player={group.taker} />
          <span className="cn-fun-stat">
            <span className="cn-num cn-record-wl">{group.countLabel}</span>
            <span className="cn-fun-toggle">{SEE_GAMES}</span>
          </span>
        </summary>
        <ol className="cn-fun-openings">
          {group.openings.map((row) => (
            <BloodRow key={row.gameId} row={row} />
          ))}
        </ol>
      </details>
    </li>
  );
}

function BloodRow({ row }: { row: FunBloodRow }) {
  const body = (
    <>
      <span className="cn-fun-blood">
        <PlayerName player={row.taker} />
        {row.victim === null ? null : (
          <span className="cn-fun-when">
            {row.foeVerb} <PlayerName player={row.victim} />
          </span>
        )}
      </span>
      <span className="cn-fun-stat">
        <span className="cn-num cn-record-wl">
          {row.champion}
          {row.haul === null ? '' : ` · ${row.haul}`}
          {row.opponent === null ? '' : ` vs ${row.opponent}`}
        </span>
        <span className="cn-fun-when">{row.when}</span>
        {row.game === null ? null : <span className="cn-fun-toggle">{THIS_GAME}</span>}
      </span>
    </>
  );

  if (row.game === null) {
    return <li className="cn-record cn-fun-holder">{body}</li>;
  }

  return (
    <li>
      <GameReveal game={row.game} focusPuuid={row.taker.puuid} className="cn-fun-holder">
        {body}
      </GameReveal>
    </li>
  );
}

function GameReveal({
  game,
  focusPuuid,
  className,
  children,
}: {
  game: HistoryGame;
  focusPuuid: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <details className="cn-fun-game">
      <summary className={`cn-record ${className}`}>{children}</summary>
      <div className="cn-fun-sheet">
        <p className="cn-fun-sheet-head">
          {game.result} · {game.score}
        </p>
        <MatchSheet game={game} focusPuuid={focusPuuid} />
      </div>
    </details>
  );
}

function PlayerName({ player }: { player: PlayerRef }) {
  return (
    <Link className="cn-stats-name" href={`/p/${player.puuid}`}>
      {renderWebName(player.name)}
    </Link>
  );
}

/**
 * Friends and enemies (M8.1): two ranked lists in one card, enemies first.
 *
 * The shape is `Pools`': one card, a titled block per list, each row a closed `<details>` that
 * opens **See games** into the customs it was folded from — the same expander Luck uses (M5.33).
 * Neither list is hidden on ARAM: both are records over whatever the `?queue=` read returned.
 */
function Rivals({ rivals }: { rivals: FunRivalsView }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head cn-fun-head">
          <FunHead title={RIVALS_HEADING} />
        </header>
        <div className="cn-role-block">
          <FunHead title={rivals.nemesis.title} as="p" className="cn-stats-subtitle" />
          <p className="cn-stats-intro">{rivals.nemesis.intro}</p>
          {rivals.nemesis.rows.length === 0 ? (
            <p className="cn-stats-empty">{rivals.nemesis.empty}</p>
          ) : (
            <ol className="cn-fun-groups">
              {rivals.nemesis.rows.map((row) => (
                <NemesisRow key={row.player.puuid} row={row} />
              ))}
            </ol>
          )}
          <p className="cn-award-rule">{rivals.nemesis.rule}</p>
        </div>
        <div className="cn-role-block">
          <FunHead title={rivals.duos.title} as="p" className="cn-stats-subtitle" />
          <p className="cn-stats-intro">{rivals.duos.intro}</p>
          {rivals.duos.rows.length === 0 ? (
            <p className="cn-stats-empty">{rivals.duos.empty}</p>
          ) : (
            <ol className="cn-fun-groups">
              {rivals.duos.rows.map((row) => (
                <DuoRow key={`${row.players[0].puuid}|${row.players[1].puuid}`} row={row} />
              ))}
            </ol>
          )}
          <p className="cn-award-rule">{rivals.duos.rule}</p>
        </div>
      </section>
    </section>
  );
}

/**
 * `Yuki · 7 of 9 · Lost 7 of 9 to Lena.`
 *
 * The number is the nowrap cell and the sentence is the wrapping one under it — Fear Ban's
 * recipe, for Fear Ban's reason: a whole sentence in the mono column pushes the name off a
 * phone. The count carries its denominator in both, which is the point of the row.
 */
function NemesisRow({ row }: { row: FunRivalRow }) {
  return (
    <li className="cn-fun-group">
      <details className="cn-fun-game">
        <summary className="cn-record cn-fun-holder">
          <PlayerName player={row.player} />
          <span className="cn-fun-stat">
            <span className="cn-num cn-record-wl">{row.countLabel}</span>
            <span className="cn-fun-when cn-fun-fear">{row.valueLabel}</span>
            <span className="cn-fun-toggle">{SEE_GAMES}</span>
          </span>
        </summary>
        <ol className="cn-fun-openings">
          {row.openings.map((opening) => (
            <OpeningRow key={opening.game.id} opening={opening} focusPuuid={row.player.puuid} />
          ))}
        </ol>
      </details>
    </li>
  );
}

/** `Yuki and Theo · 8W 2L · 80%` — the pair line `/stats` and `Partners` already print. */
function DuoRow({ row }: { row: FunDuoRow }) {
  return (
    <li className="cn-fun-group">
      <details className="cn-fun-game">
        <summary className="cn-record cn-fun-holder">
          <span className="cn-stats-pair">{row.pairLabel}</span>
          <span className="cn-fun-stat">
            <span className="cn-num cn-record-wl">{row.valueLabel}</span>
            <span className="cn-fun-toggle">{SEE_GAMES}</span>
          </span>
        </summary>
        <ol className="cn-fun-openings">
          {row.openings.map((opening) => (
            <OpeningRow key={opening.game.id} opening={opening} focusPuuid={row.players[0].puuid} />
          ))}
        </ol>
      </details>
    </li>
  );
}
