import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { WINDOW_EMPTY, WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import { WINDOW_ORDER } from '@/lib/board/window';
import { GAMES_MODE_LABELS } from '@/lib/games/copy';
import type { QueueKind } from '@/lib/games/queue';
import type { WindowKind } from '@/lib/night';
import {
  capLine,
  MODE_PICKER_LABEL,
  SEE_ALL_TIME,
  SEGMENT_LABELS,
  SEGMENTS_LABEL,
  STATS_LABEL,
  type StatsSegment,
  WINDOW_PICKER_LABEL,
} from '@/lib/stats/copy';
import { cn } from '@/lib/utils';
import { SegLinks } from '../_games/SegLinks';

/**
 * The Stats tab's frame (M14.17; redesign/nav/proposal.md section 2, `a-stats-*.png`): one h1,
 * the three segments as links with `aria-current` (05-design 5.0), the five windows, the map
 * chips on the two segments that have them, the window's slot line, and the segment's body.
 * Every control is a link, so the page works with no JavaScript and every state has a URL.
 */
export interface StatsFrameProps {
  segment: StatsSegment;
  /** `href` for each segment, carrying `?window=` (and the mode between Records and Champions). */
  segmentHref: (segment: StatsSegment) => string;
  window: WindowKind;
  windowHref: (window: WindowKind) => string;
  /** Absent on 1v1, which is Rift only. */
  mode?: { selected: QueueKind; href: (mode: QueueKind) => string } | undefined;
  /** `null` for a window with no counted game: the slot prints the window's empty sentence. */
  range: string | null;
  games: number;
  capped: boolean;
  cap: number;
  /** A line under the slot (Records' awards-pending sentence). */
  hint?: string | null | undefined;
  /** Records: its sections flow into two columns from 1024 (the Records ruling). */
  columns?: boolean | undefined;
  children: ReactNode;
}

export function StatsFrame(props: StatsFrameProps) {
  const empty = props.range === null;
  return (
    <div className="flex-1">
      <div
        className={cn(
          'mx-auto flex w-full max-w-3xl flex-col gap-4 px-(--gutter) py-6 lg:py-8',
          props.columns && 'lg:max-w-6xl',
        )}
      >
        <header className="flex flex-col gap-3">
          <h1 className="text-xl leading-tight font-bold text-balance">{STATS_LABEL}</h1>
          <SegLinks
            label={SEGMENTS_LABEL}
            items={(['records', 'champions', 'versus'] as const).map((segment) => ({
              label: SEGMENT_LABELS[segment],
              href: props.segmentHref(segment),
              current: props.segment === segment,
            }))}
          />
          <SegLinks
            label={WINDOW_PICKER_LABEL}
            items={WINDOW_ORDER.map((window) => ({
              label: WINDOW_LABELS[window],
              href: props.windowHref(window),
              current: props.window === window,
            }))}
          />
          {props.mode === undefined ? null : (
            <SegLinks
              label={MODE_PICKER_LABEL}
              className="md:max-w-56"
              items={(['sr', 'aram'] as const).map((mode) => ({
                label: GAMES_MODE_LABELS[mode],
                href: props.mode?.href(mode) ?? '',
                current: props.mode?.selected === mode,
              }))}
            />
          )}
          {empty ? null : (
            // The board's slot line (design round 2): the window in bold, then the range and the
            // count in the text face with the numbers in mono. Same words, from `windowSlotLine`.
            <p className="text-sm text-pretty text-muted-foreground">
              <span className="font-bold text-foreground">{WINDOW_LABELS[props.window]}</span>
              {' · '}
              <MonoNumbers text={windowSlotLine(props.range as string, props.games)} />
            </p>
          )}
          {props.hint ? <p className="text-sm text-pretty text-muted-foreground">{props.hint}</p> : null}
          {props.capped ? <p className="text-sm text-muted-foreground">{capLine(props.cap)}</p> : null}
        </header>
        {empty ? (
          // 05-design 5.7: one sentence, at most one action, in a dashed card.
          <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-strong p-(--card-pad)">
            <p className="text-base">{WINDOW_EMPTY[props.window]}</p>
            {props.window === 'all-time' ? null : (
              <Button asChild variant="secondary">
                <Link href={props.windowHref('all-time') as Route}>{SEE_ALL_TIME}</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className={props.columns ? 'lg:columns-2 lg:gap-5' : 'flex flex-col gap-4 lg:gap-5'}>
            {props.children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Digits in mono, words in the text face (05-design 4): `first game 3 Oct 2026 · 8 games`. */
function MonoNumbers({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional parts of one fixed string
          <span key={i} className="num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
