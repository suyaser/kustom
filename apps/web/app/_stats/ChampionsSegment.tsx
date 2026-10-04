import { NO_DRAFT_BANS, seeChampsLabel } from '@/lib/stats/copy';
import { FEAR_BAN_RULE, MOST_BANNED_RULE, MOST_PICKED_RULE, POOLS_HEADING } from '@/lib/stats/funCopy';
import type { FunChampRow, FunFactsView, FunPool, FunSection } from '@/lib/stats/types';
import { cn } from '@/lib/utils';
import {
  capRows,
  Empty,
  PlayerName,
  Row,
  Rows,
  ShowAll,
  StatSection,
  type StatsLinks,
  SubBlock,
} from './parts';

/**
 * Stats → Champions (M14.17): who plays what. `/fun`'s champion half: fear bans, most banned
 * (Rift only, ARAM has no draft), most picked, and who they lock (one-trick, always a new champ).
 * Nothing here appears in Records or 1v1.
 */
export function ChampionsSegment({ fun, links }: { fun: FunFactsView; links: StatsLinks }) {
  const rift = fun.queue === 'sr';
  const fear = capRows(fun.fearBans.rows, 'fear', links);
  // A window with no draft at all (blind customs) leads with what was picked and says the bans
  // part once, in one line, instead of two empty cards (design round 1).
  const noBans = fear.total === 0 && fun.mostBanned.rows.length === 0;
  const picked = <ChampTable id="picked" section={fun.mostPicked} rule={MOST_PICKED_RULE} links={links} />;
  return (
    <>
      {noBans ? (
        <>
          {picked}
          <p className="rounded-card border border-dashed border-border-strong p-(--card-pad) text-sm text-muted-foreground">
            {NO_DRAFT_BANS}
          </p>
        </>
      ) : (
        <>
          <StatSection
            roasts={links.roasts}
            id="fear"
            title={fun.fearBans.title}
            intro={fun.fearBans.intro}
            rule={FEAR_BAN_RULE}
          >
            {fear.total === 0 ? (
              <Empty>{fun.fearBans.empty}</Empty>
            ) : (
              <Rows ordered={false}>
                {fear.shown.map((row) => (
                  <Row
                    key={row.player.puuid}
                    who={<PlayerName player={row.player} links={links} />}
                    value={`${row.rate}%`}
                    detail={row.line}
                  />
                ))}
              </Rows>
            )}
            <ShowAll listId="fear" total={fear.total} links={links} />
          </StatSection>
          {rift ? (
            <ChampTable id="banned" section={fun.mostBanned} rule={MOST_BANNED_RULE} links={links} />
          ) : null}
          {picked}
        </>
      )}
      <StatSection roasts={links.roasts} id="pools" title={POOLS_HEADING}>
        {fun.pools.map((pool) => (
          <Pool key={pool.id} pool={pool} links={links} />
        ))}
      </StatSection>
    </>
  );
}

function ChampTable({
  id,
  section,
  rule,
  links,
}: {
  id: string;
  section: FunSection<FunChampRow>;
  rule: string;
  links: StatsLinks;
}) {
  const { shown, total } = capRows(section.rows, id, links);
  return (
    <StatSection roasts={links.roasts} id={id} title={section.title} intro={section.intro} rule={rule}>
      {total === 0 ? (
        <Empty>{section.empty}</Empty>
      ) : (
        <Rows>
          {shown.map((row) => (
            <Row
              key={row.championId}
              who={<span className="font-bold">{row.champion}</span>}
              value={row.valueLabel}
            />
          ))}
        </Rows>
      )}
      <ShowAll listId={id} total={total} links={links} />
    </StatSection>
  );
}

function Pool({ pool, links }: { pool: FunPool; links: StatsLinks }) {
  const listId = `pool-${pool.id}`;
  const { shown, total } = capRows(pool.rows, listId, links);
  return (
    <SubBlock roasts={links.roasts} title={pool.title} rule={pool.rule}>
      <p className="px-(--card-pad) pb-2 text-sm text-pretty text-muted-foreground">{pool.intro}</p>
      {total === 0 ? (
        <Empty>{pool.empty}</Empty>
      ) : (
        <Rows>
          {shown.map((row) => (
            <Row key={row.puuid} who={<PlayerName player={row} links={links} />} value={row.valueLabel}>
              {row.champs.length === 0 ? null : (
                <details className="group">
                  <summary
                    className={cn(
                      'inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold [&::-webkit-details-marker]:hidden',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      'before:me-1.5 before:inline-block before:transition-transform before:content-["▸"] group-open:before:rotate-90',
                    )}
                  >
                    {seeChampsLabel(row.champs.length)}
                  </summary>
                  <ul className="flex flex-col gap-1 pb-1">
                    {row.champs.map((champ) => (
                      <li key={champ.championId} className="flex justify-between gap-3 text-sm">
                        <span>{champ.champion}</span>
                        <span className="num text-muted-foreground">{champ.valueLabel}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Row>
          ))}
        </Rows>
      )}
      <ShowAll listId={listId} total={total} links={links} />
    </SubBlock>
  );
}
