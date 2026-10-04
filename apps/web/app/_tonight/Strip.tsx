import type { RoleValue } from '@customs/db';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/chip';
import { PLAYERS_PER_GAME } from '@/lib/lobbyRules';
import { formatWebDelta } from '@/lib/ratingDisplay';
import { renderWebName } from '@/lib/tonight/copy';
import {
  ANSWER_IN_LOBBY,
  ANSWER_MAIN_ROLE,
  ANSWER_ON,
  answerResult,
  answerRole,
  NAME_ROW_BLUE,
  NAME_ROW_RED,
  YOU_TAG,
} from '@/lib/tonight/screenCopy';
import type { PlayerName } from '@/lib/tonight/types';
import { cn } from '@/lib/utils';
import { LiveTag } from './LiveTag';

/**
 * The status strip (05-design.md 5.10): the one element on Tonight that survives every state.
 *
 * Line 1 is the live tag (5.4) and the night; then the state headline, which **is the page's h1**
 * (`TEAMS ARE SET`, `6 IN THE LOBBY`, `RED WINS`), in the display cut, always foreground; then the
 * sub-line with two lines reserved so a count change moves nothing below; then, while filling, the
 * ten-cell meter; and last the answer band when the viewer is known and in it.
 */
export type AnswerBand =
  | {
      kind: 'seated';
      side: 'blue' | 'red';
      role: RoleValue;
      /** M14.30, Fearless: `What's open for <role>`, one tap into the panel on the viewer's lane. */
      jump?: { href: Route; label: string; id: string } | undefined;
    }
  | { kind: 'lobby'; mainRole: RoleValue | null }
  /** Finished: `YOU on RED · won · +41` (designer round 1), so nobody hunts for their seat. */
  | { kind: 'result'; side: 'blue' | 'red'; won: boolean; delta: number | null }
  | null;

export interface StripProps {
  dateLine: string;
  headline: string;
  /** `6` in `6 IN THE LOBBY`, set in the same display cut. */
  count: number | null;
  sub: ReactNode;
  lobbyLive: boolean;
  /** Filling: how many of the ten seats are taken, for the meter. */
  meter: number | null;
  answer: AnswerBand;
  /**
   * M14.41 (scene-walk gap 3): balanced and in game, for a viewer with no seated answer band
   * (signed out, unlinked, sitting out), the ten names by side, in lane order, so every phone
   * finds its side on the first screen. The full team cards stay below the receipt.
   */
  names?: NameStripTeams | null | undefined;
  /**
   * M14.41 (scene-walk gap 2): the night's one deliberate press for this viewer (`Roll teams`,
   * `Reroll`, `Start a lobby`), as the strip's last row, so it is on the first screen at 375.
   */
  action?: ReactNode;
  /**
   * M15.5 (design round 2): finished, the poster's rule line (`Tanks only: Blue kept the rule.
   * Red: Jinx isn't a tank.`), its own row inside the poster, before the viewer's answer row.
   */
  ruleLine?: string | null | undefined;
}

export interface NameStripTeams {
  blue: readonly PlayerName[];
  red: readonly PlayerName[];
}

export function Strip({
  dateLine,
  headline,
  count,
  sub,
  lobbyLive,
  meter,
  answer,
  names,
  action,
  ruleLine,
}: StripProps) {
  return (
    <header className="overflow-hidden rounded-card border border-border bg-card">
      <div className={cn('px-(--card-pad) pt-(--card-pad)', names == null ? 'pb-4' : 'pb-3')}>
        {/* M14.45: the line is the tag's height with or without the tag, so the tag leaving (or
            changing from `Connecting…` to `Live`) never moves the page under it. */}
        <p className="flex min-h-(--chip-h) flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <LiveTag lobbyLive={lobbyLive} />
          <span>{dateLine}</span>
        </p>
        <h1 className="mt-2 font-display text-display font-black tracking-[-0.01em] text-balance uppercase font-stretch-62%">
          {count === null ? headline : `${count} ${headline}`}
        </h1>
        <p className="mt-2 min-h-[2.9em] text-sm text-muted-foreground">{sub}</p>
        {meter === null ? null : <Meter filled={meter} />}
      </div>
      {names == null ? null : <NameStrip teams={names} />}
      {ruleLine == null ? null : (
        <p
          data-slot="rule-line"
          className="border-t border-border px-(--card-pad) py-3 text-[0.9375rem] font-bold"
        >
          {ruleLine}
        </p>
      )}
      {answer === null ? null : <Answer answer={answer} />}
      {action === undefined || action === null ? null : (
        <div data-slot="strip-action" className="border-t border-border px-(--card-pad) py-3">
          {action}
        </div>
      )}
    </header>
  );
}

