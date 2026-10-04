import type { Route } from 'next';
import { EntityLink } from '@/components/links/EntityLink';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { renderWebName } from '@/lib/tonight/copy';
import { cn } from '@/lib/utils';
import type { YouVersusRow } from '@/lib/versus/you';
import {
  AGAINST_LABEL,
  FRIEND_LABEL,
  laneLine,
  neverMet,
  record,
  WITH_LABEL,
  YOU_VS_ALL_TIME,
  YOU_VS_EMPTY,
  YOU_VS_TITLE,
  youAndThem,
} from '@/lib/versus/youCopy';

/**
 * You vs them (M14.35). Two placements of one fold (`lib/versus/you.ts`):
 *
 * - {@link YouVsThemCard}: on someone else's player page, for a linked viewer.
 * - {@link YouVsEveryone}: on `/you`, one row per person, most games first, each row a link to
 *   Stats → 1v1 → Pick two with both of you filled in.
 */

/** The card above the records on another person's page. `row` null: never played together or apart. */
export function YouVsThemCard({ name, row }: { name: string; row: YouVersusRow | null }) {
  return (
    <Card>
      <div className="flex flex-col gap-1.5 p-(--card-pad)">
        {row === null ? (
          <p className="text-base">{neverMet(name)}</p>
        ) : (
          <>
            <p className="text-md font-bold text-pretty [font-variant-numeric:tabular-nums]">
              {youAndThem(name, row.together, row.against)}
            </p>
            {row.lanes.map((lane) => (
              <p
                key={lane.role}
                className="text-sm text-muted-foreground [font-variant-numeric:tabular-nums]"
              >
                <KeepScore text={laneLine(name, lane)} />
              </p>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

/** The everyone list on `/you`. */
export function YouVsEveryone({
  rows,
  pickTwo,
}: {
  rows: readonly YouVersusRow[];
  pickTwo: (puuid: string) => Route;
}) {
  return (
    <Card>
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] pb-2">
        <CardTitle>{YOU_VS_TITLE}</CardTitle>
        <span className="text-sm text-muted-foreground">{YOU_VS_ALL_TIME}</span>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="border-t border-border px-(--card-pad) py-3 text-sm text-muted-foreground">
          {YOU_VS_EMPTY}
        </p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-t border-border px-(--card-pad) py-2 text-xs text-muted-foreground"
          >
            <span>{FRIEND_LABEL}</span>
            <span className="w-14 text-end">{WITH_LABEL}</span>
            <span className="w-14 text-end">{AGAINST_LABEL}</span>
          </div>
          <ul>
            {rows.map((row) => {
              const name = renderWebName(row.them.name);
              const first = row.lanes[0];
              return (
                <li key={row.them.puuid} className="border-t border-border">
                  <EntityLink
                    href={pickTwo(row.them.puuid)}
                    className={cn(
                      'grid min-h-(--row-min-h) grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-4 px-(--card-pad) py-3',
                      'touch-manipulation hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-bold [overflow-wrap:anywhere]">{name}</span>
                      {first === undefined ? null : (
                        <span className="text-sm text-muted-foreground">
                          <KeepScore text={laneLine(name, first)} />
                        </span>
                      )}
                    </span>
                    <span className="num w-14 text-end font-semibold whitespace-nowrap">
                      <span className="sr-only">{`${WITH_LABEL} `}</span>
                      {record(row.together)}
                    </span>
                    <span className="num w-14 text-end font-semibold whitespace-nowrap">
                      <span className="sr-only">{`, ${AGAINST_LABEL} `}</span>
                      {record(row.against)}
                    </span>
                  </EntityLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** A line ending in a score (`… leads 4–1.`) never breaks inside the score. Same text. */
function KeepScore({ text }: { text: string }) {
  const match = text.match(/^(.*?)(\d+–\d+\.)$/);
  if (match === null) return <>{text}</>;
  return (
    <>
      {match[1]}
      <span className="whitespace-nowrap">{match[2]}</span>
    </>
  );
}
