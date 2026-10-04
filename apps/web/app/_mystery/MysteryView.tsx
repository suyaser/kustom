import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { championDisplayName } from '@/lib/mystery/champion';
import { awardStatNumber, awardStatValue } from '@/lib/mystery/clues';
import {
  actualPlayerLine,
  attemptsSoFarLine,
  awardStatLabel,
  CLUE_WORD,
  categoryLabel,
  cluesUsedLine,
  cluesUsedShort,
  communityAccuracyLine,
  DAILY_NEXT,
  firstDetectiveYou,
  fooledLine,
  gameCopy,
  itWasLine,
  lockInLine,
  lockInQuestion,
  MYSTERY_BACK,
  MYSTERY_COMMUNITY,
  MYSTERY_CORRECT,
  MYSTERY_EMPTY,
  MYSTERY_FIRST,
  MYSTERY_FIRST_TAKEN,
  MYSTERY_GUESS,
  MYSTERY_LOCKED,
  MYSTERY_NEED_HELP,
  MYSTERY_NO_STAT,
  MYSTERY_REVEAL,
  MYSTERY_REVEAL_FIRST,
  MYSTERY_SHARE,
  MYSTERY_SHARE_DONE,
  MYSTERY_SHARE_MANUAL,
  MYSTERY_SHARE_TITLE,
  MYSTERY_TITLE,
  MYSTERY_WHO,
  MYSTERY_WRONG,
  MYSTERY_YOUR_RESULT,
  mostAccusedLine,
  mysterySomeoneLine,
  notAloneWrong,
  percentileLabel,
  shareMissed,
  shareSolved,
  solvedInLine,
  youGuessedLine,
  yourGuessLine,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import type {
  AwardCategory,
  MysteryPerformance,
  MysteryPlayView,
  MysteryResultView,
  MysterySuspect,
} from '@/lib/mystery/types';
import { AWARD_CATEGORIES } from '@/lib/mystery/types';
import { cn } from '@/lib/utils';

/**
 * The daily game's card (M5.32, M8.4; rebuilt for Kustom 2.0 by M14.38). A pure function of one
 * page state, so play / closed / empty are component tests rather than a day of waiting.
 *
 * **One card, two games.** Daily Mystery and Guess the Award share this component; the sentences
 * that differ come from `gameCopy(kind)`. Community numbers, the answer and the guess
 * distribution are only in the closed state's props, so the play screen cannot leak them.
 *
 * 2.0 (docs/05-design.md): Slate tokens, no panel glow. The answer options are neutral `--raised`
 * rows; amber marks only the one you picked and the one primary action on screen (Lock in, then
 * Copy result). Labels are sentence case, numbers mono, the K / D / A in mono at the card's display
 * size. The share text is shown, not hidden behind the button, so the Discord paste is visible.
 */

/** The visible share text's id: `MysteryLive` selects it when the clipboard refuses. */
export const SHARE_TEXT_ID = 'daily-share-text';

export interface MysteryViewProps {
  state: MysteryPageState;
  /** Play-mode only. */
  pendingId?: string | null;
  locking?: MysterySuspect | null;
  revealing?: boolean;
  submitting?: boolean;
  shareCopied?: boolean;
  /** The clipboard refused: say so, and the share text is selected for a manual copy. */
  shareFailed?: boolean;
  error?: string | null;
  now?: Date;
  onSelect?: (suspect: MysterySuspect) => void;
  onCancelLock?: () => void;
  onConfirmLock?: () => void;
  onReveal?: () => void;
  onShare?: () => void;
}

export function MysteryView({
  state,
  pendingId = null,
  locking = null,
  revealing = false,
  submitting = false,
  shareCopied = false,
  shareFailed = false,
  error = null,
  now = new Date(),
  onSelect,
  onCancelLock,
  onConfirmLock,
  onReveal,
  onShare,
}: MysteryViewProps) {
  if (state.kind === 'empty') {
    return (
      <Card label={MYSTERY_TITLE}>
        <div className="flex flex-col gap-3 rounded-card border border-dashed border-border-strong p-(--card-pad)">
          <p className="text-base text-pretty">{MYSTERY_EMPTY}</p>
        </div>
        <Countdown expiresAt={state.empty.expiresAt} now={now} />
      </Card>
    );
  }

  if (state.kind === 'closed') {
    return (
      <ClosedCase
        result={state.result}
        shareCopied={shareCopied}
        shareFailed={shareFailed}
        now={now}
        {...(onShare === undefined ? {} : { onShare })}
      />
    );
  }

  return (
    <PlayCase
      play={state.play}
      pendingId={pendingId}
      locking={locking}
      revealing={revealing}
      submitting={submitting}
      error={error}
      {...(onSelect === undefined ? {} : { onSelect })}
      {...(onCancelLock === undefined ? {} : { onCancelLock })}
      {...(onConfirmLock === undefined ? {} : { onConfirmLock })}
      {...(onReveal === undefined ? {} : { onReveal })}
    />
  );
}

/**
 * The card under the page's h1 (which names today's game): the challenge number as a small mono
 * eyebrow (`#41`) and the card's own h2. The empty card has neither: the h1 already says it.
 */
function Card({
  number,
  title,
  label,
  children,
}: {
  number?: number | undefined;
  title?: string | undefined;
  /** The section's accessible name when it has no h2. */
  label?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      {...(title === undefined ? { 'aria-label': label } : { 'aria-labelledby': 'daily-title' })}
      className="flex flex-col gap-4 rounded-card border border-border bg-card p-(--card-pad)"
    >
      {title === undefined ? null : (
        <header className="flex flex-col gap-0.5">
          {number === undefined ? null : <p className="num text-xs text-muted-foreground">#{number}</p>}
          <h2 id="daily-title" className="text-lg leading-tight font-bold text-balance">
            {title}
          </h2>
        </header>
      )}
      {children}
    </section>
  );
}

/** A clue's value: numbers in mono, a champion by its display name. */
function clueValue(type: string, value: string): { value: string; mono: boolean } {
  if (type === 'champion') return { value: championDisplayName(value), mono: false };
  return { value, mono: /^[\d.,:%+−-]+\s?(k|min|%)?$/i.test(value.trim()) };
}

/** `100%`, `66.7%`: one decimal only when it says something. */
function percentText(percent: number): string {
  return `${Number(percent.toFixed(1))}%`;
}

/**
 * The closed card's numbers, two to a row (label over value), so the whole case file fits a phone
 * screen or two instead of four (M14.38: about 1,000px at 375).
 */
interface TileRow {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** A muted line under the value (the Game tile's date). */
  sub?: string;
}

function Tiles({ rows }: { rows: readonly TileRow[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground [overflow-wrap:break-word]">{row.label}</dt>
          <dd className={cn('text-sm font-bold [overflow-wrap:break-word]', row.mono !== false && 'num')}>
            {row.value}
          </dd>
          {row.sub === undefined ? null : <dd className="text-xs text-muted-foreground">{row.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Label left, value right, hairline-divided: the hook and the clues. */
function Facts({ rows }: { rows: readonly { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="divide-y divide-border rounded-control border border-border">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className={cn('text-end text-sm', row.mono !== false && 'num')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-md leading-tight font-bold">{children}</h3>;
}

function PlayCase({
  play,
  pendingId,
  locking,
  revealing,
  submitting,
  error,
  onSelect,
  onCancelLock,
  onConfirmLock,
  onReveal,
}: {
  play: MysteryPlayView;
  pendingId: string | null;
  locking: MysterySuspect | null;
  revealing: boolean;
  submitting: boolean;
  error: string | null;
  onSelect?: (suspect: MysterySuspect) => void;
  onCancelLock?: () => void;
  onConfirmLock?: () => void;
  onReveal?: () => void;
}) {
  const moreClues = play.cluesRevealed < play.clueCount;
  const copy = gameCopy(play.kind);

  return (
    <Card number={play.challengeNumber} title={categoryLabel(play.category)}>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-bold text-muted-foreground">{copy.kicker}</p>
        <p className="text-sm text-muted-foreground">{mysterySomeoneLine()}</p>
        <p className="num text-xl leading-tight font-bold tracking-tight">{play.hook.kda}</p>
      </div>
      <Facts rows={play.hook.lines.map((line) => ({ label: line.label, value: line.value }))} />

      {play.revealedClues.length > 0 ? (
        <Facts
          rows={play.revealedClues.map((clue) => ({
            label: `${CLUE_WORD} ${clue.order} · ${clue.label}`,
            ...clueValue(clue.type, clue.value),
          }))}
        />
      ) : null}

      <SubTitle>{MYSTERY_WHO}</SubTitle>
      {locking === null ? (
        <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {play.suspects.map((suspect) => {
            const on = pendingId === suspect.playerId;
            return (
              <li key={suspect.playerId}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect?.(suspect)}
                  className={cn(
                    'flex min-h-11 w-full cursor-pointer items-center rounded-control border border-border-strong bg-raised px-3 py-2 text-start text-base font-bold text-foreground [overflow-wrap:break-word]',
                    'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:border-muted-foreground active:scale-[.98]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on && 'border-primary-text outline-2 -outline-offset-2 outline-primary-text',
                  )}
                >
                  {suspect.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-2">
          {/* A question until it is confirmed; `Locked in` is the closed card's word (design). */}
          <p className="text-sm text-muted-foreground [overflow-wrap:break-word]">
            {lockInQuestion(locking.name)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              aria-disabled={submitting}
              onClick={submitting ? undefined : onConfirmLock}
              title={lockInLine(locking.name)}
              className="w-full max-w-full min-[480px]:w-auto"
            >
              <span className="min-w-0 truncate">{lockInLine(locking.name)}</span>
            </Button>
            <Button type="button" variant="secondary" aria-disabled={submitting} onClick={onCancelLock}>
              {MYSTERY_BACK}
            </Button>
          </div>
        </div>
      )}

      {moreClues && locking === null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{MYSTERY_NEED_HELP}</p>
          <Button
            type="button"
            variant="secondary"
            aria-disabled={revealing}
            onClick={revealing ? undefined : onReveal}
          >
            {play.cluesRevealed === 0 ? MYSTERY_REVEAL_FIRST : MYSTERY_REVEAL}
          </Button>
        </div>
      ) : null}

      {locking === null && !moreClues ? (
        <p className="text-sm text-muted-foreground">{MYSTERY_GUESS}</p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

function ClosedCase({
  result,
  shareCopied,
  shareFailed,
  now,
  onShare,
}: {
  result: MysteryResultView;
  shareCopied: boolean;
  shareFailed: boolean;
  now: Date;
  onShare?: () => void;
}) {
  const { personal, community, performance } = result;
  const copy = gameCopy(result.kind);
  const award = awardStatRow(result.kind, result.category, performance);
  const share = personal.correct
    ? shareSolved(result.kind, result.challengeNumber, personal.cluesUsed, personal.percentile)
    : shareMissed(result.kind, result.challengeNumber);

  const caseFile: TileRow[] = [];
  if (award !== null) {
    caseFile.push({
      label: award.label,
      value: award.value ?? MYSTERY_NO_STAT,
      mono: award.value !== null,
    });
  }
  if (performance.champion !== null)
    caseFile.push({ label: 'Champion', value: championDisplayName(performance.champion), mono: false });
  if (performance.role !== null) caseFile.push({ label: 'Role', value: performance.role });
  // The award's own row already printed this number under this label.
  if (award?.category !== 'damage') caseFile.push({ label: 'Damage', value: performance.damageLabel });
  if (award?.category !== 'cs') caseFile.push({ label: 'CS', value: String(performance.cs) });
  caseFile.push({
    label: 'Game',
    value: performance.durationLabel,
    ...(performance.startedLabel === '' ? {} : { sub: performance.startedLabel }),
  });
  caseFile.push({ label: 'Result', value: performance.won ? 'Won' : 'Lost', mono: false });

  return (
    <Card number={result.challengeNumber} title={personal.correct ? MYSTERY_CORRECT : MYSTERY_WRONG}>
      {/* What today asked, what became of it, and that your answer is in. */}
      <p className="text-xs font-bold text-muted-foreground">
        <span>{categoryLabel(result.category)}</span> · <span>{copy.closedKicker}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        <span>{copy.todayClosed}</span>. <span>{MYSTERY_LOCKED}</span>.
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-xl leading-tight font-bold text-balance [overflow-wrap:break-word]">
          {itWasLine(personal.actualName)}
        </p>
        {personal.correct ? null : <p className="text-sm">{youGuessedLine(personal.guessedName)}</p>}
        <p className="text-sm text-muted-foreground">
          {personal.correct
            ? cluesUsedLine(personal.cluesUsed)
            : notAloneWrong(Math.max(0, community.wrong - 1))}
        </p>
        {personal.correct ? null : (
          <p className="text-sm text-muted-foreground">{fooledLine(community.wrongPercent)}</p>
        )}
      </div>

      {personal.firstDetective || personal.percentile !== null || community.firstDetectiveClaimed ? (
        <div className="flex flex-wrap items-center gap-2">
          {personal.firstDetective ? (
            <p className="text-sm">
              <Chip variant="you" className="me-2 -rotate-2">
                {MYSTERY_FIRST}
              </Chip>
              {firstDetectiveYou(result.kind)}
            </p>
          ) : community.firstDetectiveClaimed ? (
            <p className="text-sm text-muted-foreground">{MYSTERY_FIRST_TAKEN}</p>
          ) : null}
          {personal.percentile === null ? null : <Chip>{percentileLabel(personal.percentile)}</Chip>}
        </div>
      ) : null}

      <section className="flex flex-col gap-2" aria-label={MYSTERY_YOUR_RESULT}>
        <SubTitle>{MYSTERY_YOUR_RESULT}</SubTitle>
        <Tiles
          rows={[
            { label: 'Clues used', value: cluesUsedShort(personal.cluesUsed) },
            { label: 'Solved in', value: solvedInLine(personal.completionTimeMs) },
            {
              label: yourGuessLine(personal.guessedName),
              value: personal.correct ? 'Yes' : actualPlayerLine(personal.actualName),
              mono: false,
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-2" aria-label={performance.kda}>
        <h3 className="num text-xl leading-tight font-bold tracking-tight">{performance.kda}</h3>
        <Tiles rows={caseFile} />
      </section>

      {/* The Discord paste, visible (M14.38): what Copy result puts on the clipboard. */}
      <section
        className="flex flex-col gap-2 rounded-control border border-border bg-background p-3"
        aria-label={MYSTERY_SHARE_TITLE}
      >
        <p className="text-xs font-bold text-muted-foreground">{MYSTERY_SHARE_TITLE}</p>
        <p id={SHARE_TEXT_ID} className="text-sm text-pretty select-all">
          {share}
        </p>
        <Button type="button" onClick={onShare} className="w-full sm:w-fit">
          {shareCopied ? MYSTERY_SHARE_DONE : MYSTERY_SHARE}
        </Button>
        <p role="status" className="text-xs text-muted-foreground empty:hidden">
          {shareCopied ? MYSTERY_SHARE_DONE : shareFailed ? MYSTERY_SHARE_MANUAL : ''}
        </p>
      </section>

      {/* Everyone else's numbers: one tap away, so the card stays about a screen (M14.38). */}
      <details className="group rounded-control border border-border-strong">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-md font-bold [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <h3>{MYSTERY_COMMUNITY}</h3>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <Tiles
            rows={[
              { label: 'Attempts', value: attemptsSoFarLine(community.attempts), mono: false },
              { label: MYSTERY_CORRECT, value: String(community.correct) },
              { label: MYSTERY_WRONG, value: String(community.wrong) },
              { label: 'Accuracy', value: percentText(community.accuracyPercent) },
            ]}
          />
          <p className="text-xs text-muted-foreground">{communityAccuracyLine(community.accuracyPercent)}</p>
          <h4 className="text-sm font-bold">{copy.blame}</h4>
          <ul className="flex flex-col gap-1.5">
            {community.distribution.map((row) => (
              <li
                key={row.playerId}
                className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-2"
              >
                <span className="text-sm [overflow-wrap:break-word]">{row.name}</span>
                <span
                  aria-hidden="true"
                  className="relative h-2.5 overflow-hidden rounded-[3px] border border-border bg-raised"
                >
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0',
                      row.playerId === personal.actualPlayerId ? 'bg-foreground' : 'bg-muted-foreground',
                    )}
                    style={{ width: `${row.percent}%` }}
                  />
                </span>
                <span className="num text-end text-sm">{row.percent}%</span>
              </li>
            ))}
          </ul>
          {community.mostFalselyAccused === null ? null : (
            <p className="text-sm text-muted-foreground">
              {mostAccusedLine(result.kind, community.mostFalselyAccused.name)}
            </p>
          )}
        </div>
      </details>

      <Countdown expiresAt={result.expiresAt} now={now} />
    </Card>
  );
}

/**
 * The award's own number, off the reveal's scoreboard and under the same label the hook used
 * (M8.4 fix pass). `null` on a mystery day; `Not recorded` rather than a 0 when the column behind
 * the award predates migrations 0014 / 0015.
 */
function awardStatRow(
  kind: MysteryResultView['kind'],
  category: MysteryResultView['category'],
  performance: MysteryPerformance,
): { category: AwardCategory; label: string; value: string | null } | null {
  if (kind !== 'award') return null;
  const award = AWARD_CATEGORIES.find((known) => known === category);
  if (award === undefined) return null;
  const raw = awardStatNumber(performance, award);
  return {
    category: award,
    label: awardStatLabel(award),
    value: raw === null ? null : awardStatValue(award, raw),
  };
}

/** The clock to civil midnight, when the next game starts. Its label names neither game. */
function Countdown({ expiresAt, now }: { expiresAt: string; now: Date }) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now.getTime());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    <p className="flex items-baseline justify-between gap-3 border-t border-border pt-3 text-sm">
      <span className="text-muted-foreground">{DAILY_NEXT}</span>
      <span className="num">
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
    </p>
  );
}
