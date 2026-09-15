import {
  actualPlayerLine,
  attemptsSoFarLine,
  categoryLabel,
  challengeHeading,
  cluesUsedLine,
  cluesUsedShort,
  communityAccuracyLine,
  firstDetectiveYou,
  fooledLine,
  itWasLine,
  lockInLine,
  MYSTERY_BLAME,
  MYSTERY_CASE_CLOSED,
  MYSTERY_COMMUNITY,
  MYSTERY_CORRECT,
  MYSTERY_CRIME,
  MYSTERY_EMPTY,
  MYSTERY_FIRST,
  MYSTERY_FIRST_TAKEN,
  MYSTERY_GUESS,
  MYSTERY_LOCKED,
  MYSTERY_NEED_HELP,
  MYSTERY_NEXT,
  MYSTERY_REVEAL,
  MYSTERY_REVEAL_FIRST,
  MYSTERY_SHARE,
  MYSTERY_SHARE_DONE,
  MYSTERY_TITLE,
  MYSTERY_TODAY_CLOSED,
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
import type { MysteryPlayView, MysteryResultView, MysterySuspect } from '@/lib/mystery/types';

/**
 * Daily Mystery markup (M5.32). A pure function of one page state so the play / closed /
 * empty screens are component tests rather than a day of waiting.
 *
 * Community numbers, the answer, and guess distribution are only rendered on a closed
 * case. The play screen cannot leak them because they are not in the props.
 */

export interface MysteryViewProps {
  state: MysteryPageState;
  /** Play-mode only. */
  pendingId?: string | null;
  locking?: MysterySuspect | null;
  revealing?: boolean;
  submitting?: boolean;
  shareCopied?: boolean;
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
      <section className="cn-card cn-mystery" aria-labelledby="cn-mystery-title">
        <header className="cn-mystery-head">
          <p className="cn-num cn-slug">{MYSTERY_TITLE}</p>
          <h2 id="cn-mystery-title" className="cn-display cn-mystery-title">
            {MYSTERY_TITLE}
          </h2>
        </header>
        <p className="cn-mystery-copy">{MYSTERY_EMPTY}</p>
        <Countdown expiresAt={state.empty.expiresAt} now={now} />
      </section>
    );
  }

  if (state.kind === 'closed') {
    return (
      <ClosedCase
        result={state.result}
        shareCopied={shareCopied}
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

  return (
    <section className="cn-card cn-mystery" aria-labelledby="cn-mystery-title">
      <header className="cn-mystery-head">
        <p className="cn-num cn-slug">{challengeHeading(play.kind, play.challengeNumber)}</p>
        <h2 id="cn-mystery-title" className="cn-display cn-mystery-title">
          {categoryLabel(play.category)}
        </h2>
      </header>

      <p className="cn-mystery-kicker">{MYSTERY_CRIME}</p>
      <p className="cn-mystery-copy">{mysterySomeoneLine()}</p>
      <p className="cn-display cn-mystery-kda">{play.hook.kda}</p>
      <ul className="cn-mystery-hooks">
        {play.hook.lines.map((line) => (
          <li key={line.label}>
            <span className="cn-mystery-hook-label">{line.label}</span>
            <span className="cn-num">{line.value}</span>
          </li>
        ))}
      </ul>

      {play.revealedClues.length > 0 ? (
        <ol className="cn-mystery-clues">
          {play.revealedClues.map((clue) => (
            <li key={clue.order}>
              <span className="cn-mystery-hook-label">
                Clue {clue.order} · {clue.label}
              </span>
              <span>{clue.value}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <h3 className="cn-mystery-who">{MYSTERY_WHO}</h3>
      {locking === null ? (
        <ul className="cn-mystery-suspects">
          {play.suspects.map((suspect) => (
            <li key={suspect.playerId}>
              <button
                type="button"
                className={
                  pendingId === suspect.playerId
                    ? 'cn-button cn-mystery-suspect cn-mystery-suspect-on'
                    : 'cn-button cn-mystery-suspect'
                }
                onClick={() => onSelect?.(suspect)}
              >
                {suspect.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="cn-mystery-lock">
          <p className="cn-mystery-copy">
            {MYSTERY_LOCKED}. {lockInLine(locking.name)}
          </p>
          <button type="button" className="cn-button" disabled={submitting} onClick={onConfirmLock}>
            {lockInLine(locking.name)}
          </button>
          <button
            type="button"
            className="cn-button cn-button-quiet"
            disabled={submitting}
            onClick={onCancelLock}
          >
            Back
          </button>
        </div>
      )}

      {moreClues && locking === null ? (
        <div className="cn-mystery-help">
          <p className="cn-mystery-hook-label">{MYSTERY_NEED_HELP}</p>
          <button type="button" className="cn-button" disabled={revealing} onClick={onReveal}>
            {play.cluesRevealed === 0 ? MYSTERY_REVEAL_FIRST : MYSTERY_REVEAL}
          </button>
        </div>
      ) : null}

      {locking === null && !moreClues ? <p className="cn-hint">{MYSTERY_GUESS}</p> : null}
      {error === null ? null : <p className="cn-notice">{error}</p>}
    </section>
  );
}

function ClosedCase({
  result,
  shareCopied,
  now,
  onShare,
}: {
  result: MysteryResultView;
  shareCopied: boolean;
  now: Date;
  onShare?: () => void;
}) {
  const { personal, community, performance } = result;

  return (
    <section className="cn-card cn-mystery cn-mystery-closed" aria-labelledby="cn-mystery-title">
      <header className="cn-mystery-head">
        <p className="cn-num cn-slug">{challengeHeading(result.kind, result.challengeNumber)}</p>
        <h2 id="cn-mystery-title" className="cn-display cn-mystery-title">
          {personal.correct ? MYSTERY_CORRECT : MYSTERY_WRONG}
        </h2>
      </header>

      <p className="cn-mystery-kicker">{MYSTERY_CASE_CLOSED}</p>
      <p className="cn-display cn-mystery-kda">{itWasLine(personal.actualName)}</p>
      {personal.correct ? null : <p className="cn-mystery-copy">{youGuessedLine(personal.guessedName)}</p>}

      {personal.firstDetective ? (
        <p className="cn-mystery-award">
          <strong>{MYSTERY_FIRST}.</strong> {firstDetectiveYou()}
        </p>
      ) : community.firstDetectiveClaimed ? (
        <p className="cn-hint">{MYSTERY_FIRST_TAKEN}</p>
      ) : null}

      {personal.correct ? (
        <p className="cn-mystery-copy">{cluesUsedLine(personal.cluesUsed)}</p>
      ) : (
        <p className="cn-mystery-copy">
          {notAloneWrong(Math.max(0, community.wrong - (personal.correct ? 0 : 1)))}
        </p>
      )}

      {personal.percentile === null ? null : (
        <p className="cn-mystery-award">{percentileLabel(personal.percentile)}</p>
      )}
      {personal.correct ? null : <p className="cn-hint">{fooledLine(community.wrongPercent)}</p>}

      <section className="cn-mystery-panel">
        <h3 className="cn-mystery-who">{MYSTERY_YOUR_RESULT}</h3>
        <ul className="cn-mystery-hooks">
          <li>
            <span className="cn-mystery-hook-label">{MYSTERY_TODAY_CLOSED}</span>
            <span>{personal.correct ? MYSTERY_CORRECT : MYSTERY_WRONG}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">Clues used</span>
            <span className="cn-num">{cluesUsedShort(personal.cluesUsed)}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">Solved in</span>
            <span className="cn-num">{solvedInLine(personal.completionTimeMs)}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">{yourGuessLine(personal.guessedName)}</span>
            <span>{personal.correct ? 'Yes' : actualPlayerLine(personal.actualName)}</span>
          </li>
        </ul>
      </section>

      <section className="cn-mystery-panel">
        <h3 className="cn-mystery-who">{performance.kda}</h3>
        <ul className="cn-mystery-hooks">
          {performance.champion === null ? null : (
            <li>
              <span className="cn-mystery-hook-label">Champion</span>
              <span>{performance.champion}</span>
            </li>
          )}
          {performance.role === null ? null : (
            <li>
              <span className="cn-mystery-hook-label">Role</span>
              <span>{performance.role.toUpperCase()}</span>
            </li>
          )}
          <li>
            <span className="cn-mystery-hook-label">Damage</span>
            <span className="cn-num">{performance.damageLabel}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">CS</span>
            <span className="cn-num">{performance.cs}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">Game</span>
            <span className="cn-num">
              {performance.durationLabel}
              {performance.startedLabel === '' ? '' : ` · ${performance.startedLabel}`}
            </span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">Result</span>
            <span>{performance.won ? 'Won' : 'Lost'}</span>
          </li>
        </ul>
      </section>

      <section className="cn-mystery-panel">
        <h3 className="cn-mystery-who">{MYSTERY_COMMUNITY}</h3>
        <ul className="cn-mystery-hooks">
          <li>
            <span className="cn-mystery-hook-label">Attempts</span>
            <span className="cn-num">{community.attempts}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">{MYSTERY_CORRECT}</span>
            <span className="cn-num">{community.correct}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">{MYSTERY_WRONG}</span>
            <span className="cn-num">{community.wrong}</span>
          </li>
          <li>
            <span className="cn-mystery-hook-label">Accuracy</span>
            <span className="cn-num">{community.accuracyPercent.toFixed(1)}%</span>
          </li>
        </ul>
        <p className="cn-hint">{communityAccuracyLine(community.accuracyPercent)}</p>
        <p className="cn-hint">{attemptsSoFarLine(community.attempts)}</p>
      </section>

      <section className="cn-mystery-panel">
        <h3 className="cn-mystery-who">{MYSTERY_BLAME}</h3>
        <ul className="cn-mystery-bars">
          {community.distribution.map((row) => (
            <li key={row.playerId}>
              <span className="cn-mystery-bar-name">{row.name}</span>
              <span className="cn-mystery-bar-track" aria-hidden="true">
                <span className="cn-mystery-bar-fill" style={{ width: `${row.percent}%` }} />
              </span>
              <span className="cn-num cn-mystery-bar-pct">{row.percent}%</span>
            </li>
          ))}
        </ul>
        {community.mostFalselyAccused === null ? null : (
          <p className="cn-mystery-copy">{mostAccusedLine(community.mostFalselyAccused.name)}</p>
        )}
      </section>

      <button type="button" className="cn-button" onClick={onShare}>
        {shareCopied ? MYSTERY_SHARE_DONE : MYSTERY_SHARE}
      </button>
      <span className="cn-sr-only">
        {personal.correct
          ? shareSolved(result.kind, result.challengeNumber, personal.cluesUsed, personal.percentile)
          : shareMissed(result.kind, result.challengeNumber)}
      </span>

      <Countdown expiresAt={result.expiresAt} now={now} />
    </section>
  );
}

function Countdown({ expiresAt, now }: { expiresAt: string; now: Date }) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now.getTime());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    <p className="cn-mystery-next">
      <span className="cn-mystery-hook-label">{MYSTERY_NEXT}</span>
      <span className="cn-num cn-mystery-count">
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
    </p>
  );
}
