import Link from 'next/link';
import {
  categoryLabel,
  challengeHeading,
  gameCopy,
  kdaLine,
  MYSTERY_CORRECT,
  MYSTERY_GUESS,
  MYSTERY_WRONG,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';

/**
 * Today's daily game on `/`, as one row that opens `/mystery` (2026-10-03).
 *
 * The full card — six names, the clue ladder, the case file — lived inline on the tonight page
 * and was most of a phone screen tall on a page whose job is "is the night happening and am I
 * in it". `/mystery` already renders the whole game from the same loader, so `/` keeps a
 * pointer: the game's own heading (as a card title), the day's question in one line, and what a
 * tap does.
 *
 * Every word is from `lib/mystery/copy.ts`; nothing here is new copy. Static once rendered —
 * no clock, no subscription — which is what lets it sit in the rail (the rail never carries
 * state). An **empty** day draws nothing: there is no game to point at, and `/mystery` still
 * shows the empty card to anyone who opens it from the nav.
 */
export function MysteryTeaser({
  mystery,
  className,
}: {
  mystery: MysteryPageState | null;
  /** The placement class: inline in the column, or in the ≥1080px rail. */
  className?: string;
}) {
  if (mystery === null || mystery.kind === 'empty') return null;

  const day = mystery.kind === 'play' ? mystery.play : mystery.result;
  const action =
    mystery.kind === 'play'
      ? MYSTERY_GUESS
      : mystery.result.personal.correct
        ? MYSTERY_CORRECT
        : MYSTERY_WRONG;
  const classes = ['cn-card', 'cn-mystery-teaser', className].filter(Boolean).join(' ');

  return (
    <Link href="/mystery" className={classes}>
      <span className="cn-mystery-teaser-body">
        {/* The card title every other card on the page wears (2026-10-03). It was the strip's
            date class — small tracked upper-case mono — and read as a second date line. */}
        <span className="cn-card-title">{challengeHeading(day.kind, day.challengeNumber)}</span>
        <span className="cn-mystery-teaser-line">
          {categoryLabel(day.category)}
          <span className="cn-mystery-teaser-sep" aria-hidden="true">
            {' · '}
          </span>
          {mystery.kind === 'play' ? (
            <span className="cn-num">{kdaLine(day.hook.kills, day.hook.deaths, day.hook.assists)}</span>
          ) : (
            <span>{gameCopy(day.kind).closedKicker}</span>
          )}
        </span>
      </span>
      <span
        className={
          mystery.kind === 'play'
            ? 'cn-mystery-teaser-action cn-mystery-teaser-go'
            : 'cn-mystery-teaser-action'
        }
      >
        {action}
      </span>
    </Link>
  );
}
