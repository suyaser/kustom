import type { JSX } from 'react';
import { Frame } from '@/components/ui/frame';
import type { MainTabKey } from '@/lib/nav';

/**
 * The pending frame for one tab (05-design.md 5.9a, M19.14 sketches; M19.15). Drawn by `PendingMain`
 * in the browser when a tab tap is still pending after 300 ms; never streamed by the server, so no
 * route has a `loading.tsx` and a no-JS first load always gets the whole page (5.9).
 *
 * - **Shapes only**: `Frame` blocks (`--card`, 1px `--border`, card radius), no words, no spinner,
 *   no amber, no side colour, no motion. The h1 is a frame of its line height.
 * - **Real heights, from tokens**: seats `--seat-min-h`, rows `--row-min-h`, team headers `--thead-h`,
 *   the strip's top line `--chip-h`, pickers at their rendered height. Gutters, max widths and gaps are each page's
 *   own, so the first real block lands where its frame was (CLS <= 0.01).
 * - **First screen only**: the frame is clipped at the viewport minus the bars, so a short page never
 *   leaves a long empty frame behind.
 *
 * Takes the tab key and nothing else; it never fetches.
 */

/** 100svh minus the bars: the top bar always, the tab bar below 1024. */
const FIRST_SCREEN =
  'max-h-[calc(100svh-var(--topbar-h)-var(--tabbar-h)-env(safe-area-inset-bottom))] overflow-hidden lg:max-h-[calc(100svh-var(--topbar-h))]';

/** The board's and You's h1: `text-xl`, line height 1, so its line is `--fs-xl` tall (32). */
const H1 = 'h-(--fs-xl) w-40';
/** Games' and Stats' h1: `text-xl leading-tight`, 1.25 × `--fs-xl` (40, measured). */
const H1_TIGHT = 'h-[calc(var(--fs-xl)*1.25)] w-40';
/**
 * `SegLinks` (Games, Stats): 44px links inside a 4px pad and a 1px border, 54 tall (measured at 375
 * and 1280; M19.15 frames round, F4).
 */
const SEG = 'h-[calc(var(--tap)+0.5rem+2px)]';
/** The board's `WindowChips`: three 44px chips in a wrapping row, not a segmented bar (measured 44 × ~293). */
const CHIPS = 'h-(--tap) w-[18.5rem] max-w-full';
/** A caption line in `text-sm` (16 × 1.45, with mono numbers 24 measured; the board's 23). */
const CAPTION = 'h-6';
/** A labelled select row: the label, a 6px gap, the 44px select and its Show button (measured 72 on the board, 71 on Games). */
const BOARD_SORT = 'h-[calc(1.375rem+0.375rem+var(--tap))]';
const GAMES_PLAYER = 'h-[calc(1.3125rem+0.375rem+var(--tap))]';
/** List rows to the fold; `FIRST_SCREEN` clips whatever is past it. */
const LIST_ROWS = 12;
const ROW = 'h-(--row-min-h)';

export function TabFrame({ tab }: { tab: MainTabKey }) {
  return (
    <div data-slot="tab-frame" data-tab={tab} aria-hidden="true" className={`flex-1 ${FIRST_SCREEN}`}>
      {FRAMES[tab]()}
    </div>
  );
}

const FRAMES: Record<MainTabKey, () => JSX.Element> = {
  tonight: TonightFrame,
  board: BoardFrame,
  games: GamesFrame,
  stats: StatsFrame,
  you: YouFrame,
};

/**
 * Tonight, in the balanced shape (the tallest first screen and the most common landing): the strip
 * as one card with its rows (top line, headline, two reserved sub-lines; then the band or action row),
 * the two team cards (header + five seats, side by side from 768), and the rail's tape from 1024.
 * Same container as `TonightView`.
 */
function TonightFrame() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-(--gutter) pt-4 pb-8 lg:grid lg:grid-cols-[minmax(0,1fr)_var(--rail-w)] lg:items-start lg:gap-5 lg:pt-6">
      <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
        <Frame
          data-frame="strip"
          rows={2}
          rowClassName="first:h-[calc(var(--card-pad)+var(--chip-h)+0.5rem+var(--fs-display)*0.95+0.5rem+2.9*var(--fs-sm)+1rem)] h-[calc(var(--tap)+1.5rem)]"
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TeamCardFrame />
          <TeamCardFrame />
        </div>
      </div>
      <Frame data-frame="rail" className="hidden lg:flex" rows={4} rowClassName="h-(--seat-min-h)" />
    </div>
  );
}

function TeamCardFrame() {
  return (
    <Frame
      data-frame="team-card"
      rows={6}
      rowClassName="first:h-(--thead-h) h-(--seat-min-h)"
      className="overflow-hidden"
    />
  );
}

/**
 * The board, as `BoardView` draws it: h1, the window chips (a row about three chips wide), the window
 * caption, `Sort by` and its select (full width under 640, 192 from there), then the list.
 */
function BoardFrame() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
      <div className="flex flex-col gap-3">
        <Frame data-frame="h1" className={H1} />
        <Frame data-frame="picker" className={CHIPS} />
        <Frame data-frame="caption" className={CAPTION} />
        <Frame data-frame="select" className={`${BOARD_SORT} w-full sm:w-48`} />
      </div>
      <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
    </div>
  );
}

/**
 * Games, as `GamesList` draws it: h1 and the calibration sentence (two lines at 375, one from 768),
 * the window picker, then the queue picker and `Player` select (stacked, side by side from 768 with
 * the picker at the bottom of the row), the count line, then the list. Same 768 column, centred.
 */
function GamesFrame() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-(--gutter) py-6 lg:py-8">
      <div className="flex flex-col gap-2">
        <Frame data-frame="h1" className={H1_TIGHT} />
        <Frame data-frame="caption" className="h-[calc(2*var(--fs-sm)*1.45+1px)] md:h-6" />
      </div>
      <div className="flex flex-col gap-3">
        <Frame data-frame="picker" className={SEG} />
        <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-end">
          <Frame data-frame="picker" className={SEG} />
          <Frame data-frame="select" className={GAMES_PLAYER} />
        </div>
      </div>
      <Frame data-frame="caption" className={CAPTION} />
      <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
    </div>
  );
}

/**
 * Stats, always the Records shape (`StatsFrame` + Records): h1, the section, window and queue pickers
 * (the queue picker 224 wide from 768), the caption line, then the summary card of three rows and the
 * records, which flow into a second column from 1024 (5.14a).
 */
function StatsFrame() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-(--gutter) py-6 lg:max-w-6xl lg:py-8">
      <div className="flex flex-col gap-3">
        <Frame data-frame="h1" className={H1_TIGHT} />
        <Frame data-frame="picker" className={SEG} />
        <Frame data-frame="picker" className={SEG} />
        <Frame data-frame="picker" className={`${SEG} md:max-w-56`} />
        <Frame data-frame="caption" className={CAPTION} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-x-5">
        <div className="flex flex-col gap-4 lg:gap-5">
          <Frame data-frame="summary" rows={3} rowClassName="h-[46.2px]" />
          <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
        </div>
        <Frame data-frame="list" className="hidden lg:flex" rows={LIST_ROWS} rowClassName={ROW} />
      </div>
    </div>
  );
}

/** You: h1, then two cards of rows (the same frame signed in or out: it is the first screen only). */
function YouFrame() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
      <Frame data-frame="h1" className={H1} />
      <Frame data-frame="card" rows={4} rowClassName={ROW} />
      <Frame data-frame="card" rows={3} rowClassName={ROW} />
    </div>
  );
}
