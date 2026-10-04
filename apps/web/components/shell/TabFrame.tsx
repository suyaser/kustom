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
 *   the strip's top line `--chip-h`, pickers `--tap`. Gutters, max widths and gaps are each page's
 *   own, so the first real block lands where its frame was (CLS <= 0.01).
 * - **First screen only**: the frame is clipped at the viewport minus the bars, so a short page never
 *   leaves a long empty frame behind.
 *
 * Takes the tab key and nothing else; it never fetches.
 */

/** 100svh minus the bars: the top bar always, the tab bar below 1024. */
const FIRST_SCREEN =
  'max-h-[calc(100svh-var(--topbar-h)-var(--tabbar-h)-env(safe-area-inset-bottom))] overflow-hidden lg:max-h-[calc(100svh-var(--topbar-h))]';

/** The pages' h1: `text-xl`, line height 1, so its line is `--fs-xl` tall. */
const H1 = 'h-(--fs-xl) w-40';
/** A segmented picker (window, queue, section): one row of 44px links. */
const PICKER = 'h-(--tap)';
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

/** The board: h1, the window picker, the list. Same container as `BoardView`. */
function BoardFrame() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
      <div className="flex flex-col gap-3">
        <Frame data-frame="h1" className={H1} />
        <Frame data-frame="picker" className={PICKER} />
      </div>
      <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
    </div>
  );
}

/** Games: h1, the queue picker, the list. Same container as `GamesList`. */
function GamesFrame() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-(--gutter) py-6 lg:py-8">
      <Frame data-frame="h1" className={H1} />
      <Frame data-frame="picker" className={PICKER} />
      <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
    </div>
  );
}

/**
 * Stats, always the Records shape: h1, the section and window pickers, the section summary, the rows
 * (two columns from 1024, 5.14a). Same container as `StatsFrame` with Records' columns.
 */
function StatsFrame() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-(--gutter) py-6 lg:max-w-6xl lg:py-8">
      <div className="flex flex-col gap-3">
        <Frame data-frame="h1" className={H1} />
        <Frame data-frame="picker" className={PICKER} />
        <Frame data-frame="picker" className={PICKER} />
        <Frame data-frame="summary" className="h-[52px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Frame data-frame="list" rows={LIST_ROWS} rowClassName={ROW} />
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