/**
 * One row per side: `BLUE` / `RED` as the side pill (glyph + word on the solid fill, 3.3), then
 * the five names in lane order as a wrapping line, spaced by a gap rather than a `·` glyph so no
 * dot dangles at a line end (design round 1). Labelled `Blue side` / `Red side`, not the team cards'
 * `Blue team`, so a screen reader hears two different things.
 * Rows, not two columns: at 375 a column is ~150px and a 16-character all-caps name broke
 * mid-word; a row gives each name ~230px, so names wrap between words, never truncate (6.14).
 * Plain text: the team cards below are where each name links to its player page.
 */
function NameStrip({ teams }: { teams: NameStripTeams }) {
  return (
    <div data-slot="name-strip" className="flex flex-col gap-2 border-t border-border px-(--card-pad) py-3">
      {(['blue', 'red'] as const).map((side) => {
        const names = side === 'blue' ? teams.blue : teams.red;
        return (
          <div key={side} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5">
            <Chip variant="side" side={side} aria-hidden="true" className="mt-px" />
            <ul
              aria-label={side === 'blue' ? NAME_ROW_BLUE : NAME_ROW_RED}
              className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5"
            >
              {names.map((name, index) => (
                <li
                  // Seats in lane order; a name can repeat (`Someone`), the position cannot.
                  // biome-ignore lint/suspicious/noArrayIndexKey: five fixed lane positions
                  key={index}
                  className="min-w-0 text-sm leading-snug font-semibold [overflow-wrap:anywhere]"
                >
                  {renderWebName(name)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Ten cells: filled ones solid foreground, empty ones dashed (5.15). The count is in the h1. */
function Meter({ filled }: { filled: number }) {
  return (
    <div aria-hidden="true" data-slot="meter" className="mt-3 grid grid-cols-10 gap-1">
      {Array.from({ length: PLAYERS_PER_GAME }, (_, index) => (
        <span
          // Positional cells that never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: the ten cells are positions, not items
          key={index}
          className={cn(
            'h-2.5 rounded-[3px]',
            index < filled ? 'bg-foreground' : 'border border-dashed border-border-strong',
          )}
        />
      ))}
    </div>
  );
}

function Answer({ answer }: { answer: NonNullable<AnswerBand> }) {
  // Inline flow, not flex: the words wrap like a sentence and the chips ride along on the line.
  return (
    <p
      data-slot="answer-band"
      className="border-t border-border bg-raised px-(--card-pad) py-3 text-md leading-[2] font-semibold"
    >
      <Chip variant="you" className="mr-2 inline-flex -rotate-2 align-middle">
        {YOU_TAG}
      </Chip>
      {answer.kind === 'seated' ? (
        <>
          {`${ANSWER_ON} `}
          <Chip variant="side" side={answer.side} className="inline-flex align-middle" />
          {answerRole(answer.role)}
          {answer.jump === undefined ? null : (
            <>
              {' '}
              <Link
                prefetch="auto"
                // Intent on it preloads the panel's sprite sheets (M14.45, `SpriteIntent` in the Mode card).
                data-warm-sprites=""
                id={answer.jump.id}
                href={answer.jump.href}
                scroll={false}
                className="inline-flex min-h-11 items-center align-middle text-sm font-bold text-primary-text underline underline-offset-3"
              >
                {answer.jump.label}
              </Link>
            </>
          )}
        </>
      ) : answer.kind === 'result' ? (
        <>
          {`${ANSWER_ON} `}
          <Chip variant="side" side={answer.side} className="inline-flex align-middle" />
          {answerResult(answer.won)}
          {answer.delta === null ? null : (
            <>
              {' · '}
              <span className="num">{formatWebDelta(answer.delta)}</span>
            </>
          )}
        </>
      ) : (
        <>
          {ANSWER_IN_LOBBY}
          {answer.mainRole === null ? null : (
            <>
              {/* M14.45: `YOU in the lobby · support`, one line at 375; `main role` is said, not shown. */}
              {' · '}
              <span className="whitespace-nowrap">
                <span className="sr-only">{`${ANSWER_MAIN_ROLE} `}</span>
                {answer.mainRole}
              </span>
            </>
          )}
        </>
      )}
    </p>
  );
}
