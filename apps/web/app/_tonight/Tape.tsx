import type { Mode } from '@customs/core';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { EntityLink } from '@/components/links/EntityLink';
import { CompactReceipt } from '@/components/receipt';
import { Chip } from '@/components/ui/chip';
import { SideGlyph } from '@/components/ui/side-glyph';
import { voidedNote } from '@/lib/games/copy';
import { formatMinutes } from '@/lib/games/duration';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { ruleRowNote } from '@/lib/mode/rowNote';
import { groupHref } from '@/lib/nav';
import { renderWebName, TAPE_NOT_RATED, tapeSatOut } from '@/lib/tonight/copy';
import {
  MVP_TAG,
  showEarlierGames,
  TAPE_NO_RESULT,
  TAPE_TITLE,
  tapeEarlier,
  tapeGame,
  tapePlayed,
} from '@/lib/tonight/screenCopy';
import type { TapeEntry } from '@/lib/tonight/types';
import { cn } from '@/lib/utils';

/** Tiles shown before `Show N earlier games` (STRATEGY §6(a), long nights). */
export const TAPE_VISIBLE = 3;

/**
 * Tonight's earlier games (M11.2; 05-design.md 5.15 "Tape tile"), newest first. Each tile is one
 * link to the game's page: the side block (word + glyph, red hatched), `Game 3`, the minutes, the
 * compact receipt line (`Blue was 53%. Red won.`, `Upset`, `pick #2`) and the MVP. After three, the
 * older ones fold into a native `<details>` (`Show 4 earlier games`), so a long night does not push
 * everything else down and the fold works with no JavaScript. Absent when there is nothing behind
 * the current game.
 */
export function Tape({
  tape,
  group,
  after = false,
  labelOf,
}: {
  tape: readonly TapeEntry[];
  group: PageGroup;
  /** A lobby is on the page, so the tape is what came before it: `1 earlier`, not `1 played`. */
  after?: boolean | undefined;
  /** M22.6 (14.6): on a night two lobbies overlapped, each tile's lobby label (its own line). */
  labelOf?: ((entry: TapeEntry) => string | null) | undefined;
}) {
  const titleId = useId();
  if (tape.length === 0) return null;

  const numbered = tape.map((entry, index) => ({ entry, number: index + 1 })).reverse();
  const shown = numbered.slice(0, TAPE_VISIBLE);
  const earlier = numbered.slice(TAPE_VISIBLE);
  const played = tape.filter((entry) => entry.result !== null).length;

  return (
    <section aria-labelledby={titleId} className="rounded-card border border-border bg-card p-(--card-pad)">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-md font-bold">
          {TAPE_TITLE}
        </h2>
        <span className="text-xs text-muted-foreground">
          {after ? tapeEarlier(played) : tapePlayed(played)}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {shown.map(({ entry, number }) => (
          <Tile
            key={entry.lobbyId}
            entry={entry}
            number={number}
            group={group}
            label={labelOf?.(entry) ?? null}
          />
        ))}
      </ol>
      {earlier.length === 0 ? null : (
        <details className="group mt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-bold text-primary-text underline underline-offset-3 [&::-webkit-details-marker]:hidden">
            {showEarlierGames(earlier.length)}
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {earlier.map(({ entry, number }) => (
              <Tile
                key={entry.lobbyId}
                entry={entry}
                number={number}
                group={group}
                label={labelOf?.(entry) ?? null}
              />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function Tile({
  entry,
  number,
  group,
  label,
}: {
  entry: TapeEntry;
  number: number;
  group: PageGroup;
  label: string | null;
}) {
  const result = entry.result;
  const side = result === null ? null : result.winningSide === 100 ? 'blue' : 'red';
  const href = result === null ? null : groupHref(group, { page: 'game', gameId: result.gameId });
  const satOut = tapeSatOut(entry.sitters);

  const body: ReactNode = (
    <>
      <span
        data-side-fill={side ?? undefined}
        className={cn(
          'flex w-[54px] shrink-0 flex-col items-center justify-center gap-1 self-stretch rounded-l-control font-display text-sm font-black tracking-[0.04em] font-stretch-70%',
          side === 'blue' && 'bg-team-blue text-on-team',
          side === 'red' && 'bg-team-red bg-(image:--hatch) text-on-team',
          side === null && 'border-r border-border text-muted-foreground',
        )}
      >
        {side === null ? null : (
          <>
            <SideGlyph side={side} />
            {side.toUpperCase()}
          </>
        )}
      </span>
      <span className="min-w-0 flex-1 py-2 pr-3 pl-3">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-bold">{tapeGame(number)}</span>
          {result === null ? null : (
            <span className="num text-sm text-muted-foreground font-stretch-85%">
              {formatMinutes(result.durationS)}
            </span>
          )}
        </span>
        {label === null ? null : (
          <span data-slot="tape-lobby" className="block text-xs text-muted-foreground">
            <span className="sr-only">, </span>
            {label}
          </span>
        )}
        {result === null ? (
          <span className="block text-sm text-muted-foreground">{TAPE_NO_RESULT}</span>
        ) : (
          <>
            {entry.blueWinProb === null ? null : (
              <CompactReceipt
                winner={result.winningSide}
                blueWinProb={entry.blueWinProb}
                rank={entry.rank ?? undefined}
                aram={result.aram}
              />
            )}
            {result.aram ? null : (
              <TileNote
                rated={result.rated}
                rule={result.rule ?? null}
                voidReason={result.voidReason ?? null}
              />
            )}
            {result.mvp === null ? null : (
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-bold">
                <MvpSticker />
                <span className="[overflow-wrap:anywhere]">{renderWebName(result.mvp)}</span>
              </span>
            )}
          </>
        )}
        {satOut === null ? null : <span className="mt-1 block text-xs text-muted-foreground">{satOut}</span>}
      </span>
    </>
  );

  return (
    <li>
      {href === null ? (
        <div className="flex min-h-11 rounded-control border border-border bg-raised">{body}</div>
      ) : (
        <EntityLink
          href={href}
          className="flex min-h-11 rounded-control border border-border bg-raised hover:border-border-strong"
        >
          {body}
        </EntityLink>
      )}
    </li>
  );
}

/**
 * Under the receipt line: the rule's name (M15.19, `Tanks only · not rated`, `Mirror match`), else
 * `not rated` for a Rift game no Rating moved on, else nothing. ARAM says so in its own chip.
 * M23.2: a voided game says why first, as its Games row does (`Not rated · ended early`).
 */
function TileNote({
  rated,
  rule,
  voidReason,
}: {
  rated: boolean;
  rule: Mode | null;
  voidReason: string | null;
}) {
  const note = voidedNote(voidReason) ?? ruleRowNote(rule, rated) ?? (rated ? null : TAPE_NOT_RATED);
  return note === null ? null : <span className="block text-xs text-muted-foreground">{note}</span>;
}

/** The MVP sticker (5.0 Chip `mvp`): foreground fill, card text, never amber. */
export function MvpSticker({ label = MVP_TAG }: { label?: string }) {
  return (
    <Chip className="min-h-6 border-transparent bg-foreground px-1.5 py-0 text-2xs font-bold tracking-[0.06em] text-card">
      {label}
    </Chip>
  );
}
